// Pure math for drawing the timeline: which part of it is worth rendering, ruler ticks, filmstrip
// frame times and waveform bars. Kept free of DOM and store code so it can be tested in Node.

/** Seconds of the timeline that are rendered around the playhead, as a bucket index. */
export function windowBucket(time: number, pps: number, vw: number) {
  const half = vw / pps / 2;
  return half > 0 ? Math.floor(time / half) : 0;
}

/**
 * Time range (seconds) worth rendering when the playhead sits in `bucket`: the visible screen plus
 * one screen on each side. It only changes when the playhead crosses half a screen, so scrolling
 * and playback don't re-render the rows every frame.
 */
export function viewWindow(bucket: number, pps: number, vw: number) {
  const screen = vw / pps;
  if (!(screen > 0)) return { from: -Infinity, to: Infinity };
  const half = screen / 2;
  return { from: bucket * half - 1.5 * screen, to: (bucket + 1) * half + 1.5 * screen };
}

/** Whether [start, end] overlaps the window. */
export const inWindow = (w: { from: number; to: number }, start: number, end: number) => end >= w.from && start <= w.to;

const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
/** Minor ticks per labeled step. */
const MINOR: Record<number, number> = { 0.5: 5, 1: 4, 2: 4, 5: 5, 10: 5, 15: 3, 30: 3, 60: 4, 120: 4, 300: 5 };

/** Seconds between labeled ruler ticks (at least ~70px apart) and between minor ticks (0 = none). */
export function tickSteps(pps: number) {
  const step = STEPS.find((s) => s * pps >= 70) ?? 300;
  const minor = step / MINOR[step]!;
  return { step, minor: minor * pps >= 7 ? minor : 0 };
}

/** Indexes k of the ticks at k * step inside [from, to], never before 0 or past `last`. */
export function tickRange(step: number, from: number, to: number, last: number) {
  const k0 = Math.max(0, Math.ceil(from / step - 1e-9));
  const k1 = Math.min(Math.floor(last / step + 1e-9), Math.floor(to / step + 1e-9));
  const out: number[] = [];
  for (let k = k0; k <= k1; k++) out.push(k);
  return out;
}

/** Source seconds between filmstrip frames: frames snap to these so zooming and trimming reuse them. */
const FRAME_STEPS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128];

export interface TileOpts {
  /** Source time at the item's left edge, and the last usable source time. */
  in: number;
  out: number;
  speed: number;
  /** Length on the timeline, seconds. */
  dur: number;
  pps: number;
  /** Tile width in px. */
  tile: number;
  /** Rendered window, in seconds from the item's start. */
  from: number;
  to: number;
  /** Freeze frame: every tile shows this source time. */
  freeze?: number;
}

/** Filmstrip tiles inside the window: offset in px from the item's left edge and the source time to show. */
export function filmstripTiles(o: TileOpts) {
  const n = Math.ceil((o.dur * o.pps) / o.tile - 1e-6);
  const per = (o.tile / o.pps) * o.speed;
  // The coarsest step that still gives each tile its own frame.
  let step = FRAME_STEPS[0]!;
  for (const s of FRAME_STEPS) if (s <= per) step = s;
  const i0 = Math.max(0, Math.floor((o.from * o.pps) / o.tile));
  const i1 = Math.min(n, Math.ceil((o.to * o.pps) / o.tile));
  const last = Math.max(o.in, o.out - 0.05);
  const out: { x: number; t: number }[] = [];
  for (let i = i0; i < i1; i++) {
    const raw = o.freeze ?? o.in + (((i + 0.5) * o.tile) / o.pps) * o.speed;
    const t = Math.min(last, Math.max(o.in, Math.round(raw / step) * step));
    out.push({ x: i * o.tile, t: Math.round(t * 1000) / 1000 });
  }
  return out;
}

/** Waveform height 0..1 for a level in dBFS: a 45 dB range, squared so loud and quiet parts read apart. */
export function dbToUnit(db: number) {
  const x = Math.min(1, Math.max(0, (db + 45) / 45));
  return x * x;
}

/**
 * Bars of a waveform from per-frame levels (dBFS, one per `frame` seconds of source): the loudest
 * frame of each of `bins` equal parts of [from, to), as 0..1. Parts outside the levels are 0.
 */
export function peakBins(levels: ArrayLike<number>, frame: number, from: number, to: number, bins: number) {
  const out = new Float32Array(Math.max(0, bins));
  const w = (to - from) / bins;
  for (let b = 0; b < bins; b++) {
    const a = Math.max(0, Math.floor((from + b * w) / frame));
    const e = Math.min(levels.length, Math.max(a + 1, Math.ceil((from + (b + 1) * w) / frame)));
    let m = -Infinity;
    for (let i = a; i < e; i++) if (levels[i]! > m) m = levels[i]!;
    out[b] = m === -Infinity ? 0 : dbToUnit(m);
  }
  return out;
}
