// Run with: npm test. Magnetic snapping and clip drop positions on the timeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/hooks.ts';
import { sampleProject } from './fixtures/project.ts';

const { snapDrag, snapPoints, dropIndex, SNAP_PX } = await import('../src/timelineSnap.ts');
const { layout } = await import('../src/model.ts');
const round = (r: { ds: number; at: number | null }) => ({ ds: Math.round(r.ds * 1e6) / 1e6, at: r.at });

test('snap points: 0, playhead and every other item edge, sorted and unique', () => {
  // Clips 0-10 and 10-12; text 1-5; sticker 2-6; audio 0-20; overlays 1-5 and 0-4.
  assert.deepEqual(snapPoints(sampleProject(), 7.5), [0, 1, 2, 4, 5, 6, 7.5, 10, 12, 20]);
  // The dragged item's own edges don't count.
  assert.deepEqual(snapPoints(sampleProject(), 7.5, { kind: 'audio', id: 'au1' }), [0, 1, 2, 4, 5, 6, 7.5, 10, 12]);
});

test('snap points: trimming a main clip ignores the clips that move with it but keeps its start', () => {
  const bare = { ...sampleProject(), texts: [], stickers: [], audios: [], overlays: [] };
  assert.deepEqual(snapPoints(bare, 3, { kind: 'clip', id: 'c2' }), [0, 3, 10]);
  assert.deepEqual(snapPoints(bare, 3, { kind: 'clip', id: 'c1' }), [0, 3]);
});

test('snapDrag pulls the nearest edge onto a point within the threshold', () => {
  const pts = [0, 5, 10];
  // Item 2-4 dragged by 0.9: its end at 4.9 snaps to 5.
  assert.deepEqual(round(snapDrag(0.9, [{ base: 2, k: 1 }, { base: 4, k: 1 }], pts, 0.2)), { ds: 1, at: 5 });
  // Its start at 0.1 is closer to 0 than its end (2.1) is to anything.
  assert.deepEqual(round(snapDrag(-1.9, [{ base: 2, k: 1 }, { base: 4, k: 1 }], pts, 0.2)), { ds: -2, at: 0 });
  // Too far: unchanged.
  assert.deepEqual(snapDrag(0.5, [{ base: 2, k: 1 }], pts, 0.2), { ds: 0.5, at: null });
  // An edge that moves against the drag (a main clip's left trim moves its end).
  assert.deepEqual(round(snapDrag(0.1, [{ base: 10.2, k: -1 }], pts, 0.2)), { ds: 0.2, at: 10 });
});

test('the snap distance is in pixels, so it shrinks in seconds when zoomed in', () => {
  const near = (pps: number) => snapDrag(0.1, [{ base: 1, k: 1 }], [1.2], SNAP_PX / pps).at;
  assert.equal(near(60), 1.2); // 8px = 0.13s
  assert.equal(near(200), null); // 8px = 0.04s
});

test('dropIndex finds where a dragged clip lands among the others', () => {
  const p = sampleProject();
  p.clips.push({ ...p.clips[0]!, id: 'c3', in: 0, out: 4 }); // c1 0-10, c2 10-12, c3 12-16
  const placed = layout(p);
  assert.deepEqual(dropIndex(placed, 'c1', 5), { index: 0, at: 10 }); // stays
  assert.deepEqual(dropIndex(placed, 'c1', 13), { index: 1, at: 12 }); // past c2's middle
  assert.deepEqual(dropIndex(placed, 'c1', 30), { index: 2, at: 16 }); // the end
  assert.deepEqual(dropIndex(placed, 'c3', 0), { index: 0, at: 0 }); // the front
});
