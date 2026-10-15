import type { AspectId, AudioItem, Clip, OverlayItem, Project } from './types';

/** Longest an image clip can be stretched, in seconds. */
export const IMAGE_MAX = 600;
export const DEFAULT_IMAGE_SECONDS = 3;

export const ASPECTS: Record<AspectId, { w: number; h: number; label: string; hint: string }> = {
  '9:16': { w: 9, h: 16, label: 'Vertical', hint: 'TikTok · Reels · Shorts' },
  '16:9': { w: 16, h: 9, label: 'Horizontal', hint: 'YouTube · PC · TV' },
  '1:1': { w: 1, h: 1, label: 'Cuadrado', hint: 'Publicación de Instagram o Facebook' },
  '4:5': { w: 4, h: 5, label: 'Retrato', hint: 'Feed de Instagram' },
};

const even = (n: number) => Math.round(n / 2) * 2;

/** Short side of the preview frame. Export sizes are chosen separately and never use this. */
export const PREVIEW_SHORT = 720;
/** Short side used while playing on devices that can't draw the full preview in time. */
export const PREVIEW_SHORT_LOW = 540;

/** Pixel size of the frame for an aspect, given the length of its short side. */
export function canvasSize(aspect: AspectId, short = PREVIEW_SHORT): [number, number] {
  const { w, h } = ASPECTS[aspect];
  return w <= h ? [short, even((short * h) / w)] : [even((short * w) / h), short];
}

export const clipDur = (c: Clip) => (c.out - c.in) / c.speed;
export const audioDur = (a: AudioItem) => a.out - a.in;
export const overlayDur = (o: OverlayItem) => o.out - o.in;
/** Picture-in-picture items; missing in projects saved before they existed. */
export const overlaysOf = (p: Project) => p.overlays ?? [];

export interface Placed {
  clip: Clip;
  start: number;
  end: number;
  index: number;
}

/** Last layout per clip list: the preview asks for it every frame and projects are replaced, not mutated. */
const layouts = new WeakMap<Clip[], Placed[]>();

/**
 * Positions of the main-track clips; they always sit back to back. The result is shared (cached
 * per clip list and checked against the clips without allocating): treat it as read-only.
 */
export function layout(p: Project): Placed[] {
  const hit = layouts.get(p.clips);
  if (hit && hit.length === p.clips.length) {
    let t = 0;
    let ok = true;
    for (let i = 0; i < hit.length && ok; i++) {
      const c = p.clips[i]!;
      const h = hit[i]!;
      ok = h.clip === c && h.start === t;
      t += clipDur(c);
      ok &&= h.end === t;
    }
    if (ok) return hit;
  }
  let t = 0;
  const out = p.clips.map((clip, index) => {
    const start = t;
    t += clipDur(clip);
    return { clip, start, end: t, index };
  });
  layouts.set(p.clips, out);
  return out;
}


export function mainDuration(p: Project) {
  const l = layout(p);
  return l.at(-1)?.end ?? 0;
}

export function totalDuration(p: Project) {
  let d = mainDuration(p);
  for (const x of p.texts) d = Math.max(d, x.start + x.duration);
  for (const a of p.audios) d = Math.max(d, a.start + audioDur(a));
  for (const x of p.stickers ?? []) d = Math.max(d, x.start + x.duration);
  for (const o of overlaysOf(p)) d = Math.max(d, o.start + overlayDur(o));
  return d;
}

/** Main-track clip visible at time t (the last clip keeps showing at the very end). */
export function activeClip(p: Project, t: number, placed = layout(p)): Placed | null {
  for (const x of placed) if (t >= x.start && t < x.end) return x;
  const last = placed[placed.length - 1];
  if (last && t >= last.end && t - last.end < 0.05) return last;
  return null;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function fmtTime(s: number, tenths = false) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const base = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return tenths ? `${base}.${Math.floor((s * 10) % 10)}` : base;
}

/** Greedy lane assignment so overlapping items stack instead of hiding each other. */
export function lanes(items: { id: string; start: number; end: number }[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const ends: number[] = [];
  const map: Record<string, number> = {};
  for (const it of sorted) {
    let i = ends.findIndex((e) => e <= it.start + 1e-6);
    if (i < 0) {
      i = ends.length;
      ends.push(it.end);
    } else ends[i] = it.end;
    map[it.id] = i;
  }
  return { map, count: ends.length };
}
