import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Music, Plus, Type } from 'lucide-react';
import type { AudioItem, Clip, Project, SelectionKind, TextItem } from '../types';
import { useStore } from '../store';
import { engine } from '../engine';
import { IMAGE_MAX, audioDur, clamp, fmtTime, lanes, layout, mainDuration, totalDuration } from '../model';
import { addText } from '../ops';
import { getFilter } from '../filters';

const ROW_CLIP = 60;
const ROW_TEXT = 30;
const ROW_AUDIO = 34;

type Mode = 'l' | 'r' | 'body';

/** Apply a horizontal drag of `ds` seconds to an item, starting from its original values. */
function applyDrag(p: Project, kind: SelectionKind, id: string, mode: Mode, ds: number, o: Clip | TextItem | AudioItem) {
  if (kind === 'clip') {
    const c = p.clips.find((x) => x.id === id);
    const oc = o as Clip;
    if (!c) return;
    const a = p.assets[c.assetId];
    if (a?.kind === 'image') {
      // Photos have no "source" to trim: both handles change how long they show.
      c.out = clamp(oc.out + (mode === 'l' ? -ds : ds), 0.3, IMAGE_MAX);
    } else if (mode === 'l') c.in = clamp(oc.in + ds * oc.speed, 0, oc.out - 0.1);
    else if (mode === 'r') c.out = clamp(oc.out + ds * oc.speed, oc.in + 0.1, a?.duration ?? oc.out);
  } else if (kind === 'text') {
    const t = p.texts.find((x) => x.id === id);
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
  const list: (Clip | TextItem | AudioItem)[] = kind === 'clip' ? p.clips : kind === 'text' ? p.texts : p.audios;
  const found = list.find((x) => x.id === id);
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

function Handles({ kind, id }: { kind: SelectionKind; id: string }) {
  return (
    <>
      <span className="handle l" onPointerDown={(e) => startDrag(e, kind, id, 'l')} onClick={(e) => e.stopPropagation()} />
      <span className="handle r" onPointerDown={(e) => startDrag(e, kind, id, 'r')} onClick={(e) => e.stopPropagation()} />
    </>
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

  // Mouse wheel scrolls sideways; Ctrl+wheel and two-finger pinch zoom.
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      const s = useStore.getState();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        s.setPps(s.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    let pinch: { d: number; pps: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
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

  const select = (kind: SelectionKind, id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    engine.pause();
    useStore.getState().select({ kind, id });
  };
  const isSel = (kind: SelectionKind, id: string) => selection?.kind === kind && selection.id === id;

  const dur = totalDuration(project);
  const placed = layout(project);
  const pad = vw / 2;
  const width = dur * pps + vw;
  const textLanes = lanes(project.texts.map((t) => ({ id: t.id, start: t.start, end: t.start + t.duration })));
  const audioLanes = lanes(project.audios.map((a) => ({ id: a.id, start: a.start, end: a.start + audioDur(a) })));

  return (
    <div className="timeline">
      <div className="tl-scroll" ref={ref} onScroll={onScroll} onClick={() => useStore.getState().select(null)}>
        <div className="tl-content" style={{ width }}>
          <Ruler dur={dur} pps={pps} pad={pad} />

          <div className="tl-row" style={{ height: ROW_CLIP }}>
            {placed.map(({ clip, start, end }) => {
              const a = project.assets[clip.assetId];
              const sel = isSel('clip', clip.id);
              const f = getFilter(clip.filter);
              return (
                <div
                  key={clip.id}
                  className={`tl-item clip ${sel ? 'selected' : ''}`}
                  style={{
                    left: pad + start * pps,
                    width: Math.max(2, (end - start) * pps),
                    backgroundImage: a?.thumb ? `url(${a.thumb})` : undefined,
                  }}
                  onClick={select('clip', clip.id)}
                  title={a?.name}
                >
                  <span className="tl-badges">
                    {a?.kind === 'image' && <ImageIcon size={12} />}
                    {clip.speed !== 1 && <em>{clip.speed}×</em>}
                    {f.id !== 'none' && <em>{f.name}</em>}
                    <em>{fmtTime(end - start, true)}</em>
                  </span>
                  {sel && <Handles kind="clip" id={clip.id} />}
                </div>
              );
            })}
            <button
              className="tl-add"
              style={{ left: pad + mainDuration(project) * pps + 8 }}
              onClick={(e) => {
                e.stopPropagation();
                useStore.getState().setPanel('media');
              }}
              aria-label="Agregar videos o fotos"
              title="Agregar videos o fotos"
            >
              <Plus size={22} />
            </button>
          </div>

          <div className="tl-row" style={{ height: Math.max(1, textLanes.count) * ROW_TEXT }}>
            {project.texts.length === 0 && (
              <button className="tl-ghost" style={{ left: pad + 8 }} onClick={(e) => { e.stopPropagation(); addText(); }}>
                <Type size={14} /> Agregar texto
              </button>
            )}
            {project.texts.map((t) => {
              const sel = isSel('text', t.id);
              return (
                <div
                  key={t.id}
                  className={`tl-item text ${sel ? 'selected' : ''}`}
                  style={{ left: pad + t.start * pps, width: Math.max(2, t.duration * pps), top: textLanes.map[t.id] * ROW_TEXT, height: ROW_TEXT - 4 }}
                  onClick={select('text', t.id)}
                  onPointerDown={sel ? (e) => startDrag(e, 'text', t.id, 'body') : undefined}
                  onDoubleClick={() => useStore.getState().setPanel('text')}
                >
                  <Type size={12} /> <span>{t.text}</span>
                  {sel && <Handles kind="text" id={t.id} />}
                </div>
              );
            })}
          </div>

          <div className="tl-row" style={{ height: Math.max(1, audioLanes.count) * ROW_AUDIO }}>
            {project.audios.length === 0 && (
              <button className="tl-ghost" style={{ left: pad + 8 }} onClick={(e) => { e.stopPropagation(); useStore.getState().setPanel('audio'); }}>
                <Music size={14} /> Agregar música
              </button>
            )}
            {project.audios.map((a) => {
              const sel = isSel('audio', a.id);
              return (
                <div
                  key={a.id}
                  className={`tl-item audio ${sel ? 'selected' : ''}`}
                  style={{ left: pad + a.start * pps, width: Math.max(2, audioDur(a) * pps), top: audioLanes.map[a.id] * ROW_AUDIO, height: ROW_AUDIO - 4 }}
                  onClick={select('audio', a.id)}
                  onPointerDown={sel ? (e) => startDrag(e, 'audio', a.id, 'body') : undefined}
                >
                  <Music size={12} /> <span>{project.assets[a.assetId]?.name ?? 'Audio'}</span>
                  {sel && <Handles kind="audio" id={a.id} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="playhead" />
    </div>
  );
}

function Ruler({ dur, pps, pad }: { dur: number; pps: number; pad: number }) {
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pps >= 70) ?? 300;
  const ticks = [];
  for (let t = 0; t <= dur + step; t += step) {
    ticks.push(
      <span key={t} className="tick" style={{ left: pad + t * pps }}>
        {fmtTime(t)}
        {step < 1 && t % 1 ? '.5' : ''}
      </span>,
    );
  }
  return <div className="ruler">{ticks}</div>;
}
