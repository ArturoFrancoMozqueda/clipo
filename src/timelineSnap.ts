// Timeline editing math: magnetic snapping and where a dragged clip drops. Pure, no DOM.
import type { Project, SelectionKind } from './types';
import { audioDur, layout, overlayDur, overlaysOf, type Placed } from './model';

/** Snap distance on screen, in pixels; divide by pps for seconds so it scales with zoom. */
export const SNAP_PX = 8;

/** An edge being dragged: it sits at `base + k * ds` for a drag of `ds` seconds. */
export interface Edge {
  base: number;
  k: number;
}

/**
 * Times other things line up on: 0, the playhead and the start/end of every item except
 * `skip`. For a main clip, the clips from it on move while it's trimmed, so only earlier ones count.
 */
export function snapPoints(p: Project, time: number, skip?: { kind: SelectionKind; id: string }): number[] {
  const pts = [0, time];
  const placed = layout(p);
  const cut = skip?.kind === 'clip' ? placed.findIndex((x) => x.clip.id === skip.id) : -1;
  for (const x of cut >= 0 ? placed.slice(0, cut) : placed) pts.push(x.start, x.end);
  if (cut >= 0) pts.push(placed[cut]!.start);
  const add = (kind: SelectionKind, id: string, start: number, end: number) => {
    if (skip?.kind !== kind || skip.id !== id) pts.push(start, end);
  };
  for (const x of p.texts) add('text', x.id, x.start, x.start + x.duration);
  for (const x of p.stickers ?? []) add('sticker', x.id, x.start, x.start + x.duration);
  for (const x of p.audios) add('audio', x.id, x.start, x.start + audioDur(x));
  for (const x of overlaysOf(p)) add('overlay', x.id, x.start, x.start + overlayDur(x));
  return [...new Set(pts)].sort((a, b) => a - b);
}

/**
 * The drag adjusted so the nearest edge lands on a snap point within `threshold` seconds,
 * with the point it snapped to (`at` is null when nothing is close enough).
 */
export function snapDrag(ds: number, edges: Edge[], points: number[], threshold: number): { ds: number; at: number | null } {
  let best: { ds: number; at: number; d: number } | null = null;
  for (const e of edges) {
    if (!e.k) continue;
    const pos = e.base + e.k * ds;
    for (const q of points) {
      const d = Math.abs(q - pos);
      if (d <= threshold && (!best || d < best.d)) best = { ds: ds + (q - pos) / e.k, at: q, d };
    }
  }
  return best ? { ds: best.ds, at: best.at } : { ds, at: null };
}

/**
 * Where a main clip dragged so its middle is at `center` would drop: `index` in the list without
 * it, and `at`, the boundary in the current layout to mark. `index` equal to its own means no move.
 */
export function dropIndex(placed: readonly Placed[], id: string, center: number): { index: number; at: number } {
  const others = placed.filter((x) => x.clip.id !== id);
  let index = 0;
  while (index < others.length && (others[index]!.start + others[index]!.end) / 2 < center) index++;
  const at = index < others.length ? others[index]!.start : (others.at(-1)?.end ?? 0);
  return { index, at };
}
