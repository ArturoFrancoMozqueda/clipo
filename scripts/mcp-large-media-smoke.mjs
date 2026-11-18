import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtemp, copyFile, open, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const dir = await mkdtemp(path.join(tmpdir(), 'clipo-large-smoke-'));
const appRoot = path.resolve('release/mcp-validation/packaged-final/win-unpacked');
const discoveryFile = path.join(dir, 'automation.json');
const env = { ...process.env, CLIPO_SMOKE: '1', CLIPO_SMOKE_EXTERNAL: '1', CLIPO_SMOKE_DATA: path.join(dir, 'profile'), CLIPO_BRIDGE_FILE: discoveryFile };
delete env.ELECTRON_RUN_AS_NODE; delete env.CLIPO_AUTOMATION;
const desktop = spawn(path.join(appRoot, 'Clipo.exe'), [], { env, windowsHide: true, stdio: 'ignore' });
const client = new Client({ name: 'large-media-smoke', version: '1' });
let state;
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args }, { timeout: 130000 });
  assert.ok(!r.isError, JSON.stringify(r));
  return JSON.parse(r.content.find(c => c.type === 'text').text);
};
const guard = () => ({ projectId: state.project.id, expectedRevision: state.revision });
try {
  const deadline = Date.now() + 40000;
  while (true) {
    try { await readFile(discoveryFile); break; } catch {}
    if (Date.now() > deadline || desktop.exitCode !== null) throw new Error('Packaged app did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(appRoot, 'resources/mcp/server.mjs')], env }));
  state = await call('clipo_status');
  state = await call('clipo_create_project', { expectedRevision: state.revision, name: 'Large media isolation test', aspect: '16:9' });
  const image = path.join(dir, 'large.jpg');
  await copyFile('tests/fixtures/portrait.jpg', image);
  const f = await open(image, 'r+'); await f.truncate(130 * 1024 * 1024); await f.close();
  state = await call('clipo_import_media', { ...guard(), paths: [image] });
  assert.equal(state.failed.length, 0); assert.equal(state.imported.length, 1);
  const assetId = state.imported[0];
  state = await call('clipo_edit', { ...guard(), operations: [{ op: 'add_clip', clip: { assetId, in: 0, out: 0.5 } }] });
  state = await call('clipo_save_project', guard());
  const id = state.project.id;
  state = await call('clipo_create_project', { expectedRevision: state.revision, name: 'Switch away before reopen', aspect: '16:9' });
  state = await call('clipo_open_project', { projectId: id, expectedRevision: state.revision });
  assert.equal(state.missingAssets.length, 0);
  state = await call('clipo_action', { ...guard(), request: { action: 'export_video', short: '360' } });
  const jobId = state.job.id;
  do {
    await new Promise(r => setTimeout(r, 500));
    state = await call('clipo_get_job', { jobId });
  } while (['queued', 'running'].includes(state.job.status));
  assert.equal(state.job.status, 'completed');
  assert.ok(state.job.result.artifacts[0].bytes > 1000);
  const exported = state.job.result.artifacts[0];
  const hdr = path.join(dir, 'hdr.mov');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x36:rate=30', '-t', '0.5', '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-x265-params', 'pools=1:frame-threads=1:log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc', hdr], { windowsHide: true });
  state = await call('clipo_import_media', { ...guard(), paths: [hdr], normalize: true, ranges: [{ from: .1, to: .4 }] });
  assert.equal(state.failed.length, 0); assert.equal(state.receipts[0].hdrToSdr, true);
  assert.equal(state.receipts[0].outputTransfer, 'bt709');
  assert.equal(state.receipts[0].outputCodec, 'h264');
  assert.equal(state.receipts[0].sourceFrom, .1);
  const report = { status: 'passed', at: new Date().toISOString(), bytes: 130 * 1024 * 1024, chunkBytes: 8 * 1024 * 1024, isolatedProfile: true, reopened: true, export: exported, compatibility: state.receipts[0] };
  await writeFile('release/mcp-validation/large-media.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  try { state = await call('clipo_get_project'); await call('clipo_close_editor', { projectId: state.project?.id ?? null, expectedRevision: state.revision }); } finally { await client.close(); }
}
