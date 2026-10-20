// Run with: npm test. Split and delete for every kind of item on the timeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stub } from './helpers/hooks.ts';
import { sampleProject } from './fixtures/project.ts';
import type { SelectionKind } from '../src/types.ts';

// The preview engine needs a browser; editing only asks it to pause.
stub('engine', 'export const engine = { pause() {}, play() {} };');
const { useStore } = await import('../src/store.ts');
const { splitAtPlayhead, deleteSelected, moveClipTo } = await import('../src/ops.ts');

const st = () => useStore.getState();
function at(kind: SelectionKind | null, id: string, time: number) {
  st().open(sampleProject(), {});
  st().select(kind ? { kind, id } : null);
  st().setTime(time);
}

test('splitting an audio keeps the fade-in on the first half and the fade-out on the second', () => {
  at('audio', 'au1', 10);
  splitAtPlayhead();
  const [a, b] = st().project!.audios;
  assert.ok(a && b);
  assert.deepEqual([a.start, a.in, a.out, a.fadeIn, a.fadeOut], [0, 5, 15, 2, 0]);
  assert.deepEqual([b.start, b.in, b.out, b.fadeIn, b.fadeOut], [10, 15, 25, 0, 3]);
  assert.deepEqual(st().selection, { kind: 'audio', id: b.id });
  st().undo();
  assert.equal(st().project!.audios.length, 1);
  assert.deepEqual([st().project!.audios[0]!.fadeIn, st().project!.audios[0]!.fadeOut], [2, 3]);
});

test('splitting a text keeps the entrance on the first piece and the exit on the second', () => {
  at('text', 't1', 3);
  splitAtPlayhead();
  const [a, b] = st().project!.texts;
  assert.ok(a && b);
  assert.deepEqual([a.start, a.duration, b.start, b.duration], [1, 2, 3, 2]);
  assert.deepEqual(a.anim, { in: 'fade', out: 'none', loop: 'none' });
  assert.deepEqual(b.anim, { in: 'none', out: 'pop', loop: 'none' });
});

test('splitting a main clip cuts its source by speed and moves the transition to the second piece', () => {
  at(null, '', 11); // clip c2 (source 2..6 at 2x) is on 10..12
  splitAtPlayhead();
  const [c1, x, y] = st().project!.clips;
  assert.ok(c1 && x && y);
  assert.equal(c1.id, 'c1');
  assert.deepEqual([x.in, x.out, y.in, y.out], [2, 4, 4, 6]);
  at(null, '', 4);
  splitAtPlayhead();
  const [a, b] = st().project!.clips;
  assert.ok(a && b);
  assert.deepEqual([a.in, a.out, b.in, b.out], [0, 4, 4, 10]);
  assert.equal(a.transition, undefined);
  assert.deepEqual(b.transition, { type: 'fade', duration: 0.5 });
});

test('splitting a sticker and overlays (video and photo)', () => {
  at('sticker', 's1', 3);
  splitAtPlayhead();
  const [s1, s2] = st().project!.stickers!;
  assert.ok(s1 && s2);
  assert.deepEqual([s1.duration, s2.start, s2.duration], [1, 3, 3]);

  at('overlay', 'o1', 2); // video overlay from 1 s, source 1..5
  splitAtPlayhead();
  const v = st().project!.overlays!.filter((o) => o.assetId === 'v1');
  assert.deepEqual(v.map((o) => [o.start, o.in, o.out]), [[1, 1, 2], [2, 2, 5]]);

  at('overlay', 'o2', 1); // photo overlay shows 0..4
  splitAtPlayhead();
  const ph = st().project!.overlays!.filter((o) => o.assetId === 'i1');
  assert.deepEqual(ph.map((o) => [o.start, o.in, o.out]), [[0, 0, 1], [1, 0, 3]]);
});

test('the playhead outside the item does not split it', () => {
  at('audio', 'au1', 0.05);
  const before = st().project;
  splitAtPlayhead();
  assert.equal(st().project, before);
  assert.equal(st().past.length, 0);
});

test('delete removes the selected item of every kind, and undo brings it back', () => {
  for (const [kind, id, list] of [
    ['clip', 'c1', 'clips'],
    ['text', 't1', 'texts'],
    ['audio', 'au1', 'audios'],
    ['sticker', 's1', 'stickers'],
    ['overlay', 'o1', 'overlays'],
  ] as const) {
    at(kind, id, 0);
    const n = (st().project![list] ?? []).length;
    deleteSelected();
    const items = (st().project![list] ?? []) as { id: string }[];
    assert.equal(items.length, n - 1, kind);
    assert.ok(!items.some((x) => x.id === id), kind);
    assert.equal(st().selection, null);
    st().undo();
    assert.ok(((st().project![list] ?? []) as { id: string }[]).some((x) => x.id === id), `${kind} back after undo`);
  }
});

test('moveClipTo reorders main clips in one undo step and keeps the playhead on the moved clip', () => {
  at('clip', 'c1', 0);
  assert.equal(moveClipTo('c1', 0), false);
  assert.equal(moveClipTo('c1', 1), true);
  assert.deepEqual(st().project!.clips.map((c) => c.id), ['c2', 'c1']);
  assert.ok(Math.abs(st().time - 2.01) < 1e-9);
  st().undo();
  assert.deepEqual(st().project!.clips.map((c) => c.id), ['c1', 'c2']);
  assert.equal(moveClipTo('c1', 5), false);
});
