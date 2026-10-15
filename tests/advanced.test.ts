// Run with: npm test. Pure math of the advanced mode: keyframes and color correction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addKeyframe, clearKeyframes, poseAt, removeKeyframe, setPose, shiftKeyframes, type Animatable } from '../src/keyframes.ts';
import { applyToPixels, autoColor, isNeutral, tone, toneLuts } from '../src/color.ts';
import { overlayDur, totalDuration } from '../src/model.ts';
import type { Project } from '../src/types.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const item = (): Animatable => ({ x: 0.5, y: 0.5, size: 0.3 });

test('without keyframes the pose is the item itself', () => {
  assert.deepEqual(poseAt(item(), 1), { x: 0.5, y: 0.5, size: 0.3, rotation: 0, opacity: 1 });
});

test('linear and eased interpolation between keyframes', () => {
  const it = item();
  it.keyframes = [
    { t: 0, x: 0, y: 0, size: 0.2, rotation: 0, opacity: 0, ease: 'linear' },
    { t: 2, x: 1, y: 0.5, size: 0.4, rotation: Math.PI, opacity: 1, ease: 'linear' },
  ];
  const mid = poseAt(it, 1);
  near(mid.x, 0.5);
  near(mid.size, 0.3);
  near(mid.opacity, 0.5);
  near(poseAt(it, 0.5).x, 0.25);
  // Outside the keyframes the edge pose holds.
  near(poseAt(it, -1).x, 0);
  near(poseAt(it, 9).x, 1);

  it.keyframes[0]!.ease = 'ease';
  near(poseAt(it, 1).x, 0.5); // symmetric at the middle
  assert.ok(poseAt(it, 0.5).x < 0.25, 'ease starts slower than linear');
  assert.ok(poseAt(it, 1.5).x > 0.75, 'and ends slower too');
});

test('setPose edits the item, or the keyframe at the playhead when animated', () => {
  const it = item();
  setPose(it, 1, { x: 0.2 });
  assert.equal(it.x, 0.2);
  assert.equal(it.keyframes, undefined);

  assert.ok(addKeyframe(it, 0));
  assert.equal(addKeyframe(it, 0.001), false, 'one keyframe per moment');
  setPose(it, 2, { x: 0.9 }); // creates a second keyframe
  assert.equal(it.keyframes!.length, 2);
  near(poseAt(it, 2).x, 0.9);
  near(poseAt(it, 0).x, 0.2);
  setPose(it, 2, { y: 0.1 }); // edits that same keyframe
  assert.equal(it.keyframes!.length, 2);
  near(poseAt(it, 2).y, 0.1);

  removeKeyframe(it, 2);
  removeKeyframe(it, 0);
  assert.equal(it.keyframes, undefined);
  near(it.x, 0.2, 1e-9);

  addKeyframe(it, 0);
  setPose(it, 1, { opacity: 0.5 });
  clearKeyframes(it, 1);
  assert.equal(it.keyframes, undefined);
  near(it.opacity!, 0.5);
});

test('split keeps the motion continuous', () => {
  const it = item();
  it.keyframes = [
    { t: 0, x: 0, y: 0, size: 0.2, rotation: 0, opacity: 1, ease: 'linear' },
    { t: 4, x: 1, y: 0, size: 0.2, rotation: 0, opacity: 1, ease: 'linear' },
  ];
  const second = { ...it, keyframes: shiftKeyframes(it.keyframes, 1) };
  near(poseAt(second, 0).x, poseAt(it, 1).x);
  near(poseAt(second, 2).x, poseAt(it, 3).x);
});

test('neutral color changes nothing', () => {
  assert.ok(isNeutral(undefined));
  assert.ok(isNeutral({ brightness: 0, vignette: 0 }));
  assert.ok(!isNeutral({ tint: 0.2 }));
  assert.ok(isNeutral({ vignette: 0.5 }, true));
  for (const x of [0, 0.1, 0.5, 0.9, 1]) for (const ch of [0, 1, 2] as const) near(tone({}, ch, x), x, 1e-12);
  const px = new Uint8ClampedArray([10, 120, 250, 255, 0, 0, 0, 255]);
  const copy = px.slice();
  applyToPixels({}, px);
  assert.deepEqual(px, copy);
});

test('each control moves the picture the expected way', () => {
  const mean = (c: Parameters<typeof tone>[0], ch: 0 | 1 | 2) => [0.2, 0.5, 0.8].reduce((s, x) => s + tone(c, ch, x), 0) / 3;
  assert.ok(mean({ brightness: 0.5 }, 1) > 0.5);
  assert.ok(mean({ brightness: -0.5 }, 1) < 0.5);
  assert.ok(tone({ contrast: 0.5 }, 1, 0.8) > 0.8 && tone({ contrast: 0.5 }, 1, 0.2) < 0.2);
  assert.ok(tone({ temperature: 0.6 }, 0, 0.5) > 0.5 && tone({ temperature: 0.6 }, 2, 0.5) < 0.5, 'warmer = more red, less blue');
  assert.ok(tone({ tint: -0.6 }, 1, 0.5) > 0.5, 'negative tint = greener');
  assert.ok(tone({ shadows: 0.8 }, 1, 0.15) > 0.15 && Math.abs(tone({ shadows: 0.8 }, 1, 0.95) - 0.95) < 0.01, 'shadows lift darks only');
  assert.ok(tone({ highlights: -0.8 }, 1, 0.9) < 0.9 && Math.abs(tone({ highlights: -0.8 }, 1, 0.1) - 0.1) < 0.01, 'highlights pull brights only');
  const gray = new Uint8ClampedArray([200, 100, 50, 255]);
  applyToPixels({ saturation: -1 }, gray);
  assert.ok(Math.abs(gray[0]! - gray[2]!) <= 1, 'no saturation = gray');
  for (const lut of toneLuts({ contrast: 1, brightness: 1 })) assert.ok(lut.every((v, i) => i === 0 || v >= lut[i - 1]!), 'curves never invert');
});

test('auto color fixes a warm, dark picture', () => {
  const px = new Uint8ClampedArray(4 * 400);
  for (let i = 0; i < 400; i++) {
    const v = 20 + (i % 60);
    px.set([v + 30, v + 5, v - 15 < 0 ? 0 : v - 15, 255], i * 4);
  }
  const a = autoColor(px);
  assert.ok((a.temperature ?? 0) < 0, 'cools a warm cast');
  assert.ok((a.brightness ?? 0) > 0, 'brightens a dark picture');
  assert.ok((a.contrast ?? 0) > 0, 'stretches a flat picture');
  assert.deepEqual(autoColor(new Uint8ClampedArray(0)), {});
});

test('old projects stay valid and overlays count toward the length', () => {
  const old = { id: 'p', name: 'x', aspect: '9:16', assets: {}, clips: [], texts: [], audios: [], createdAt: 0, updatedAt: 0 } as Project;
  assert.equal(totalDuration(old), 0);
  const ov = { id: 'o', assetId: 'a', start: 2, in: 1, out: 4, volume: 1, x: 0.5, y: 0.5, size: 0.4, rotation: 0, opacity: 1, blend: 'normal' as const };
  assert.equal(overlayDur(ov), 3);
  assert.equal(totalDuration({ ...old, overlays: [ov] }), 5);
});
