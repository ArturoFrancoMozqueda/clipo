import type { Reframe } from './types';

/**
 * "Reencuadre automático": math only (no DOM) so it can be tested. The person masks come from the
 * existing segmentation; this turns them into a smooth path and into the crop the renderer uses.
 * The path is saved in the clip, so the preview and the export crop exactly the same way.
 */

export interface Point {
  t: number;
  x: number;
  y: number;
}

/** One analyzed moment; x/y missing when no person was found. */
export interface Sample {
  t: number;
  x?: number;
  y?: number;
}

/** Below this share of the picture covered by the person, the mask is treated as "nobody". */
const MIN_COVERAGE = 0.004;

/**
 * Center of the person in a mask (0..1 of the picture), or null when there is nobody. The vertical
 * center is pulled toward the top of the person so the face, not the belly, stays in frame.
 */
export function maskCenter(m: { w: number; h: number; alpha: ArrayLike<number> }): { x: number; y: number } | null {
  let sum = 0;
  let sx = 0;
  let top = -1;
  let bottom = -1;
  const rowMass = new Float64Array(m.h);
  for (let y = 0; y < m.h; y++) {
    let row = 0;
    for (let x = 0; x < m.w; x++) {
      const a = m.alpha[y * m.w + x];
      if (a < 128) continue; // only pixels that are clearly the person
      row += a;
      sx += a * (x + 0.5);
    }
    rowMass[y] = row;
    sum += row;
  }
  if (sum <= 0 || sum / (255 * m.w * m.h) < MIN_COVERAGE) return null;
  // Rows holding 5 % and 95 % of the mass: the person's top and bottom, ignoring stray pixels.
  let acc = 0;
  for (let y = 0; y < m.h; y++) {
    acc += rowMass[y];
    if (top < 0 && acc >= sum * 0.05) top = y;
    if (bottom < 0 && acc >= sum * 0.95) bottom = y;
  }
  const yCenter = (top + (bottom - top) * 0.35 + 0.5) / m.h;
  return { x: sx / sum / m.w, y: Math.min(1, Math.max(0, yCenter)) };
}

/**
 * Smooth path from raw samples: moments without a person keep the nearest known position (or the
 * center), then each point becomes a Gaussian-weighted local straight-line fit of its neighbors.
 * That removes jitter without lagging behind, even at the start and end of the clip, where a plain
 * average would pull the frame toward the middle. `tau` is the smoothing time in seconds.
 */
export function smoothTrack(samples: Sample[], tau = 0.7): Point[] {
  const s = [...samples].sort((a, b) => a.t - b.t);
  if (!s.length) return [];
  const known = s.filter((p) => p.x != null && p.y != null);
  if (!known.length) return s.map((p) => ({ t: p.t, x: 0.5, y: 0.5 }));
  // Fill the gaps with the nearest known value in time.
  const filled: Point[] = s.map((p) => {
    if (p.x != null && p.y != null) return { t: p.t, x: p.x, y: p.y };
    let best = known[0];
    for (const k of known) if (Math.abs(k.t - p.t) < Math.abs(best.t - p.t)) best = k;
    return { t: p.t, x: best.x!, y: best.y! };
  });
  if (tau <= 0 || filled.length < 3) return filled.map((p) => ({ t: round(p.t), x: round(p.x), y: round(p.y) }));
  const reach = tau * 3;
  return filled.map((pi) => {
    let sw = 0, st = 0, stt = 0, sx = 0, stx = 0, sy = 0, sty = 0;
    for (const pj of filled) {
      const d = pj.t - pi.t;
      if (d < -reach || d > reach) continue;
      const w = Math.exp(-0.5 * (d / tau) ** 2);
      sw += w;
      st += w * d;
      stt += w * d * d;
      sx += w * pj.x;
      stx += w * d * pj.x;
      sy += w * pj.y;
      sty += w * d * pj.y;
    }
    // Value at d = 0 of the weighted line fit; a plain weighted mean when the fit is degenerate.
    const det = sw * stt - st * st;
    const fit = (sv: number, stv: number) => (det > 1e-12 ? (stt * sv - st * stv) / det : sv / sw);
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    return { t: round(pi.t), x: round(clamp01(fit(sx, stx))), y: round(clamp01(fit(sy, sty))) };
  });
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Subject center at a source time, interpolated along the path (the ends hold). */
export function trackAt(points: Reframe['points'], t: number): { x: number; y: number } {
  if (!points.length) return { x: 0.5, y: 0.5 };
  if (t <= points[0].t) return { x: points[0].x, y: points[0].y };
  const last = points[points.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y };
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/**
 * Where to draw a sw×sh picture so it covers a W×H frame with `focus` (0..1 of the picture) as close
 * to the center as possible without showing an edge. Without a focus the picture is centered.
 */
export function coverRect(sw: number, sh: number, W: number, H: number, focus?: { x: number; y: number }) {
  const k = Math.max(W / sw, H / sh);
  const dw = sw * k;
  const dh = sh * k;
  if (!focus) return { dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh };
  const place = (size: number, frame: number, f: number) => Math.min(0, Math.max(frame - size, frame / 2 - f * size));
  return { dx: place(dw, W, focus.x), dy: place(dh, H, focus.y), dw, dh };
}

/** Moments of a clip's source to analyze: every `step` seconds from `from` to `to`, both included. */
export function sampleTimes(from: number, to: number, step = 1 / 3, max = 900): number[] {
  const span = Math.max(0, to - from);
  const n = Math.min(max, Math.max(1, Math.ceil(span / step)));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(round(from + (span * i) / n));
  return out;
}
