// Texts, stickers, sounds and overlays stay with the clip they were placed on: when a main-track
// clip is deleted, trimmed, duplicated or moved, everything after it shifts on the timeline, and
// what sat on those clips (captions above all) would otherwise end up over the wrong picture.
// Pure: no DOM or store, so it runs in Node tests.
import type { Clip, Project } from './types';
import { audioDur, layout, overlayDur, type Placed } from './model';

export interface FollowOptions {
  /**
   * Remove automatic captions whose clip (or the part of it they were on) is gone. Off while a
   * trim is still being dragged, so dragging back brings nothing back from the dead.
   */
  prune?: boolean;
  /**
   * The clips changed order: an item longer than its clip (background music, a title over several
   * clips) stays where it is instead of travelling with the first clip it touches.
   */
  reorder?: boolean;
}

const EPS = 1e-6;

interface Timed {
  id: string;
  start: number;
}

/** The clip of `placed` that is on screen at `t` (a boundary belongs to the clip that starts there). */
const clipAt = (placed: readonly Placed[], t: number) => placed.find((x) => t >= x.start - EPS && t < x.end - EPS);

/**
 * Where an item that started at `start` in `before` belongs after the main track changed to
 * `after`: the same moment of the same clip. `gone` = its clip (or that part of it) no longer exists.
 */
function follow(
  start: number, dur: number, before: readonly Placed[], after: ReadonlyMap<string, Placed>, afterEnd: number, reorder: boolean,
): { pos: number; gone?: boolean } {
  const last = before[before.length - 1];
  if (!last) return { pos: start };
  // Past the end of the main track: it keeps its distance to that end.
  if (start >= last.end - EPS) return { pos: start + afterEnd - last.end };
  const a = clipAt(before, start);
  if (!a) return { pos: start };
  const now = after.get(a.clip.id);
  const spans = start + dur > a.end + 0.05;
  if (!now) return { pos: start, gone: !spans };
  if (reorder && spans) return { pos: start };
  const c0: Clip = a.clip;
  const c1: Clip = now.clip;
  // Same footage at the same place of the clip: move exactly as far as the clip did.
  const same = c0.in === c1.in && c0.speed === c1.speed;
  const pos = same ? start + (now.start - a.start) : now.start + (c0.in + (start - a.start) * c0.speed - c1.in) / c1.speed;
  // Trimmed away at the front: it starts with what is left of the clip.
  if (pos < now.start - EPS) return { pos: now.start, gone: !spans };
  return { pos, gone: !spans && pos >= now.end - EPS };
}

/**
 * Move the items of `after` (edited in place; a store draft is fine) so they stay on the clips they
 * were on in `before`. Call it right after changing the main track, inside the same edit.
 */
export function followClips(before: Project, after: Project, opts: FollowOptions = {}) {
  const was = layout(before);
  if (!was.length) return;
  const placed = layout(after);
  // Nothing moved or changed length: nothing to do (the usual case for edits elsewhere).
  if (placed.length === was.length && placed.every((x, i) => x.clip === was[i]!.clip)) return;
  const now = new Map(placed.map((x) => [x.clip.id, x] as const));
  const end = placed[placed.length - 1]?.end ?? 0;

  const olds = new Map<string, number>();
  const remember = (list: readonly Timed[] | undefined) => list?.forEach((x) => olds.set(x.id, x.start));
  remember(before.texts);
  remember(before.stickers);
  remember(before.audios);
  remember(before.overlays);

  /** Moves the items of one list; returns the ids whose clip is gone. */
  const move = <T extends Timed>(list: T[] | undefined, durOf: (x: T) => number) => {
    const gone = new Set<string>();
    for (const it of list ?? []) {
      const start = olds.get(it.id);
      if (start === undefined) continue; // added by this same edit
      const to = follow(start, durOf(it), was, now, end, !!opts.reorder);
      if (to.gone) gone.add(it.id);
      const pos = Math.max(0, to.pos);
      if (Math.abs(pos - it.start) > EPS) it.start = pos;
    }
    return gone;
  };

  const lost = move(after.texts, (x) => x.duration);
  move(after.stickers, (x) => x.duration);
  move(after.audios, audioDur);
  move(after.overlays, overlayDur);
  // Only what Clipo wrote by itself is removed; anything the user placed stays where it was.
  if (opts.prune && lost.size && after.texts.some((x) => x.caption && lost.has(x.id))) {
    after.texts = after.texts.filter((x) => !(x.caption && lost.has(x.id)));
  }
}
