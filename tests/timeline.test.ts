// Run with: npm test. Math behind the timeline's windowed rendering, ruler, filmstrips and waveforms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbToUnit, filmstripTiles, inWindow, peakBins, tickRange, tickSteps, viewWindow, windowBucket } from '../src/timelineMath.ts';

test('the rendered window covers the screen plus one screen each side, wherever the playhead is in its bucket', () => {
  const pps = 50;
  const vw = 400; // 8 s on screen
  for (const time of [0, 1, 3.99, 4, 37.2, 120]) {
    const w = viewWindow(windowBucket(time, pps, vw), pps, vw);
    assert.ok(w.from <= time - 4 - 8 + 1e-9, `from ${w.from} at ${time}`);
    assert.ok(w.to >= time + 4 + 8 - 1e-9, `to ${w.to} at ${time}`);
    assert.ok(w.to - w.from <= 8 * 3 + 4 + 1e-9);
  }
  // The bucket (and so the rows) only change every half screen.
  assert.equal(windowBucket(4.1, pps, vw), windowBucket(7.9, pps, vw));
  assert.notEqual(windowBucket(7.9, pps, vw), windowBucket(8.1, pps, vw));
});

test('before the timeline is measured everything is rendered', () => {
  const w = viewWindow(windowBucket(3, 50, 0), 50, 0);
  assert.ok(inWindow(w, 1e6, 1e6 + 1));
});

test('items are kept when they touch the window', () => {
  const w = { from: 10, to: 20 };
  assert.ok(inWindow(w, 5, 10));
  assert.ok(inWindow(w, 19, 30));
  assert.ok(inWindow(w, 0, 100));
  assert.ok(!inWindow(w, 0, 9.9));
  assert.ok(!inWindow(w, 20.1, 25));
});

test('ruler steps keep labels apart and only add minor ticks that are not cramped', () => {
  assert.deepEqual(tickSteps(70), { step: 1, minor: 0.25 });
  assert.deepEqual(tickSteps(200), { step: 0.5, minor: 0.1 });
  assert.equal(tickSteps(10).step, 10);
  assert.equal(tickSteps(0.01).step, 300);
  assert.deepEqual(tickSteps(20), { step: 5, minor: 1 });
  assert.equal(tickSteps(0.01).minor, 0); // 60 s ticks would be under a pixel apart
});

test('ticks are only made inside the window and never before 0 or past the end', () => {
  assert.deepEqual(tickRange(1, -5, 3.5, 100), [0, 1, 2, 3]);
  assert.deepEqual(tickRange(2, 10, 16, 100), [5, 6, 7, 8]);
  assert.deepEqual(tickRange(5, 0, 1000, 12), [0, 1, 2]);
  assert.deepEqual(tickRange(0.5, 1.2, 2.6, 10), [3, 4, 5]);
  assert.deepEqual(tickRange(1, 50, 60, 10), []);
});

test('filmstrip tiles follow the trim and the speed, and snap so zooming reuses frames', () => {
  const base = { in: 10, out: 30, speed: 1, dur: 20, pps: 10, tile: 50, from: -Infinity, to: Infinity };
  const tiles = filmstripTiles(base);
  assert.equal(tiles.length, 4); // 200 px / 50 px
  assert.deepEqual(tiles.map((t) => t.x), [0, 50, 100, 150]);
  // 5 s per tile, frames every 4 s: middles at 12.5, 17.5, 22.5, 27.5 s.
  assert.deepEqual(tiles.map((t) => t.t), [12, 16, 24, 28]);
  // Zooming in a little keeps the same snapped times for the same places.
  assert.deepEqual(filmstripTiles({ ...base, pps: 11 }).map((t) => t.t).slice(0, 2), [12, 16]);
  for (const t of tiles) assert.ok(t.t >= 10 && t.t < 30);
  // Twice as fast: twice as much source per tile.
  const fast = filmstripTiles({ ...base, speed: 2, dur: 10 });
  assert.equal(fast.length, 2);
  assert.ok(fast[1]!.t > fast[0]!.t);
  // Freeze frames show the same picture everywhere.
  assert.deepEqual(new Set(filmstripTiles({ ...base, freeze: 3 }).map((t) => t.t)), new Set([10]));
});

test('filmstrip tiles outside the window are skipped', () => {
  const tiles = filmstripTiles({ in: 0, out: 100, speed: 1, dur: 100, pps: 10, tile: 50, from: 40, to: 60 });
  assert.deepEqual(tiles.map((t) => t.x), [400, 450, 500, 550]);
});

test('waveform bars take the loudest frame of each part and respect the trim', () => {
  // 1 level per 0.5 s: quiet, loud, silent, mid.
  const levels = Float32Array.from([-45, 0, -200, -22.5]);
  assert.deepEqual([...peakBins(levels, 0.5, 0, 2, 4)], [0, 1, 0, 0.25]);
  assert.deepEqual([...peakBins(levels, 0.5, 0, 2, 2)], [1, 0.25]);
  // Trimmed to the last second.
  assert.deepEqual([...peakBins(levels, 0.5, 1, 2, 2)], [0, 0.25]);
  // Past the end of the sound: nothing.
  assert.deepEqual([...peakBins(levels, 0.5, 2, 3, 2)], [0, 0]);
  // More bars than frames: each bar still reads a frame.
  assert.deepEqual([...peakBins(levels, 0.5, 0.5, 1, 4)], [1, 1, 1, 1]);
  assert.equal(dbToUnit(-100), 0);
  assert.equal(dbToUnit(6), 1);
});
