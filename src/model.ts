import type { AspectId, AudioItem, Clip, Project } from './types';

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

/** Pixel size of the frame for an aspect, given the length of its short side. */
export function canvasSize(aspect: AspectId, short = 720): [number, number] {
  const { w, h } = ASPECTS[aspect];
  return w <= h ? [short, even((short * h) / w)] : [even((short * w) / h), short];
}

export const clipDur = (c: Clip) => (c.out - c.in) / c.speed;
export const audioDur = (a: AudioItem) => a.out - a.in;

export interface Placed {
  clip: Clip;
  start: number;
  end: number;
  index: number;
}

/** Positions of the main-track clips; they always sit back to back. */
export function layout(p: Project): Placed[] {
  let t = 0;
  return p.clips.map((clip, index) => {
    const start = t;
    t += clipDur(clip);
    return { clip, start, end: t, index };
  });
}

export function mainDuration(p: Project) {
  const l = layout(p);
  return l.length ? l[l.length - 1].end : 0;
}

export function totalDuration(p: Project) {
  let d = mainDuration(p);
  for (const x of p.texts) d = Math.max(d, x.start + x.duration);
  for (const a of p.audios) d = Math.max(d, a.start + audioDur(a));
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
