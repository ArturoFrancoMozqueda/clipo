import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Diamond } from 'lucide-react';
import type { SelectionKind } from '../types';
import { useStore } from '../store';
import { engine } from '../engine';
import { clamp, layout, mainDuration, overlaysOf, totalDuration } from '../model';
import { keyframeAt } from '../keyframes';
import { toggleKeyframe, useAnimated } from './AdvancedPanels';
import { stickersOf } from '../visuals';
import { viewWindow, windowBucket } from '../timelineMath';
import { AudioRow, MainRow, OverlayRow, Ruler, StickerRow, TextRow } from './TimelineRows';
import { DragGuides, startDrag, useRulerScrub } from './timelineDrag';

/** Touch screens get taller thin rows so text/sticker items are easier to hit. */
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const ROW_CLIP = 60;
const ROW_TEXT = COARSE ? 44 : 30;
const ROW_AUDIO = COARSE ? 44 : 34;
const ROW_STICKER = COARSE ? 44 : 30;
const ROW_OVERLAY = 40;
const FULL_ROWS = { ROW_CLIP, ROW_TEXT, ROW_AUDIO, ROW_STICKER, ROW_OVERLAY };
/** Compact mode: thinner rows so more fits in a short timeline. */
const COMPACT_ROWS = { ROW_CLIP: 40, ROW_TEXT: COARSE ? 32 : 22, ROW_AUDIO: COARSE ? 32 : 24, ROW_STICKER: COARSE ? 32 : 22, ROW_OVERLAY: 28 };

// Height of the scrolling tracks area in px. null = automatic (fits the tracks, capped by CSS).
const HEIGHT_KEY = 'clipo.tlHeight';
const COMPACT_KEY = 'clipo.tlCompact';
const MIN_H = 76; // ruler + compact clip row
const COMPACT_H = 104; // what "compact" snaps to
const AUTO_COMPACT_BELOW = 110;
const AUTO_EXPAND_ABOVE = 150;
const PREVIEW_MIN = 240; // the preview and its play controls keep at least this much

function readNum(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeKey(key: string, v: string | null) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* private mode: remembered for this session only */
  }
}

/** Drag the top edge to resize the timeline; double-tap or the button toggles compact mode. */
function useTimelineSize(box: React.RefObject<HTMLDivElement | null>, scroller: React.RefObject<HTMLDivElement | null>) {
  const [height, setHeightState] = useState<number | null>(() => readNum(HEIGHT_KEY));
  const [compact, setCompactState] = useState(() => readNum(COMPACT_KEY) === 1);
  const prev = useRef<number | null>(height);
  const lastTap = useRef(0);

  const setHeight = useCallback((h: number | null) => {
    setHeightState(h);
    writeKey(HEIGHT_KEY, h == null ? null : String(Math.round(h)));
  }, []);
  const setCompact = useCallback((c: boolean) => {
    setCompactState(c);
    writeKey(COMPACT_KEY, c ? '1' : null);
  }, []);

  /** Largest height that leaves the preview usable (and at most 70% of the editor). */
  const maxHeight = useCallback(() => {
    const el = scroller.current;
    const editor = box.current?.closest('.editor');
    const ws = editor?.querySelector('.workspace');
    if (!el || !editor || !ws) return 400;
    const room = el.clientHeight + ws.clientHeight - PREVIEW_MIN;
    return Math.max(MIN_H, Math.min(editor.clientHeight * 0.7, room));
  }, [box, scroller]);
  const current = () => height ?? scroller.current?.clientHeight ?? COMPACT_H;

  // A height saved on a taller screen (or before rotating) must still leave the preview usable.
  useEffect(() => {
    const fit = () => setHeightState((h) => (h == null ? h : Math.min(h, Math.max(MIN_H, maxHeight()))));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [maxHeight]);

  const toggleCompact = useCallback(() => {
    if (compact) {
      setCompact(false);
      setHeight(prev.current);
    } else {
      prev.current = height;
      setCompact(true);
      setHeight(COMPACT_H);
    }
  }, [compact, height, setCompact, setHeight]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const h0 = current();
    const max = maxHeight();
    let h = h0;
    let moved = false;
    let isCompact = compact;
    const move = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.abs(ev.clientY - y0) < 3) return;
        moved = true;
        if (!isCompact) prev.current = h0;
        setHeightState(h0);
      }
      h = clamp(h0 - (ev.clientY - y0), MIN_H, max);
      // Straight to the DOM while dragging (no re-render per move); React gets it on release.
      box.current?.style.setProperty('--tl-h', `${h}px`);
      if (!isCompact && h < AUTO_COMPACT_BELOW) {
        isCompact = true;
        setCompactState(true);
        setHeightState(h);
      } else if (isCompact && h > AUTO_EXPAND_ABOVE) {
        isCompact = false;
        setCompactState(false);
        setHeightState(h);
      }
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (moved) {
        setHeight(h);
        setCompact(isCompact);
        lastTap.current = 0;
        return;
      }
      const now = performance.now();
      if (now - lastTap.current < 320) {
        lastTap.current = 0;
        toggleCompact();
      } else lastTap.current = now;
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16;
    let h: number;
    if (e.key === 'ArrowUp') h = current() + step;
    else if (e.key === 'ArrowDown') h = current() - step;
    else if (e.key === 'Home') h = MIN_H;
    else if (e.key === 'End') h = maxHeight();
    else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      toggleCompact();
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    setHeight(clamp(h, MIN_H, maxHeight()));
  };

  return { height, compact, toggleCompact, onPointerDown, onKeyDown, maxHeight };
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
  const boxRef = useRef<HTMLDivElement>(null);
  const size = useTimelineSize(boxRef, ref);
  const { ROW_CLIP, ROW_TEXT, ROW_AUDIO, ROW_STICKER, ROW_OVERLAY } = size.compact ? COMPACT_ROWS : FULL_ROWS;
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
  useRulerScrub(ref);
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
    <div
      ref={boxRef}
      className={`timeline ${size.compact ? 'compact' : ''} ${size.height != null ? 'sized' : ''}`}
      style={size.height != null ? ({ '--tl-h': `${size.height}px` } as React.CSSProperties) : undefined}
    >
      <div
        className="tl-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Altura de la línea de tiempo"
        aria-valuemin={MIN_H}
        aria-valuemax={Math.round(size.maxHeight())}
        aria-valuenow={Math.round(size.height ?? ref.current?.clientHeight ?? MIN_H)}
        tabIndex={0}
        title="Arrastra para cambiar el tamaño · doble toque: compactar"
        onPointerDown={size.onPointerDown}
        onKeyDown={size.onKeyDown}
      />
      <button
        className="tl-compact"
        onClick={size.toggleCompact}
        aria-pressed={size.compact}
        aria-label={size.compact ? 'Expandir línea de tiempo' : 'Compactar línea de tiempo'}
        title={size.compact ? 'Expandir' : 'Compactar'}
      >
        {size.compact ? <ChevronsUpDown size={16} /> : <ChevronsDownUp size={16} />}
      </button>
      <div className="tl-scroll" ref={ref} onScroll={onScroll} onClick={() => useStore.getState().select(null)}>
        <div className="tl-content" style={{ width }}>
          <Ruler dur={dur} pps={pps} pad={pad} from={win.from} to={win.to} />
          <DragGuides pad={pad} pps={pps} />
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
