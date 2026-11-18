import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/hooks.ts';
import { sampleProject } from './fixtures/project.ts';
import { toolSchemas } from '../src/automation/schema.ts';
const { applyEdits } = await import('../src/automation/edits.ts');
const { useStore } = await import('../src/store.ts');

const operations = (ops: unknown[]) => toolSchemas.clipo_edit.parse({ projectId: 'p1', expectedRevision: 0, operations: ops }).operations;
afterEach(() => useStore.getState().close());

test('full visual fields validate references and permit explicit removal without resetting other edits', () => {
  const p = sampleProject();
  const next = applyEdits(p, operations([{ op: 'update_clip', id: 'c1', changes: { bgRemoval: { mode: 'media', assetId: 'i1', color: '#ffffff', smooth: 0.3 }, voiceFx: 'echo', reframe: { points: [{ t: 0, x: 0.4, y: 0.5 }] } } }])).project;
  assert.equal(next.clips[0]!.voiceFx, 'echo');
  const cleared = applyEdits(next, operations([{ op: 'clear', kind: 'clip', id: 'c1', fields: ['bgRemoval', 'reframe'] }])).project;
  assert.equal(cleared.clips[0]!.bgRemoval, undefined); assert.equal(cleared.clips[0]!.voiceFx, 'echo');
  assert.throws(() => applyEdits(p, operations([{ op: 'update_clip', id: 'c1', changes: { lut: { id: 'missing', amount: 1 } } }])), /LUT/);
  assert.throws(() => applyEdits(p, operations([{ op: 'clear', kind: 'audio', id: 'au1', fields: ['crop'] }])), /incompatible/);
});

test('patches preserve omitted values, including nondefault trim and animation', () => {
  const p = sampleProject();
  p.clips[1]!.filter = 'warm';
  const next = applyEdits(p, operations([
    { op: 'update_clip', id: 'c2', changes: { volume: 0.3 } },
    { op: 'update_text', id: 't1', changes: { text: 'Nuevo título' } },
    { op: 'update_audio', id: 'au1', changes: { volume: 0.2 } },
    { op: 'update_overlay', id: 'o1', changes: { opacity: 0.5 } },
    { op: 'update_sticker', id: 's1', changes: { duration: 2 } },
  ])).project;
  assert.deepEqual(next.clips[1], { ...p.clips[1], volume: 0.3 });
  assert.deepEqual(next.texts[0], { ...p.texts[0], text: 'Nuevo título' });
  assert.deepEqual(next.audios[0], { ...p.audios[0], volume: 0.2 });
  assert.deepEqual(next.overlays![0], { ...p.overlays![0], opacity: 0.5 });
  assert.deepEqual(next.stickers![0], { ...p.stickers![0], duration: 2 });
});

test('a failed batch never changes the project or creates a partial history step', () => {
  const p = sampleProject();
  const original = structuredClone(p);
  useStore.getState().open(p, {});
  assert.throws(() => applyEdits(p, operations([
    { op: 'settings', name: 'Should not persist' },
    { op: 'add_clip', clip: { assetId: 'v1', out: 99 } },
  ])), /Recorte/);
  assert.deepEqual(p, original);
  assert.equal(useStore.getState().past.length, 0);
});

test('source-aware splitting keeps the outgoing transition on the second piece', () => {
  const p = sampleProject();
  p.clips[1]!.transition = { type: 'fade', duration: 0.5 };
  const { project: next } = applyEdits(p, operations([{ op: 'split_clip', id: 'c2', at: 11 }]));
  assert.equal(next.clips[1]!.in, 2);
  assert.equal(next.clips[1]!.out, 4);
  assert.equal(next.clips[1]!.transition, undefined);
  assert.equal(next.clips[2]!.in, 4);
  assert.equal(next.clips[2]!.out, 6);
  assert.equal(next.clips[2]!.transition!.type, 'fade');
  assert.equal(p.clips.length, 2);
});

test('a complete batch is a single undoable step in the actual editor store', () => {
  useStore.getState().open(sampleProject(), {});
  const before = useStore.getState().project!;
  const { project, added } = applyEdits(before, operations([
    { op: 'settings', aspect: '16:9', audioMix: { duck: 12, normalize: true } },
    { op: 'add_text', text: { text: 'Hola MCP', start: 0, duration: 3, caption: true } },
    { op: 'add_audio', audio: { assetId: 'a1', start: 0, out: 10, role: 'music' } },
  ]));
  useStore.getState().commit((p) => Object.assign(p, project));
  assert.equal(added.length, 2);
  assert.equal(useStore.getState().past.length, 1);
  assert.equal(useStore.getState().project!.texts.at(-1)!.text, 'Hola MCP');
  useStore.getState().undo();
  assert.equal(useStore.getState().project, before);
  useStore.getState().redo();
  assert.equal(useStore.getState().project!.aspect, '16:9');
});

test('invalid kinds, catalogs, framing, words and reorder cannot corrupt a project', () => {
  const p = sampleProject();
  for (const op of [
    { op: 'add_clip', clip: { assetId: 'a1', out: 2 } },
    { op: 'add_clip', clip: { assetId: '__proto__', out: 2 } },
    { op: 'update_clip', id: 'c1', changes: { filter: 'invented' } },
    { op: 'update_clip', id: 'c1', changes: { crop: { x: 0.8, y: 0, w: 0.9, h: 1 } } },
    { op: 'reorder_clips', clipIds: ['c1', 'c1'] },
    { op: 'add_sticker', sticker: { start: 0, duration: 2 } },
    { op: 'update_text', id: 't1', changes: { words: [{ text: 'Hola', start: 0, end: 8 }] } },
    { op: 'update_text', id: 't1', changes: { keyframes: [{ t: 99, x: 0.5, y: 0.5, size: 0.1, rotation: 0, opacity: 1, ease: 'linear' }] } },
  ]) assert.throws(() => applyEdits(p, operations([op])));
  assert.throws(() => operations([{ op: 'settings', arbitraryCode: 'danger' }]));
  assert.throws(() => operations([{ op: 'update_clip', id: 'c1', changes: { speed: 0 } }]));
  assert.throws(() => operations([{ op: 'add_text', text: { text: 'bad', start: -1, duration: 2 } }]));
});
