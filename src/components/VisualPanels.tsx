import { useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, Ban, Blend, FileUp, FlipHorizontal2, FlipVertical2, HeartPulse,
  ImageUp, Keyboard, Minimize2, RotateCw, Sparkle, Trash2, type LucideIcon,
} from 'lucide-react';
import type { Clip, Direction, EffectId, StickerItem, TextAnim, TextItem, Transition, TransitionId } from '../types';
import { useStore } from '../store';
import { engine } from '../engine';
import { clipDur, layout } from '../model';
import { importFiles } from '../media';
import { STICKER_GROUPS, stickerUrl } from '../stickers';
import { addImageStickers, addSticker, editPose, poseNow } from '../ops';
import {
  DIRECTIONS, EFFECTS, EFFECT_DEFAULT_INTENSITY, NO_ANIM, TEXT_IN, TEXT_LOOP, TEXT_OUT, TRANSITIONS, TRANSITION_DEFAULT,
  TRANSITION_MAX, TRANSITION_MIN, transitionLength,
} from '../visuals';
import { cropEdges, cropForAspect, normCrop, setCropEdge } from '../framing';
import { deleteLut, importLuts } from '../visualOps';
import { EFFECT_ICONS, TRANSITION_ICONS } from './fxIcons';
import { EffectThumb, LutThumb, TransitionThumb, useFrame } from './FxPreview';
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

const DIR_ICONS: Record<Direction, LucideIcon> = { left: ArrowLeft, right: ArrowRight, up: ArrowUp, down: ArrowDown };
const DIR_SHORT: Record<Direction, string> = { left: 'Izquierda', right: 'Derecha', up: 'Arriba', down: 'Abajo' };

export function TransitionPanel() {
  const clip = useSelected<Clip>('clip');
  const project = useStore((s) => s.project!);
  const placed = layout(project);
  const i = clip ? placed.findIndex((l) => l.clip.id === clip.id) : -1;
  const next = i >= 0 ? placed[i + 1] : undefined;
  const frameA = useFrame(clip ? project.assets[clip.assetId]?.thumb : undefined, '#5b4bd6', 'A');
  const frameB = useFrame(next ? project.assets[next.clip.assetId]?.thumb : undefined, '#e0457b', 'B');
  if (!clip) return <Hint>Toca el botón <b>⇄</b> que aparece entre dos clips en la línea de tiempo.</Hint>;
  if (!next) return <Hint>Este es el último clip: las transiciones van entre dos clips. Toca el botón <b>⇄</b> entre dos clips.</Hint>;
  const type = clip.transition?.type ?? 'none';
  const duration = clip.transition?.duration ?? TRANSITION_DEFAULT;
  const dir = clip.transition?.dir ?? 'left';

  const show = (c: Clip) => {
    const d = transitionLength(c, next.clip);
    const cut = placed[i]!.end; // `next` exists, so the clip is placed
    previewRange(cut - d / 2 - 0.6, cut + d / 2 + 0.6);
  };
  const set = (tr: Transition) => {
    checkpoint();
    editSelected((c) => void (c.transition = tr));
    if (tr.type !== 'none') show({ ...clip, transition: tr });
  };
  const withDir = (id: TransitionId, d: Direction): Transition => ({ type: id, duration, ...(id === 'push' ? { dir: d } : {}) });
  const tooShort = Math.min(clipDur(clip), clipDur(next.clip)) < duration && type !== 'none';

  return (
    <>
      <Hint>Entre el clip {i + 1} y el clip {i + 2}. Elige cómo pasar de uno a otro:</Hint>
      <div className="fx-grid">
        {TRANSITIONS.map((tr) => {
          const Icon = TRANSITION_ICONS[tr.id];
          return (
            <button key={tr.id} className={`fx ${type === tr.id ? 'active' : ''}`} onClick={() => set(withDir(tr.id, dir))}>
              <div>
                <TransitionThumb type={tr.id} dir={dir} a={frameA} b={frameB} />
              </div>
              <span className="fx-name"><Icon size={14} /> {tr.name}</span>
            </button>
          );
        })}
      </div>
      {type === 'push' && (
        <>
          <p className="label">Dirección</p>
          <div className="chips">
            {DIRECTIONS.map((d) => {
              const Icon = DIR_ICONS[d.id];
              return (
                <button key={d.id} className={`chip ${dir === d.id ? 'active' : ''}`} onClick={() => set(withDir('push', d.id))} title={d.name}>
                  <Icon size={16} /> {DIR_SHORT[d.id]}
                </button>
              );
            })}
          </div>
        </>
      )}
      {type !== 'none' && (
        <>
          <Slider
            label="Duración"
            value={duration}
            min={TRANSITION_MIN}
            max={TRANSITION_MAX}
            step={0.1}
            format={(v) => `${v.toFixed(1)} s`}
            onChange={(v) => editSelected((c) => void (c.transition = { ...withDir(type, dir), duration: v }))}
          />
          {tooShort && <Hint>Uno de los clips es más corto: la transición se acorta para que quepa.</Hint>}
          <div className="row">
            <button className="btn-ghost" onClick={() => show(clip)}>Ver otra vez</button>
            <button
              className="btn-ghost"
              onClick={() => {
                const s = useStore.getState();
                s.commit((p) => p.clips.forEach((c, k) => { if (k < p.clips.length - 1) c.transition = withDir(type, dir); }));
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

export function EffectsPanel() {
  const clip = useSelected<Clip>('clip');
  const project = useStore((s) => s.project!);
  const pic = useFrame(clip ? project.assets[clip.assetId]?.thumb : undefined, '#4b7bd0', '');
  if (!clip) return <NeedsSelection what="un video o una foto" />;
  const id = clip.effect?.id ?? 'none';
  const intensity = clip.effect?.intensity ?? EFFECT_DEFAULT_INTENSITY;
  const placed = layout(project).find((l) => l.clip.id === clip.id);
  const fixed = EFFECTS.find((e) => e.id === id)?.fixed;

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
              <div>
                <EffectThumb id={e.id} intensity={id === e.id ? intensity : EFFECT_DEFAULT_INTENSITY} pic={pic} />
              </div>
              <span className="fx-name"><Icon size={14} /> {e.name}</span>
            </button>
          );
        })}
      </div>
      {id !== 'none' && !fixed && (
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

// ---------- imported LUTs (inside the Filters panel) ----------

export function LutSection({ clip }: { clip: Clip }) {
  const project = useStore((s) => s.project!);
  const pic = useFrame(project.assets[clip.assetId]?.thumb, '#4b7bd0', '');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const luts = Object.values(project.luts ?? {});
  const current = clip.lut && project.luts?.[clip.lut.id] ? clip.lut : undefined;
  const amount = current?.amount ?? 1;
  const choose = (id: string | undefined) => {
    checkpoint();
    editSelected((c) => {
      if (id) c.lut = { id, amount: c.lut?.amount ?? 1 };
      else delete c.lut;
    });
  };

  return (
    <>
      <p className="label">Estilo de color importado (LUT)</p>
      {luts.length > 0 && (
        <div className="filter-grid">
          <button className={`filter ${!current ? 'active' : ''}`} onClick={() => choose(undefined)}>
            <div className="filter-thumb"><LutThumb pic={pic} /></div>
            <span>Sin LUT</span>
          </button>
          {luts.map((l) => (
            <button key={l.id} className={`filter ${current?.id === l.id ? 'active' : ''}`} onClick={() => choose(l.id)} title={l.name}>
              <div className="filter-thumb"><LutThumb lut={l} pic={pic} /></div>
              <span className="lut-name">{l.name}</span>
            </button>
          ))}
        </div>
      )}
      {current && (
        <Slider
          label="Intensidad del LUT"
          value={amount}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(v) => editSelected((c) => void (c.lut = { id: current.id, amount: v }))}
        />
      )}
      <button className="dropzone" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <span className="spinner" /> : <FileUp size={22} />}
        <span>{busy ? 'Leyendo…' : 'Importar LUT (.cube)'}</span>
        <small>Un archivo .cube trae un estilo de color hecho en otro editor. Se guarda en este proyecto.</small>
      </button>
      <input
        ref={input}
        type="file"
        // Android/iOS pickers don't know the .cube type and grey the files out; the extension is checked below.
        accept=".cube,application/octet-stream,text/plain"
        multiple
        hidden
        onChange={(e) => {
          const all = Array.from(e.target.files ?? []);
          e.target.value = '';
          const files = all.filter((f) => /\.cube$/i.test(f.name));
          if (all.length && !files.length) useStore.getState().notify('Elige un archivo .cube');
          if (!files.length) return;
          setBusy(true);
          importLuts(files)
            .then((id) => {
              if (!id) return;
              choose(id);
              useStore.getState().notify('LUT importado y aplicado a este clip');
            })
            .finally(() => setBusy(false));
        }}
      />
      {current && (
        <div className="row">
          <button
            className="btn-ghost"
            onClick={() => {
              const s = useStore.getState();
              s.commit((p) => p.clips.forEach((c) => (c.lut = { ...current })));
              s.notify('LUT aplicado a todos los clips');
            }}
          >
            Usar este LUT en todos los clips
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              deleteLut(current.id);
              useStore.getState().notify('LUT quitado del proyecto');
            }}
          >
            <Trash2 size={16} /> Quitar del proyecto
          </button>
        </div>
      )}
    </>
  );
}

// ---------- crop and flip ----------

const CROP_PRESETS: { label: string; ratio?: number }[] = [
  { label: 'Original' },
  { label: 'Vertical 9:16', ratio: 9 / 16 },
  { label: 'Cuadrado 1:1', ratio: 1 },
  { label: 'Retrato 4:5', ratio: 4 / 5 },
  { label: 'Horizontal 16:9', ratio: 16 / 9 },
];
const EDGES: { key: keyof ReturnType<typeof cropEdges>; label: string }[] = [
  { key: 'left', label: 'Recortar izquierda' },
  { key: 'right', label: 'Recortar derecha' },
  { key: 'top', label: 'Recortar arriba' },
  { key: 'bottom', label: 'Recortar abajo' },
];

export function CropPanel() {
  const clip = useSelected<Clip>('clip');
  const asset = useStore((s) => (clip ? s.project!.assets[clip.assetId] : undefined));
  if (!clip || !asset) return <NeedsSelection what="un video o una foto" />;
  const edges = cropEdges(clip.crop);
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const toggle = (key: 'flipH' | 'flipV') => {
    checkpoint();
    editSelected((c) => {
      if (c[key]) delete c[key];
      else c[key] = true;
    });
  };
  const preset = (ratio?: number) => {
    checkpoint();
    editSelected((c) => {
      const crop = ratio && asset.width && asset.height ? cropForAspect(ratio, asset.width, asset.height) : undefined;
      if (crop) c.crop = crop;
      else delete c.crop;
    });
  };
  const sameRatio = (r?: number) => {
    const n = normCrop(clip.crop);
    if (!r) return !n;
    if (!n || !asset.width || !asset.height) return false;
    return Math.abs((n.w * asset.width) / (n.h * asset.height) - r) / r < 0.01;
  };

  return (
    <>
      <p className="label">Voltear</p>
      <div className="chips">
        <button className={`chip ${clip.flipH ? 'active' : ''}`} onClick={() => toggle('flipH')}>
          <FlipHorizontal2 size={16} /> Como espejo
        </button>
        <button className={`chip ${clip.flipV ? 'active' : ''}`} onClick={() => toggle('flipV')}>
          <FlipVertical2 size={16} /> De cabeza
        </button>
      </div>
      <p className="label">Recortar</p>
      <div className="chips">
        {CROP_PRESETS.map((p) => (
          <button key={p.label} className={`chip ${sameRatio(p.ratio) ? 'active' : ''}`} onClick={() => preset(p.ratio)}>
            {p.label}
          </button>
        ))}
      </div>
      {EDGES.map((e) => (
        <Slider
          key={e.key}
          label={e.label}
          value={edges[e.key]}
          min={0}
          max={0.9}
          step={0.01}
          format={pct}
          onChange={(v) => editSelected((c) => {
            const crop = setCropEdge(c.crop, e.key, v);
            if (crop) c.crop = crop;
            else delete c.crop;
          })}
        />
      ))}
      <Hint>El recorte elige qué parte del video se ve. Con “Rellenar” la parte elegida ocupa toda la pantalla.</Hint>
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
              {Icon && <Icon size={16} />} {o.name}
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
  useStore((s) => (s.playing ? -1 : s.time)); // size and turn follow keyframes at the playhead (not re-rendered while playing)
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
