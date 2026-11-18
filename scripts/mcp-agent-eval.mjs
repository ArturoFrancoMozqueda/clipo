// Provider-independent task evaluation against real MCP + isolated Electron.
// Default = scripted reference, NOT a measurement of an LLM's editing ability.
// --driver /absolute/adapter.mjs exports async runTask({prompt, tools, call, context}).
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import electron from 'electron';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const tasks = JSON.parse(await readFile(new URL('../evals/mcp-tasks.json', import.meta.url), 'utf8'));
const driverIndex = process.argv.indexOf('--driver');
if (driverIndex >= 0 && !process.argv[driverIndex + 1]) throw new Error('--driver requiere un módulo local.');
const driverPath = driverIndex >= 0 ? path.resolve(process.argv[driverIndex + 1]) : null;
const driver = driverPath ? (await import(pathToFileURL(driverPath).href)).runTask : reference;
if (typeof driver !== 'function') throw new Error('El adaptador debe exportar runTask.');
const dir = await mkdtemp(path.join(tmpdir(), 'clipo-mcp-eval-'));
const env = { ...process.env, CLIPO_SMOKE: '1', CLIPO_SMOKE_EXTERNAL: '1', CLIPO_SMOKE_DATA: path.join(dir, 'profile'), CLIPO_BRIDGE_FILE: path.join(dir, 'automation.json') };
delete env.ELECTRON_RUN_AS_NODE; delete env.CLIPO_AUTOMATION;
const desktop = spawn(electron, ['.'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let desktopLog = ''; desktop.stdout.on('data', (b) => { desktopLog += b; }); desktop.stderr.on('data', (b) => { desktopLog += b; });
const client = new Client({ name: 'clipo-task-evaluation', version: '1' });
const guard = (s) => ({ projectId: s.project?.id ?? s.projectSummary.id, expectedRevision: s.revision });
async function raw(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const state = r.structuredContent ?? JSON.parse(r.content.find((c) => c.type === 'text').text);
  if (r.isError) throw Object.assign(new Error(state.error?.message ?? JSON.stringify(state)), { code: state.error?.code });
  return state;
}
async function ready() {
  const end = Date.now() + 40000;
  while (Date.now() < end) {
    if (desktop.exitCode !== null) throw new Error('Electron no arrancó: ' + desktopLog.slice(-2000));
    try { await readFile(env.CLIPO_BRIDGE_FILE); return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Electron no habilitó el puente de evaluación.');
}
const report = { at: new Date().toISOString(), mode: driverPath ? 'external-driver' : 'scripted-reference', driver: driverPath ? path.basename(driverPath) : 'reference',
  modelQualityMeasured: false, tasks: [], status: 'failed' };
try {
  await ready();
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('mcp/server.mjs')], env }));
  const fixture = path.join(dir, 'scenes.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=1[r];color=c=blue:s=320x180:r=30:d=1[b];color=c=black:s=320x180:r=30:d=1[k];[r][b][k]concat=n=3:v=1:a=0', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fixture], { windowsHide: true });
  const allowed = new Set(['clipo_get_project', 'clipo_query_project', 'clipo_plan_edit', 'clipo_edit', 'clipo_save_project', 'clipo_get_request', 'clipo_inspect_media', 'clipo_action', 'clipo_get_job']);
  const tools = (await client.listTools()).tools.filter((t) => allowed.has(t.name));
  for (const task of tasks) {
    let s = await raw('clipo_get_project');
    s = await raw('clipo_create_project', { expectedRevision: s.revision, name: 'Evaluation ' + task.id, aspect: '16:9' });
    s = await raw('clipo_import_media', { ...guard(s), paths: [fixture] }); const assetId = s.imported[0];
    if (task.id === 'conflict' || task.id === 'review') s = await raw('clipo_edit', { ...guard(s), operations: [{ op: 'add_clip', clip: { assetId, out: 3 } }] });
    const context = { taskId: task.id, projectId: s.project.id, assetId, requestKey: 'eval-' + s.project.id };
    const trace = []; let injected = false; let review;
    const started = Date.now();
    const call = async (name, args = {}) => {
      if (trace.length >= task.maxCalls) throw new Error('Presupuesto de llamadas agotado.');
      if (!allowed.has(name) || (name === 'clipo_action' && args.request?.action !== 'export_video')) throw new Error('Herramienta fuera del alcance de evaluación.');
      const entry = { tool: name, ms: 0, bytes: 0 }; trace.push(entry); const at = Date.now();
      try {
        const result = await raw(name, args); entry.bytes = Buffer.byteLength(JSON.stringify(result));
        if (task.id === 'conflict' && name === 'clipo_get_project' && !injected) {
          injected = true; await raw('clipo_edit', { ...guard(result), operations: [{ op: 'add_text', text: { text: 'Texto de la persona', start: 0, duration: 1 } }] });
        }
        if (task.id === 'lost-reply' && name === 'clipo_edit' && !injected) {
          injected = true; throw Object.assign(new Error('Respuesta perdida después de aplicar; consulta el requestKey.'), { code: 'CONNECTION_LOST' });
        }
        if (name === 'clipo_review_export') review = result;
        return result;
      } catch (e) { entry.error = e.code ?? 'ERROR'; throw e; }
      finally { entry.ms = Date.now() - at; }
    };
    // Review tool is permitted only for the task that needs it.
    if (task.id === 'review') allowed.add('clipo_review_export');
    const taskTools = task.id === 'review' ? [...tools, (await client.listTools()).tools.find((t) => t.name === 'clipo_review_export')] : tools;
    const row = { id: task.id, status: 'failed', ms: 0, calls: 0, errors: 0, responseBytes: 0, trace };
    try {
      const answer = await driver({ prompt: task.prompt, tools: taskTools, call, context });
      const final = await raw('clipo_get_project'); assert.equal(final.saveStatus, 'saved'); assert.equal(final.project.id, context.projectId);
      if (task.id === 'assembly') {
        assert.equal(final.project.clips.length, 2); assert.equal(final.duration, 3); assert.equal(final.project.texts.filter((t) => t.text === 'Inicio').length, 1);
        assert.ok(trace.some((t) => t.tool === 'clipo_plan_edit')); assert.equal(trace.filter((t) => t.tool === 'clipo_edit').length, 1);
      } else if (task.id === 'conflict') {
        assert.equal(final.project.name, 'Revisado'); assert.equal(final.project.clips.length, 1);
        assert.equal(final.project.texts.filter((t) => t.text === 'Texto de la persona').length, 1);
        assert.ok(trace.some((t) => t.error === 'CONFLICT'));
      } else if (task.id === 'lost-reply') {
        assert.equal(final.project.texts.filter((t) => t.text === 'Una vez').length, 1);
        assert.equal(trace.filter((t) => t.tool === 'clipo_edit').length, 1); assert.ok(trace.some((t) => t.tool === 'clipo_get_request'));
        assert.equal((await raw('clipo_get_request', { requestKey: context.requestKey })).request.status, 'completed');
      } else {
        assert.ok(trace.some((t) => t.tool === 'clipo_inspect_media')); assert.equal(review?.durationCheck.matches, true);
        assert.equal(review.audioAnalysis.decoded, true); assert.ok(review.issues.some((i) => i.code === 'DARK_SAMPLE'));
        assert.ok(answer?.answer && /muestr|sample/i.test(answer.answer), 'El informe debe declarar la revisión por muestras.');
      }
      row.status = 'passed';
      if (answer?.model) row.model = String(answer.model);
    } catch (e) { row.error = e.message; }
    row.ms = Date.now() - started; row.calls = trace.length; row.errors = trace.filter((t) => t.error).length; row.responseBytes = trace.reduce((n, t) => n + t.bytes, 0);
    report.tasks.push(row); console.log(row.status.toUpperCase(), task.id, row.calls, 'calls');
    // Finish/cancel any work left by an unsuccessful driver before the next fixture.
    const jobs = await raw('clipo_list_jobs', { response: 'summary' });
    for (const j of jobs.jobs.filter((j) => ['queued', 'running', 'saving'].includes(j.status))) {
      await raw('clipo_cancel_job', { jobId: j.id });
      const end = Date.now() + 30000;
      while (Date.now() < end && ['queued', 'running', 'saving'].includes((await raw('clipo_get_job', { jobId: j.id })).job.status)) await new Promise((r) => setTimeout(r, 200));
    }
  }
  report.status = report.tasks.every((t) => t.status === 'passed') ? 'passed' : 'failed';
} catch (e) { report.error = e.message; }
finally {
  await mkdir(path.resolve('release/mcp-validation'), { recursive: true });
  await writeFile(path.resolve('release/mcp-validation/evaluations.json'), JSON.stringify(report, null, 2));
  try { const s = await raw('clipo_get_project'); await raw('clipo_close_editor', { projectId: s.project?.id ?? null, expectedRevision: s.revision }); } catch { desktop.kill(); }
  await client.close(); if (desktop.exitCode === null) await once(desktop, 'exit');
  if (path.dirname(path.resolve(dir)) !== path.resolve(tmpdir()) || !path.basename(dir).startsWith('clipo-mcp-eval-')) throw new Error('Directorio temporal inesperado.');
  await rm(dir, { recursive: true, force: true });
}
if (report.status !== 'passed') { console.error(report.error ?? report.tasks.filter((t) => t.error)); process.exitCode = 1; }

async function reference({ context, call }) {
  let s = await call('clipo_get_project', { response: 'summary' });
  if (context.taskId === 'assembly') {
    const operations = [{ op: 'add_clip', clip: { assetId: context.assetId, in: 0, out: 1 } }, { op: 'add_clip', clip: { assetId: context.assetId, in: 1, out: 3 } }, { op: 'add_text', text: { text: 'Inicio', start: 0, duration: 1 } }];
    await call('clipo_plan_edit', { ...guard(s), operations, response: 'summary' });
    await call('clipo_edit', { ...guard(s), operations, response: 'summary' });
  } else if (context.taskId === 'conflict') {
    const edit = (state) => call('clipo_edit', { ...guard(state), operations: [{ op: 'settings', name: 'Revisado' }], response: 'summary' });
    try { await edit(s); } catch (e) { if (e.code !== 'CONFLICT') throw e; s = await call('clipo_get_project', { response: 'summary' }); await edit(s); }
  } else if (context.taskId === 'lost-reply') {
    try { await call('clipo_edit', { ...guard(s), requestKey: context.requestKey, operations: [{ op: 'add_text', text: { text: 'Una vez', start: 0, duration: 1 } }] }); }
    catch (e) { if (e.code !== 'CONNECTION_LOST') throw e; assert.equal((await call('clipo_get_request', { requestKey: context.requestKey })).request.status, 'completed'); }
  } else {
    await call('clipo_inspect_media', { ...guard(s), assetId: context.assetId, from: 0, to: 3, samples: 6 });
    const queued = await call('clipo_action', { ...guard(s), request: { action: 'export_video', short: '360' }, response: 'summary' });
    let job = queued.job;
    while (['queued', 'running', 'saving'].includes(job.status)) { await new Promise((r) => setTimeout(r, 300)); job = (await call('clipo_get_job', { jobId: job.id, response: 'summary' })).job; }
    assert.equal(job.status, 'completed');
    await call('clipo_review_export', { artifactId: job.result.artifacts[0].id, from: 0, to: 3, samples: 6, expectedDuration: 3 });
    return { answer: 'Revisión por muestras: hay candidatos negros en el último segundo. Audio decodificado y duración comprobada.' };
  }
  return { answer: 'Proyecto guardado.' };
}
