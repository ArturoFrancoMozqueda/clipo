import { uid, useStore } from '../store';
import { saveNow, useSaveState } from '../saveState';
import type { AudioReviewOptions, CaptionLook, CaptionProgress, CaptionQuality } from '../captions';

export interface CaptionJobOptions { language: string; quality: CaptionQuality; look: CaptionLook; source?: { assetId: string; from: number; to: number } }
interface CaptionModule {
  generateCaptions(options: CaptionJobOptions & { onProgress(p: CaptionProgress): void }): Promise<number>;
  cancelCaptions(): void;
  reviewSourceAudio?(options: AudioReviewOptions): Promise<unknown>;
}
export interface CaptionJob {
  id: string;
  projectId: string;
  status: 'queued' | 'running' | 'saving' | 'completed' | 'error' | 'cancelled';
  progress: CaptionProgress | null;
  count?: number;
  error?: string;
  kind: 'captions' | 'audio-review';
  result?: unknown;
  createdAt: number;
  updatedAt: number;
}

/** Long transcriptions outlive one MCP request. Polling never starts a second run. */
export function createCaptionJobs(deps: { load?: () => Promise<CaptionModule>; save?: () => Promise<unknown>; persist?: (job: CaptionJob) => Promise<void> } = {}) {
  const jobs = new Map<string, CaptionJob>();
  let active: { job: CaptionJob; cancel: boolean; module?: CaptionModule } | null = null;
  const read = (id: string) => {
    const job = jobs.get(id);
    if (!job) throw new Error('Trabajo de subtítulos inexistente en esta sesión.');
    return structuredClone(job);
  };
  const save = deps.save ?? (async () => {
    await saveNow();
    if (useSaveState.getState().status === 'error') throw new Error('Los subtítulos están aplicados, pero no se pudieron guardar. Usa clipo_save_project para reintentar.');
  });
  return {
    start(options: CaptionJobOptions) {
      const state = useStore.getState();
      if (!state.project) throw new Error('Abre un proyecto primero.');
      if (active || state.captioning || state.exporting) throw new Error('Ya hay una transcripción o exportación en curso.');
      while (jobs.size >= 20) jobs.delete(jobs.keys().next().value!);
      const job: CaptionJob = { id: uid(), projectId: state.project.id, kind: options.source ? 'audio-review' : 'captions', status: 'queued', progress: null, createdAt: Date.now(), updatedAt: Date.now() };
      const run = { job, cancel: false, module: undefined as CaptionModule | undefined };
      active = run;
      jobs.set(job.id, job);
      state.setCaptioning(true);
      void Promise.resolve().then(async () => {
        try {
          await deps.persist?.(structuredClone(job));
          const captions = await (deps.load ?? (() => import('../captions')))();
          run.module = captions;
          if (run.cancel || useStore.getState().project?.id !== job.projectId) throw new Error('cancelled');
          job.status = 'running';
          let lastProgress = 0;
          const onProgress = (progress: CaptionProgress) => {
            job.progress = progress;
            if (Date.now() - lastProgress > 300) { lastProgress = Date.now(); void deps.persist?.(structuredClone(job)).catch(() => {}); }
          };
          if (options.source) {
            if (!captions.reviewSourceAudio) throw new Error('La revisión de audio no está disponible.');
            job.result = await captions.reviewSourceAudio({ ...options.source, project: state.project!, urls: state.urls,
              language: options.language, quality: options.quality, onProgress });
          } else job.count = await captions.generateCaptions({ ...options, onProgress });
          if (run.cancel) throw new Error('cancelled');
          if (!options.source) { job.status = 'saving'; const receipt = await save(); if (receipt !== undefined) job.result = { receipt }; }
          job.status = 'completed';
          if (!options.source) useStore.getState().notify(`Listo: ${job.count} subtítulos generados por MCP`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          job.status = run.cancel || message === 'cancelled' ? 'cancelled' : 'error';
          if (job.status === 'error') job.error = message;
        } finally {
          job.updatedAt = Date.now();
          try { await deps.persist?.(structuredClone(job)); }
          catch { job.status = 'error'; job.error = 'No se pudo guardar el estado del trabajo. Lee el proyecto antes de repetirlo.'; }
          state.setCaptioning(false);
          active = null;
        }
      });
      return read(job.id);
    },
    read,
    has: (id: string) => jobs.has(id),
    cancel(id: string) {
      read(id); // Unknown IDs never cancel another request's job.
      if (active?.job.id === id) {
        active.cancel = true;
        active.module?.cancelCaptions();
      }
      return read(id);
    },
  };
}
