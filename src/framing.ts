// Crop and flip of a main-track clip. They change the source picture itself, before anything else
// (fit, "Quitar fondo", filters, effects) sees it, so every later step works as with an uncropped clip.
import type { Clip, Crop } from './types';

export const CROP_MIN = 0.1;

const c01 = (v: number) => Math.max(0, Math.min(1, v));

/** A valid crop (inside the picture, at least CROP_MIN of each side), or undefined for "whole picture". */
export function normCrop(c: Crop | undefined): Crop | undefined {
  if (!c) return undefined;
  const w = Math.max(CROP_MIN, Math.min(1, c.w));
  const h = Math.max(CROP_MIN, Math.min(1, c.h));
  const x = Math.min(c01(c.x), 1 - w);
  const y = Math.min(c01(c.y), 1 - h);
  if (x < 1e-4 && y < 1e-4 && w > 1 - 1e-4 && h > 1 - 1e-4) return undefined;
  return { x, y, w, h };
}

/** Pixel rectangle of the crop inside a sw×sh picture (rounded, at least 1 px). */
export function cropRect(c: Crop | undefined, sw: number, sh: number) {
  const n = normCrop(c);
  if (!n) return { x: 0, y: 0, w: sw, h: sh };
  const x = Math.round(n.x * sw);
  const y = Math.round(n.y * sh);
  return { x, y, w: Math.max(1, Math.min(sw - x, Math.round(n.w * sw))), h: Math.max(1, Math.min(sh - y, Math.round(n.h * sh))) };
}

/**
 * The largest centered crop of a sw×sh picture with the given width/height ratio, or undefined
 * when the picture already has it.
 */
export function cropForAspect(ratio: number, sw: number, sh: number): Crop | undefined {
  const src = sw / sh;
  if (Math.abs(src - ratio) / ratio < 0.01) return undefined;
  if (ratio < src) {
    const w = ratio / src;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = src / ratio;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/** Crop edges as the four "trim" amounts the panel sliders show (0..1 from each side). */
export const cropEdges = (c: Crop | undefined) => {
  const n = normCrop(c) ?? { x: 0, y: 0, w: 1, h: 1 };
  return { left: n.x, top: n.y, right: 1 - n.x - n.w, bottom: 1 - n.y - n.h };
};

/** Change one edge, keeping the others where they are. */
export function setCropEdge(c: Crop | undefined, edge: keyof ReturnType<typeof cropEdges>, v: number): Crop | undefined {
  const e = { ...cropEdges(c), [edge]: c01(v) };
  // Never let two opposite edges cross: the edge being moved stops at the minimum size.
  if (edge === 'left' || edge === 'right') {
    const other = edge === 'left' ? 'right' : 'left';
    e[edge] = Math.min(e[edge], 1 - CROP_MIN - e[other]);
  } else {
    const other = edge === 'top' ? 'bottom' : 'top';
    e[edge] = Math.min(e[edge], 1 - CROP_MIN - e[other]);
  }
  return normCrop({ x: e.left, y: e.top, w: 1 - e.left - e.right, h: 1 - e.top - e.bottom });
}

export const hasFraming = (c: Pick<Clip, 'crop' | 'flipH' | 'flipV'>) => !!(c.flipH || c.flipV || normCrop(c.crop));

// ---------- drawing (browser only) ----------

interface Frame {
  src: CanvasImageSource;
  w: number;
  h: number;
}

/** One canvas per clip id (a transition shows two clips at once); old ones are dropped. */
const canvases = new Map<string, HTMLCanvasElement>();

/** The clip's picture after crop and flip; the same frame when it has neither. */
export function framed<F extends Frame>(clip: Pick<Clip, 'id' | 'crop' | 'flipH' | 'flipV'>, f: F): F | Frame {
  if (!f.w || !f.h || !hasFraming(clip)) return f;
  const r = cropRect(clip.crop, f.w, f.h);
  let c = canvases.get(clip.id);
  if (!c) {
    c = document.createElement('canvas');
    canvases.set(clip.id, c);
    if (canvases.size > 6) canvases.delete(canvases.keys().next().value!);
  }
  if (c.width !== r.w || c.height !== r.h) {
    c.width = r.w;
    c.height = r.h;
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(clip.flipH ? -1 : 1, 0, 0, clip.flipV ? -1 : 1, clip.flipH ? r.w : 0, clip.flipV ? r.h : 0);
  ctx.drawImage(f.src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return { src: c, w: r.w, h: r.h };
}

/**
 * A point of the whole source picture (fractions 0..1) as seen in the cropped and flipped picture,
 * so the automatic reframe, measured on the original video, still follows the person.
 */
export function pointInFrame(clip: Clip, pt: { x: number; y: number }) {
  const n = normCrop(clip.crop) ?? { x: 0, y: 0, w: 1, h: 1 };
  const x = c01((pt.x - n.x) / n.w);
  const y = c01((pt.y - n.y) / n.h);
  return { x: clip.flipH ? 1 - x : x, y: clip.flipV ? 1 - y : y };
}
