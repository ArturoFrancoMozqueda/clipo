import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Diamond } from 'lucide-react';
import type { AudioItem, Clip, OverlayItem, Project, SelectionKind, StickerItem, TextItem } from '../types';
import { itemsOf, useStore } from '../store';
import { engine } from '../engine';
import { IMAGE_MAX, clamp, layout, mainDuration, overlaysOf, totalDuration } from '../model';
import { keyframeAt } from '../keyframes';
import { toggleKeyframe, useAnimated } from './AdvancedPanels';
import { stickersOf } from '../visuals';
import { viewWindow, windowBucket } from '../timelineMath';
import { AudioRow, MainRow, OverlayRow, Ruler, StickerRow, TextRow } from './TimelineRows';

/** Touch screens get taller thin rows so text/sticker items are easier to hit. */
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const ROW_CLIP = 60;
const ROW_TEXT = COARSE ? 44 : 30;
const ROW_AUDIO = COARSE ? 44 : 34;
const ROW_STICKER = COARSE ? 44 : 30;
const ROW_OVERLAY = 40;

type Mode = 'l' | 'r' | 'body';

/** Apply a horizontal drag of `ds` seconds to an item, starting from its original values. */
function applyDrag(p: Project, kind: SelectionKind, id: string, mode: Mode, ds: number, o: Clip | TextItem | AudioItem | StickerItem | OverlayItem) {
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

function startDrag(e: React.PointerEvent, kind: SelectionKind, id: string, mode: Mode) {
  e.stopPropagation();
  const s = useStore.getState();
  const p = s.project!;
  const found = (itemsOf(p, kind) as (Clip | TextItem | AudioItem | StickerItem | OverlayItem)[]).find((x) => x.id === id);
  if (!found) return;
  engine.pause();
  const orig = structuredClone(found);
  const pps = s.pps;
  const x0 = e.clientX;
  let moved = false;
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    if (!moved) {
      if (Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      useStore.getState().checkpoint();
    }
    const ds = (ev.clientX - x0) / pps;
    useStore.getState().live((q) => applyDrag(q, kind, id, mode, ds, orig));
  };
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

/** Diamond at the playhead: adds (or removes) a keyframe on the selected item. */
function KeyframeButton() {
  const a = useAnimated();
  const advanced = useStore((s) => s.advanced);
  if (!a || !advanced) return null;
  const on = keyframeAt(a.item, a.local) >= 0 && a.inside;
  const label = on ? 'Quitar fotograma clave' : 'Agregar fotograma clave aquí';
  return (
    <button
      className={`tl-kf-btn ${on ? 'on' : ''} ${a.inside ? '' : 'off'}`}
      onClick={(e) => {
        e.stopPropagation();
        toggleKeyframe();
      }}
      aria-label={label}
      title={label}
    >
      <Diamond size={16} fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}

export function Timeline() {
  const project = useStore((s) => s.project!);
  const pps = useStore((s) => s.pps);
  const selection = useStore((s) => s.selection);
  const ref = useRef<HTMLDivElement>(null);
  const lastProg = useRef(-1);
  const [vw, setVw] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setVw(el.clientWidth));
    ro.observe(el);
    setVw(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // The playhead is fixed in the middle; the timeline scrolls underneath it.
  const applyScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const s = useStore.getState();
    el.scrollLeft = s.time * s.pps;
    lastProg.current = el.scrollLeft;
  }, []);
  useLayoutEffect(applyScroll, [vw, pps, project, applyScroll]);
  useEffect(() => useStore.subscribe((s, prev) => void (s.time !== prev.time && applyScroll())), [applyScroll]);

  const onScroll = () => {
    const el = ref.current!;
    if (Math.abs(el.scrollLeft - lastProg.current) < 1) return;
    lastProg.current = el.scrollLeft;
    engine.seek(el.scrollLeft / useStore.getState().pps);
  };

  // Ctrl+wheel and two-finger pinch zoom. Shift+wheel scrolls sideways; a plain wheel scrolls
  // the tracks vertically when they overflow (so lower tracks stay reachable), else sideways.
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      const s = useStore.getState();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        s.setPps(s.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const vertical = el.scrollHeight > el.clientHeight + 1;
        if (e.shiftKey || !vertical) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
      }
    };
    let pinch: { d: number; pps: number } | null = null;
    // Only called with two touches.
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { d: dist(e.touches), pps: useStore.getState().pps };
    };
    const tm = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        useStore.getState().setPps((pinch.pps * dist(e.touches)) / pinch.d);
      }
    };
    const te = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
    };
  }, []);

  const dur = totalDuration(project);
  const placed = layout(project);
  const mainDur = mainDuration(project);
  const pad = vw / 2;
  const width = dur * pps + vw;
  // Missing lists become a new [] each time: keep one per project list so the rows can skip renders.
  const stickers = useMemo(() => stickersOf(project), [project.stickers]); // eslint-disable-line react-hooks/exhaustive-deps
  const overlays = useMemo(() => overlaysOf(project), [project.overlays]); // eslint-disable-line react-hooks/exhaustive-deps
  const advanced = useStore((s) => s.advanced);
  const urls = useStore((s) => s.urls);
  // Only the part of the timeline around the playhead is rendered; it moves in half-screen steps.
  const bucket = useStore((s) => windowBucket(s.time, pps, vw));
  const win = useMemo(() => viewWindow(bucket, pps, vw), [bucket, pps, vw]);
  const selOf = (kind: SelectionKind) => (selection?.kind === kind ? selection.id : null);
  const row = { pps, pad, win, drag: startDrag };

  return (
    <div className="timeline">
      <div className="tl-scroll" ref={ref} onScroll={onScroll} onClick={() => useStore.getState().select(null)}>
        <div className="tl-content" style={{ width }}>
          <Ruler dur={dur} pps={pps} pad={pad} from={win.from} to={win.to} />
          {(advanced || overlays.length > 0) && (
            <OverlayRow {...row} overlays={overlays} assets={project.assets} urls={urls} rowH={ROW_OVERLAY} selId={selOf('overlay')} />
          )}
          <MainRow {...row} placed={placed} mainDur={mainDur} assets={project.assets} urls={urls} rowH={ROW_CLIP} selId={selOf('clip')} />
          <TextRow {...row} texts={project.texts} rowH={ROW_TEXT} selId={selOf('text')} />
          <StickerRow {...row} stickers={stickers} assets={project.assets} rowH={ROW_STICKER} selId={selOf('sticker')} />
          <AudioRow {...row} audios={project.audios} assets={project.assets} urls={urls} rowH={ROW_AUDIO} selId={selOf('audio')} />
        </div>
      </div>
      <div className="playhead" />
      <KeyframeButton />

    </div>
  );
}
