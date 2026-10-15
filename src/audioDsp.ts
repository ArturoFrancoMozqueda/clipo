// Pure audio math (no Web Audio, no DOM), shared by the preview, the export and the tests:
// level meters, voice detection, the ducking curve, loudness (ITU-R BS.1770) with a limiter,
// and silence detection for "Quitar silencios".
import type { AudioItem, AudioRole, Clip, Project } from './types';

/** Length of one analysis frame in seconds (50 per second). */
export const FRAME = 0.02;

const toDb = (x: number) => (x > 1e-10 ? 20 * Math.log10(x) : -200);
export const dbToGain = (db: number) => 10 ** (db / 20);

/** RMS level of every FRAME of mono samples, in dBFS (-200 for digital silence). */
export function frameLevels(samples: Float32Array, sampleRate: number, frame = FRAME): Float32Array {
  const n = Math.max(1, Math.round(frame * sampleRate));
  const count = Math.ceil(samples.length / n);
  const out = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    let sum = 0;
    const a = f * n;
    const b = Math.min(samples.length, a + n);
    for (let i = a; i < b; i++) sum += samples[i]! * samples[i]!;
    out[f] = toDb(Math.sqrt(sum / Math.max(1, b - a)));
  }
  return out;
}

function percentile(levels: Float32Array, q: number) {
  const s = Array.from(levels).filter((x) => x > -150).sort((a, b) => a - b);
  if (!s.length) return -200;
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]!;
}

/** Typical level of the loud (spoken) parts: the 95th percentile of the frames. */
export const speechLevel = (levels: Float32Array) => percentile(levels, 0.95);

/**
 * Frames where someone is talking (1) or not (0). A frame counts when it is clearly above the
 * background noise and not far below the loudest parts; blips shorter than `minOn` are dropped
 * and gaps between words shorter than `bridge` are filled.
 */
export function voiceActivity(levels: Float32Array, opts: { minOn?: number; bridge?: number } = {}): Uint8Array {
  const act = new Uint8Array(levels.length);
  const loud = speechLevel(levels);
  if (loud < -55) return act; // nothing but (near) silence
  const noise = percentile(levels, 0.1);
  const thr = Math.max(-50, noise + 10, loud - 28);
  for (let i = 0; i < levels.length; i++) act[i] = levels[i]! >= thr ? 1 : 0;
  fillGaps(act, Math.round((opts.bridge ?? 0.25) / FRAME), 1);
  fillGaps(act, Math.round((opts.minOn ?? 0.1) / FRAME), 0);
  return act;
}

/** Replace runs of `!v` shorter than `max` frames that sit between runs of `v`. */
function fillGaps(a: Uint8Array, max: number, v: 0 | 1) {
  let i = 0;
  while (i < a.length) {
    if (a[i] === v) { i++; continue; }
    let j = i;
    while (j < a.length && a[j] !== v) j++;
    const inside = v === 1 ? i > 0 && j < a.length : true;
    if (inside && j - i < max) a.fill(v, i, j);
    i = j;
  }
}

// ---------- ducking ----------

export interface DuckOptions {
  /** How much the music goes down while someone talks, in dB (positive). */
  depth: number;
  /** Seconds to go down; the dip starts this early so the first word is already clear. */
  attack?: number;
  /** Seconds to come back up after the voice stops. */
  release?: number;
  /** Seconds the music stays down after the voice, so it doesn't pump between sentences. */
  hold?: number;
}

/**
 * Gain (linear, 0..1) to apply to the background music for every FRAME, given when there is voice.
 * Changes are straight ramps in dB, so the music glides down and back up without clicks.
 */
export function duckCurve(activity: Uint8Array, o: DuckOptions): Float32Array {
  const n = activity.length;
  const depth = Math.max(0, o.depth);
  const out = new Float32Array(n).fill(1);
  if (!n || depth <= 0) return out;
  const attack = Math.max(FRAME, o.attack ?? 0.2);
  const release = Math.max(FRAME, o.release ?? 0.6);
  const hold = Math.round((o.hold ?? 0.3) / FRAME);
  const lead = Math.round(attack / FRAME);
  // Where the music must be fully down: the voice, a little before it and the hold after it.
  const down = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!activity[i]) continue;
    down.fill(1, Math.max(0, i - lead), Math.min(n, i + hold + 1));
  }
  // Follow that target in dB, moving at most one attack/release step per frame. Because the dip
  // starts `lead` frames early, the music is fully down exactly when the voice begins.
  const stepDown = (depth / attack) * FRAME;
  const stepUp = (depth / release) * FRAME;
  let db = down[0] ? -depth : 0;
  for (let i = 0; i < n; i++) {
    const target = down[i] ? -depth : 0;
    db = Math.min(db + stepUp, Math.max(db - stepDown, target));
    out[i] = dbToGain(db);
  }
  return out;
}

/** Value of a per-FRAME curve at time t (seconds), linearly interpolated. */
export function curveAt(curve: Float32Array, t: number) {
  if (!curve.length) return 1;
  const x = t / FRAME;
  const i = Math.floor(x);
  if (i < 0) return curve[0]!;
  if (i >= curve.length - 1) return curve[curve.length - 1]!;
  return curve[i]! + (curve[i + 1]! - curve[i]!) * (x - i);
}

/** What an audio item is, for ducking. Items saved before roles existed are guessed from their name. */
export function audioRole(a: AudioItem, assetName = ''): AudioRole {
  if (a.role) return a.role;
  if (/^(Voz|Narración)\b/i.test(assetName)) return 'voice';
  if (/^Sonido:/i.test(assetName)) return 'sfx';
  return 'music';
}

/** Per-asset voice activity: frame flags in source time. */
export type ActivityByAsset = Record<string, Uint8Array | undefined>;

/**
 * When someone is talking on the project timeline (per FRAME): sound of the main-track videos
 * and voice/narration items. Music and sound effects never count.
 */
export function timelineVoice(p: Project, activity: ActivityByAsset, duration: number): Uint8Array {
  const n = Math.max(0, Math.ceil(duration / FRAME));
  const out = new Uint8Array(n);
  const mark = (act: Uint8Array | undefined, start: number, srcIn: number, len: number, speed: number) => {
    if (!act) return;
    const a = Math.max(0, Math.floor(start / FRAME));
    const b = Math.min(n, Math.ceil((start + len) / FRAME));
    for (let f = a; f < b; f++) {
      const src = Math.floor((srcIn + (f * FRAME - start) * speed) / FRAME);
      if (src >= 0 && src < act.length && act[src]) out[f] = 1;
    }
  };
  let t = 0;
  for (const c of p.clips) {
    const len = (c.out - c.in) / c.speed;
    if (p.assets[c.assetId]?.kind === 'video' && c.volume > 0) mark(activity[c.assetId], t, c.in, len, c.speed);
    t += len;
  }
  for (const a of p.audios) {
    if (a.volume <= 0 || audioRole(a, p.assets[a.assetId]?.name) !== 'voice') continue;
    mark(activity[a.assetId], a.start, a.in, a.out - a.in, 1);
  }
  return out;
}

// ---------- loudness (ITU-R BS.1770-4 / EBU R128) ----------

type Biquad = [b0: number, b1: number, b2: number, a1: number, a2: number];

/** The two K-weighting filters (high shelf + high pass) for any sample rate. */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const hp: Biquad = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  return [shelf, hp];
}

function filter(x: Float32Array, [b0, b1, b2, a1, a2]: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const v = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * Integrated loudness in LUFS of mono or stereo audio (gated, 400 ms blocks with 75 % overlap).
 * Returns -Infinity for silence.
 */
export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  const [shelf, hp] = kWeighting(sampleRate);
  const weighted = channels.map((c) => filter(filter(c, shelf), hp));
  const len = channels[0]?.length ?? 0;
  const block = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  if (len < block) {
    if (!len) return -Infinity;
    // Shorter than one block: measure it as a single block.
    let z = 0;
    for (const w of weighted) { let s = 0; for (let i = 0; i < len; i++) s += w[i]! * w[i]!; z += s / len; }
    return z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity;
  }
  // Running sums of squares make every block O(1).
  const cums = weighted.map((w) => {
    const c = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) c[i + 1] = c[i]! + w[i]! * w[i]!;
    return c;
  });
  const zs: number[] = [];
  for (let a = 0; a + block <= len; a += hop) {
    let z = 0;
    for (const c of cums) z += (c[a + block]! - c[a]!) / block;
    zs.push(z);
  }
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const abs = zs.filter((z) => z > 0 && lufs(z) > -70);
  if (!abs.length) return -Infinity;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter((z) => lufs(z) > rel);
  return gated.length ? lufs(mean(gated)) : -Infinity;
}

/** Highest absolute sample over all channels. */
export function peak(channels: Float32Array[]) {
  let m = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]!); if (v > m) m = v; }
  return m;
}

/**
 * Look-ahead peak limiter, in place: no sample ends above `ceiling` (linear). The gain dips smoothly
 * a few milliseconds before each peak and recovers over `release` seconds, so it doesn't crackle.
 */
export function limit(channels: Float32Array[], sampleRate: number, ceiling = dbToGain(-1), release = 0.15) {
  const len = channels[0]?.length ?? 0;
  if (!len) return;
  const look = Math.max(1, Math.round(0.005 * sampleRate));
  // Gain each sample needs on its own.
  const need = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let m = 0;
    for (const c of channels) m = Math.max(m, Math.abs(c[i]!));
    need[i] = m > ceiling ? ceiling / m : 1;
  }
  // Minimum over the look-ahead window (a monotonic deque keeps it linear time).
  const g = new Float32Array(len);
  const dq = new Int32Array(len);
  let h = 0, t = 0;
  for (let i = 0, j = 0; i < len; i++) {
    for (; j < len && j <= i + look; j++) {
      while (t > h && need[dq[t - 1]!]! >= need[j]!) t--;
      dq[t++] = j;
    }
    while (dq[h]! < i) h++;
    g[i] = need[dq[h]!]!;
  }
  // Ramp down across the look-ahead window instead of jumping, then recover slowly.
  const rel = 1 - Math.exp(-1 / (release * sampleRate));
  const smooth = new Float32Array(len);
  let cur = 1;
  for (let i = 0; i < len; i++) {
    const gi = g[i]!;
    cur = gi < cur ? gi : cur + (gi - cur) * rel;
    smooth[i] = cur;
  }
  // Average over the look-ahead window: still ≤ need at each peak because the window minimum covers it.
  const out = new Float32Array(len);
  let acc = 0;
  for (let i = 0; i < len; i++) {
    acc += smooth[i]!;
    if (i >= look) acc -= smooth[i - look]!;
    out[i] = acc / Math.min(i + 1, look);
  }
  for (const c of channels) {
    for (let i = 0; i < len; i++) {
      const k = Math.min(out[i]!, need[i]!);
      c[i]! *= k;
    }
  }
}

export interface NormalizeResult {
  /** Loudness before, in LUFS (-Infinity when silent). */
  before: number;
  after: number;
  /** Gain applied before the limiter, in dB. */
  gainDb: number;
}

/**
 * Bring a mix to `target` LUFS (e.g. -14 for social networks), in place, then limit peaks to -1 dBFS.
 * Very quiet mixes are raised at most `maxGainDb` so background noise isn't blown up.
 */
export function normalizeLoudness(channels: Float32Array[], sampleRate: number, target = -14, maxGainDb = 20): NormalizeResult {
  const before = integratedLoudness(channels, sampleRate);
  if (!Number.isFinite(before)) return { before, after: before, gainDb: 0 };
  const gainDb = Math.min(maxGainDb, target - before);
  const k = dbToGain(gainDb);
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i]! *= k;
  limit(channels, sampleRate);
  return { before, after: integratedLoudness(channels, sampleRate), gainDb };
}

// ---------- silences ----------

export interface Range {
  start: number;
  end: number;
}

export interface SilenceOptions {
  /** How far below the spoken parts counts as silence, in dB (bigger = only very quiet parts). */
  depth?: number;
  /** Shortest pause that gets removed, in seconds. */
  minDuration?: number;
  /** Seconds of the pause kept on each side, so words aren't clipped. */
  margin?: number;
}

/** Pauses (in seconds of the analyzed audio) that can be cut, already shrunk by the margin. */
export function findSilences(levels: Float32Array, o: SilenceOptions = {}, frame = FRAME): Range[] {
  const depth = o.depth ?? 30;
  const minDur = o.minDuration ?? 0.8;
  const margin = o.margin ?? 0.15;
  const loud = speechLevel(levels);
  if (loud < -60) return []; // no sound at all: nothing to compare against
  const thr = Math.max(-70, loud - depth);
  const out: Range[] = [];
  let i = 0;
  while (i < levels.length) {
    if (levels[i]! >= thr) { i++; continue; }
    let j = i;
    while (j < levels.length && levels[j]! < thr) j++;
    const start = i * frame;
    const end = Math.min(levels.length, j) * frame;
    if (end - start >= minDur) {
      // A pause at the very start or end of the audio needs no margin on that side.
      const a = i === 0 ? start : start + margin;
      const b = j >= levels.length ? end : end - margin;
      if (b - a > 0.05) out.push({ start: a, end: b });
    }
    i = j;
  }
  return out;
}

/** One proposed cut: a silent part of a main-track clip, in clip-source and timeline seconds. */
export interface SilenceCut {
  clipId: string;
  /** Source seconds inside the clip's media. */
  src: Range;
  /** Where it is on the timeline now. */
  at: Range;
}

/** Proposed cuts for every video clip on the main track, from per-asset frame levels. */
export function planSilenceCuts(p: Project, levels: Record<string, Float32Array | undefined>, o: SilenceOptions = {}): SilenceCut[] {
  const cuts: SilenceCut[] = [];
  let t = 0;
  for (const c of p.clips) {
    const len = (c.out - c.in) / c.speed;
    const lv = levels[c.assetId];
    if (lv && p.assets[c.assetId]?.kind === 'video') {
      for (const s of findSilences(lv, o)) {
        const a = Math.max(c.in, s.start);
        const b = Math.min(c.out, s.end);
        if (b - a < 0.1) continue;
        cuts.push({ clipId: c.id, src: { start: a, end: b }, at: { start: t + (a - c.in) / c.speed, end: t + (b - c.in) / c.speed } });
      }
    }
    t += len;
  }
  return cuts;
}

/** Timeline time after removing `removed` (sorted, non-overlapping timeline ranges). */
export function rippleTime(t: number, removed: Range[]) {
  let shift = 0;
  for (const r of removed) {
    if (t <= r.start) break;
    shift += Math.min(t, r.end) - r.start;
  }
  return t - shift;
}

/**
 * Removes the cuts from the project, in place: each clip is split around its silences (like
 * "Dividir" + "Eliminar"), and texts, stickers, overlays and audio after a cut move earlier so they
 * stay with the words they belonged to. Returns the seconds removed.
 */
export function applySilenceCuts(p: Project, cuts: SilenceCut[], newId: () => string): number {
  // Positions are worked out again from the project as it is now, in case it changed since the plan.
  const byClip = new Map<string, Range[]>();
  const removed: Range[] = [];
  let t = 0;
  for (const c of p.clips) {
    for (const cut of cuts) {
      if (cut.clipId !== c.id) continue;
      const a = Math.max(c.in, cut.src.start);
      const b = Math.min(c.out, cut.src.end);
      if (b - a < 0.05) continue;
      (byClip.get(c.id) ?? byClip.set(c.id, []).get(c.id)!).push({ start: a, end: b });
      removed.push({ start: t + (a - c.in) / c.speed, end: t + (b - c.in) / c.speed });
    }
    t += (c.out - c.in) / c.speed;
  }
  if (!removed.length) return 0;
  removed.sort((a, b) => a.start - b.start);
  const mainBefore = p.clips.reduce((s, c) => s + (c.out - c.in) / c.speed, 0);

  const clips: Clip[] = [];
  for (const c of p.clips) {
    const rs = byClip.get(c.id);
    if (!rs) { clips.push(c); continue; }
    rs.sort((a, b) => a.start - b.start);
    const pieces: Range[] = [];
    let from = c.in;
    for (const r of rs) {
      if (r.start - from > 0.05) pieces.push({ start: from, end: r.start });
      from = Math.max(from, r.end);
    }
    if (c.out - from > 0.05) pieces.push({ start: from, end: c.out });
    pieces.forEach((r, i) => {
      const piece: Clip = { ...c, id: i === 0 ? c.id : newId(), in: r.start, out: r.end };
      // Like "Dividir": the transition stays at the end of the last piece.
      if (i < pieces.length - 1) delete piece.transition;
      clips.push(piece);
    });
  }
  p.clips = clips;
  const mainAfter = clips.reduce((s, c) => s + (c.out - c.in) / c.speed, 0);
  const map = (t: number) => rippleTime(t, removed);
  // Items that reached the old end of the video should still reach the new end, not beyond.
  const end = (start: number, stop: number) => (stop >= mainBefore - 0.05 ? Math.min(map(stop), mainAfter) : map(stop)) - map(start);

  for (const x of [...p.texts, ...(p.stickers ?? [])]) {
    const d = end(x.start, x.start + x.duration);
    x.start = map(x.start);
    x.duration = Math.max(0.1, d);
  }
  for (const a of p.audios) {
    const d = end(a.start, a.start + (a.out - a.in));
    a.start = map(a.start);
    a.out = a.in + Math.max(0.1, Math.min(a.out - a.in, d));
  }
  for (const o of p.overlays ?? []) {
    const d = end(o.start, o.start + (o.out - o.in));
    o.start = map(o.start);
    o.out = o.in + Math.max(0.1, Math.min(o.out - o.in, d));
  }
  return mainBefore - mainAfter;
}
