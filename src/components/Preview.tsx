import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImagePlus, Pause, Play, ZoomIn, ZoomOut } from 'lucide-react';
import { useStore } from '../store';
import { engine } from '../engine';
import { ASPECTS, canvasSize, clamp, fmtTime, totalDuration } from '../model';
import { ImportButton } from './ImportButton';
import { hitSticker, stickerHandle, stickerHandleRadius } from '../visuals';
import { editPose, poseNow } from '../ops';
import { SafeZoneGuide } from './SafeZoneGuide';

/** Things that can be dragged, resized and rotated on the preview. */
type Shape = 'sticker' | 'overlay';

type Gesture =
  | { kind: 'text' | Shape; id: string; ox: number; oy: number; sx: number; sy: number; moved: boolean; wasSelected: boolean }
  | { kind: 'handle' | 'pinch'; shape: Shape; id: string; d0: number; a0: number; size0: number; rot0: number; moved: boolean };

const SIZE_LIMITS: Record<Shape, [number, number]> = { sticker: [0.04, 1.5], overlay: [0.05, 2] };
const PANEL_OF = { text: 'text', sticker: 'stickers', overlay: 'overlay' } as const;

export function Preview() {
  const aspect = useStore((s) => s.project!.aspect);
  const empty = useStore((s) => s.project!.clips.length === 0);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const drag = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    const c = canvas.current!;
    engine.attach(c);
    return () => engine.detach(c);
  }, []);

  useEffect(() => {
    if (engine.exporting) return;
    const [w, h] = canvasSize(aspect);
    canvas.current!.width = w;
    canvas.current!.height = h;
  }, [aspect]);

  // Fit the canvas into the available space while keeping its aspect ratio.
  useLayoutEffect(() => {
    const el = wrap.current!;
    const fit = () => {
      const { w, h } = ASPECTS[aspect];
      const r = w / h;
      const cw = el.clientWidth - 16;
      const ch = el.clientHeight - 16;
      let W = cw;
      let H = cw / r;
      if (H > ch) {
        H = ch;
        W = ch * r;
      }
      setBox({ w: Math.max(0, W), h: Math.max(0, H) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height, r };
  };

  const boxesOf = (shape: Shape) => (shape === 'sticker' ? engine.stickerBoxes : engine.overlayBoxes);

  /** Start resizing/rotating a sticker or overlay around its center, from a reference distance and angle. */
  const startTransform = (shape: Shape, id: string, kind: 'handle' | 'pinch', d0: number, a0: number, moved: boolean) => {
    const pose = poseNow(shape, id);
    if (!pose) return;
    drag.current = { kind, shape, id, d0: Math.max(1, d0), a0, size0: pose.size, rot0: pose.rotation, moved };
  };

  const shapeCenter = (shape: Shape, id: string) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const b = boxesOf(shape).find((x) => x.id === id);
    return b ? { x: r.left + (b.cx * r.width) / c.width, y: r.top + (b.cy * r.height) / c.height } : null;
  };

  const pinchGeom = () => {
    const [p1, p2] = [...pointers.current.values()];
    return { d: Math.hypot(p2.x - p1.x, p2.y - p1.y), a: Math.atan2(p2.y - p1.y, p2.x - p1.x) };
  };

  const onDown = (e: React.PointerEvent) => {
    const s = useStore.getState();
    if (s.exporting || empty) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.current!.setPointerCapture(e.pointerId);
    const g = drag.current;

    // Second finger on a sticker or overlay: pinch to resize and rotate.
    if (pointers.current.size === 2 && g && g.kind !== 'text') {
      if (!g.moved) s.checkpoint();
      const { d, a } = pinchGeom();
      startTransform(g.kind === 'handle' || g.kind === 'pinch' ? g.shape : g.kind, g.id, 'pinch', d, a, true);
      return;
    }
    if (pointers.current.size > 1) return;

    const { x, y } = toCanvas(e);
    const W = canvas.current!.width;
    const sel = s.selection;
    if (sel?.kind === 'sticker' || sel?.kind === 'overlay') {
      const b = boxesOf(sel.kind).find((i) => i.id === sel.id);
      const h = b && stickerHandle(b);
      if (b && h && Math.hypot(x - h.x, y - h.y) < stickerHandleRadius(W) * 1.8) {
        engine.pause();
        const c = shapeCenter(sel.kind, sel.id)!;
        startTransform(sel.kind, sel.id, 'handle', Math.hypot(e.clientX - c.x, e.clientY - c.y), Math.atan2(e.clientY - c.y, e.clientX - c.x), false);
        return;
      }
    }

    const grab = (kind: 'text' | Shape, id: string) => {
      engine.pause();
      const pose = poseNow(kind, id)!;
      const wasSelected = sel?.kind === kind && sel.id === id;
      s.select({ kind, id });
      drag.current = { kind, id, ox: pose.x, oy: pose.y, sx: e.clientX, sy: e.clientY, moved: false, wasSelected };
    };
    const hit = [...engine.textBoxes].reverse().find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (hit) return grab('text', hit.id);
    const sHit = [...engine.stickerBoxes].reverse().find((b) => hitSticker(b, x, y, W / 80));
    if (sHit) return grab('sticker', sHit.id);
    const oHit = [...engine.overlayBoxes].reverse().find((b) => hitSticker(b, x, y, W / 80));
    if (oHit) return grab('overlay', oHit.id);
    if (sel) s.select(null);
    else engine.toggle();
  };

  const onMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    const store = useStore.getState();

    if (d.kind === 'handle' || d.kind === 'pinch') {
      let dist: number;
      let ang: number;
      if (d.kind === 'pinch') {
        if (pointers.current.size < 2) return;
        ({ d: dist, a: ang } = pinchGeom());
      } else {
        const c = shapeCenter(d.shape, d.id);
        if (!c) return;
        dist = Math.hypot(e.clientX - c.x, e.clientY - c.y);
        ang = Math.atan2(e.clientY - c.y, e.clientX - c.x);
      }
      if (!d.moved) {
        d.moved = true;
        store.checkpoint();
      }
      // Snap to straight when close, since that's what people usually want.
      let rot = d.rot0 + ang - d.a0;
      rot = Math.atan2(Math.sin(rot), Math.cos(rot));
      if (Math.abs(rot) < 0.06) rot = 0;
      const [lo, hi] = SIZE_LIMITS[d.shape];
      editPose(d.shape, d.id, { size: clamp((d.size0 * dist) / d.d0, lo, hi), rotation: rot });
      return;
    }

    if (!('ox' in d)) return;
    const { r } = toCanvas(e);
    const dx = (e.clientX - d.sx) / r.width;
    const dy = (e.clientY - d.sy) / r.height;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
      d.moved = true;
      store.checkpoint();
    }
    // Snap to the center lines, which is where people usually want things.
    const snap = (v: number) => (Math.abs(v - 0.5) < 0.025 ? 0.5 : v);
    // Overlays may go partly off the frame; texts and stickers stay inside.
    const [lo, hi] = d.kind === 'overlay' ? [-0.2, 1.2] : [0.03, 0.97];
    editPose(d.kind, d.id, { x: snap(clamp(d.ox + dx, lo, hi)), y: snap(clamp(d.oy + dy, lo, hi)) });
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (d?.kind === 'pinch' && pointers.current.size === 1) {
      drag.current = null; // lifting one finger ends the pinch; don't jump into a drag
      return;
    }
    if (pointers.current.size) return;
    drag.current = null;
    if (d && 'wasSelected' in d && !d.moved && d.wasSelected) useStore.getState().setPanel(PANEL_OF[d.kind]);
  };

  return (
    <div className="preview-area">
      <div className="canvas-wrap" ref={wrap}>
        <canvas
          ref={canvas}
          className="preview-canvas"
          style={{ width: box.w, height: box.h }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        {!empty && <SafeZoneGuide aspect={aspect} w={box.w} h={box.h} />}
        {empty && (
          <div className="empty-state" style={{ width: box.w, height: box.h }}>
            <ImagePlus size={44} />
            <p>Empieza agregando tus videos o fotos</p>
            <ImportButton className="btn-primary big">Agregar videos o fotos</ImportButton>
            <small>También puedes arrastrarlos aquí</small>
          </div>
        )}
      </div>
      <PlayerControls />
    </div>
  );
}

function PlayerControls() {
  // The timecode is written straight to the DOM so playback doesn't re-render React at 60fps.
  const tc = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const paint = (t: number) => {
      if (tc.current) tc.current.textContent = fmtTime(t, true);
    };
    paint(useStore.getState().time);
    return useStore.subscribe((s, prev) => void (s.time !== prev.time && paint(s.time)));
  }, []);
  const dur = useStore((s) => (s.project ? totalDuration(s.project) : 0));
  const playing = useStore((s) => s.playing);
  const zoom = (k: number) => useStore.getState().setPps(useStore.getState().pps * k);
  return (
    <div className="controls">
      <span className="timecode">
        <b ref={tc} /> / {fmtTime(dur, true)}
      </span>
      <button className="play-btn" onClick={() => engine.toggle()} aria-label={playing ? 'Pausar' : 'Reproducir'}>
        {playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
      </button>
      <div className="zoom-btns">
        <button className="icon-btn" onClick={() => zoom(1 / 1.4)} aria-label="Alejar línea de tiempo" title="Alejar">
          <ZoomOut size={20} />
        </button>
        <button className="icon-btn" onClick={() => zoom(1.4)} aria-label="Acercar línea de tiempo" title="Acercar">
          <ZoomIn size={20} />
        </button>
      </div>
    </div>
  );
}
