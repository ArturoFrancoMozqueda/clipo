// Timeline gestures: moving and trimming items (magnetic, with auto-scroll at the edges),
// reordering main clips and tapping/scrubbing on the ruler. Kept out of Timeline.tsx.
import { useEffect, useSyncExternalStore, type RefObject } from 'react';
import type { AudioItem, Clip, OverlayItem, Project, SelectionKind, StickerItem, TextItem } from '../types';
import { findItem, itemsOf, useStore } from '../store';
import { engine } from '../engine';
import { IMAGE_MAX, audioDur, clamp, fmtTime, layout, overlayDur } from '../model';
import { SNAP_PX, dropIndex, snapDrag, snapPoints, type Edge } from '../timelineSnap';
import { moveClipTo } from '../ops';
import './timelineDrag.css';

export type Mode = 'l' | 'r' | 'body';
type Item = Clip | TextItem | AudioItem | StickerItem | OverlayItem;

/** Apply a horizontal drag of `ds` seconds to an item, starting from its original values. */
export function applyDrag(p: Project, kind: SelectionKind, id: string, mode: Mode, ds: number, o: Item) {
  if (kind === 'overlay') {
    const v = p.overlays?.find((x) => x.id === id);
    const ov = o as OverlayItem;
    if (!v) return;
    if (mode === 'body') v.start = Math.max(0, ov.start + ds);
    else if (p.assets[v.assetId]?.kind === 'image') {
      // Photos: both edges change how long it shows.
      if (mode === 'l') {
        const d = clamp(ds, -ov.start, ov.out - 0.3);
        v.start = ov.start + d;
        v.out = ov.out - d;
      } else v.out = clamp(ov.out + ds, 0.3, IMAGE_MAX);
    } else if (mode === 'l') {
      const d = clamp(ds, -Math.min(ov.in, ov.start), ov.out - ov.in - 0.2);
      v.in = ov.in + d;
      v.start = ov.start + d;
    } else v.out = clamp(ov.out + ds, ov.in + 0.2, p.assets[v.assetId]?.duration ?? ov.out);
  } else if (kind === 'clip') {
    const c = p.clips.find((x) => x.id === id);
    const oc = o as Clip;
    if (!c) return;
    const a = p.assets[c.assetId];
    if (a?.kind === 'image' || c.freeze != null) {
      // Photos and freeze frames have no "source" to trim: both handles change how long they show.
      c.out = clamp(oc.out + (mode === 'l' ? -ds : ds), 0.3, IMAGE_MAX);
    } else if (mode === 'l') c.in = clamp(oc.in + ds * oc.speed, 0, oc.out - 0.1);
    else if (mode === 'r') c.out = clamp(oc.out + ds * oc.speed, oc.in + 0.1, a?.duration ?? oc.out);
  } else if (kind === 'text' || kind === 'sticker') {
    const t = (itemsOf(p, kind) as (TextItem | StickerItem)[]).find((x) => x.id === id);
    const ot = o as TextItem;
    if (!t) return;
    const end = ot.start + ot.duration;
    if (mode === 'l') {
      t.start = clamp(ot.start + ds, 0, end - 0.2);
      t.duration = end - t.start;
    } else if (mode === 'r') t.duration = Math.max(0.2, ot.duration + ds);
    else t.start = Math.max(0, ot.start + ds);
  } else {
    const a = p.audios.find((x) => x.id === id);
    const oa = o as AudioItem;
    if (!a) return;
    if (mode === 'l') {
      const d = clamp(ds, -Math.min(oa.in, oa.start), oa.out - oa.in - 0.2);
      a.in = oa.in + d;
      a.start = oa.start + d;
    } else if (mode === 'r') a.out = clamp(oa.out + ds, oa.in + 0.2, p.assets[a.assetId]?.duration ?? oa.out);
    else a.start = Math.max(0, oa.start + ds);
  }
}

/** Start and end of an item on the timeline (main clips by their place in the sequence). */
function span(p: Project, kind: SelectionKind, id: string): [number, number] | null {
  if (kind === 'clip') {
    const x = layout(p).find((l) => l.clip.id === id);
    return x ? [x.start, x.end] : null;
  }
  const it = findItem(p, kind, id) as Exclude<Item, Clip> | undefined;
  if (!it) return null;
  const d = kind === 'audio' ? audioDur(it as AudioItem) : kind === 'overlay' ? overlayDur(it as OverlayItem) : (it as TextItem).duration;
  return [it.start, it.start + d];
}

/** The edges a drag moves, for snapping. A main clip's trims always move its end (clips sit back to back). */
function dragEdges(p: Project, kind: SelectionKind, id: string, mode: Mode, o: Item): Edge[] {
  const sp = span(p, kind, id);
  if (!sp) return [];
  if (kind === 'clip') {
    const c = o as Clip;
    const k = p.assets[c.assetId]?.kind === 'image' || c.freeze != null ? 1 / c.speed : 1;
    return mode === 'body' ? [] : [{ base: sp[1], k: mode === 'l' ? -k : k }];
  }
  if (mode === 'body') return [{ base: sp[0], k: 1 }, { base: sp[1], k: 1 }];
  return [{ base: mode === 'l' ? sp[0] : sp[1], k: 1 }];
}

// ---------- guides drawn while dragging ----------

interface Guides {
  /** Time the dragged edge snapped to. */
  snap: number | null;
  /** Where a dragged main clip would drop. */
  drop: number | null;
  /** Length while trimming, shown over the moving edge. */
  trim: { at: number; text: string } | null;
}
const NO_GUIDES: Guides = { snap: null, drop: null, trim: null };
let guides = NO_GUIDES;
const subs = new Set<() => void>();
function setGuides(g: Partial<Guides>) {
  guides = g === NO_GUIDES ? NO_GUIDES : { ...guides, ...g };
  for (const f of subs) f();
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

/** Snap line, drop marker and trim length; place inside the scrolling content. */
export function DragGuides({ pad, pps }: { pad: number; pps: number }) {
  const g = useSyncExternalStore(subscribe, () => guides);
  return (
    <>
      {g.snap != null && <div className="tl-snap" style={{ left: pad + g.snap * pps }} />}
      {g.drop != null && <div className="tl-drop" style={{ left: pad + g.drop * pps }} />}
      {g.trim && (
        <div className="tl-trim-len" style={{ left: pad + g.trim.at * pps }}>
          {g.trim.text}
        </div>
      )}
    </>
  );
}

const buzz = () => {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* not allowed here */
  }
};

/**
 * Scrolls the timeline while the pointer is near its left or right edge. Time follows the scroll
 * (so the content under the pointer keeps changing); `step` runs after every scroll.
 */
function autoScroll(el: HTMLElement, pps: number, step: () => void) {
  let x = 0;
  let raf = 0;
  let then = 0;
  const frame = (now: number) => {
    raf = 0;
    const r = el.getBoundingClientRect();
    const zone = Math.min(56, r.width / 6);
    const v = x < r.left + zone ? x - r.left - zone : x > r.right - zone ? x - r.right + zone : 0;
    if (!v) return void (then = 0);
    // Up to ~850 px/s, deeper into the edge is faster; by elapsed time so slow frames don't slow it.
    const dt = then ? Math.min(now - then, 50) : 16;
    then = now;
    const before = el.scrollLeft;
    el.scrollLeft += clamp(v / zone, -1, 1) * 0.85 * dt;
    if (el.scrollLeft !== before) {
      // Seek now so a re-render doesn't scroll back to the old time before onScroll runs.
      engine.seek(el.scrollLeft / pps);
      step();
    }
    raf = requestAnimationFrame(frame);
  };
  return {
    at(cx: number) {
      x = cx;
      if (!raf) raf = requestAnimationFrame(frame);
    },
    stop: () => cancelAnimationFrame(raf),
  };
}

/** Holding this long on a selected clip (touch) picks it up to reorder; a quick swipe still scrolls. */
const HOLD_MS = 300;

/**
 * Drag an item's edge ('l'/'r') or body. Edges and free items snap to the playhead and other items
 * (unless the magnet is off or Alt is held); a main clip's body is reordered on release.
 */
export function startDrag(e: React.PointerEvent, kind: SelectionKind, id: string, mode: Mode) {
  e.stopPropagation();
  const s = useStore.getState();
  const p = s.project!;
  const found = (itemsOf(p, kind) as Item[]).find((x) => x.id === id);
  const target = e.currentTarget as HTMLElement;
  const el = target.closest<HTMLElement>('.tl-scroll');
  if (!found || !el) return;
  engine.pause();
  const orig = structuredClone(found);
  const pps = s.pps;
  const reorder = kind === 'clip' && mode === 'body';
  const placed = layout(p);
  const me = placed.find((x) => x.clip.id === id);
  const edges = dragEdges(p, kind, id, mode, orig);
  // Positions in the scrolling content, so auto-scroll counts as movement.
  const pos = (x: number) => x - el.getBoundingClientRect().left + el.scrollLeft;
  const x0 = e.clientX;
  const c0 = pos(x0);
  let last = { x: x0, alt: e.altKey };
  let moved = false;
  let snapped: number | null = null;
  let drop = -1;
  let armed = !(reorder && e.pointerType === 'touch');
  const hold = armed
    ? 0
    : window.setTimeout(() => {
        armed = true;
        target.classList.add('lifted');
        buzz();
      }, HOLD_MS);

  const update = () => {
    const ds = (pos(last.x) - c0) / pps;
    if (reorder) {
      if (!me) return;
      target.style.transform = `translateX(${ds * pps}px)`;
      const d = dropIndex(placed, id, (me.start + me.end) / 2 + ds);
      drop = d.index;
      setGuides({ drop: d.index === me.index ? null : d.at });
      return;
    }
    const st = useStore.getState();
    const sn = st.snap && !last.alt ? snapDrag(ds, edges, snapPoints(p, st.time, { kind, id }), SNAP_PX / pps) : { ds, at: null };
    if (sn.at != null && sn.at !== snapped) buzz();
    snapped = sn.at;
    st.live((q) => applyDrag(q, kind, id, mode, sn.ds, orig));
    const sp = mode === 'body' ? null : span(useStore.getState().project!, kind, id);
    const at = sp && (kind === 'clip' || mode === 'r' ? sp[1] : sp[0]);
    setGuides({ snap: sn.at, trim: sp && at != null ? { at, text: fmtTime(sp[1] - sp[0], true) } : null });
  };
  const scroller = autoScroll(el, pps, update);

  const move = (ev: PointerEvent) => {
    last = { x: ev.clientX, alt: ev.altKey };
    if (!armed) return;
    if (!moved) {
      if (Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      if (reorder) target.classList.add('lifted');
      else useStore.getState().checkpoint();
    }
    scroller.at(ev.clientX);
    update();
  };
  // Once a clip is picked up on touch, the finger drags it instead of scrolling the timeline.
  const touchMove = (ev: TouchEvent) => {
    if (armed && ev.cancelable) ev.preventDefault();
  };
  const up = (ev: PointerEvent) => {
    clearTimeout(hold);
    scroller.stop();
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    target.removeEventListener('touchmove', touchMove);
    target.classList.remove('lifted');
    target.style.transform = '';
    setGuides(NO_GUIDES);
    if (reorder && moved && ev.type === 'pointerup' && drop >= 0) moveClipTo(id, drop);
  };
  target.setPointerCapture(e.pointerId);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
  target.addEventListener('touchmove', touchMove, { passive: false });
}

/** Tap the ruler to move the playhead there; drag along it to scrub. */
export function useRulerScrub(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const down = (e: PointerEvent) => {
      const ruler = (e.target as Element).closest?.('.ruler') as HTMLElement | null;
      if (!ruler || e.button > 0 || !useStore.getState().project) return;
      const pps = useStore.getState().pps;
      const t0 = useStore.getState().time;
      const x0 = e.clientX;
      const tap = (x0 - el.getBoundingClientRect().left + el.scrollLeft - el.clientWidth / 2) / pps;
      let moved = false;
      engine.pause();
      const move = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - x0) < 3) return;
        moved = true;
        engine.seek(t0 + (ev.clientX - x0) / pps);
      };
      const up = (ev: PointerEvent) => {
        ruler.removeEventListener('pointermove', move);
        ruler.removeEventListener('pointerup', up);
        ruler.removeEventListener('pointercancel', up);
        if (!moved && ev.type === 'pointerup') engine.seek(tap);
      };
      // The click that follows shouldn't clear the selection.
      ruler.addEventListener('click', (ev) => ev.stopPropagation(), { once: true });
      ruler.setPointerCapture(e.pointerId);
      ruler.addEventListener('pointermove', move);
      ruler.addEventListener('pointerup', up);
      ruler.addEventListener('pointercancel', up);
    };
    el.addEventListener('pointerdown', down);
    return () => el.removeEventListener('pointerdown', down);
  }, [ref]);
}
