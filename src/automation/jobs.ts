import type { RecordStore } from './storage';
export interface AgentJob {
  id: string; projectId: string; kind: string; createdAt: number; updatedAt: number;
  status: 'queued' | 'running' | 'saving' | 'completed' | 'error' | 'cancelled' | 'interrupted';
  progress?: unknown; result?: unknown; error?: string; cancelRequested?: boolean;
}
export interface JobContext { signal: AbortSignal; check(): void; progress(value: unknown): void }
export function createAgentJobs(storage: RecordStore, id: () => string, lock: (busy: boolean) => void) {
  const controllers = new Map<string, AbortController>();
  let active: string | undefined;
  let writes = Promise.resolve();
  const persist = (job: AgentJob) => {
    const copy = structuredClone(job);
    const next = writes.catch(() => {}).then(() => storage.put('job:' + copy.id, copy));
    writes = next; return next;
  };
  const read = async (jobId: string) => {
    await writes;
    const job = await storage.get<AgentJob>('job:' + jobId);
    if (!job) throw new Error('Trabajo inexistente.');
    return job;
  };
  return {
    busy: () => !!active,
    async recover() {
      for (const job of await storage.list<AgentJob>('job:')) {
        if (job.status === 'running' || job.status === 'queued' || job.status === 'saving') {
          job.status = 'interrupted'; job.error = 'Clipo se cerró durante el trabajo. Revisa el proyecto y los archivos antes de repetirlo.';
          job.updatedAt = Date.now(); await persist(job);
        }
      }
    },
    async start(projectId: string, kind: string, run: (ctx: JobContext) => Promise<unknown>) {
      if (active) throw new Error('Ya hay un trabajo de MCP en curso.');
      const job: AgentJob = { id: id(), projectId, kind, createdAt: Date.now(), updatedAt: Date.now(), status: 'queued' };
      active = job.id; lock(true);
      const controller = new AbortController(); controllers.set(job.id, controller);
      try { await persist(job); } catch (e) { active = undefined; controllers.delete(job.id); lock(false); throw e; }
      void Promise.resolve().then(async () => {
        let lastProgress = 0;
        const check = () => { if (controller.signal.aborted) throw new Error('cancelled'); };
        try {
          job.status = 'running'; await persist(job); check();
          job.result = await run({ signal: controller.signal, check, progress(value) {
            job.progress = value;
            if (Date.now() - lastProgress > 300) { lastProgress = Date.now(); void persist(job).catch(() => {}); }
          } });
          job.status = 'completed';
        } catch (e) {
          job.status = controller.signal.aborted ? 'cancelled' : 'error';
          if (job.status === 'error') job.error = e instanceof Error ? e.message : String(e);
        } finally {
          job.updatedAt = Date.now();
          // A failed final write is surfaced by polling, never as a false durable success.
          try { await persist(job); } catch { /* read() reports the persistence error */ }
          controllers.delete(job.id); active = undefined; lock(false);
        }
      });
      return structuredClone(job);
    },
    read,
    async list() { await writes; return (await storage.list<AgentJob>('job:')).sort((a, b) => b.createdAt - a.createdAt); },
    async cancel(jobId: string) {
      const job = await read(jobId);
      const controller = controllers.get(jobId);
      if (controller) { controller.abort(); job.cancelRequested = true; await persist(job); }
      return job;
    },
  };
}
