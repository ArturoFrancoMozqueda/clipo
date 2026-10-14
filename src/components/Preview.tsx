import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImagePlus, Pause, Play, ZoomIn, ZoomOut } from 'lucide-react';
import { useStore } from '../store';
import { engine } from '../engine';
import { ASPECTS, canvasSize, clamp, fmtTime, totalDuration } from '../model';
import { ImportButton } from './ImportButton';

export function Preview() {
  const aspect = useStore((s) => s.project!.aspect);
  const empty = useStore((s) => s.project!.clips.length === 0);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const drag = useRef<{ id: string; ox: number; oy: number; sx: number; sy: number; moved: boolean; wasSelected: boolean } | null>(null);

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

  const toCanvas = (e: React.PointerEvent) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height, r };
  };

  const onDown = (e: React.PointerEvent) => {
    const s = useStore.getState();
    if (s.exporting || empty) return;
    const { x, y } = toCanvas(e);
    const hit = [...engine.textBoxes].reverse().find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (hit) {
      engine.pause();
      const t = s.project!.texts.find((i) => i.id === hit.id)!;
      const wasSelected = s.selection?.kind === 'text' && s.selection.id === hit.id;
      s.select({ kind: 'text', id: hit.id });
      drag.current = { id: hit.id, ox: t.x, oy: t.y, sx: e.clientX, sy: e.clientY, moved: false, wasSelected };
      canvas.current!.setPointerCapture(e.pointerId);
    } else if (s.selection) {
      s.select(null);
    } else {
      engine.toggle();
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { r } = toCanvas(e);
    const dx = (e.clientX - d.sx) / r.width;
    const dy = (e.clientY - d.sy) / r.height;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
      d.moved = true;
      useStore.getState().checkpoint();
    }
    // Snap to the center lines, which is where people usually want text.
    const snap = (v: number) => (Math.abs(v - 0.5) < 0.025 ? 0.5 : v);
    useStore.getState().live((p) => {
      const t = p.texts.find((i) => i.id === d.id);
      if (!t) return;
      t.x = snap(clamp(d.ox + dx, 0.03, 0.97));
      t.y = snap(clamp(d.oy + dy, 0.03, 0.97));
    });
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && d.wasSelected) useStore.getState().setPanel('text');
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
  const time = useStore((s) => s.time);
  const dur = useStore((s) => (s.project ? totalDuration(s.project) : 0));
  const playing = useStore((s) => s.playing);
  const zoom = (k: number) => useStore.getState().setPps(useStore.getState().pps * k);
  return (
    <div className="controls">
      <span className="timecode">
        <b>{fmtTime(time, true)}</b> / {fmtTime(dur, true)}
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
