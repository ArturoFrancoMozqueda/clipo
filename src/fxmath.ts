// Pure timing and geometry of transitions and effects (no canvas), shared by visuals.ts and tests.
import type { Direction } from './types';

/** Cheap deterministic noise so effects look the same in preview and export. */
export function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Smooth noise in -0.5..0.5 that changes about once per unit of t. */
export function smoothNoise(t: number, seed: number) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return hash(i + seed * 101) * (1 - u) + hash(i + 1 + seed * 101) * u - 0.5;
}

/** Gray film-grain values (0..255, centered on 128 so an "overlay" blend leaves the average alone). */
export function grainValues(seed: number, count: number) {
  const out = new Uint8ClampedArray(count);
  for (let i = 0; i < count; i++) {
    // Sum of three uniforms ≈ a bell curve: mostly fine grain with a few stronger specks.
    const v = hash(i * 3.1 + seed * 7919) + hash(i * 5.7 + seed * 104729 + 1) + hash(i * 1.3 + seed * 1299709 + 2);
    out[i] = 128 + (v - 1.5) * 150;
  }
  return out;
}

/** How strong a "through a color" transition is: 0 at the ends, 1 around the cut. */
export const peak = (k: number) => Math.min(1, (1 - Math.abs(2 * k - 1)) * 1.15);

/** Unit vector of the motion for a push: the old clip leaves this way and the new one follows. */
export function dirVector(dir: Direction | undefined): [number, number] {
  if (dir === 'right') return [1, 0];
  if (dir === 'up') return [0, -1];
  if (dir === 'down') return [0, 1];
  return [-1, 0];
}

/** Offsets (in frame widths/heights) of the outgoing and incoming picture during a push. */
export function pushOffsets(dir: Direction | undefined, k: number) {
  const [vx, vy] = dirVector(dir);
  return { from: [vx * k, vy * k] as const, to: [vx * (k - 1), vy * (k - 1)] as const };
}

/** Scale that keeps a W×H picture rotated by `theta` covering the whole W×H frame (no corners showing). */
export function coverScale(theta: number, W: number, H: number) {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  return Math.max((W * c + H * s) / W, (W * s + H * c) / H);
}

/** Radius of the iris circle that has opened a fraction k of the way (reaches the corners at k = 1). */
export const irisRadius = (k: number, W: number, H: number) => k * Math.hypot(W, H) / 2;

/** Size in output pixels of one pixelate block (scaled with the frame so preview and export match). */
export const pixelBlock = (amt: number, W: number, H: number) => Math.max(2, (4 + 36 * amt) * Math.min(W, H) / 720);
