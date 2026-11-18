import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentJobs } from '../src/automation/jobs.ts';
import type { RecordStore } from '../src/automation/storage.ts';
const tick = () => new Promise<void>((r) => setImmediate(r));
function memory(): RecordStore {
  const data = new Map<string, unknown>();
  return { async put(k, v) { data.set(k, structuredClone(v)); }, async get<T>(k: string) { return structuredClone(data.get(k)) as T | undefined; }, async list<T>(prefix: string) { return [...data].filter(([k]) => k.startsWith(prefix)).map(([, v]) => structuredClone(v) as T); }, async remove(k) { data.delete(k); } };
}
test('persistent jobs serialize work, report terminal results and recover interrupted work without replay', async () => {
  const storage = memory(); let busy = false; let release!: () => void;
  const jobs = createAgentJobs(storage, () => 'j1', (value) => { busy = value; });
  const job = await jobs.start('p1', 'export', async (ctx) => { ctx.progress({ pct: 42 }); await new Promise<void>((r) => { release = r; }); return { artifactId: 'a1', verified: true }; });
  assert.equal(busy, true); await tick();
  await assert.rejects(jobs.start('p1', 'other', async () => null), /curso/);
  assert.deepEqual((await jobs.read(job.id)).progress, { pct: 42 }); release(); await tick();
  assert.equal((await jobs.read(job.id)).status, 'completed'); assert.equal(busy, false);
  await storage.put('job:dead', { id: 'dead', projectId: 'p1', kind: 'music', status: 'running', createdAt: 0 });
  const restarted = createAgentJobs(storage, () => 'j2', () => {}); await restarted.recover();
  assert.equal((await restarted.read('dead')).status, 'interrupted'); assert.equal((await restarted.read('j1')).status, 'completed');
});
test('cancelling an unknown job cannot abort active work; cancellation is acknowledged by the worker', async () => {
  const storage = memory(); const jobs = createAgentJobs(storage, () => 'j1', () => {});
  await jobs.start('p', 'analysis', async (ctx) => { await new Promise<void>((r) => ctx.signal.addEventListener('abort', () => r())); ctx.check(); return null; });
  await tick(); await assert.rejects(jobs.cancel('missing'), /inexistente/);
  assert.equal((await jobs.read('j1')).status, 'running'); await jobs.cancel('j1'); await tick();
  assert.equal((await jobs.read('j1')).status, 'cancelled');
});
test('a result already committed is completed even when a late cancel arrives', async () => {
  const storage = memory(); const jobs = createAgentJobs(storage, () => 'j1', () => {});
  let release!: () => void;
  await jobs.start('p', 'write', async () => { await new Promise<void>((r) => { release = r; }); return { committed: true }; });
  await tick(); await jobs.cancel('j1'); release(); await tick();
  assert.equal((await jobs.read('j1')).status, 'completed');
});
test('a queued record must be durable before computation starts', async () => {
  const storage = memory(); storage.put = async () => { throw new Error('disk full'); };
  let ran = false; let locked = false; const jobs = createAgentJobs(storage, () => 'j', (v) => { locked = v; });
  await assert.rejects(jobs.start('p', 'write', async () => { ran = true; }), /disk full/);
  assert.equal(ran, false); assert.equal(locked, false);
});
