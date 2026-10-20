import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Blend, Diamond, Image as ImageIcon, Layers, Music, Plus, Smile, Snowflake, Sparkles, Type } from 'lucide-react';
import type { Asset, AudioItem, Clip, Keyframe, OverlayItem, Project, SelectionKind, StickerItem, TextItem, TransitionId } from '../types';
import { itemsOf, useStore } from '../store';
import { engine } from '../engine';
import { IMAGE_MAX, audioDur, clamp, fmtTime, lanes, layout, mainDuration, overlayDur, overlaysOf, totalDuration } from '../model';
import { keyframeButtonState, toggleKeyframe } from './AdvancedPanels';
import { addText } from '../ops';
import { getFilter } from '../filters';
import { effectName, stickersOf, transitionName } from '../visuals';
import { TRANSITION_ICONS } from './fxIcons';

const JUNCTION_ICONS: Record<TransitionId, typeof Blend> = { ...TRANSITION_ICONS, none: ArrowLeftRight };

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

/** Small diamonds where an item has keyframes. */
function KfMarks({ kf, pps }: { kf?: Keyframe[]; pps: number }) {
  if (!kf?.length) return null;
  return (
    <>
      {kf.map((k, i) => (
        <span key={i} className="tl-kf" style={{ left: k.t * pps }} />
      ))}
    </>
  );
}

/** Diamond at the playhead: adds (or removes) a keyframe on the selected item. */
function KeyframeButton() {
  // Only its look is selected, so playback doesn't re-render it every frame.
  const state = useStore(keyframeButtonState);
  if (!state) return null;
  const on = state === 'on';
  const label = on ? 'Quitar fotograma clave' : 'Agregar fotograma clave aquí';
  return (
    <button
      className={`tl-kf-btn ${on ? 'on' : ''} ${state === 'out' ? 'off' : ''}`}
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

function Handles({ kind, id }: { kind: SelectionKind; id: string }) {
  return (
    <>
      <span className="handle l" onPointerDown={(e) => startDrag(e, kind, id, 'l')} onClick={(e) => e.stopPropagation()} />
      <span className="handle r" onPointerDown={(e) => startDrag(e, kind, id, 'r')} onClick={(e) => e.stopPropagation()} />
    </>
  );
}

const select = (kind: SelectionKind, id: string) => (e: React.MouseEvent) => {
  e.stopPropagation();
  engine.pause();
  useStore.getState().select({ kind, id });
};

/** Keyboard access for timeline items: focusable, Enter/Space selects. */
const itemA11y = (kind: SelectionKind, id: string, label: string, sel: boolean) => ({
  role: 'button',
  tabIndex: 0,
  'aria-label': label,
  'aria-pressed': sel,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      engine.pause();
      useStore.getState().select({ kind, id });
    }
  },
});

// Items are memoized on their own data: copy-on-write edits keep untouched items identical, so a
// drag or a selection change re-renders only the items it touches, not the whole timeline.

interface Placement {
  sel: boolean;
  pps: number;
  pad: number;
}

const TlOverlay = memo(function TlOverlay({ o, asset, lane, sel, pps, pad }: Placement & { o: OverlayItem; asset?: Asset; lane: number }) {
  return (
    <div
      className={`tl-item overlay ${sel ? 'selected' : ''}`}
      style={{
        left: pad + o.start * pps,
        width: Math.max(2, overlayDur(o) * pps),
        top: lane * ROW_OVERLAY,
        height: ROW_OVERLAY - 4,
        backgroundImage: asset?.thumb ? `url(${asset.thumb})` : undefined,
      }}
      onClick={select('overlay', o.id)}
      {...itemA11y('overlay', o.id, `Superposición: ${asset?.name ?? 'sin nombre'}`, sel)}
      onPointerDown={sel ? (e) => startDrag(e, 'overlay', o.id, 'body') : undefined}
      onDoubleClick={() => useStore.getState().setPanel('overlay')}
      title={asset?.name}
    >
      <Layers size={12} /> <span>{asset?.name ?? 'Superposición'}</span>
      <KfMarks kf={o.keyframes} pps={pps} />
      {sel && <Handles kind="overlay" id={o.id} />}
    </div>
  );
});

const TlClip = memo(function TlClip({ clip, asset, start, end, sel, pps, pad }: Placement & { clip: Clip; asset?: Asset; start: number; end: number }) {
  const f = getFilter(clip.filter);
  return (
    <div
      className={`tl-item clip ${sel ? 'selected' : ''}`}
      style={{
        left: pad + start * pps,
        width: Math.max(2, (end - start) * pps),
        backgroundImage: asset?.thumb ? `url(${asset.thumb})` : undefined,
      }}
      onClick={select('clip', clip.id)}
      {...itemA11y('clip', clip.id, `Clip: ${asset?.name ?? 'sin nombre'}, ${fmtTime(end - start, true)}`, sel)}
      title={asset?.name}
    >
      <span className="tl-badges">
        {asset?.kind === 'image' && <ImageIcon size={12} />}
        {clip.freeze != null && <Snowflake size={12} />}
        {clip.speed !== 1 && <em>{clip.speed}×</em>}
        {f.id !== 'none' && <em>{f.name}</em>}
        {clip.effect && clip.effect.id !== 'none' && <em><Sparkles size={10} /> {effectName(clip.effect.id)}</em>}
        <em>{fmtTime(end - start, true)}</em>
      </span>
      {sel && <Handles kind="clip" id={clip.id} />}
    </div>
  );
});

const TlJunction = memo(function TlJunction({ clip, end, pps, pad }: Omit<Placement, 'sel'> & { clip: Clip; end: number }) {
  const type = clip.transition?.type ?? 'none';
  const Icon = JUNCTION_ICONS[type];
  const label = type === 'none' ? 'Agregar transición' : `Transición: ${transitionName(type)}`;
  return (
    <button
      className={`tl-junction ${type !== 'none' ? 'set' : ''}`}
      style={{ left: pad + end * pps }}
      onClick={(e) => {
        e.stopPropagation();
        engine.pause();
        const s = useStore.getState();
        s.select({ kind: 'clip', id: clip.id });
        s.setPanel('transition');
      }}
      aria-label={label}
      title={label}
    >
      <Icon size={14} />
    </button>
  );
});

const TlText = memo(function TlText({ t, lane, sel, pps, pad }: Placement & { t: TextItem; lane: number }) {
  return (
    <div
      className={`tl-item text ${sel ? 'selected' : ''}`}
      style={{ left: pad + t.start * pps, width: Math.max(2, t.duration * pps), top: lane * ROW_TEXT, height: ROW_TEXT - 4 }}
      onClick={select('text', t.id)}
      {...itemA11y('text', t.id, `Texto: ${t.text}`, sel)}
      onPointerDown={sel ? (e) => startDrag(e, 'text', t.id, 'body') : undefined}
      onDoubleClick={() => useStore.getState().setPanel('text')}
    >
      <Type size={12} /> <span>{t.text}</span>
      <KfMarks kf={t.keyframes} pps={pps} />
      {sel && <Handles kind="text" id={t.id} />}
    </div>
  );
});

const TlSticker = memo(function TlSticker({ st, thumb, lane, sel, pps, pad }: Placement & { st: StickerItem; thumb?: string; lane: number }) {
  return (
    <div
      className={`tl-item sticker ${sel ? 'selected' : ''}`}
      style={{ left: pad + st.start * pps, width: Math.max(2, st.duration * pps), top: lane * ROW_STICKER, height: ROW_STICKER - 4 }}
      onClick={select('sticker', st.id)}
      {...itemA11y('sticker', st.id, 'Sticker', sel)}
      onPointerDown={sel ? (e) => startDrag(e, 'sticker', st.id, 'body') : undefined}
      onDoubleClick={() => useStore.getState().setPanel('stickers')}
    >
      {thumb ? <img src={thumb} alt="" /> : <span className="tl-emoji">{st.emoji}</span>}
      <span>Sticker</span>
      <KfMarks kf={st.keyframes} pps={pps} />
      {sel && <Handles kind="sticker" id={st.id} />}
    </div>
  );
});

const TlAudio = memo(function TlAudio({ a, name, lane, sel, pps, pad }: Placement & { a: AudioItem; name?: string; lane: number }) {
  return (
    <div
      className={`tl-item audio ${sel ? 'selected' : ''}`}
      style={{ left: pad + a.start * pps, width: Math.max(2, audioDur(a) * pps), top: lane * ROW_AUDIO, height: ROW_AUDIO - 4 }}
      onClick={select('audio', a.id)}
      {...itemA11y('audio', a.id, `Audio: ${name ?? 'sin nombre'}`, sel)}
      onPointerDown={sel ? (e) => startDrag(e, 'audio', a.id, 'body') : undefined}
    >
      <Music size={12} /> <span>{name ?? 'Audio'}</span>
      {sel && <Handles kind="audio" id={a.id} />}
    </div>
  );
});

export function Timeline() {
  const project = useStore((s) => s.project!);
  const pps = useStore((s) => s.pps);
  const selection = useStore((s) => s.selection);
  const advanced = useStore((s) => s.advanced);
  const ref = useRef<HTMLDivElement>(null);
  /** The scroll position the playhead asked for last, or the user's own scroll: tells the two apart. */
  const lastProg = useRef(-1);
  const [vw, setVw] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setVw(el.clientWidth));
    ro.observe(el);
    setVw(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // The playhead is fixed in the middle; the timeline scrolls underneath it. While playing this runs
  // inside the engine's frame, so it only writes: reading scrollLeft back would force a layout there.
  const [applyScroll] = useState(() => (force: boolean) => {
    const el = ref.current;
    if (!el) return;
    const s = useStore.getState();
    const x = s.time * s.pps;
    // Already there, e.g. the time came from the user's own scroll: don't fight their swipe.
    if (!force && Math.abs(x - lastProg.current) < 0.5) return;
    lastProg.current = x;
    el.scrollLeft = x;
  });
  useLayoutEffect(() => applyScroll(true), [vw, pps, project, applyScroll]);
  useEffect(() => useStore.subscribe((s, prev) => void (s.time !== prev.time && applyScroll(false))), [applyScroll]);

  const onScroll = () => {
    const el = ref.current!;
    const x = el.scrollLeft;
    // The browser may clamp (or round) the position the playhead asked for: that is not the user.
    if (Math.abs(x - Math.min(lastProg.current, el.scrollWidth - el.clientWidth)) < 1) return;
    lastProg.current = x;
    engine.seek(x / useStore.getState().pps);
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

  const isSel = (kind: SelectionKind, id: string) => selection?.kind === kind && selection.id === id;

  const dur = totalDuration(project);
  const placed = layout(project);
  const pad = vw / 2;
  const width = dur * pps + vw;
  const stickers = stickersOf(project);
  const overlays = overlaysOf(project);
  // Lanes only change with their own track, not with selection or zoom.
  const textLanes = useMemo(() => lanes(project.texts.map((t) => ({ id: t.id, start: t.start, end: t.start + t.duration }))), [project.texts]);
  const stickerLanes = useMemo(() => lanes(stickers.map((t) => ({ id: t.id, start: t.start, end: t.start + t.duration }))), [stickers]);
  const audioLanes = useMemo(() => lanes(project.audios.map((a) => ({ id: a.id, start: a.start, end: a.start + audioDur(a) }))), [project.audios]);
  const overlayLanes = useMemo(() => lanes(overlays.map((o) => ({ id: o.id, start: o.start, end: o.start + overlayDur(o) }))), [overlays]);

  return (
    <div className="timeline">
      <div className="tl-scroll" ref={ref} onScroll={onScroll} onClick={() => useStore.getState().select(null)}>
        <div className="tl-content" style={{ width }}>
          <Ruler dur={dur} pps={pps} pad={pad} />

          {(advanced || overlays.length > 0) && (
            <div className="tl-row tl-overlays" style={{ height: Math.max(1, overlayLanes.count) * ROW_OVERLAY }}>
              {overlays.length === 0 && (
                <button className="tl-ghost" style={{ left: pad + 8 }} onClick={(e) => { e.stopPropagation(); useStore.getState().setPanel('overlay'); }}>
                  <Layers size={14} /> Superponer video o foto
                </button>
              )}
              {overlays.map((o) => (
                <TlOverlay key={o.id} o={o} asset={project.assets[o.assetId]} lane={overlayLanes.map[o.id] ?? 0} sel={isSel('overlay', o.id)} pps={pps} pad={pad} />
              ))}
            </div>
          )}

          <div className="tl-row" style={{ height: ROW_CLIP }}>
            {placed.map(({ clip, start, end }) => (
              <TlClip key={clip.id} clip={clip} asset={project.assets[clip.assetId]} start={start} end={end} sel={isSel('clip', clip.id)} pps={pps} pad={pad} />
            ))}
            {placed.slice(0, -1).map(({ clip, end }) => (
              <TlJunction key={`j-${clip.id}`} clip={clip} end={end} pps={pps} pad={pad} />
            ))}
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
            {project.texts.map((t) => (
              <TlText key={t.id} t={t} lane={textLanes.map[t.id] ?? 0} sel={isSel('text', t.id)} pps={pps} pad={pad} />
            ))}
          </div>

          <div className="tl-row" style={{ height: Math.max(1, stickerLanes.count) * ROW_STICKER }}>
            {stickers.length === 0 && (
              <button className="tl-ghost" style={{ left: pad + 8 }} onClick={(e) => { e.stopPropagation(); useStore.getState().setPanel('stickers'); }}>
                <Smile size={14} /> Agregar sticker
              </button>
            )}
            {stickers.map((st) => (
              <TlSticker
                key={st.id}
                st={st}
                thumb={st.assetId ? project.assets[st.assetId]?.thumb : undefined}
                lane={stickerLanes.map[st.id] ?? 0}
                sel={isSel('sticker', st.id)}
                pps={pps}
                pad={pad}
              />
            ))}
          </div>

          <div className="tl-row" style={{ height: Math.max(1, audioLanes.count) * ROW_AUDIO }}>
            {project.audios.length === 0 && (
              <button className="tl-ghost" style={{ left: pad + 8 }} onClick={(e) => { e.stopPropagation(); useStore.getState().setPanel('audio'); }}>
                <Music size={14} /> Agregar música
              </button>
            )}
            {project.audios.map((a) => (
              <TlAudio key={a.id} a={a} name={project.assets[a.assetId]?.name} lane={audioLanes.map[a.id] ?? 0} sel={isSel('audio', a.id)} pps={pps} pad={pad} />
            ))}
          </div>
        </div>
      </div>
      <div className="playhead" />
      <KeyframeButton />

    </div>
  );
}

const Ruler = memo(function Ruler({ dur, pps, pad }: { dur: number; pps: number; pad: number }) {
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
});
