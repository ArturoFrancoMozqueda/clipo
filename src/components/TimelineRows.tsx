// Rows of the timeline as memoized components: a drag or a selection change re-renders only the
// items it touches, and items (plus ruler ticks, filmstrip frames and waveform bars) far from the
// playhead aren't rendered at all.
import { memo, useMemo } from 'react';
import { ArrowLeftRight, Blend, Image as ImageIcon, Layers, Music, Plus, Smile, Snowflake, Sparkles, Type } from 'lucide-react';
import type { Asset, AudioItem, Clip, Keyframe, OverlayItem, PanelId, SelectionKind, StickerItem, TextItem, TransitionId } from '../types';
import { useStore } from '../store';
import { engine } from '../engine';
import { audioDur, fmtTime, lanes, overlayDur, type Placed } from '../model';
import { addText } from '../ops';
import { getFilter } from '../filters';
import { effectName, transitionName } from '../visuals';
import { inWindow, tickRange, tickSteps } from '../timelineMath';
import { useLevels } from '../waveform';
import { TRANSITION_ICONS } from './fxIcons';
import { Filmstrip } from './Filmstrip';
import { Waveform } from './Waveform';
import './timeline.css';

const JUNCTION_ICONS: Record<TransitionId, typeof Blend> = { ...TRANSITION_ICONS, none: ArrowLeftRight };

export type DragMode = 'l' | 'r' | 'body';
export type DragFn = (e: React.PointerEvent, kind: SelectionKind, id: string, mode: DragMode) => void;
/** Rendered part of the timeline, in seconds. */
export interface Win {
  from: number;
  to: number;
}
type Assets = Record<string, Asset>;
type Urls = Record<string, string>;

/** Items have a 2px border all around. */
const EDGE = 4;
/** Video clips longer than this get no waveform strip (some files can only be decoded whole). */
const WAVE_MAX_SOURCE = 300;
/** Items narrower than this hide their name/duration label. */
const LABEL_MIN = 110;

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

const panel = (p: PanelId) => () => useStore.getState().setPanel(p);

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

function Handles({ kind, id, drag }: { kind: SelectionKind; id: string; drag: DragFn }) {
  return (
    <>
      <span className="handle l" onPointerDown={(e) => drag(e, kind, id, 'l')} onClick={(e) => e.stopPropagation()} />
      <span className="handle r" onPointerDown={(e) => drag(e, kind, id, 'r')} onClick={(e) => e.stopPropagation()} />
    </>
  );
}

/** Duration badge, only where it fits. */
const Dur = ({ s, px }: { s: number; px: number }) => (px >= LABEL_MIN ? <em className="tl-dur">{fmtTime(s, true)}</em> : null);

/** Filmstrip tile width for a video of this shape at this height. */
const tileOf = (a: Asset | undefined, h: number) => Math.min(120, Math.max(24, Math.round(a?.width && a.height ? (h * a.width) / a.height : (h * 16) / 9)));

/** Part [a, b] of an item of `dur` seconds starting at `start` that falls in the window, or null. */
function part(w: Win, start: number, dur: number) {
  const a = Math.max(0, w.from - start);
  const b = Math.min(dur, w.to - start);
  return b > a ? { a, b } : null;
}

/** Ghost button shown in an empty row. */
function Ghost({ pad, onClick, children }: { pad: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="tl-ghost" style={{ left: pad + 8 }} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Ruler

/** Time labels and minor ticks, only inside the rendered window. */
export const Ruler = memo(function Ruler({ dur, pps, pad, from, to }: { dur: number; pps: number; pad: number; from: number; to: number }) {
  const { step, minor } = tickSteps(pps);
  const last = dur + step;
  const per = minor ? Math.round(step / minor) : 0;
  return (
    <div className="ruler">
      {minor > 0 &&
        tickRange(minor, from, to, last).map((j) =>
          j % per ? <span key={`m${j}`} className="tick-minor" style={{ left: pad + j * minor * pps }} /> : null,
        )}
      {tickRange(step, from, to, last).map((k) => {
        const t = k * step;
        return (
          <span key={k} className="tick" style={{ left: pad + t * pps }}>
            {fmtTime(t)}
            {step < 1 && t % 1 ? '.5' : ''}
          </span>
        );
      })}
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// Overlays

interface RowBase {
  pps: number;
  pad: number;
  rowH: number;
  /** Id of the selected item of this row's kind. */
  selId: string | null;
  win: Win;
  drag: DragFn;
}

export const OverlayRow = memo(function OverlayRow({ overlays, assets, urls, pps, pad, rowH, selId, win, drag }: RowBase & { overlays: OverlayItem[]; assets: Assets; urls: Urls }) {
  const ln = useMemo(() => lanes(overlays.map((o) => ({ id: o.id, start: o.start, end: o.start + overlayDur(o) }))), [overlays]);
  return (
    <div className="tl-row tl-overlays" style={{ height: Math.max(1, ln.count) * rowH }}>
      {overlays.length === 0 && (
        <Ghost pad={pad} onClick={panel('overlay')}>
          <Layers size={14} /> Superponer video o foto
        </Ghost>
      )}
      {overlays.map((o) => {
        const sel = o.id === selId;
        if (!sel && !inWindow(win, o.start, o.start + overlayDur(o))) return null;
        const a = assets[o.assetId];
        return (
          <OverlayView key={o.id} o={o} a={a} url={urls[o.assetId]} top={(ln.map[o.id] ?? 0) * rowH} h={rowH - 4} pps={pps} pad={pad} sel={sel} from={win.from} to={win.to} drag={drag} />
        );
      })}
    </div>
  );
});

interface ItemBase {
  pps: number;
  pad: number;
  sel: boolean;
  from: number;
  to: number;
  drag: DragFn;
}

const OverlayView = memo(function OverlayView({ o, a, url, top, h, pps, pad, sel, from, to, drag }: ItemBase & { o: OverlayItem; a?: Asset; url?: string; top: number; h: number }) {
  const d = overlayDur(o);
  const px = Math.max(2, d * pps);
  return (
    <div
      className={`tl-item overlay ${sel ? 'selected' : ''}`}
      style={{ left: pad + o.start * pps, width: px, top, height: h, backgroundImage: a?.thumb ? `url(${a.thumb})` : undefined }}
      onClick={select('overlay', o.id)}
      {...itemA11y('overlay', o.id, `Superposición: ${a?.name ?? 'sin nombre'}`, sel)}
      onPointerDown={sel ? (e) => drag(e, 'overlay', o.id, 'body') : undefined}
      onDoubleClick={panel('overlay')}
      title={a?.name}
    >
      {a?.kind === 'video' && (
        <Filmstrip assetId={o.assetId} url={url} in={o.in} out={o.out} speed={1} dur={d} pps={pps} tile={tileOf(a, h - EDGE)} height={h - EDGE} from={from - o.start} to={to - o.start} />
      )}
      <Layers size={12} /> <span className="tl-label">{a?.name ?? 'Superposición'}</span>
      <Dur s={d} px={px} />
      <KfMarks kf={o.keyframes} pps={pps} />
      {sel && <Handles kind="overlay" id={o.id} drag={drag} />}
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// Main track

export const MainRow = memo(function MainRow({ placed, mainDur, assets, urls, pps, pad, rowH, selId, win, drag }: RowBase & { placed: Placed[]; mainDur: number; assets: Assets; urls: Urls }) {
  return (
    <div className="tl-row" style={{ height: rowH }}>
      {placed.map(({ clip, start, end }) => {
        const sel = clip.id === selId;
        if (!sel && !inWindow(win, start, end)) return null;
        return (
          <ClipView key={clip.id} clip={clip} a={assets[clip.assetId]} url={urls[clip.assetId]} start={start} end={end} h={rowH} pps={pps} pad={pad} sel={sel} from={win.from} to={win.to} drag={drag} />
        );
      })}
      {placed.slice(0, -1).map(({ clip, end }) =>
        inWindow(win, end, end) ? <Junction key={`j-${clip.id}`} id={clip.id} type={clip.transition?.type ?? 'none'} left={pad + end * pps} /> : null,
      )}
      <button
        className="tl-add"
        style={{ left: pad + mainDur * pps + 8 }}
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
  );
});

const ClipView = memo(function ClipView({ clip, a, url, start, end, h, pps, pad, sel, from, to, drag }: ItemBase & { clip: Clip; a?: Asset; url?: string; start: number; end: number; h: number }) {
  const d = end - start;
  const px = Math.max(2, d * pps);
  const f = getFilter(clip.filter);
  const inner = h - EDGE;
  const video = a?.kind === 'video';
  const wave = video && clip.freeze == null && (a?.duration ?? Infinity) <= WAVE_MAX_SOURCE;
  return (
    <div
      className={`tl-item clip ${sel ? 'selected' : ''}`}
      style={{ left: pad + start * pps, width: px, backgroundImage: a?.thumb ? `url(${a.thumb})` : undefined }}
      onClick={select('clip', clip.id)}
      {...itemA11y('clip', clip.id, `Clip: ${a?.name ?? 'sin nombre'}, ${fmtTime(d, true)}`, sel)}
      title={a?.name}
    >
      {video && (
        <Filmstrip assetId={clip.assetId} url={url} in={clip.in} out={clip.out} speed={clip.speed} dur={d} freeze={clip.freeze} pps={pps} tile={tileOf(a, inner)} height={inner} from={from - start} to={to - start} />
      )}
      {wave && <ClipWave assetId={clip.assetId} url={url} src0={clip.in} speed={clip.speed} pps={pps} start={start} dur={d} from={from} to={to} />}
      {px >= LABEL_MIN * 1.5 && <span className="tl-name">{a?.name}</span>}
      <span className="tl-badges">
        {a?.kind === 'image' && <ImageIcon size={12} />}
        {clip.freeze != null && <Snowflake size={12} />}
        {clip.speed !== 1 && <em>{clip.speed}×</em>}
        {f.id !== 'none' && <em>{f.name}</em>}
        {clip.effect && clip.effect.id !== 'none' && <em><Sparkles size={10} /> {effectName(clip.effect.id)}</em>}
        <em>{fmtTime(d, true)}</em>
      </span>
      {sel && <Handles kind="clip" id={clip.id} drag={drag} />}
    </div>
  );
});

/** Thin waveform of a video's own sound along the bottom of its clip. */
function ClipWave({ assetId, url, src0, speed, pps, start, dur, from, to }: { assetId: string; url?: string; src0: number; speed: number; pps: number; start: number; dur: number; from: number; to: number }) {
  const levels = useLevels(assetId, url);
  const p = part({ from, to }, start, dur);
  if (!levels || !p) return null;
  return <Waveform levels={levels} src0={src0} speed={speed} pps={pps} a={p.a} b={p.b} height={14} align="bottom" />;
}

const Junction = memo(function Junction({ id, type, left }: { id: string; type: TransitionId; left: number }) {
  const Icon = JUNCTION_ICONS[type];
  const label = type === 'none' ? 'Agregar transición' : `Transición: ${transitionName(type)}`;
  return (
    <button
      className={`tl-junction ${type !== 'none' ? 'set' : ''}`}
      style={{ left }}
      onClick={(e) => {
        e.stopPropagation();
        engine.pause();
        const s = useStore.getState();
        s.select({ kind: 'clip', id });
        s.setPanel('transition');
      }}
      aria-label={label}
      title={label}
    >
      <Icon size={14} />
    </button>
  );
});

// ---------------------------------------------------------------------------------------------
// Texts and stickers

export const TextRow = memo(function TextRow({ texts, pps, pad, rowH, selId, win, drag }: RowBase & { texts: TextItem[] }) {
  const ln = useMemo(() => lanes(texts.map((t) => ({ id: t.id, start: t.start, end: t.start + t.duration }))), [texts]);
  return (
    <div className="tl-row" style={{ height: Math.max(1, ln.count) * rowH }}>
      {texts.length === 0 && (
        <Ghost pad={pad} onClick={addText}>
          <Type size={14} /> Agregar texto
        </Ghost>
      )}
      {texts.map((t) => {
        const sel = t.id === selId;
        if (!sel && !inWindow(win, t.start, t.start + t.duration)) return null;
        return <TextView key={t.id} t={t} top={(ln.map[t.id] ?? 0) * rowH} h={rowH - 4} pps={pps} pad={pad} sel={sel} from={win.from} to={win.to} drag={drag} />;
      })}
    </div>
  );
});

const TextView = memo(function TextView({ t, top, h, pps, pad, sel, drag }: ItemBase & { t: TextItem; top: number; h: number }) {
  const px = Math.max(2, t.duration * pps);
  return (
    <div
      className={`tl-item text ${sel ? 'selected' : ''}`}
      style={{ left: pad + t.start * pps, width: px, top, height: h }}
      onClick={select('text', t.id)}
      {...itemA11y('text', t.id, `Texto: ${t.text}`, sel)}
      onPointerDown={sel ? (e) => drag(e, 'text', t.id, 'body') : undefined}
      onDoubleClick={panel('text')}
    >
      <Type size={12} /> <span className="tl-label">{t.text}</span>
      <Dur s={t.duration} px={px} />
      <KfMarks kf={t.keyframes} pps={pps} />
      {sel && <Handles kind="text" id={t.id} drag={drag} />}
    </div>
  );
}, skipWindow);

export const StickerRow = memo(function StickerRow({ stickers, assets, pps, pad, rowH, selId, win, drag }: RowBase & { stickers: StickerItem[]; assets: Assets }) {
  const ln = useMemo(() => lanes(stickers.map((t) => ({ id: t.id, start: t.start, end: t.start + t.duration }))), [stickers]);
  return (
    <div className="tl-row" style={{ height: Math.max(1, ln.count) * rowH }}>
      {stickers.length === 0 && (
        <Ghost pad={pad} onClick={panel('stickers')}>
          <Smile size={14} /> Agregar sticker
        </Ghost>
      )}
      {stickers.map((st) => {
        const sel = st.id === selId;
        if (!sel && !inWindow(win, st.start, st.start + st.duration)) return null;
        const thumb = st.assetId ? assets[st.assetId]?.thumb : undefined;
        return <StickerView key={st.id} st={st} thumb={thumb} top={(ln.map[st.id] ?? 0) * rowH} h={rowH - 4} pps={pps} pad={pad} sel={sel} from={win.from} to={win.to} drag={drag} />;
      })}
    </div>
  );
});

const StickerView = memo(function StickerView({ st, thumb, top, h, pps, pad, sel, drag }: ItemBase & { st: StickerItem; thumb?: string; top: number; h: number }) {
  const px = Math.max(2, st.duration * pps);
  return (
    <div
      className={`tl-item sticker ${sel ? 'selected' : ''}`}
      style={{ left: pad + st.start * pps, width: px, top, height: h }}
      onClick={select('sticker', st.id)}
      {...itemA11y('sticker', st.id, 'Sticker', sel)}
      onPointerDown={sel ? (e) => drag(e, 'sticker', st.id, 'body') : undefined}
      onDoubleClick={panel('stickers')}
    >
      {thumb ? <img src={thumb} alt="" /> : <span className="tl-emoji">{st.emoji}</span>}
      <span className="tl-label">Sticker</span>
      <Dur s={st.duration} px={px} />
      <KfMarks kf={st.keyframes} pps={pps} />
      {sel && <Handles kind="sticker" id={st.id} drag={drag} />}
    </div>
  );
}, skipWindow);

/** Items that draw nothing per window (texts, stickers) ignore window changes. */
function skipWindow<P extends ItemBase>(a: P, b: P) {
  for (const k in a) if (k !== 'from' && k !== 'to' && a[k] !== b[k]) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Audio

export const AudioRow = memo(function AudioRow({ audios, assets, urls, pps, pad, rowH, selId, win, drag }: RowBase & { audios: AudioItem[]; assets: Assets; urls: Urls }) {
  const ln = useMemo(() => lanes(audios.map((a) => ({ id: a.id, start: a.start, end: a.start + audioDur(a) }))), [audios]);
  return (
    <div className="tl-row" style={{ height: Math.max(1, ln.count) * rowH }}>
      {audios.length === 0 && (
        <Ghost pad={pad} onClick={panel('audio')}>
          <Music size={14} /> Agregar música
        </Ghost>
      )}
      {audios.map((a) => {
        const sel = a.id === selId;
        if (!sel && !inWindow(win, a.start, a.start + audioDur(a))) return null;
        return (
          <AudioView key={a.id} au={a} asset={assets[a.assetId]} url={urls[a.assetId]} top={(ln.map[a.id] ?? 0) * rowH} h={rowH - 4} pps={pps} pad={pad} sel={sel} from={win.from} to={win.to} drag={drag} />
        );
      })}
    </div>
  );
});

const AudioView = memo(function AudioView({ au, asset, url, top, h, pps, pad, sel, from, to, drag }: ItemBase & { au: AudioItem; asset?: Asset; url?: string; top: number; h: number }) {
  const d = audioDur(au);
  const px = Math.max(2, d * pps);
  const levels = useLevels(au.assetId, url);
  const p = part({ from, to }, au.start, d);
  const name = asset?.name ?? 'Audio';
  return (
    <div
      className={`tl-item audio ${levels ? 'waved' : ''} ${sel ? 'selected' : ''}`}
      style={{ left: pad + au.start * pps, width: px, top, height: h }}
      onClick={select('audio', au.id)}
      {...itemA11y('audio', au.id, `Audio: ${asset?.name ?? 'sin nombre'}`, sel)}
      onPointerDown={sel ? (e) => drag(e, 'audio', au.id, 'body') : undefined}
    >
      {levels && p && <Waveform levels={levels} src0={au.in} speed={1} pps={pps} a={p.a} b={p.b} height={h - EDGE} align="mid" />}
      <Music size={12} /> <span className="tl-label">{name}</span>
      <Dur s={d} px={px} />
      {sel && <Handles kind="audio" id={au.id} drag={drag} />}
    </div>
  );
});
