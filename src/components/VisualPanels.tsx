import { useRef, useState } from 'react';
import {
  ArrowUp, ArrowUpDown, Aperture, Ban, Blend, Columns2, Droplets, HeartPulse, ImageUp, Keyboard, Minimize2,
  MoveLeft, RotateCw, Sparkle, Vibrate, Zap, ZoomIn, type LucideIcon,
} from 'lucide-react';
import type { Clip, EffectId, StickerItem, TextAnim, TextItem, TransitionId } from '../types';
import { useStore } from '../store';
import { engine } from '../engine';
import { clipDur, layout } from '../model';
import { importFiles } from '../media';
import { STICKER_GROUPS, stickerUrl } from '../stickers';
import { addImageStickers, addSticker, editPose, poseNow } from '../ops';
import {
  EFFECTS, EFFECT_DEFAULT_INTENSITY, NO_ANIM, TEXT_IN, TEXT_LOOP, TEXT_OUT, TRANSITIONS, TRANSITION_DEFAULT,
  TRANSITION_MAX, TRANSITION_MIN, transitionLength,
} from '../visuals';
import { Hint, NeedsSelection, Slider, checkpoint, editSelected, useSelected } from './Panels';

/** Play a short stretch of the video so the user sees what they just picked. */
let previewTimer = 0;
function previewRange(from: number, to: number) {
  clearTimeout(previewTimer);
  engine.seek(Math.max(0, from));
  engine.play();
  previewTimer = window.setTimeout(() => engine.pause(), Math.max(300, (to - Math.max(0, from)) * 1000));
}

// ---------- transitions ----------

const TRANSITION_ICONS: Record<TransitionId, LucideIcon> = { none: Ban, fade: Blend, slide: MoveLeft, zoom: ZoomIn, wipe: Columns2 };

export function TransitionPanel() {
  const clip = useSelected<Clip>('clip');
  const project = useStore((s) => s.project!);
  if (!clip) return <Hint>Toca el botón <b>⇄</b> que aparece entre dos clips en la línea de tiempo.</Hint>;
  const placed = layout(project);
  const i = placed.findIndex((l) => l.clip.id === clip.id);
  const next = placed[i + 1];
  if (!next) return <Hint>Este es el último clip: las transiciones van entre dos clips. Toca el botón <b>⇄</b> entre dos clips.</Hint>;
  const type = clip.transition?.type ?? 'none';
  const duration = clip.transition?.duration ?? TRANSITION_DEFAULT;
  const thumbA = project.assets[clip.assetId]?.thumb;
  const thumbB = project.assets[next.clip.assetId]?.thumb;

  const show = (c: Clip) => {
    const d = transitionLength(c, next.clip);
    const cut = placed[i].end;
    previewRange(cut - d / 2 - 0.6, cut + d / 2 + 0.6);
  };
  const pick = (id: TransitionId) => {
    checkpoint();
    editSelected((c) => void (c.transition = { type: id, duration }));
    if (id !== 'none') show({ ...clip, transition: { type: id, duration } });
  };
  const tooShort = Math.min(clipDur(clip), clipDur(next.clip)) < duration && type !== 'none';

  return (
    <>
      <Hint>Entre el clip {i + 1} y el clip {i + 2}. Elige cómo pasar de uno a otro:</Hint>
      <div className="fx-grid">
        {TRANSITIONS.map((tr) => {
          const Icon = TRANSITION_ICONS[tr.id];
          return (
            <button key={tr.id} className={`fx ${type === tr.id ? 'active' : ''}`} onClick={() => pick(tr.id)}>
              <div className={`tp tp-${tr.id}`}>
                <span className="tp-a" style={thumbA ? { backgroundImage: `url(${thumbA})` } : undefined}>{!thumbA && 'A'}</span>
                <span className="tp-b" style={thumbB ? { backgroundImage: `url(${thumbB})` } : undefined}>{!thumbB && 'B'}</span>
              </div>
              <span className="fx-name"><Icon size={14} /> {tr.name}</span>
            </button>
          );
        })}
      </div>
      {type !== 'none' && (
        <>
          <Slider
            label="Duración"
            value={duration}
            min={TRANSITION_MIN}
            max={TRANSITION_MAX}
            step={0.1}
            format={(v) => `${v.toFixed(1)} s`}
            onChange={(v) => editSelected((c) => void (c.transition = { type, duration: v }))}
          />
          {tooShort && <Hint>Uno de los clips es más corto: la transición se acorta para que quepa.</Hint>}
          <div className="row">
            <button className="btn-ghost" onClick={() => show(clip)}>Ver otra vez</button>
            <button
              className="btn-ghost"
              onClick={() => {
                const s = useStore.getState();
                s.commit((p) => p.clips.forEach((c, k) => { if (k < p.clips.length - 1) c.transition = { type, duration }; }));
                s.notify('Transición aplicada entre todos los clips');
              }}
            >
              Aplicar a todas las uniones
            </button>
          </div>
        </>
      )}
    </>
  );
}

// ---------- effects ----------

const EFFECT_ICONS: Record<EffectId, LucideIcon> = { none: Ban, kenburns: ZoomIn, shake: Vibrate, glitch: Zap, blur: Droplets, vignette: Aperture };

export function EffectsPanel() {
  const clip = useSelected<Clip>('clip');
  const project = useStore((s) => s.project!);
  if (!clip) return <NeedsSelection what="un video o una foto" />;
  const thumb = project.assets[clip.assetId]?.thumb;
  const id = clip.effect?.id ?? 'none';
  const intensity = clip.effect?.intensity ?? EFFECT_DEFAULT_INTENSITY;
  const placed = layout(project).find((l) => l.clip.id === clip.id);

  const pick = (e: EffectId) => {
    checkpoint();
    editSelected((c) => void (c.effect = { id: e, intensity }));
    if (e !== 'none' && placed) {
      const t = useStore.getState().time;
      const from = t >= placed.start && t < placed.end - 0.5 ? t : placed.start;
      previewRange(from, Math.min(placed.end, from + 2.5));
    }
  };

  return (
    <>
      <div className="fx-grid">
        {EFFECTS.map((e) => {
          const Icon = EFFECT_ICONS[e.id];
          return (
            <button key={e.id} className={`fx ${id === e.id ? 'active' : ''}`} onClick={() => pick(e.id)}>
              <div className={`ep ep-${e.id}`}>
                <span style={thumb ? { backgroundImage: `url(${thumb})` } : undefined} />
              </div>
              <span className="fx-name"><Icon size={14} /> {e.name}</span>
            </button>
          );
        })}
      </div>
      {id !== 'none' && (
        <Slider
          label="Intensidad"
          value={intensity}
          min={0.1}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(v) => editSelected((c) => void (c.effect = { id, intensity: v }))}
        />
      )}
      <button
        className="btn-ghost"
        onClick={() => {
          const s = useStore.getState();
          s.commit((p) => p.clips.forEach((c) => (c.effect = id === 'none' ? undefined : { id, intensity })));
          s.notify('Efecto aplicado a todos los clips');
        }}
      >
        Aplicar a todos los clips
      </button>
      <Hint>“Acercamiento” hace un zoom lento: las fotos lo traen activado para que no se vean quietas.</Hint>
    </>
  );
}

// ---------- text animations ----------

const IN_ICONS: Record<TextAnim['in'], LucideIcon> = { none: Ban, fade: Blend, pop: Sparkle, slideUp: ArrowUp, typewriter: Keyboard };
const OUT_ICONS: Record<TextAnim['out'], LucideIcon> = { none: Ban, fade: Blend, pop: Minimize2 };
const LOOP_ICONS: Record<TextAnim['loop'], LucideIcon> = { none: Ban, bounce: ArrowUpDown, pulse: HeartPulse };

export function TextAnimSection({ text }: { text: TextItem }) {
  const anim = text.anim ?? NO_ANIM;
  const set = <K extends keyof TextAnim>(key: K, value: TextAnim[K]) => {
    checkpoint();
    editSelected((t) => void (t.anim = { ...(t.anim ?? NO_ANIM), [key]: value }));
    if (value === 'none') return;
    const end = text.start + text.duration;
    if (key === 'in') previewRange(text.start, Math.min(end, text.start + 1.5));
    else if (key === 'out') previewRange(Math.max(text.start, end - 1.2), end);
    else previewRange(text.start, Math.min(end, text.start + 2.5));
  };
  const row = <K extends keyof TextAnim>(key: K, label: string, opts: { id: TextAnim[K]; name: string }[], icons: Record<string, LucideIcon>) => (
    <>
      <p className="label">{label}</p>
      <div className="chips">
        {opts.map((o) => {
          const Icon = icons[o.id];
          return (
            <button key={o.id} className={`chip ${anim[key] === o.id ? 'active' : ''}`} onClick={() => set(key, o.id)}>
              <Icon size={16} /> {o.name}
            </button>
          );
        })}
      </div>
    </>
  );
  return (
    <>
      {row('in', 'Animación al aparecer', TEXT_IN, IN_ICONS)}
      {row('out', 'Animación al desaparecer', TEXT_OUT, OUT_ICONS)}
      {row('loop', 'Movimiento continuo', TEXT_LOOP, LOOP_ICONS)}
    </>
  );
}

// ---------- stickers ----------

const deg = (r: number) => Math.round((r * 180) / Math.PI);

export function StickersPanel() {
  const sticker = useSelected<StickerItem>('sticker');
  useStore((s) => s.time); // size and turn follow keyframes at the playhead
  const pose = sticker ? poseNow('sticker', sticker.id) ?? sticker : null;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const importImages = async (files: FileList) => {
    setBusy(true);
    try {
      const { ok, failed } = await importFiles(Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)$/i.test(f.name)));
      const images = ok.filter((a) => a.kind === 'image');
      addImageStickers(images);
      const n = useStore.getState().notify;
      if (failed.length || images.length < files.length) n('Solo se pueden usar imágenes (PNG, JPG, WebP) como sticker');
      else if (images.length) n('Sticker agregado: arrástralo sobre el video');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {sticker && pose && (
        <div className="sticker-edit">
          <Slider label="Tamaño" value={pose.size} min={0.05} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => editPose('sticker', sticker.id, { size: v })} />
          <Slider
            label="Giro"
            value={deg(pose.rotation ?? 0)}
            min={-180}
            max={180}
            step={1}
            format={(v) => `${v}°`}
            onChange={(v) => editPose('sticker', sticker.id, { rotation: (v * Math.PI) / 180 })}
          />
          <Slider label="Se muestra durante" value={sticker.duration} min={0.5} max={30} step={0.5} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => editSelected((s) => void (s.duration = v))} />
          <div className="chips">
            <button className="chip" onClick={() => { checkpoint(); editPose('sticker', sticker.id, { rotation: 0 }); }}>

              <RotateCw size={16} /> Enderezar
            </button>
          </div>
          <Hint>Arrastra el sticker sobre el video para moverlo. Usa el círculo de la esquina (o dos dedos) para girarlo y cambiar su tamaño.</Hint>
        </div>
      )}
      <button className="dropzone" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <span className="spinner" /> : <ImageUp size={22} />}
        <span>{busy ? 'Cargando…' : 'Usar una imagen como sticker'}</span>
        <small>PNG con fondo transparente se ve mejor</small>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) importImages(e.target.files).finally(() => (e.target.value = ''));
        }}
      />
      <p className="muted small">{sticker ? 'Toca un emoji para agregar otro:' : 'Toca un emoji para ponerlo en tu video:'}</p>
      {STICKER_GROUPS.map((g) => (
        <div key={g.name}>
          <p className="label">{g.name}</p>
          <div className="emoji-grid">
            {g.list.map((e) => (
              <button key={e.file} className="emoji" onClick={() => addSticker({ emoji: e.glyph })} aria-label={`Agregar ${e.glyph}`} title={e.glyph}>
                <img src={stickerUrl(e)} alt="" loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="muted small">Stickers: Fluent Emoji de Microsoft (licencia MIT).</p>
    </>
  );
}
