import { selectionExists, useStore } from '../store';
import type { Project } from '../types';
import { getBlob, getProject, listProjectMeta, projectMeta, saveProject } from '../db';
import { saveNow, trackedSave, useSaveState } from '../saveState';
import { layout, totalDuration } from '../model';
import { toolSchemas, type ToolName } from './schema';
import { applyEdits, catalog } from './edits';
import { createCaptionJobs } from './captionJobs';
import { createEditorUi } from './editorUi';
import { runAction, agentJobs, verifySaved } from './actions';
import { agentStorage, projectDigest } from './storage';
import { getArtifact, publicArtifact, readArtifact } from './artifacts';
import { compactResult, page, publicProject, queryProject } from './queries';
import { AgentError, errorDetails } from './errors';
import { createRequestJournal, type RequestRecord } from './requests';
import { planDifferences } from './plan';

interface AgentRequest { requestId: string; deadline: number; tool: string; args: unknown }
interface AgentBridge {
  ready(): Promise<void>;
  onRequest(cb: (request: AgentRequest) => void): () => void;
  onCancel(cb: (id: string) => void): () => void;
  respond(response: { requestId: string; result?: unknown; error?: string; errorDetails?: ReturnType<typeof errorDetails> }): void;
  readMedia(requestId: string, path: string): Promise<{ name: string; bytes: ArrayBuffer }>;
  statMedia(requestId: string, path: string): Promise<{ name: string; size: number; mtimeMs: number }>;
  compatibleMedia(requestId: string, path: string, range?: { from: number; to: number }): Promise<{ path: string; receipt: unknown }>;
  readMediaChunk(requestId: string, path: string, expected: { size: number; mtimeMs: number }, offset: number, length: number): Promise<ArrayBuffer>;
  closeEditor(requestId: string): Promise<void>;
}
declare global { interface Window { clipoAgent?: AgentBridge } }

async function readLocalFile(bridge: AgentBridge, requestId: string, path: string, unchanged: () => void): Promise<File> {
  const info = await bridge.statMedia(requestId, path); unchanged();
  // Blob backing storage can spill to disk; never send the whole movie in one IPC
  // message or concatenate all of its bytes in the main process.
  let blob = new Blob([]);
  for (let offset = 0; offset < info.size; offset += 8 * 1024 * 1024) {
    unchanged();
    const bytes = await bridge.readMediaChunk(requestId, path, info, offset, Math.min(8 * 1024 * 1024, info.size - offset));
    unchanged(); blob = new Blob([blob, bytes]);
  }
  const final = await bridge.statMedia(requestId, path); unchanged();
  if (final.size !== info.size || final.mtimeMs !== info.mtimeMs) throw new Error('El archivo cambió durante la importación.');
  return new File([blob], info.name, { lastModified: info.mtimeMs });
}

let revision = 0;
const captionJobs = createCaptionJobs({ save: verifySaved, persist: (job) => agentStorage.put('job:' + job.id, job) });
const editorUi = createEditorUi();
const requestJournal = createRequestJournal(agentStorage, projectDigest);
useStore.subscribe((s, prev) => { if (s.project !== prev.project) revision++; });

function snapshot() {
  const s = useStore.getState();
  const p = s.project;
  // Media stay local. Thumbnails/LUT data make text responses huge and aren't needed to edit.
  const project = p ? publicProject(p) : null;
  return { revision, project, time: s.time, duration: p ? totalDuration(p) : 0,
    timeline: p ? layout(p).map(({ clip, start, end }) => ({ id: clip.id, start, end })) : [],
    canUndo: s.past.length > 0, canRedo: s.future.length > 0, captioning: s.captioning, exporting: s.exporting,
    proxyPreview: s.proxyPreview, proxyJob: s.proxyJob, proxyAssets: Object.keys(s.proxyUrls),
    saveStatus: useSaveState.getState().status };
}

async function flush() {
  await saveNow();
  if (useSaveState.getState().status === 'error') throw new Error('Los cambios están en la interfaz, pero no se pudieron guardar. Libera espacio y usa clipo_save_project.');
}

/** Registered once at startup, including when the home screen has no project open. */
export async function startAgentBridge() {
  const bridge = window.clipoAgent;
  if (!bridge) return;
  await agentJobs.recover();
  await requestJournal.recover();
  const cancelled = new Set<string>();
  const active = new Set<string>();
  bridge.onCancel((id) => { if (active.has(id)) cancelled.add(id); });
  bridge.onRequest(async (request) => {
    active.add(request.requestId);
    const initialRevision = revision;
    let journalRecord: RequestRecord | undefined;
    const alive = () => {
      if (cancelled.has(request.requestId) || Date.now() >= request.deadline) throw new Error('Comando caducado. Lee el proyecto antes de reintentar.');
    };
    const unchanged = () => {
      alive();
      if (revision !== initialRevision) throw new Error('El proyecto cambió durante el comando. Vuelve a leerlo antes de editar.');
    };
    try {
      alive();
      if (!Object.hasOwn(toolSchemas, request.tool)) throw new Error('Herramienta desconocida.');
      const name = request.tool as ToolName;
      const args = toolSchemas[name].parse(request.args);
      if ('requestKey' in args && args.requestKey && name !== 'clipo_get_request') {
        const recorded = await requestJournal.lookup(args.requestKey, name, args);
        if (recorded) {
          if (recorded.status !== 'completed') throw new AgentError('OUTCOME_UNKNOWN', 'La solicitud tiene un resultado incierto. Consulta clipo_get_request y revisa proyecto/trabajos. No se repitió.');
          bridge.respond({ requestId: request.requestId, result: { ...compactResult(snapshot()) as object, requestKey: args.requestKey, replayed: true, requestResult: recorded.result } });
          return;
        }
      }
      const s = useStore.getState();
      if ('expectedRevision' in args && args.expectedRevision !== revision) throw new AgentError('CONFLICT', 'Versión desactualizada. Usa clipo_get_project y reintenta con su revision.');
      if ('projectId' in args && !['clipo_open_project', 'clipo_list_jobs'].includes(name) && args.projectId !== (s.project?.id ?? null)) throw new AgentError('CONFLICT', 'Ese proyecto no está abierto.');
      if (!['clipo_query_project', 'clipo_get_request', 'clipo_status', 'clipo_list_projects', 'clipo_get_project', 'clipo_preview', 'clipo_get_audio', 'clipo_get_ui', 'clipo_get_caption_job', 'clipo_cancel_caption_job', 'clipo_list_jobs', 'clipo_get_job', 'clipo_cancel_job', 'clipo_read_artifact', 'clipo_audit'].includes(name) && (s.exporting || s.captioning || agentJobs.busy())) throw new AgentError('BUSY', 'Espera a que termine el trabajo o cancélalo con su ID.');
      if ('requestKey' in args && args.requestKey && name !== 'clipo_get_request') { journalRecord = await requestJournal.begin(args.requestKey, name, args); unchanged(); }
      let result: unknown;
      switch (name) {
        case 'clipo_get_request': {
          const a = toolSchemas.clipo_get_request.parse(args);
          result = { request: await requestJournal.read(a.requestKey) }; break;
        }
        case 'clipo_query_project': {
          if (!s.project) throw new Error('Abre un proyecto primero.');
          result = { revision, projectId: s.project.id, ...queryProject(s.project, toolSchemas.clipo_query_project.parse(args)) }; break;
        }
        case 'clipo_inspect_media': {
          const a = toolSchemas.clipo_inspect_media.parse(args);
          const asset = s.project && Object.hasOwn(s.project.assets, a.assetId) ? s.project.assets[a.assetId] : undefined;
          if (!asset || asset.kind === 'audio') throw new Error('Selecciona un video o imagen existente.');
          const blob = await getBlob(asset.id); unchanged();
          if (!blob) throw new Error('Falta el medio original.');
          const { inspectVisual } = await import('./visualReview'); unchanged();
          result = { revision, projectId: s.project!.id, assetId: asset.id, domain: 'source', ...await inspectVisual(blob, asset.kind, a, unchanged) }; break;
        }
        case 'clipo_review_export': {
          const a = toolSchemas.clipo_review_export.parse(args);
          const artifact = await getArtifact(a.artifactId); alive();
          if (!artifact.type.startsWith('video/')) throw new Error('Selecciona un artefacto de video.');
          if (a.includeAudio && a.to - a.from > 60) throw new Error('La revisión con audio admite hasta 60 segundos.');
          const { inspectVisual, inspectRenderedAudio } = await import('./visualReview'); alive();
          const visual = await inspectVisual(artifact.blob, 'video', a, alive);
          const audio = a.includeAudio ? await inspectRenderedAudio(artifact.blob, a.from, a.to, alive) : {};
          result = { artifact: publicArtifact(artifact), domain: 'export', ...visual, ...audio,
            durationCheck: a.expectedDuration === undefined ? { measured: false, reason: 'No se suministró expectedDuration.' }
              : { measured: true, expected: a.expectedDuration, actual: visual.media.duration, matches: Math.abs(visual.media.duration! - a.expectedDuration) <= 0.2 } }; break;
        }
        case 'clipo_close_editor': {
          const receipt = await verifySaved(); unchanged();
          const at = Date.now();
          await agentStorage.put('audit:' + at + ':' + request.requestId, { at, requestId: request.requestId, tool: name, projectId: s.project?.id, beforeRevision: revision, afterRevision: revision, outcome: 'closing', receipt });
          unchanged();
          await bridge.closeEditor(request.requestId);
          result = { ...snapshot(), closing: true, receipt }; break;
        }
        case 'clipo_action': {
          const a = toolSchemas.clipo_action.parse(args);
          const actionResult = await runAction(a.request, alive);
          result = { ...snapshot(), ...(actionResult as object) }; break;
        }
        case 'clipo_plan_edit': {
          if (!s.project) throw new Error('Abre un proyecto primero.');
          const a = toolSchemas.clipo_plan_edit.parse(args);
          const plan = applyEdits(s.project, a.operations);
          result = { ...snapshot(), dryRun: true, plan: { duration: totalDuration(plan.project), clips: plan.project.clips.length, texts: plan.project.texts.length, audios: plan.project.audios.length, added: plan.added,
            ...planDifferences(s.project, plan.project) }, appliesToRevision: revision }; break;
        }
        case 'clipo_list_jobs': {
          const a = toolSchemas.clipo_list_jobs.parse(args);
          const jobs = (await agentJobs.list()).filter((j) => (!a.projectId || j.projectId === a.projectId) && (!a.status || j.status === a.status));
          const { items, ...pagination } = page(jobs, a.offset, a.limit);
          result = { ...snapshot(), jobs: items, pagination }; break;
        }
        case 'clipo_get_job': {
          const id = toolSchemas.clipo_get_job.parse(args).jobId;
          const job = captionJobs.has(id) ? captionJobs.read(id) : await agentJobs.read(id);
          result = { ...snapshot(), job }; break;
        }
        case 'clipo_cancel_job': {
          const id = toolSchemas.clipo_cancel_job.parse(args).jobId;
          const job = captionJobs.has(id) ? captionJobs.cancel(id) : await agentJobs.cancel(id);
          result = { ...snapshot(), job }; break;
        }
        case 'clipo_read_artifact': {
          const a = toolSchemas.clipo_read_artifact.parse(args); result = await readArtifact(a.artifactId, a.offset, a.length); break;
        }
        case 'clipo_audit': {
          const records = await agentStorage.list<{ at: number }>('audit:');
          result = { records: records.sort((a, b) => b.at - a.at).slice(0, toolSchemas.clipo_audit.parse(args).limit) }; break;
        }
        case 'clipo_status': result = { ...snapshot(), connection: 'desktop-local', catalog: catalog() }; break;
        case 'clipo_get_project': result = snapshot(); break;
        case 'clipo_review_audio': {
          const a = toolSchemas.clipo_review_audio.parse(args);
          const job = captionJobs.start({ language: a.language, quality: a.quality,
            look: { style: 'viral', karaoke: 'color', color: '#ffe500', chunk: 'corto' },
            source: { assetId: a.assetId, from: a.from, to: a.to } });
          result = { ...snapshot(), job }; break;
        }
        case 'clipo_get_audio': {
          const a = toolSchemas.clipo_get_audio.parse(args);
          if (!s.project) throw new Error('Abre un proyecto primero.');
          const { reviewAudio } = await import('./reviewAudio'); unchanged();
          const audio = await reviewAudio(s.project, a.assetId, a.from, a.to, unchanged);
          result = { ...snapshot(), ...audio }; break;
        }
        case 'clipo_get_ui': {
          const a = toolSchemas.clipo_get_ui.parse(args);
          result = { ...snapshot(), ui: editorUi.read(a.filter, a.offset, a.limit) }; break;
        }
        case 'clipo_ui_action': {
          const a = toolSchemas.clipo_ui_action.parse(args);
          const ui = await editorUi.action(a.viewId, a.controlId, a.action, a.value, a.key, a.delta);
          result = { ...snapshot(), ui }; break;
        }
        case 'clipo_set_input_files': {
          const a = toolSchemas.clipo_set_input_files.parse(args);
          editorUi.fileInput(a.viewId, a.controlId);
          const files: File[] = [];
          for (const path of a.paths) {
            files.push(await readLocalFile(bridge, request.requestId, path, unchanged));
          }
          const ui = await editorUi.attach(a.viewId, a.controlId, files);
          result = { ...snapshot(), ui, accepted: files.map((f) => f.name) }; break;
        }
        case 'clipo_editor': {
          const a = toolSchemas.clipo_editor.parse(args);
          const { engine } = await import('../engine'); unchanged();
          if (a.selection && !selectionExists(s.project, a.selection)) throw new Error('El elemento seleccionado no existe.');
          if (a.selection !== undefined) s.select(a.selection);
          if (a.advanced !== undefined) s.setAdvanced(a.advanced);
          if (a.panel !== undefined) s.setPanel(a.panel);
          if (a.snap !== undefined) s.setSnap(a.snap);
          if (a.proxyPreview !== undefined) s.setProxyPreview(a.proxyPreview);
          if (a.zoom !== undefined) s.setPps(a.zoom);
          if (a.playing !== undefined) a.playing ? await engine.play() : engine.pause();
          await new Promise((r) => setTimeout(r, 40));
          result = { ...snapshot(), ui: editorUi.read() }; break;
        }
        case 'clipo_generate_captions': {
          const a = toolSchemas.clipo_generate_captions.parse(args);
          const { engine } = await import('../engine');
          if (a.look.style === 'marca' && !(await import('../brand')).getBrand()) throw new Error('Configura una marca antes de usar ese estilo.');
          unchanged();
          engine.pause();
          const job = captionJobs.start({ language: a.language, quality: a.quality, look: a.look });
          result = { ...snapshot(), job };
          break;
        }
        case 'clipo_get_caption_job': {
          const id = toolSchemas.clipo_get_caption_job.parse(args).jobId;
          const job = captionJobs.has(id) ? captionJobs.read(id) : await agentJobs.read(id);
          result = { ...snapshot(), job }; break;
        }
        case 'clipo_cancel_caption_job': {
          const id = toolSchemas.clipo_cancel_caption_job.parse(args).jobId;
          const job = captionJobs.has(id) ? captionJobs.cancel(id) : await agentJobs.cancel(id);
          result = { ...snapshot(), job }; break;
        }
        case 'clipo_preview': result = { ...snapshot(), view: { editorVisible: !!document.querySelector('.editor'), previewVisible: !!document.querySelector('.preview-canvas') } }; break;
        case 'clipo_list_projects': {
          const a = toolSchemas.clipo_list_projects.parse(args);
          const rows = (await listProjectMeta()).filter((p) => !a.search || p.name.toLocaleLowerCase().includes(a.search.toLocaleLowerCase())).sort((a, b) => a.id.localeCompare(b.id));
          const { items, ...pagination } = page(rows, a.offset, a.limit); unchanged();
          result = { revision, projects: items.map(({ thumb: _thumb, ...p }) => p), pagination }; break;
        }
        case 'clipo_create_project': {
          const a = toolSchemas.clipo_create_project.parse(args);
          await flush();
          unchanged();
          const { newProject } = await import('../ops');
          unchanged();
          const p = { ...newProject(a.aspect), name: a.name };
          // Commit synchronously to the store before any async persistence: a manual edit
          // during saving must never be overwritten by opening a stale snapshot afterwards.
          s.close();
          s.open(p, {});
          await flush();
          result = snapshot();
          break;
        }
        case 'clipo_open_project': {
          const a = toolSchemas.clipo_open_project.parse(args);
          if (s.project?.id === a.projectId) { result = snapshot(); break; }
          await flush();
          const p = await getProject(a.projectId);
          if (!p) throw new Error('Proyecto inexistente.');
          const urls: Record<string, string> = {};
          const missing: string[] = [];
          try {
            for (const id of Object.keys(p.assets)) {
              const b = await getBlob(id);
              if (b) urls[id] = URL.createObjectURL(b);
              else missing.push(id);
            }
            unchanged();
            s.close();
            s.open(p, urls);
          } catch (e) { Object.values(urls).forEach(URL.revokeObjectURL); throw e; }
          result = { ...snapshot(), missingAssets: missing };
          break;
        }
        case 'clipo_import_media': {
          const a = toolSchemas.clipo_import_media.parse(args);
          if (!s.project) throw new Error('Abre o crea un proyecto primero.');
          const { importFiles } = await import('../media');
          const imported: string[] = [];
          const failed: string[] = [];
          const receipts: unknown[] = [];
          const assets: Project['assets'] = {};
          try {
            for (const [index, path] of a.paths.entries()) {
              unchanged();
              const prepared = a.normalize ? await bridge.compatibleMedia(request.requestId, path, a.ranges?.[index]) : null;
              unchanged();
              const file = await readLocalFile(bridge, request.requestId, prepared?.path ?? path, unchanged);
              unchanged();
              const r = await importFiles([file]);
              failed.push(...r.failed);
              for (const asset of r.ok) { imported.push(asset.id); assets[asset.id] = asset; }
              if (prepared) receipts.push({ assetIds: r.ok.map(asset => asset.id), ...prepared.receipt as object });
              unchanged();
            }
            for (const id of imported) if (!await getBlob(id)) throw new Error('No se pudo guardar el archivo importado.');
            unchanged();
            if (imported.length) s.commit((p) => { Object.assign(p.assets, assets); });
          } catch (e) {
            const urls = { ...useStore.getState().urls };
            for (const id of imported) { if (urls[id]) URL.revokeObjectURL(urls[id]); delete urls[id]; }
            useStore.setState({ urls });
            throw e;
          }
          await flush();
          result = { ...snapshot(), imported, failed, receipts };
          break;
        }
        case 'clipo_import_capcut': {
          const a = toolSchemas.clipo_import_capcut.parse(args);
          const parser = await import('../importers/capcut'); const { buildProject } = await import('../importers/capcutProject');
          await flush(); unchanged(); const files: File[] = [];
          for (const path of a.paths) files.push(await readLocalFile(bridge, request.requestId, path, unchanged));
          const draft = parser.findDraftFile(files); if (!draft) throw new Error('Falta el JSON de CapCut.');
          const parsed = parser.parseDraft(await draft.text()); if (!parsed.ok) throw new Error(parser.FAILURE_MESSAGE[parsed.reason]);
          const built = await buildProject(parsed.plan, parser.matchMedia(Object.values(parsed.plan.media), files.filter((f) => f !== draft)));
          const urls: Record<string, string> = {};
          try {
            for (const id of Object.keys(built.project.assets)) { const blob = await getBlob(id); if (!blob) throw new Error('No se guardó un archivo importado.'); urls[id] = URL.createObjectURL(blob); }
            unchanged(); s.close(); s.open(built.project, urls); await flush();
          } catch (e) { Object.values(urls).forEach(URL.revokeObjectURL); throw e; }
          result = { ...snapshot(), problems: [...parsed.plan.skipped, ...built.problems], receipt: await verifySaved() }; break;
        }
        case 'clipo_edit': {
          const a = toolSchemas.clipo_edit.parse(args);
          if (!s.project) throw new Error('Abre o crea un proyecto primero.');
          const edit = applyEdits(s.project, a.operations);
          const { engine } = await import('../engine');
          unchanged();
          engine.pause();
          s.commit((p) => { Object.assign(p, edit.project); });
          s.notify('Edición de IA aplicada · puedes deshacerla');
          await flush();
          result = { ...snapshot(), added: edit.added, receipt: await verifySaved() };
          break;
        }
        case 'clipo_undo':
        case 'clipo_redo': {
          const { engine } = await import('../engine');
          unchanged();
          engine.pause();
          s[name === 'clipo_undo' ? 'undo' : 'redo']();
          await flush();
          result = snapshot();
          break;
        }
        case 'clipo_save_project': {
          await saveNow();
          // Retry explicitly, even if a previous failed autosave has no pending write.
          const p = useStore.getState().project;
          if (p) await trackedSave(p, saveProject);
          result = { ...snapshot(), savedProject: p ? projectMeta(p).id : null };
          break;
        }
        case 'clipo_seek': {
          const a = toolSchemas.clipo_seek.parse(args);
          if (a.time > (s.project ? totalDuration(s.project) : 0)) throw new Error('Tiempo fuera del proyecto.');
          const { engine } = await import('../engine');
          unchanged();
          engine.seek(a.time);
          result = snapshot();
          break;
        }
        default: throw new Error('Esta herramienta se ejecuta en el servidor MCP, no directamente en el editor.');
      }
      if ('expectedRevision' in args && !['clipo_query_project', 'clipo_inspect_media', 'clipo_seek', 'clipo_editor', 'clipo_plan_edit', 'clipo_close_editor'].includes(name)) {
        const record = { at: Date.now(), requestId: request.requestId, tool: name, action: name === 'clipo_action' ? toolSchemas.clipo_action.parse(request.args).request.action : undefined,
          beforeRevision: initialRevision, afterRevision: revision, projectId: useStore.getState().project?.id,
          projectSha256: await projectDigest(useStore.getState().project), outcome: 'returned', result: result && typeof result === 'object' && 'job' in result ? { job: (result as { job: unknown }).job } : undefined };
        await agentStorage.put('audit:' + record.at + ':' + request.requestId, record);
        const old = (await agentStorage.list<{ at: number; requestId: string }>('audit:')).sort((a, b) => b.at - a.at).slice(500);
        for (const r of old) await agentStorage.remove('audit:' + r.at + ':' + r.requestId);
      }
      if (journalRecord) {
        // Persist only a compact receipt: no full project, base64 media or original tool arguments.
        const compact = compactResult(result) as Record<string, unknown>;
        await requestJournal.complete(journalRecord, compact);
        result = { ...result as object, requestKey: journalRecord.key };
      }
      bridge.respond({ requestId: request.requestId, result: 'response' in args && args.response === 'summary' ? compactResult(result) : result });
    } catch (e) {
      if (journalRecord) {
        try { await requestJournal.uncertain(journalRecord, e instanceof Error ? e.message : String(e)); } catch { /* durable running record remains uncertain */ }
      }
      bridge.respond({ requestId: request.requestId, error: e instanceof Error ? e.message : String(e), errorDetails: errorDetails(e) });
    }
    finally { active.delete(request.requestId); cancelled.delete(request.requestId); }
  });
  await bridge.ready();
}
