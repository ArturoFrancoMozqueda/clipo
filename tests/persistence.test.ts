// Run with: npm test. Autosave timing and errors, the project list summary and media cleanup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/hooks.ts';
import { sampleProject } from './fixtures/project.ts';
import type { Project } from '../src/types.ts';

const { createAutosave } = await import('../src/autosave.ts');
const { blobsToDelete, projectAssetIds, projectMeta } = await import('../src/db.ts');

/** Manual timers so the test controls when the debounce fires. */
function fakeTimers() {
  let t = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => (due.set(++id, { at: t + ms, fn }), id),
    clearTimer: (k: unknown) => void due.delete(k as number),
    advance(ms: number) {
      t += ms;
      for (const [k, d] of [...due]) if (d.at <= t) (due.delete(k), d.fn());
    },
  };
}
const flushPromises = () => new Promise((r) => setTimeout(r, 0));
const version = (p: Project, n: number): Project => ({ ...p, updatedAt: n });

test('autosave waits for a pause, saves the last version once and skips what is saved', async () => {
  const timers = fakeTimers();
  const saved: number[] = [];
  const a = createAutosave({ ...timers, delay: 800, save: async (p) => void saved.push(p.updatedAt) });
  const base = sampleProject();
  for (let i = 1; i <= 5; i++) {
    a.changed(version(base, i));
    timers.advance(100);
  }
  assert.deepEqual(saved, []);
  timers.advance(800);
  await flushPromises();
  assert.deepEqual(saved, [5]);
  await a.flush();
  assert.deepEqual(saved, [5], 'nothing new to save');
});

test('autosave saves at least every maxWait while edits keep coming', async () => {
  const timers = fakeTimers();
  const saved: number[] = [];
  const a = createAutosave({ ...timers, delay: 800, maxWait: 2000, save: async (p) => void saved.push(p.updatedAt) });
  for (let i = 1; i <= 30; i++) {
    a.changed(version(sampleProject(), i));
    timers.advance(100);
  }
  await flushPromises();
  assert.ok(saved.length >= 1, 'saved during a long drag');
});

test('autosave reports a failure once, and again only after a save worked', async () => {
  const timers = fakeTimers();
  let fail = true;
  let errors = 0;
  const a = createAutosave({ ...timers, save: async () => { if (fail) throw new Error('QuotaExceededError'); }, onError: () => errors++ });
  const p = sampleProject();
  a.changed(version(p, 1));
  await a.flush();
  a.changed(version(p, 2));
  await a.flush();
  assert.equal(errors, 1);
  fail = false;
  a.changed(version(p, 3));
  await a.flush();
  fail = true;
  a.changed(version(p, 4));
  await a.flush();
  assert.equal(errors, 2);
});

test('closing or switching projects saves the previous one right away', async () => {
  const timers = fakeTimers();
  const saved: string[] = [];
  const a = createAutosave({ ...timers, save: async (p) => void saved.push(p.id) });
  a.changed(sampleProject());
  a.changed({ ...sampleProject(), id: 'p2' });
  await flushPromises();
  assert.deepEqual(saved, ['p1']);
  a.changed(null);
  await flushPromises();
  assert.deepEqual(saved, ['p1', 'p2']);
});

test('the project summary has what the list needs and every media id', () => {
  const p = sampleProject();
  p.clips[0].bgRemoval = { mode: 'media', color: '#000', assetId: 'bg1', smooth: 0.5 };
  const m = projectMeta(p);
  assert.deepEqual([m.id, m.name, m.aspect, m.clipCount], ['p1', 'Prueba', '9:16', 2]);
  assert.equal(m.thumb, p.assets.v1.thumb);
  assert.ok(m.duration >= 12);
  assert.deepEqual(new Set(projectAssetIds(p)), new Set(['v1', 'a1', 'i1', 'bg1']));
  assert.ok(!('clips' in m), 'no timeline in the summary');
});

test('garbage collection keeps used, in-memory and non-media blobs', () => {
  const stored = ['v1abcdef', 'orphan12ab', 'undo1234ab', 'myvoice:abc123', 'b1-video'];
  const gone = blobsToDelete(stored, new Set(['v1abcdef']), new Set(['undo1234ab']));
  assert.deepEqual(gone, ['orphan12ab']);
});
