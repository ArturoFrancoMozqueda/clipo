// Run with: npm test. Copy-on-write edits, undo/redo history and opening damaged projects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { types } from 'node:util';
import './helpers/hooks.ts';
import { sampleProject } from './fixtures/project.ts';
import type { Project } from '../src/types.ts';

const { produce } = await import('../src/draft.ts');
const { useStore, selectionExists, findItem, editItem, HISTORY_LIMIT } = await import('../src/store.ts');
const { normalizeProject } = await import('../src/normalize.ts');

/** Fails if a proxy (draft) leaked into the result. */
function assertNoDrafts(v: unknown, path = 'root') {
  if (v === null || typeof v !== 'object') return;
  assert.ok(!types.isProxy(v), `draft left at ${path}`);
  for (const [k, x] of Object.entries(v)) assertNoDrafts(x, `${path}.${k}`);
}

const st = () => useStore.getState();
const open = (p = sampleProject()) => st().open(p, {});

// ---------- produce ----------

test('produce copies only the changed path and never touches the base', () => {
  const base = sampleProject();
  const before = JSON.stringify(base);
  const next = produce(base, (p) => {
    p.clips[1]!.speed = 3;
  });
  assert.equal(JSON.stringify(base), before);
  assert.equal(next.clips[1]!.speed, 3);
  assert.notEqual(next.clips, base.clips);
  assert.equal(next.clips[0], base.clips[0], 'untouched clip shared');
  assert.equal(next.assets, base.assets, 'assets (thumbnails) shared');
  assert.equal(next.luts, base.luts, 'LUTs shared');
  assert.equal(next.texts, base.texts);
  assertNoDrafts(next);
});

test('produce returns the base when nothing changed, even after reads', () => {
  const base = sampleProject();
  const next = produce(base, (p) => {
    void p.clips.find((c) => c.id === 'c2')!.speed;
    p.texts[0]!.x = 0.5; // same value
  });
  assert.equal(next, base);
});

test('produce handles spreads, filter, splice, push, delete and moved items', () => {
  const base = sampleProject();
  const next = produce(base, (p) => {
    p.clips.splice(1, 0, { ...p.clips[0]!, id: 'c3', in: 4 });
    delete p.clips[0]!.transition;
    p.audios = p.audios.filter((a) => a.id !== 'nope');
    p.audios[0]!.volume = 0.1;
    const [s] = p.stickers!.splice(0, 1);
    assert.ok(s);
    p.stickers!.push(s);
    p.texts.push({ ...p.texts[0]!, id: 't2' });
    p.texts[1]!.anim!.in = 'none';
  });
  assertNoDrafts(next);
  assert.deepEqual(next.clips.map((c) => c.id), ['c1', 'c3', 'c2']);
  assert.equal(next.clips[0]!.transition, undefined);
  assert.deepEqual(next.clips[1]!.transition, { type: 'fade', duration: 0.5 });
  assert.equal(base.clips[0]!.transition?.type, 'fade');
  assert.equal(next.audios[0]!.volume, 0.1);
  assert.equal(base.audios[0]!.volume, 0.8);
  assert.equal(next.stickers![0], base.stickers![0]);
  assert.equal(next.texts[1]!.anim!.in, 'none');
  // Like plain JS: a shallow spread shares the nested object, so both see the change.
  assert.equal(next.texts[0]!.anim, next.texts[1]!.anim);
  assert.equal(base.texts[0]!.anim!.in, 'fade');
  assert.ok(Array.isArray(next.clips));
  assert.deepEqual(Object.keys(next.clips[1]!).sort(), Object.keys(base.clips[0]!).sort());
});

test('produce does not change outside objects put into the project', () => {
  const base = sampleProject();
  const outside = { id: 'z', kind: 'audio' as const, name: 'x', duration: 1, width: 0, height: 0 };
  const next = produce(base, (p) => {
    p.assets.z = outside;
    p.assets.z.name = 'renamed';
  });
  assert.equal(outside.name, 'x');
  assert.equal(next.assets.z?.name, 'renamed');
  assert.equal(next.assets.v1, base.assets.v1);
  assertNoDrafts(next);
});

// ---------- history ----------

test('commit records one step; undo and redo walk it both ways', () => {
  open();
  const p0 = st().project!;
  st().commit((p) => void (p.clips[0]!.volume = 0));
  const p1 = st().project!;
  assert.equal(p1.clips[0]!.volume, 0);
  assert.equal(p0.clips[0]!.volume, 1, 'the snapshot is not modified');
  assert.equal(st().past.length, 1);
  st().undo();
  assert.equal(st().project, p0);
  assert.deepEqual([st().past.length, st().future.length], [0, 1]);
  st().redo();
  assert.equal(st().project, p1);
  assert.deepEqual([st().past.length, st().future.length], [1, 0]);
  st().undo();
  st().commit((p) => void (p.name = 'otro'));
  assert.equal(st().future.length, 0, 'a new edit drops the redo list');
});

test('checkpoint + live edits (a drag) undo as one step and share the heavy data', () => {
  open();
  const p0 = st().project!;
  st().checkpoint();
  for (let i = 1; i <= 50; i++) st().live((p) => void (p.texts[0]!.x = i / 100));
  assert.equal(st().past.length, 1);
  assert.equal(st().project!.texts[0]!.x, 0.5);
  assert.equal(st().project!.assets, p0.assets, 'thumbnails are not copied per pointer move');
  assert.equal(st().project!.luts, p0.luts);
  st().undo();
  assert.equal(st().project, p0);
  assert.equal(st().project!.texts[0]!.x, 0.5);
});

test('a checkpoint with no change is not an extra undo step', () => {
  open();
  const p0 = st().project!;
  st().checkpoint();
  st().checkpoint();
  st().commit((p) => void (p.name = 'x'));
  assert.equal(st().past.length, 1);
  st().undo();
  assert.equal(st().project, p0);
  st().undo(); // nothing left: stays put
  assert.equal(st().project, p0);
});

test('history keeps at most HISTORY_LIMIT steps', () => {
  open();
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) st().commit((p) => void (p.name = `v${i}`));
  assert.equal(st().past.length, HISTORY_LIMIT);
  assert.equal(st().past[0]?.name, 'v19');
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) st().undo();
  assert.equal(st().project!.name, 'v19');
});

test('undo drops a selection whose item is gone; selectionExists checks every kind', () => {
  open();
  const p = st().project!;
  for (const [kind, id] of [['clip', 'c1'], ['text', 't1'], ['audio', 'au1'], ['sticker', 's1'], ['overlay', 'o1']] as const) {
    assert.deepEqual(selectionExists(p, { kind, id }), { kind, id });
    assert.equal(selectionExists(p, { kind, id: 'missing' }), null);
  }
  assert.equal(selectionExists(null, { kind: 'clip', id: 'c1' }), null);
  assert.equal(selectionExists({ ...p, overlays: undefined }, { kind: 'overlay', id: 'o1' }), null);
  st().commit((q) => void q.texts.push({ ...q.texts[0]!, id: 'new' }));
  st().select({ kind: 'text', id: 'new' });
  st().undo();
  assert.equal(st().selection, null);
});

test('editItem is typed by kind and can record history', () => {
  open();
  editItem('audio', 'au1', (a) => void (a.fadeIn = 0), 'commit');
  assert.equal(findItem(st().project!, 'audio', 'au1')!.fadeIn, 0);
  assert.equal(st().past.length, 1);
  editItem('overlay', 'o1', (o) => void (o.blend = 'screen'));
  assert.equal(findItem(st().project!, 'overlay', 'o1')!.blend, 'screen');
  assert.equal(st().past.length, 1, 'live by default');
});

// ---------- opening damaged projects ----------

test('opening a damaged project fills defaults instead of crashing', () => {
  const broken = {
    id: 'p9',
    assets: { v1: { id: 'v1', kind: 'video', name: 'a', duration: 5, width: 1, height: 1 }, bad: null },
    clips: [{ id: 'c1', assetId: 'v1', in: 0, out: 5 }, { id: 'c2', assetId: 'gone', in: 0, out: 1 }, null],
    texts: [{ id: 't1', text: 'x' }],
    audios: 'nope',
  } as unknown as Project;
  const p = normalizeProject(broken);
  assert.equal(p.name, 'Mi video');
  assert.equal(p.aspect, '9:16');
  assert.deepEqual(Object.keys(p.assets), ['v1']);
  assert.equal(p.clips.length, 1);
  const [c] = p.clips;
  assert.ok(c);
  assert.deepEqual([c.speed, c.volume, c.filter, c.fit], [1, 1, 'none', 'fit']);
  const [t] = p.texts;
  assert.ok(t);
  assert.deepEqual([t.start, t.duration, t.styleId], [0, 3, 'clasico']);
  assert.deepEqual(p.audios, []);
  assert.deepEqual(p.stickers, []);
  assert.ok(p.createdAt > 0 && p.updatedAt > 0);
  open(broken);
  assert.equal(st().project!.clips.length, 1);
});

test('a healthy project opens unchanged', () => {
  const p = sampleProject();
  assert.deepEqual(normalizeProject(p), p);
});
