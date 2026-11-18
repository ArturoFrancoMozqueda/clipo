// Real MCP client -> stdio server -> authenticated bridge -> Electron -> store -> IndexedDB.
// Uses its own disposable profile; never reads or changes the user's projects.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electron from 'electron';
import sharp from 'sharp';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { startHttp } from '../mcp/http-server.mjs';
import { callEditor } from '../mcp/bridge-client.mjs';
import { randomBytes } from 'node:crypto';

const dir = await mkdtemp(path.join(tmpdir(), 'clipo-mcp-smoke-'));
const discoveryFile = path.join(dir, 'automation.json');
const env = { ...process.env, CLIPO_AUTOMATION: '1', CLIPO_BRIDGE_FILE: discoveryFile,
  CLIPO_SMOKE: '1', CLIPO_SMOKE_EXTERNAL: '1', CLIPO_SMOKE_DATA: path.join(dir, 'profile') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CLIPO_AUTOMATION; // Exercise NORMAL desktop launch, without an agent flag or env switch.
let desktop;
let agentPid;
let client;
let log = '';
let allLog = '';

async function start() {
  log = '';
  const args = process.env.CLIPO_MCP_APP ? [] : ['.'];
  args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-audio-capture=' + path.join(dir, 'fake-mic.wav'));
  desktop = spawn(process.env.CLIPO_MCP_APP ?? electron, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  desktop.stdout.on('data', (b) => { log += b; allLog += b; });
  desktop.stderr.on('data', (b) => { log += b; allLog += b; });
  const end = Date.now() + 40000;
  let info;
  while (Date.now() < end) {
    if (desktop.exitCode !== null) throw new Error(`Desktop exited: ${log}`);
    try { info = JSON.parse(await readFile(discoveryFile, 'utf8')); break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!info) throw new Error(`Desktop did not become ready: ${log}`);
  agentPid = info.pid;
  await openClient();
  return info;
}
async function openClient() {
  client = new Client({ name: 'clipo-desktop-smoke', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve(process.env.CLIPO_MCP_SERVER ?? 'mcp/server.mjs')], env }));
}
async function stop() {
  let closing = false;
  if (client) {
    try {
      const state = await call('clipo_get_project');
      await call('clipo_close_editor', { projectId: state.project?.id ?? null, expectedRevision: state.revision }); closing = true;
    } catch { /* failed tests can leave a running job; only this disposable process is terminated below */ }
  }
  await client?.close(); client = null;
  if (desktop && desktop.exitCode === null) {
    const exited = once(desktop, 'exit');
    if (!closing) desktop.kill();
    await exited;
  }
  if (!desktop && agentPid) {
    if (!closing) { try { process.kill(agentPid); } catch {} }
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      try { process.kill(agentPid, 0); } catch { break; }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  desktop = null;
  agentPid = null;
  // SIGTERM on Windows bypasses will-quit; remove only this test's discovery file.
  await rm(discoveryFile, { force: true });
}
async function call(name, args = {}, error = false) {
  const r = await client.callTool({ name, arguments: args });
  if (error) { assert.equal(r.isError, true); return r; }
  assert.ok(!r.isError, JSON.stringify(r));
  const state = JSON.parse(r.content.find((c) => c.type === 'text').text);
  assert.deepEqual(r.structuredContent, state);
  if (name === 'clipo_create_project' || name === 'clipo_open_project') {
    await new Promise((r) => setTimeout(r, 60));
    const ui = await call('clipo_get_ui'); const skip = ui.ui.controls.find((c) => c.label === 'Saltar');
    if (skip) await call('clipo_ui_action', { expectedRevision: ui.revision, viewId: ui.ui.viewId, controlId: skip.id, action: 'click' });
  }
  return { ...state, images: r.content.filter((c) => c.type === 'image'), audios: r.content.filter((c) => c.type === 'audio') };
}
const guard = (s) => ({ projectId: s.project.id, expectedRevision: s.revision });
const flows = [];
let succeeded = false;
let blockedTelemetry = [];
async function flow(name, fn) {
  const started = Date.now();
  try { await fn(); flows.push({ name, status: 'passed', ms: Date.now() - started }); console.log('PASS', name); }
  catch (e) { flows.push({ name, status: 'failed', error: String(e) }); throw e; }
}
async function action(request, timeout = 300000) {
  const state = await call('clipo_get_project');
  let result = await call('clipo_action', { ...guard(state), request });
  if (!result.job) return result;
  const end = Date.now() + timeout;
  while (['queued', 'running', 'saving'].includes(result.job.status) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 300)); result = await call('clipo_get_job', { jobId: result.job.id });
  }
  assert.equal(result.job.status, 'completed', JSON.stringify(result.job));
  return { ...result, ...result.job.result };
}
async function control(match, action = 'click', value) {
  const ui = await call('clipo_get_ui'); const found = ui.ui.controls.find(match);
  assert.ok(found, ui.ui.text);
  return call('clipo_ui_action', { expectedRevision: ui.revision, viewId: ui.ui.viewId, controlId: found.id, action, ...(value !== undefined ? { value } : {}) });
}

try {
  // Synthetic hardware input: the test never opens the user's physical microphone.
  await copyFile(path.resolve('tests/fixtures/mic-speech.wav'), path.join(dir, 'fake-mic.wav'));
  const first = await start();
  let s = await call('clipo_status');
  assert.equal(s.project, null);
  assert.ok(s.catalog.filters.some((f) => f.id === 'warm'));
  s = await call('clipo_create_project', { expectedRevision: s.revision, name: 'MCP smoke', aspect: '9:16' });
  const projectId = s.project.id;
  const imageFile = path.join(dir, 'frame.png');
  await sharp({ create: { width: 360, height: 640, channels: 3, background: '#2b72d8' } }).png().toFile(imageFile);
  const wavFile = path.join(dir, 'music.wav');
  const wav = Buffer.alloc(44 + 8000 * 2 * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await writeFile(wavFile, wav);
  s = await call('clipo_import_media', { ...guard(s), paths: [imageFile, wavFile] });
  assert.deepEqual(s.failed, []);
  assert.equal(s.imported.length, 2);
  const image = Object.values(s.project.assets).find((a) => a.kind === 'image').id;
  const music = Object.values(s.project.assets).find((a) => a.kind === 'audio').id;
  const beforeEdit = s;
  s = await call('clipo_edit', { ...guard(s), operations: [
    { op: 'add_clip', clip: { assetId: image, out: 8, fit: 'fill', filter: 'warm', transition: { type: 'fade', duration: 0.4 } } },
    { op: 'add_text', text: { text: 'Editado por MCP', start: 0, duration: 4, styleId: 'titulo' } },
    { op: 'add_audio', audio: { assetId: music, start: 0, out: 4, volume: 0.25, role: 'music', fadeOut: 0.4 } },
    { op: 'add_sticker', sticker: { emoji: '🎬', start: 1, duration: 3 } },
    { op: 'add_overlay', overlay: { assetId: image, start: 2, out: 3, size: 0.2 } },
  ] });
  assert.equal(s.project.clips.length, 1);
  assert.equal(s.added.length, 5);
  assert.equal(s.saveStatus, 'saved');
  await call('clipo_edit', { ...guard(beforeEdit), operations: [{ op: 'settings', name: 'stale' }] }, true);
  await call('clipo_edit', { ...guard(s), operations: [
    { op: 'settings', name: 'invalid batch' }, { op: 'add_clip', clip: { assetId: image, out: 10000 } },
  ] }, true);
  assert.equal((await call('clipo_get_project')).project.name, 'MCP smoke');
  s = await call('clipo_undo', guard(s));
  assert.equal(s.project.clips.length, 0);
  assert.equal(s.project.texts.length, 0);
  s = await call('clipo_redo', guard(s));
  assert.equal(s.project.texts[0].text, 'Editado por MCP');
  s = await call('clipo_edit', { ...guard(s), operations: [{ op: 'split_clip', id: s.project.clips[0].id, at: 2 }] });
  assert.equal(s.project.clips.length, 2);
  assert.equal(s.timeline[1].start, 2);
  s = await call('clipo_seek', { ...guard(s), time: 1 });
  // Let the browser decode the still and draw the text before inspecting the real window.
  await new Promise((r) => setTimeout(r, 600));
  const preview = await call('clipo_preview');
  assert.equal(preview.view.editorVisible, true, JSON.stringify(preview.view));
  assert.equal(preview.view.previewVisible, true, JSON.stringify(preview.view));
  assert.equal(preview.images[0].mimeType, 'image/png');
  assert.ok(preview.images[0].data.length > 5000);
  if (process.env.CLIPO_MCP_SCREENSHOT) await writeFile(process.env.CLIPO_MCP_SCREENSHOT, Buffer.from(preview.images[0].data, 'base64'));
  await call('clipo_save_project', guard(s));
  await stop();
  const second = await start();
  assert.notEqual(first.token, second.token);
  const list = await call('clipo_list_projects');
  assert.ok(list.projects.some((p) => p.id === projectId));
  s = await call('clipo_open_project', { projectId, expectedRevision: list.revision });
  assert.deepEqual(s.missingAssets, []);
  assert.equal(s.project.clips.length, 2);
  assert.equal(s.project.texts[0].text, 'Editado por MCP');
  assert.equal(s.project.audios[0].volume, 0.25);
  // Exercise semantic UI through MCP, including React inputs and real file handlers.
  let uiState = await call('clipo_get_ui', { filter: 'Nombre del proyecto' });
  for (let i = 0; i < 30 && !uiState.ui.controls.length; i++) {
    await new Promise((r) => setTimeout(r, 100));
    uiState = await call('clipo_get_ui', { filter: 'Nombre del proyecto' });
  }
  const titleControl = uiState.ui.controls.find((c) => c.label === 'Nombre del proyecto');
  assert.ok(titleControl, JSON.stringify(uiState.ui));
  s = await call('clipo_ui_action', { expectedRevision: uiState.revision, viewId: uiState.ui.viewId,
    controlId: titleControl.id, action: 'set_value', value: 'MCP semantic UI smoke' });
  assert.equal(s.project.name, 'MCP semantic UI smoke');
  await call('clipo_ui_action', { expectedRevision: s.revision, viewId: uiState.ui.viewId,
    controlId: titleControl.id, action: 'set_value', value: 'stale view' }, true);
  s = await call('clipo_editor', { ...guard(s), panel: 'captions', advanced: true });
  // Lazy panels can still be loading after the tool acknowledges the navigation.
  for (let i = 0; i < 20; i++) {
    uiState = await call('clipo_get_ui', { filter: 'file' });
    if (uiState.ui.controls.some((c) => c.accept?.includes('.srt'))) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const subtitleInput = uiState.ui.controls.find((c) => c.accept?.includes('.srt'));
  assert.ok(subtitleInput, JSON.stringify(uiState.ui));
  const subtitles = path.join(dir, 'test.srt');
  await writeFile(subtitles, '1\n00:00:00,300 --> 00:00:01,500\nSubtítulos por MCP\n');
  s = await call('clipo_set_input_files', { expectedRevision: uiState.revision, viewId: uiState.ui.viewId,
    controlId: subtitleInput.id, paths: [subtitles] });
  for (let i = 0; i < 20 && !s.project.texts.some((t) => t.caption); i++) {
    await new Promise((r) => setTimeout(r, 100)); s = await call('clipo_get_project');
  }
  assert.ok(s.project.texts.some((t) => t.caption && t.text === 'Subtítulos por MCP'));
  await call('clipo_save_project', guard(s));
  const captionJob = await call('clipo_generate_captions', guard(s));
  let jobState = captionJob;
  for (let i = 0; i < 20 && !['error', 'completed'].includes(jobState.job.status); i++) {
    await new Promise((r) => setTimeout(r, 100));
    jobState = await call('clipo_get_caption_job', { jobId: captionJob.job.id });
  }
  // This project contains photos and music, but no speaking video. It must fail
  // explicitly without downloading a model or modifying existing captions.
  assert.equal(jobState.job.status, 'error');
  assert.equal(jobState.job.error, 'no-video');
  assert.equal(jobState.captioning, false);
  s = await call('clipo_get_project');
  const sourceAudio = await call('clipo_get_audio', { ...guard(s), assetId: music, from: 1, to: 2 });
  assert.equal(sourceAudio.audios[0].mimeType, 'audio/wav');
  const wave = Buffer.from(sourceAudio.audios[0].data, 'base64');
  assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wave.readUInt32LE(24), 16000);
  assert.equal(wave.length, 44 + 16000 * 2);
  await call('clipo_get_audio', { ...guard(s), assetId: image, from: 0, to: 1 }, true);
  await call('clipo_get_audio', { ...guard(s), assetId: music, from: 0, to: 5 }, true);
  await flow('dry-run, full clip properties, clearing and atomic rejection', async () => {
    s = await call('clipo_get_project'); const original = structuredClone(s.project);
    const plan = await call('clipo_plan_edit', { ...guard(s), operations: [{ op: 'settings', name: 'Planned only' }] });
    assert.equal(plan.dryRun, true); assert.deepEqual(plan.project, original); assert.equal(plan.revision, s.revision);
    s = await call('clipo_edit', { ...guard(s), operations: [{ op: 'update_clip', id: s.project.clips[0].id, changes: { voiceFx: 'phone', bgRemoval: { mode: 'color', color: '#00ff00', smooth: 0.4 }, reframe: { points: [{ t: 0, x: 0.4, y: 0.5 }] } } }] });
    assert.equal(s.receipt.verified, true); assert.equal(s.project.clips[0].voiceFx, 'phone');
    s = await call('clipo_undo', guard(s)); assert.deepEqual(s.project.clips, original.clips);
  });
  const cube = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
  await flow('LUT import, application, deletion and undo', async () => {
    const lut = await action({ action: 'import_lut', name: 'Identity', cube });
    s = await call('clipo_edit', { ...guard(lut), operations: [{ op: 'update_clip', id: lut.project.clips[0].id, changes: { lut: { id: lut.result.lutId, amount: 1 } } }] });
    const removed = await action({ action: 'delete_lut', lutId: lut.result.lutId });
    assert.ok(!removed.project.clips[0].lut); s = await call('clipo_undo', guard(removed)); assert.equal(s.project.clips[0].lut.id, lut.result.lutId);
    await action({ action: 'delete_lut', lutId: lut.result.lutId });
  });
  await flow('caption import, restyling, SRT/VTT export and verified local save', async () => {
    await action({ action: 'import_subtitles', format: 'srt', content: '1\n00:00:00,300 --> 00:00:01,500\nTexto verificado\n', look: { style: 'viral', karaoke: 'color', color: '#ffe500' } });
    const styled = await action({ action: 'restyle_captions', look: { style: 'rebote', karaoke: 'scale', color: '#00ff00' } });
    assert.equal(styled.project.texts.find((t) => t.caption).styleId, 'meme');
    for (const format of ['srt', 'vtt']) {
      const exported = await action({ action: 'export_subtitles', format });
      const out = path.join(dir, 'captions.' + format);
      const saved = await call('clipo_export_file', { artifactId: exported.artifact.id, path: out });
      assert.equal(saved.verified, true); assert.match(await readFile(out, 'utf8'), /Texto verificado/);
      await call('clipo_export_file', { artifactId: exported.artifact.id, path: out }, true);
    }
  });
  await flow('music generation, synthesized SFX and durable audio analysis', async () => {
    const generated = await action({ action: 'music', moodId: 'lofihop', duration: 2, start: 0, volume: 0.1 });
    assert.ok(generated.duration >= 2); assert.equal(generated.receipt.verified, true);
    const sound = await action({ action: 'sfx', soundId: 'whoosh', start: 0, volume: 0.1 }); assert.ok(sound.duration > 0);
    const analysis = await action({ action: 'analyze_audio' }); assert.ok(analysis.loudness); assert.ok(analysis.levels);
  });
  let duplicate;
  await flow('templates, brand persistence and recoverable project deletion', async () => {
    const template = await action({ action: 'save_template', name: 'MCP fixture template' });
    const applied = await action({ action: 'apply_template', templateId: template.template.id, assetIds: [image], values: {} });
    assert.ok(applied.project.clips.length); s = await call('clipo_undo', guard(applied));
    await action({ action: 'delete_template', templateId: template.template.id });
    const branded = await action({ action: 'brand', kit: { styleId: 'clasico', accent: '#ffff00', fill: '#ffffff', forNew: true }, apply: true });
    assert.ok(branded.project.texts.every((t) => t.fill === '#ffffff')); await action({ action: 'brand', kit: null });
    duplicate = await action({ action: 'duplicate_project', name: 'MCP disposable copy' });
    const removed = await action({ action: 'delete_project', targetId: duplicate.projectId });
    assert.equal(removed.verified, true); assert.ok(removed.recoveryProjectId);
  });
  let exportedArtifacts;
  await flow('video export in every aspect, decode, SHA-256 and ffprobe validation', async () => {
    const exported = await action({ action: 'export_video', short: '360', aspects: ['9:16', '16:9', '1:1', '4:5'] });
    exportedArtifacts = exported.artifacts; assert.equal(exportedArtifacts.length, 4);
    for (const artifact of exportedArtifacts) {
      const out = path.join(dir, artifact.name);
      await call('clipo_export_file', { artifactId: artifact.id, path: out });
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out], { encoding: 'utf8', windowsHide: true }));
      const video = probe.streams.find((s) => s.codec_type === 'video'); assert.ok(video); assert.equal(video.width, artifact.media.width); assert.equal(video.height, artifact.media.height);
      assert.ok(Math.abs(Number(probe.format.duration) - artifact.media.duration) < 0.2);
      execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-'], { windowsHide: true });
    }
  });
  await flow('cover artifact, social checks and unauthenticated publishing rejection', async () => {
    const cover = await action({ action: 'capture_cover', at: 0.6 }); assert.ok(cover.artifact.bytes > 100);
    const checks = await action({ action: 'check_social', platforms: ['youtube', 'instagram_reels'], short: 720 }); assert.equal(checks.checks.length, 2);
    const pub = await action({ action: 'publishing_status' }); assert.ok(Array.isArray(pub.accounts));
    s = await call('clipo_get_project');
    await call('clipo_action', { ...guard(s), request: { action: 'publish', artifactId: exportedArtifacts[0].id, targets: [{ platform: 'youtube', accountId: 'nonexistent' }], posts: { youtube: { title: 'Test', description: 'Test', hashtags: '' } }, privacy: 'private', madeForKids: false } }, true);
  });
  await flow('compact queries, detailed plan and lost-response recovery without duplicate writes', async () => {
    s = await call('clipo_get_project'); const original = structuredClone(s.project);
    const summary = await call('clipo_get_project', { response: 'summary' });
    assert.equal(summary.project, undefined); assert.equal(summary.projectSummary.id, projectId);
    assert.ok(JSON.stringify(summary).length < JSON.stringify(s).length / 2);
    const firstPage = await call('clipo_query_project', { ...guard(s), section: 'clips', limit: 1 });
    assert.equal(firstPage.items.length, 1); assert.equal(firstPage.nextOffset, 1);
    const nextPage = await call('clipo_query_project', { ...guard(s), section: 'clips', offset: firstPage.nextOffset, limit: 1 });
    assert.notEqual(nextPage.items[0].id, firstPage.items[0].id);
    const plan = await call('clipo_plan_edit', { ...guard(s), response: 'summary', operations: [{ op: 'update_clip', id: original.clips[0].id, changes: { out: original.clips[0].out - 0.5 } }] });
    assert.equal(plan.plan.mainDurationDelta, -0.5); assert.ok(plan.plan.differences.length >= 2); assert.ok(plan.plan.warnings.length);
    assert.deepEqual((await call('clipo_get_project')).project, original);
    const requestKey = 'smoke-lost-reply';
    const edit = { ...guard(s), requestKey, operations: [{ op: 'add_text', text: { text: 'Recover once', start: 0, duration: 1 } }] };
    await call('clipo_edit', edit); // Model a response that the caller lost after the commit.
    const receipt = await call('clipo_get_request', { requestKey }); assert.equal(receipt.request.status, 'completed');
    const duplicate = await call('clipo_edit', edit); assert.equal(duplicate.replayed, true);
    s = await call('clipo_get_project'); assert.equal(s.project.texts.filter((t) => t.text === 'Recover once').length, 1);
    const stale = await call('clipo_query_project', { projectId, expectedRevision: firstPage.revision, section: 'clips' }, true);
    assert.equal(JSON.parse(stale.content[0].text).error.code, 'CONFLICT');
    const reuse = await call('clipo_edit', { ...edit, operations: [{ op: 'settings', name: 'wrong reuse' }] }, true);
    assert.equal(JSON.parse(reuse.content[0].text).error.code, 'REQUEST_KEY_REUSED');
    const jobs = await call('clipo_list_jobs', { response: 'summary', limit: 1 }); assert.ok(jobs.pagination.total >= jobs.jobs.length); assert.equal(jobs.project, undefined);
    await stop(); await start(); s = await call('clipo_status'); s = await call('clipo_open_project', { projectId, expectedRevision: s.revision });
    assert.equal((await call('clipo_get_request', { requestKey })).request.status, 'completed');
    assert.equal((await call('clipo_edit', edit)).replayed, true);
  });
  await flow('source contact sheet, scene candidates, exported pixels/audio and read-only invariants', async () => {
    s = await call('clipo_get_project');
    const photo = await call('clipo_inspect_media', { ...guard(s), assetId: image, from: 0, to: 1 });
    assert.equal(photo.frames.length, 1); assert.equal(photo.media.duration, null); assert.equal(photo.revision, s.revision);
    await call('clipo_inspect_media', { ...guard(s), assetId: music, from: 0, to: 1 }, true);
    const fixture = path.join(dir, 'inspection-scenes.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=1[r];color=c=blue:s=320x180:r=30:d=1[b];color=c=black:s=320x180:r=30:d=1[k];[r][b][k]concat=n=3:v=1:a=0', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fixture], { windowsHide: true });
    s = await call('clipo_get_project'); s = await call('clipo_create_project', { expectedRevision: s.revision, name: 'MCP inspection fixture', aspect: '16:9' });
    s = await call('clipo_import_media', { ...guard(s), paths: [fixture] }); const assetId = s.imported[0];
    const before = await call('clipo_get_project');
    const inspected = await call('clipo_inspect_media', { ...guard(before), assetId, from: 0, to: 3, samples: 6 });
    assert.equal(inspected.domain, 'source'); assert.equal(inspected.frames.length, 6); assert.equal(inspected.sceneChanges.length, 2);
    assert.equal(inspected.issues.filter((i) => i.code === 'DARK_SAMPLE').length, 2); assert.equal(inspected.images.length, 1);
    assert.ok(inspected.issues.some((i) => i.code === 'STATIC_SAMPLE_PAIR'));
    const sheet = Buffer.from(inspected.images[0].data, 'base64'); assert.ok(sheet.length > 1000);
    const sheetInfo = await sharp(sheet).metadata(); assert.equal(sheetInfo.width, 1024); assert.equal(sheetInfo.height, 336);
    await mkdir(path.resolve('release/mcp-validation'), { recursive: true }); await writeFile(path.resolve('release/mcp-validation/contact-sheet.jpg'), sheet);
    const after = await call('clipo_get_project'); assert.deepEqual(after.project, before.project); assert.equal(after.time, before.time); assert.equal(after.revision, before.revision);
    await call('clipo_inspect_media', { ...guard(after), assetId, from: 0, to: 4 }, true);
    s = await call('clipo_edit', { ...guard(after), operations: [{ op: 'add_clip', clip: { assetId, out: 3 } }] });
    const exported = await action({ action: 'export_video', short: '360' }); const artifactId = exported.artifacts[0].id;
    const baseline = await call('clipo_get_project');
    const review = await call('clipo_review_export', { artifactId, from: 0, to: 3, samples: 6, expectedDuration: 3 });
    assert.equal(review.domain, 'export'); assert.equal(review.durationCheck.matches, true); assert.equal(review.audioAnalysis.decoded, true);
    assert.ok(review.audioAnalysis.samplePeak > 0.01); assert.ok(review.audioAnalysis.integratedLufs < 0); assert.equal(review.audios.length, 1);
    assert.ok(review.issues.some((i) => i.code === 'DARK_SAMPLE')); assert.equal(review.coverage.mode, 'sampled');
    assert.ok(review.coverage.unmeasured.includes('audiovisual_sync'));
    const wrongDuration = await call('clipo_review_export', { artifactId, from: 0, to: 1, samples: 1, expectedDuration: 8, includeAudio: false });
    assert.equal(wrongDuration.durationCheck.matches, false); assert.equal(wrongDuration.audios.length, 0);
    const final = await call('clipo_get_project'); assert.deepEqual(final.project, baseline.project); assert.equal(final.revision, baseline.revision); assert.equal(final.time, baseline.time);
    s = await call('clipo_open_project', { projectId, expectedRevision: final.revision });
  });
  await flow('persisted job/artifact/audit readback after Electron restart', async () => {
    const jobs = await call('clipo_list_jobs'); const completed = jobs.jobs.find((j) => j.kind === 'export_video'); assert.equal(completed.status, 'completed');
    const audit = await call('clipo_audit', { limit: 100 }); assert.ok(audit.records.some((r) => r.action === 'export_video'));
    await stop(); await start(); s = await call('clipo_status'); s = await call('clipo_open_project', { projectId, expectedRevision: s.revision });
    assert.equal((await call('clipo_get_job', { jobId: completed.id })).job.status, 'completed');
    const chunk = await call('clipo_read_artifact', { artifactId: exportedArtifacts[0].id, offset: 0, length: 16 }); assert.equal(Buffer.from(chunk.data, 'base64').length, 16);
  });
  await flow('authenticated HTTP MCP client -> real Electron project and resources', async () => {
    const token = randomBytes(32).toString('hex');
    const endpoint = await startHttp({ port: 0, token, call: (tool, args) => callEditor(tool, args, { discoveryFile }) });
    const remote = new Client({ name: 'clipo-http-e2e', version: '1' });
    try {
      await remote.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: { Authorization: 'Bearer ' + token } } }));
      const response = await remote.callTool({ name: 'clipo_get_project', arguments: {} });
      assert.ok(!response.isError); const state = JSON.parse(response.content.find((c) => c.type === 'text').text); assert.equal(state.project.id, projectId);
      assert.equal((await remote.listResources()).resources.length, 2);
      const resource = await remote.readResource({ uri: 'clipo://project' }); assert.ok(JSON.stringify(resource).includes(projectId));
      const seek = await remote.callTool({ name: 'clipo_seek', arguments: { ...guard(state), time: 0.2 } }); assert.ok(!seek.isError);
    } finally { await remote.close(); await endpoint.close(); }
  });
  await flow('person segmentation, automatic reframe, background replacement and final video pixels', async () => {
    s = await call('clipo_get_project'); s = await call('clipo_create_project', { expectedRevision: s.revision, name: 'MCP segmentation fixture', aspect: '9:16' });
    s = await call('clipo_import_media', { ...guard(s), paths: [path.resolve('tests/fixtures/portrait.jpg')] }); const portraitId = s.imported[0];
    s = await call('clipo_edit', { ...guard(s), operations: [{ op: 'add_clip', clip: { assetId: portraitId, out: 1 } }] });
    await action({ action: 'prepare_background' }); const reframed = await action({ action: 'reframe' }); assert.equal(reframed.found, 1); assert.ok(reframed.project.clips[0].reframe.points.length);
    await action({ action: 'reframe', clear: true }); s = await call('clipo_get_project');
    s = await call('clipo_edit', { ...guard(s), operations: [{ op: 'update_clip', id: s.project.clips[0].id, changes: { fit: 'fill', bgRemoval: { mode: 'color', color: '#00ff00', smooth: 0.3 } } }] });
    const rendered = await action({ action: 'export_video', short: '360' }); const output = path.join(dir, 'segmented.mp4');
    await call('clipo_export_file', { artifactId: rendered.artifacts[0].id, path: output });
    const pixel = execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-vf', 'crop=2:2:0:0,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', '-'], { windowsHide: true });
    assert.ok(pixel[1] > 150 && pixel[0] < 70 && pixel[2] < 70, `Expected replaced green background, got ${[...pixel.subarray(0, 3)]}`);
    s = await call('clipo_get_project'); s = await call('clipo_open_project', { projectId, expectedRevision: s.revision });
  });
  await flow('video import, freeze frame, silence analysis/cuts and CapCut draft to saved editable project', async () => {
    const videoFile = path.join(dir, 'synthetic.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'aevalsrc=if(between(t\\,1\\,2)\\,0\\,0.4*sin(2*PI*440*t)):s=44100:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', videoFile], { windowsHide: true });
    s = await call('clipo_get_project'); s = await call('clipo_create_project', { expectedRevision: s.revision, name: 'MCP video fixture', aspect: '16:9' });
    s = await call('clipo_import_media', { ...guard(s), paths: [videoFile] }); const videoId = s.imported[0];
    s = await call('clipo_edit', { ...guard(s), operations: [{ op: 'add_clip', clip: { assetId: videoId, out: 4 } }] });
    const frozen = await action({ action: 'freeze', at: 0.5 }); assert.equal(frozen.project.clips.length, 3); assert.ok(frozen.project.clips.some((c) => c.freeze !== undefined));
    s = await call('clipo_undo', guard(frozen));
    const plan = await action({ action: 'silences', apply: false, depth: 20, minDuration: 0.5, margin: 0.1 }); assert.ok(plan.cuts.length); assert.equal(plan.project.clips.length, 1);
    const cut = await action({ action: 'silences', apply: true, depth: 20, minDuration: 0.5, margin: 0.1 }); assert.ok(cut.removed > 0.5); assert.ok(cut.duration < 4);
    const draft = path.join(dir, 'draft_content.json');
    await writeFile(draft, JSON.stringify({ name: 'MCP CapCut import', canvas_config: { width: 1920, height: 1080 }, materials: { videos: [{ id: 'v', path: 'synthetic.mp4', duration: 4000000 }] }, tracks: [{ type: 'video', segments: [{ material_id: 'v', source_timerange: { start: 0, duration: 2000000 }, target_timerange: { start: 0, duration: 2000000 } }] }] }));
    s = await call('clipo_get_project'); const imported = await call('clipo_import_capcut', { ...guard(s), paths: [draft, videoFile] });
    assert.equal(imported.project.name, 'MCP CapCut import'); assert.equal(imported.project.clips.length, 1); assert.equal(imported.receipt.verified, true);
    const exported = await action({ action: 'export_video', short: '360' }); assert.ok(exported.artifacts[0].bytes > 1000);
    s = await call('clipo_get_project'); s = await call('clipo_open_project', { projectId, expectedRevision: s.revision });
  });
  await flow('entire filter/effect/transition/text-style catalog, animated tracks and native ripple actions to final render', async () => {
    const { catalog } = await call('clipo_status');
    s = await call('clipo_get_project'); s = await call('clipo_create_project', { expectedRevision: s.revision, name: 'MCP render catalog', aspect: '9:16' });
    s = await call('clipo_import_media', { ...guard(s), paths: [imageFile] }); const assetId = s.imported[0];
    const clips = [...catalog.filters.map((f) => ({ assetId, out: 0.3, filter: f.id })), ...catalog.effects.map((e) => ({ assetId, out: 0.3, effect: { id: e.id, intensity: 0.6 } })), ...catalog.transitions.map((t) => ({ assetId, out: 0.3, transition: { type: t.id, duration: 0.2 } }))];
    const operations = clips.map((clip) => ({ op: 'add_clip', clip }));
    operations.push(...catalog.textStyles.map((t, i) => ({ op: 'add_text', text: { text: t.name, start: i * 0.3, duration: 0.3, styleId: t.id, anim: { in: 'pop', out: 'fade', loop: 'pulse' } } })));
    const frames = [{ t: 0, x: 0.2, y: 0.4, size: 0.2, rotation: 0, opacity: 0.7, ease: 'ease' }, { t: 0.3, x: 0.8, y: 0.7, size: 0.3, rotation: 0.2, opacity: 1, ease: 'linear' }];
    for (const [i, blend] of ['normal', 'screen', 'multiply', 'overlay', 'lighten', 'darken', 'soft-light', 'difference'].entries()) operations.push({ op: 'add_overlay', overlay: { assetId, start: i * 0.3, out: 0.3, blend, keyframes: frames } });
    operations.push({ op: 'add_sticker', sticker: { assetId, start: 0, duration: 0.3, keyframes: frames } });
    for (let i = 0; i < operations.length; i += 150) { s = await call('clipo_edit', { ...guard(s), operations: operations.slice(i, i + 150) }); }
    const firstId = s.project.clips[0].id;
    const corrected = await action({ action: 'auto_color', kind: 'clip', itemId: firstId }); assert.ok(corrected.result.color);
    const moved = await action({ action: 'move_clip', clipId: firstId, toIndex: s.project.clips.length - 1 }); assert.equal(moved.project.clips.at(-1).id, firstId);
    const duplicated = await action({ action: 'duplicate_selection', kind: 'clip', itemId: firstId }); assert.equal(duplicated.project.clips.length, clips.length + 1);
    const duplicateId = duplicated.project.clips.at(-1).id; await action({ action: 'delete_selection', kind: 'clip', itemId: duplicateId });
    const rendered = await action({ action: 'export_video', short: '360' }); assert.ok(rendered.artifacts[0].bytes > 10000);
    const out = path.join(dir, 'catalog.mp4'); await call('clipo_export_file', { artifactId: rendered.artifacts[0].id, path: out });
    execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-'], { windowsHide: true });
    console.log('CATALOG', JSON.stringify({ filters: catalog.filters.length, effects: catalog.effects.length, transitions: catalog.transitions.length, textStyles: catalog.textStyles.length }));
    s = await call('clipo_get_project'); s = await call('clipo_open_project', { projectId, expectedRevision: s.revision });
  });
  await flow('heavy video -> real preview proxy -> original-source export', async () => {
    const heavy = path.join(dir, 'heavy.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=2560x1440:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', heavy], { windowsHide: true });
    s = await call('clipo_get_project'); s = await call('clipo_create_project', { expectedRevision: s.revision, name: 'MCP proxy fixture', aspect: '16:9' });
    s = await call('clipo_editor', { ...guard(s), proxyPreview: true });
    s = await call('clipo_import_media', { ...guard(s), paths: [heavy] }); const assetId = s.imported[0];
    s = await call('clipo_edit', { ...guard(s), operations: [{ op: 'add_clip', clip: { assetId, out: 2 } }] });
    const end = Date.now() + 60000;
    while (!s.proxyAssets.includes(assetId) && Date.now() < end) { await new Promise((r) => setTimeout(r, 250)); s = await call('clipo_get_project'); }
    assert.ok(s.proxyAssets.includes(assetId), JSON.stringify(s.proxyJob));
    const rendered = await action({ action: 'export_video', short: '360' }); assert.equal(rendered.artifacts[0].media.width, 640);
    s = await call('clipo_get_project'); s = await call('clipo_editor', { ...guard(s), proxyPreview: false }); assert.equal(s.proxyPreview, false);
    s = await call('clipo_open_project', { projectId, expectedRevision: s.revision });
  });
  await flow('MCP recording controls -> MediaRecorder with synthetic microphone -> saved editable voice track', async () => {
    s = await call('clipo_get_project'); s = await call('clipo_seek', { ...guard(s), time: 0 });
    const count = s.project.audios.length;
    await call('clipo_editor', { ...guard(s), panel: 'record', selection: null });
    let ui = await call('clipo_get_ui', { filter: 'Grabar voz' }); const button = ui.ui.controls.findLast((c) => c.label === 'Grabar voz'); assert.ok(button);
    await call('clipo_ui_action', { expectedRevision: ui.revision, viewId: ui.ui.viewId, controlId: button.id, action: 'click' });
    const end = Date.now() + 15000; let stopButton;
    do { await new Promise((r) => setTimeout(r, 200)); ui = await call('clipo_get_ui', { filter: 'Detener' }); stopButton = ui.ui.controls.find((c) => c.label === 'Detener'); } while (!stopButton && Date.now() < end);
    assert.ok(stopButton, ui.ui.text); await new Promise((r) => setTimeout(r, 1500));
    ui = await call('clipo_get_ui', { filter: 'Detener' }); stopButton = ui.ui.controls.find((c) => c.label === 'Detener'); assert.ok(stopButton);
    await call('clipo_ui_action', { expectedRevision: ui.revision, viewId: ui.ui.viewId, controlId: stopButton.id, action: 'click' });
    do { await new Promise((r) => setTimeout(r, 150)); s = await call('clipo_get_project'); } while (s.project.audios.length === count && Date.now() < end);
    assert.equal(s.project.audios.length, count + 1); assert.ok(s.project.audios.at(-1).out > 0.5); await call('clipo_save_project', guard(s));
  });
  await flow('portaled voice enrollment dialog -> synthetic recording -> persistent profile -> confirmed deletion', async () => {
    s = await call('clipo_get_project'); await call('clipo_editor', { ...guard(s), panel: 'tts', selection: null });
    // This is our synthetic fixture, not an enrollment of the user's real voice.
    await control((c) => c.tag === 'button' && c.label.startsWith('Crear mi voz'));
    let ui = await call('clipo_get_ui'); assert.ok(ui.ui.controls.some((c) => c.type === 'checkbox')); assert.ok(!ui.ui.controls.some((c) => c.section === 'toolbar'));
    await control((c) => c.tag === 'input' && c.type === 'text', 'set_value', 'MCP synthetic fixture');
    await control((c) => c.type === 'checkbox');
    await control((c) => c.label === 'Continuar');
    await control((c) => c.label === 'Empezar a grabar');
    const end = Date.now() + 25000;
    do { await new Promise((r) => setTimeout(r, 150)); ui = await call('clipo_get_ui'); } while (!ui.ui.controls.some((c) => c.label === 'Terminé de leer') && Date.now() < end);
    assert.ok(ui.ui.controls.some((c) => c.label === 'Terminé de leer'), ui.ui.text);
    await new Promise((r) => setTimeout(r, 6500)); await control((c) => c.label === 'Terminé de leer');
    do { await new Promise((r) => setTimeout(r, 150)); ui = await call('clipo_get_ui'); } while (!ui.ui.controls.some((c) => c.label === 'Guardar mi voz' && !c.disabled) && Date.now() < end);
    assert.ok(ui.ui.controls.some((c) => c.label === 'Guardar mi voz' && !c.disabled), ui.ui.text); await control((c) => c.label === 'Guardar mi voz');
    let catalog = await action({ action: 'catalog' }); const profile = catalog.voices.find((v) => v.name === 'MCP synthetic fixture'); assert.ok(profile);
    await stop(); await start(); s = await call('clipo_status'); s = await call('clipo_open_project', { projectId, expectedRevision: s.revision });
    catalog = await action({ action: 'catalog' }); assert.ok(catalog.voices.some((v) => v.id === profile.id));
    await call('clipo_editor', { ...guard(catalog), panel: 'tts', selection: null });
    await control((c) => c.label === 'Borrar la voz MCP synthetic fixture');
    ui = await call('clipo_get_ui'); assert.ok(ui.ui.controls.some((c) => c.label === 'Borrar')); await control((c) => c.label === 'Borrar');
    catalog = await action({ action: 'catalog' }); assert.ok(!catalog.voices.some((v) => v.id === profile.id));
  });
  await flow('app fully closed -> MCP status launches normal Clipo -> reconnect preserves saved project', async () => {
    await stop(); await openClient();
    const connected = await call('clipo_status'); assert.equal(connected.connected, true); assert.equal(connected.launched, true);
    agentPid = JSON.parse(await readFile(discoveryFile, 'utf8')).pid;
    const again = await call('clipo_connect'); assert.equal(again.launched, false);
    s = await call('clipo_open_project', { projectId, expectedRevision: again.revision }); assert.ok(s.project.clips.length); assert.equal(s.saveStatus, 'saved');
  });
  if (process.env.CLIPO_MCP_FULL === '1') {
    await flow('real local TTS -> encoded video -> imported source -> local ASR -> saved timed captions', async () => {
      const narration = await action({ action: 'narration', voiceId: 'claude', text: 'Esta es una prueba de Clipo. Los subtítulos siguen mi voz.', speed: 1, start: 0 }, 600000);
      assert.ok(narration.duration > 2);
      const rendered = await action({ action: 'export_video', short: '360' }); const artifact = rendered.artifacts[0];
      const videoFile = path.join(dir, 'spoken.mp4'); await call('clipo_export_file', { artifactId: artifact.id, path: videoFile });
      s = await call('clipo_get_project'); s = await call('clipo_create_project', { expectedRevision: s.revision, name: 'MCP speech validation', aspect: '9:16' });
      s = await call('clipo_import_media', { ...guard(s), paths: [videoFile] }); const id = s.imported[0];
      s = await call('clipo_edit', { ...guard(s), operations: [{ op: 'add_clip', clip: { assetId: id, out: s.project.assets[id].duration } }] });
      let caption = await call('clipo_generate_captions', { ...guard(s), quality: 'rapido' }); const end = Date.now() + 600000;
      while (['queued', 'running', 'saving'].includes(caption.job.status) && Date.now() < end) { await new Promise((r) => setTimeout(r, 500)); caption = await call('clipo_get_job', { jobId: caption.job.id }); }
      assert.equal(caption.job.status, 'completed', JSON.stringify(caption.job));
      s = await call('clipo_get_project'); const captions = s.project.texts.filter((t) => t.caption); assert.ok(captions.length);
      assert.match(captions.map((t) => t.text).join(' ').toLowerCase(), /prueba/);
      assert.ok(captions.every((t) => t.start >= 0 && t.start + t.duration <= s.duration + 0.01 && t.words?.length));
      await call('clipo_save_project', guard(s));
      const subtitle = await action({ action: 'export_subtitles', format: 'srt' }); assert.ok(subtitle.artifact.bytes > 20);
    });
  }
  const errors = allLog.split(/\r?\n/).filter((line) => line.includes('[renderer error]'));
  // MediaPipe 1.0 attempts optional Google diagnostics; Clipo intentionally
  // denies that endpoint in CSP. Record those denials; fail on every other error.
  blockedTelemetry = errors.filter((line) => line.includes('https://odml.pa.googleapis.com/v1/log') && /Content Security Policy/.test(line));
  assert.deepEqual(errors.filter((line) => !blockedTelemetry.includes(line)), []);
  succeeded = true;
  console.log('MCP SMOKE OK:', flows.length, 'end-to-end flows plus bridge/edit regression suite.');
} catch (e) { console.error(log); throw e; }
finally {
  await mkdir(path.resolve('release/mcp-validation'), { recursive: true });
  await writeFile(path.resolve('release/mcp-validation/latest.json'), JSON.stringify({ at: new Date().toISOString(), status: succeeded ? 'passed' : 'failed', full: process.env.CLIPO_MCP_FULL === '1', blockedTelemetryAttempts: blockedTelemetry.length, flows }, null, 2));
  await stop();
  // `dir` is a fresh, absolute mkdtemp path exclusively owned by this smoke test.
  await rm(dir, { recursive: true, force: true });
}
