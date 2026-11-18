// Explicit, local verification against an installed app and a real project.
// Reads the original; all write/export checks use a saved duplicate. Nothing is uploaded.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const projectId = process.argv[2];
if (!projectId) throw new Error('Usage: node scripts/verify-installed-mcp.mjs <existing-project-id>');
if (!process.env.LOCALAPPDATA) throw new Error('Esta verificación de instalación es para Windows.');
const server = path.join(process.env.LOCALAPPDATA, 'Programs/Clipo/resources/mcp/server.mjs');
const client = new Client({ name: 'clipo-installed-real-project', version: '1.0.0' });
const out = path.resolve('release/mcp-validation'); await mkdir(out, { recursive: true });
const sha = (p) => createHash('sha256').update(JSON.stringify(p)).digest('hex');
const guard = (s) => ({ projectId: s.project?.id ?? s.projectSummary.id, expectedRevision: s.revision });
const report = { at: new Date().toISOString(), server, originalProjectId: projectId, status: 'failed', checks: [] };
let baseline; let baselineTime; let copyId;
async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 130000 });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const result = r.structuredContent ?? JSON.parse(r.content.find((c) => c.type === 'text').text);
  assert.deepEqual(result, JSON.parse(r.content.find((c) => c.type === 'text').text));
  for (const [i, c] of r.content.entries()) {
    if (c.type === 'image') await writeFile(path.join(out, `real-${name}-${i}.jpg`), Buffer.from(c.data, 'base64'));
    if (c.type === 'audio') await writeFile(path.join(out, `real-${name}-${i}.wav`), Buffer.from(c.data, 'base64'));
  }
  return result;
}
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } }));
  const tools = (await client.listTools()).tools;
  for (const name of ['clipo_inspect_media', 'clipo_review_export', 'clipo_query_project', 'clipo_get_request']) assert.ok(tools.some((t) => t.name === name && t.outputSchema));
  report.toolCount = tools.length; report.checks.push('fresh MCP discovery and output schemas');
  let s = await call('clipo_status', { response: 'summary' });
  if (s.projectSummary?.id !== projectId) s = await call('clipo_open_project', { projectId, expectedRevision: s.revision });
  s = await call('clipo_get_project'); baseline = s.project; baselineTime = s.time;
  assert.equal(baseline.id, projectId); assert.equal(s.saveStatus, 'saved');
  report.projectName = baseline.name; report.originalSha256 = sha(baseline);
  const assets = Object.values(baseline.assets).filter((a) => a.kind === 'video' && a.duration > 1);
  const asset = assets.find((a) => /compatible/i.test(a.name)) ?? assets[0]; assert.ok(asset, 'El proyecto debe tener al menos un video real.');
  const duration = Math.min(3, asset.duration - 0.05);
  const inspected = await call('clipo_inspect_media', { ...guard(s), assetId: asset.id, from: 0, to: duration, samples: 6 });
  assert.equal(inspected.frames.length, 6); assert.equal(inspected.domain, 'source');
  const first = await call('clipo_query_project', { ...guard(s), section: 'clips', limit: 2 });
  const second = await call('clipo_query_project', { ...guard(s), section: 'clips', limit: 2, offset: first.nextOffset });
  assert.equal(first.items.length, 2); assert.ok(!second.items.some((c) => first.items.some((a) => a.id === c.id)));
  const clip = baseline.clips.find((c) => (c.out - c.in) / c.speed > 1); assert.ok(clip);
  const planned = await call('clipo_plan_edit', { ...guard(s), response: 'summary', operations: [{ op: 'update_clip', id: clip.id, changes: { out: clip.out - 0.1 * clip.speed } }] });
  assert.ok(Math.abs(planned.plan.mainDurationDelta + 0.1) < 0.001); assert.ok(planned.plan.differences.length);
  const unchanged = await call('clipo_get_project'); assert.equal(sha(unchanged.project), sha(baseline)); assert.equal(unchanged.time, baselineTime);
  report.checks.push('source contact sheet, paginated query and detailed plan without original changes');
  const copy = await call('clipo_action', { ...guard(unchanged), request: { action: 'duplicate_project', name: baseline.name + ' · Prueba MCP' }, response: 'summary' });
  copyId = copy.projectId; assert.ok(copyId && copyId !== projectId); report.testProjectId = copyId;
  s = await call('clipo_open_project', { projectId: copyId, expectedRevision: copy.revision });
  const operations = [];
  for (const [collection, kind] of [['clips', 'clip'], ['texts', 'text'], ['audios', 'audio'], ['stickers', 'sticker'], ['overlays', 'overlay']]) {
    for (const item of s.project[collection] ?? []) operations.push({ op: 'delete', kind, id: item.id });
  }
  operations.push({ op: 'add_clip', clip: { assetId: asset.id, in: 0, out: duration, volume: 1, filter: 'none', fit: 'fit' } });
  operations.push({ op: 'settings', publish: { coverTime: 0 } });
  assert.ok(operations.length <= 200);
  const requestKey = 'installed-real-' + Date.now(); const edit = { ...guard(s), requestKey, operations, response: 'summary' };
  const applied = await call('clipo_edit', edit);
  const replay = await call('clipo_edit', edit); assert.equal(replay.replayed, true); assert.equal(replay.revision, applied.revision);
  const receipt = await call('clipo_get_request', { requestKey }); assert.equal(receipt.request.status, 'completed');
  report.checks.push('durable edit receipt and retry without duplicate writes on test copy');
  s = await call('clipo_get_project', { response: 'summary' });
  const queued = await call('clipo_action', { ...guard(s), request: { action: 'export_video', short: '360' }, response: 'summary' });
  let job = queued.job; const deadline = Date.now() + 180000;
  while (['queued', 'running', 'saving'].includes(job.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400)); job = (await call('clipo_get_job', { jobId: job.id, response: 'summary' })).job;
  }
  assert.equal(job.status, 'completed', JSON.stringify(job)); const artifact = job.result.artifacts[0];
  const review = await call('clipo_review_export', { artifactId: artifact.id, from: 0, to: duration, samples: 6, expectedDuration: duration });
  assert.equal(review.durationCheck.matches, true); assert.equal(review.frames.length, 6); assert.equal(review.domain, 'export');
  const target = path.join(out, 'real-project-' + Date.now() + '.mp4');
  const file = await call('clipo_export_file', { artifactId: artifact.id, path: target }); assert.equal(file.verified, true);
  report.exportedFile = target; report.exportSha256 = artifact.sha256; report.audio = review.audioAnalysis; report.coverage = review.coverage;
  report.checks.push('real-source export, decoded artifact review and SHA-256 verified local file');
  report.status = 'passed';
} catch (e) { report.error = e.message; process.exitCode = 1; }
finally {
  try {
    if (baseline) {
      let s = await call('clipo_get_project', { response: 'summary' });
      if (s.projectSummary?.id !== projectId) s = await call('clipo_open_project', { projectId, expectedRevision: s.revision });
      await call('clipo_seek', { projectId, expectedRevision: s.revision, time: Math.min(baselineTime, s.duration) });
      const restored = await call('clipo_get_project');
      assert.equal(sha(restored.project), sha(baseline)); assert.equal(restored.saveStatus, 'saved');
      report.originalUnchanged = true; report.originalOpenForReview = true;
    }
  } catch (e) { report.status = 'failed'; report.restoreError = e.message; process.exitCode = 1; }
  await writeFile(path.join(out, 'installed-real-project.json'), JSON.stringify(report, null, 2));
  await client.close(); console.log(JSON.stringify(report, null, 2));
}
