// Run with: npm test. Pure logic of LUTs (.cube), crop/flip framing and the transition/effect math.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/hooks.ts';
import { CROP_MIN, cropEdges, cropForAspect, cropRect, hasFraming, normCrop, pointInFrame, setCropEdge } from '../src/framing.ts';
import { coverScale, grainValues, hash, irisRadius, peak, pixelBlock, pushOffsets, smoothNoise } from '../src/fxmath.ts';

// lut.ts imports other app modules Vite-style (no extension): load it through the test hooks.
const {
  LUT_MAX_SIZE, applyLutToPixels, base64ToBytes, bytesToBase64, lutBytes, lutFromCube, lutToBytes, parseCube,
} = await import('../src/lut.ts');

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

/** A .cube text whose colors are f(r, g, b) on an n³ grid. */
function cube(n: number, f: (r: number, g: number, b: number) => [number, number, number], header = '') {
  const rows: string[] = [];
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) rows.push(f(r / (n - 1), g / (n - 1), b / (n - 1)).map((v) => v.toFixed(6)).join(' '));
  return `${header}LUT_3D_SIZE ${n}\n${rows.join('\n')}\n`;
}
const identity = (r: number, g: number, b: number): [number, number, number] => [r, g, b];
const invert = (r: number, g: number, b: number): [number, number, number] => [1 - r, 1 - g, 1 - b];

// ---------- .cube parsing ----------

test('parses a 3D .cube with title, comments, blank lines and CRLF', () => {
  const text = cube(2, identity, '# made by hand\r\nTITLE "Mi look"\r\n\r\nDOMAIN_MIN 0 0 0\r\nDOMAIN_MAX 1 1 1\r\n').replace(/\n/g, '\r\n');
  const l = parseCube(text);
  assert.equal(l.title, 'Mi look');
  assert.equal(l.size, 2);
  assert.equal(l.data.length, 8 * 3);
  // Red changes fastest: the second entry is (1, 0, 0).
  assert.deepEqual(Array.from(l.data.slice(3, 6)), [1, 0, 0]);
  assert.deepEqual(Array.from(l.data.slice(21, 24)), [1, 1, 1]);
});

test('reads the input range (DOMAIN and LUT_3D_INPUT_RANGE)', () => {
  assert.deepEqual(parseCube(cube(2, identity, 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n')).domainMax, [2, 2, 2]);
  const r = parseCube(cube(2, identity, 'LUT_3D_INPUT_RANGE -0.5 1.5\n'));
  assert.deepEqual(r.domainMin, [-0.5, -0.5, -0.5]);
  assert.deepEqual(r.domainMax, [1.5, 1.5, 1.5]);
});

test('turns a 1D .cube into the same curves on a 3D grid', () => {
  const rows = ['0 0 0', '0.25 0.5 1', '1 1 1'].join('\n');
  const l = parseCube(`LUT_1D_SIZE 3\n${rows}\n`);
  assert.equal(l.size, 3);
  // Red axis follows the red curve, green the green one, independently of the others.
  const at = (r: number, g: number, b: number) => Array.from(l.data.slice((r + g * 3 + b * 9) * 3, (r + g * 3 + b * 9) * 3 + 3));
  assert.deepEqual(at(1, 0, 0), [0.25, 0, 0]);
  assert.deepEqual(at(0, 1, 0), [0, 0.5, 0]);
  assert.deepEqual(at(1, 1, 1), [0.25, 0.5, 1]);
});

test('rejects broken files with a message for the user', () => {
  assert.throws(() => parseCube('hola mundo'), /LUT_3D_SIZE/);
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n1 0 0\n'), /incompleto/);
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 x\n'), /Línea 2/);
  assert.throws(() => parseCube(cube(2, identity, 'DOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n')), /rango/);
  assert.throws(() => parseCube('LUT_3D_SIZE 1\n0 0 0\n'), /Tamaño/);
});

// ---------- stored LUTs ----------

test('bytes keep the grid as is when it is small enough', () => {
  const { size, bytes } = lutToBytes(parseCube(cube(5, invert)));
  assert.equal(size, 5);
  assert.equal(bytes.length, 125 * 3);
  assert.deepEqual(Array.from(bytes.slice(0, 3)), [255, 255, 255]);
  assert.deepEqual(Array.from(bytes.slice(-3)), [0, 0, 0]);
});

test('large LUTs are resampled down to the stored maximum', () => {
  const { size, bytes } = lutToBytes(parseCube(cube(40, invert)));
  assert.equal(size, LUT_MAX_SIZE);
  assert.equal(bytes.length, LUT_MAX_SIZE ** 3 * 3);
  const mid = (16 + 16 * 33 + 16 * 33 * 33) * 3;
  assert.ok(Math.abs(bytes[mid]! - 127.5) <= 1, `${bytes[mid]}`);
});

test('the input range is baked in: a 0..2 identity halves every color', () => {
  const { bytes, size } = lutToBytes(parseCube(cube(3, identity, 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n')));
  // Grid input 1.0 maps to position 0.5 of the file's range, whose value is 0.5 -> 128.
  const last = (size ** 3 - 1) * 3;
  assert.ok(Math.abs(bytes[last]! - 128) <= 1, `${bytes[last]}`);
});

test('base64 storage round-trips', () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
});

test('lutFromCube names the look after the title or the file', () => {
  const a = lutFromCube('x1', 'Teal Orange.cube', cube(2, identity, 'TITLE "Cine cálido"\n'));
  assert.equal(a.name, 'Cine cálido');
  assert.equal(a.size, 2);
  assert.deepEqual(Array.from(lutBytes(a)), [0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 255, 0, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]);
  assert.equal(lutFromCube('x2', 'Teal Orange.cube', cube(2, identity)).name, 'Teal Orange');
});

// ---------- applying a LUT ----------

const px = () => new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 10, 128, 240, 255, 200, 30, 90, 128]);

test('an identity LUT leaves pixels as they were', () => {
  const l = lutFromCube('id', 'id.cube', cube(17, identity));
  const p = px();
  applyLutToPixels(p, lutBytes(l), l.size);
  px().forEach((v, i) => assert.ok(Math.abs(p[i]! - v) <= 1, `${i}: ${p[i]} vs ${v}`));
});

test('an inverting LUT inverts, interpolating between grid points; alpha is kept', () => {
  const l = lutFromCube('inv', 'inv.cube', cube(2, invert));
  const p = px();
  applyLutToPixels(p, lutBytes(l), l.size);
  px().forEach((v, i) => {
    if (i % 4 === 3) assert.equal(p[i], v);
    else assert.ok(Math.abs(p[i]! - (255 - v)) <= 1, `${i}: ${p[i]} vs ${255 - v}`);
  });
});

test('amount mixes the LUT with the original', () => {
  const l = lutFromCube('inv', 'inv.cube', cube(2, invert));
  const p = new Uint8ClampedArray([200, 0, 100, 255]);
  applyLutToPixels(p, lutBytes(l), l.size, 0.5);
  assert.deepEqual(Array.from(p), [128, 128, 128, 255]);
  const q = new Uint8ClampedArray([200, 0, 100, 255]);
  applyLutToPixels(q, lutBytes(l), l.size, 0);
  assert.deepEqual(Array.from(q), [200, 0, 100, 255]);
});

// ---------- crop and flip ----------

test('normCrop keeps crops inside the picture and drops "whole picture"', () => {
  assert.equal(normCrop(undefined), undefined);
  assert.equal(normCrop({ x: 0, y: 0, w: 1, h: 1 }), undefined);
  assert.deepEqual(normCrop({ x: 0.8, y: -1, w: 0.5, h: 0.01 }), { x: 0.5, y: 0, w: 0.5, h: CROP_MIN });
});

test('cropRect gives pixels inside the source', () => {
  assert.deepEqual(cropRect(undefined, 1920, 1080), { x: 0, y: 0, w: 1920, h: 1080 });
  assert.deepEqual(cropRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 1920, 1080), { x: 480, y: 540, w: 960, h: 540 });
});

test('cropForAspect picks the largest centered crop', () => {
  const v = cropForAspect(9 / 16, 1920, 1080)!;
  near(v.w * 1920 / (v.h * 1080), 9 / 16);
  near(v.h, 1);
  near(v.x, (1 - v.w) / 2);
  const wide = cropForAspect(16 / 9, 1080, 1920)!;
  near(wide.w, 1);
  near(wide.h * 1920, 1080 * 9 / 16);
  assert.equal(cropForAspect(16 / 9, 1920, 1080), undefined);
});

test('crop edges move independently and never cross', () => {
  let c = setCropEdge(undefined, 'left', 0.2);
  c = setCropEdge(c, 'bottom', 0.3);
  const e = cropEdges(c);
  near(e.left, 0.2);
  near(e.right, 0);
  near(e.top, 0);
  near(e.bottom, 0.3);
  c = setCropEdge(c, 'right', 0.95);
  near(cropEdges(c).right, 1 - CROP_MIN - 0.2);
  assert.equal(setCropEdge(setCropEdge(undefined, 'top', 0.4), 'top', 0), undefined);
});

test('hasFraming notices flips and real crops only', () => {
  assert.equal(hasFraming({}), false);
  assert.equal(hasFraming({ crop: { x: 0, y: 0, w: 1, h: 1 } }), false);
  assert.equal(hasFraming({ flipV: true }), true);
  assert.equal(hasFraming({ crop: { x: 0.1, y: 0, w: 0.8, h: 1 } }), true);
});

// ---------- transition and effect math ----------

test('noise is deterministic, so preview and export draw the same', () => {
  assert.equal(hash(12.5), hash(12.5));
  assert.equal(smoothNoise(3.3, 2), smoothNoise(3.3, 2));
  assert.ok(Math.abs(smoothNoise(7.2, 1)) <= 0.5);
  assert.deepEqual(grainValues(3, 500), grainValues(3, 500));
  assert.notDeepEqual(grainValues(3, 500), grainValues(4, 500));
});

test('film grain averages to middle gray (an overlay blend keeps the brightness)', () => {
  const v = grainValues(1, 20000);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  assert.ok(Math.abs(mean - 128) < 3, `${mean}`);
});

test('push moves both pictures together and ends with the new one in place', () => {
  const start = pushOffsets('left', 0);
  near(start.from[0], 0);
  near(start.to[0], 1);
  const end = pushOffsets('up', 1);
  near(end.from[1], -1);
  near(end.to[1], 0);
  const mid = pushOffsets('down', 0.5);
  near(mid.from[1] - mid.to[1], 1);
  assert.deepEqual(pushOffsets(undefined, 0.3), pushOffsets('left', 0.3));
});

test('spin scale always covers the frame', () => {
  near(coverScale(0, 720, 1280), 1);
  near(coverScale(Math.PI, 720, 1280), 1);
  near(coverScale(Math.PI / 2, 720, 1280), 1280 / 720);
  near(coverScale(Math.PI / 2, 500, 500), 1);
  assert.ok(coverScale(Math.PI / 4, 500, 500) > 1.41);
});

test('through-color transitions peak at the cut, iris reaches the corners', () => {
  assert.equal(peak(0), 0);
  assert.equal(peak(1), 0);
  assert.equal(peak(0.5), 1);
  near(irisRadius(1, 300, 400), 250);
  assert.equal(irisRadius(0, 300, 400), 0);
});

test('pixel blocks scale with the frame size', () => {
  near(pixelBlock(0.5, 1080, 1920) / pixelBlock(0.5, 720, 1280), 1.5);
  assert.ok(pixelBlock(0, 100, 100) >= 2);
});

test('automatic reframe follows the person through crop and flip', () => {
  const clip = { crop: { x: 0.5, y: 0, w: 0.5, h: 1 }, flipH: true } as Parameters<typeof pointInFrame>[0];
  // A person at 3/4 of the original width is the middle of the right half, and stays there flipped.
  assert.deepEqual(pointInFrame(clip, { x: 0.75, y: 0.4 }), { x: 0.5, y: 0.4 });
  // Outside the crop it clamps to the edge (flipped: right edge of the original crop = left side).
  assert.deepEqual(pointInFrame(clip, { x: 0.2, y: 0.4 }), { x: 1, y: 0.4 });
  assert.deepEqual(pointInFrame({} as Parameters<typeof pointInFrame>[0], { x: 0.3, y: 0.6 }), { x: 0.3, y: 0.6 });
});
