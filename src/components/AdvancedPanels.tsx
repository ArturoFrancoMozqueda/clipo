// Panels of the advanced mode: overlays (picture-in-picture), color correction and keyframes.
// Beginners never see them unless they turn the advanced mode on in "Ayuda".
import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Diamond, Film, Image as ImageIcon, Layers, RotateCcw, Upload, Wand2 } from 'lucide-react';
import type { BlendMode, Clip, ColorAdjust, OverlayItem, SelectionKind, StickerItem, TextItem } from '../types';
import { itemsOf, useStore } from '../store';
import { engine } from '../engine';
import { clamp, layout, overlayDur } from '../model';
import { ACCEPT_VISUAL, importFiles } from '../media';
import { addOverlays, editPose, localTime, poseNow } from '../ops';
import { COLOR_KEYS, COLOR_LABELS, autoColor, type ColorKey } from '../color';
import { EASINGS, KF_EPS, addKeyframe, clearKeyframes, keyframeAt, removeKeyframe } from '../keyframes';
import { Hint, NeedsSelection, Slider, checkpoint, editSelected, usePoseTime, useSelected } from './Panels';

const deg = (r: number) => Math.round((r * 180) / Math.PI);
const pct = (v: number) => `${Math.round(v * 100)} %`;

// ---------- advanced mode switch ----------

export function AdvancedToggle() {
  const on = useStore((s) => s.advanced);
  return (
    <label className="adv-toggle">
      <input type="checkbox" checked={on} onChange={(e) => useStore.getState().setAdvanced(e.target.checked)} />
      <span className="adv-switch" aria-hidden />
      <span>
        <b>Modo avanzado</b>
        <small>Superposiciones (video sobre video), fotogramas clave y corrección de color. Se recuerda en este dispositivo.</small>
      </span>
    </label>
  );
}

// ---------- overlays ----------

const BLENDS: { id: BlendMode; name: string }[] = [
  { id: 'normal', name: 'Normal' },
  { id: 'screen', name: 'Aclarar' },
  { id: 'multiply', name: 'Multiplicar' },
  { id: 'overlay', name: 'Superponer' },
  { id: 'soft-light', name: 'Luz suave' },
  { id: 'lighten', name: 'Más claro' },
  { id: 'darken', name: 'Más oscuro' },
  { id: 'difference', name: 'Diferencia' },
];

export function OverlayPanel() {
  const ov = useSelected<OverlayItem>('overlay');
  // The pose depends on the playhead when there are keyframes; skip the 60fps re-renders while playing.
  usePoseTime(ov);
  if (!ov) return <OverlayPicker />;
  const kind = useStore.getState().project!.assets[ov.assetId]?.kind;
  const pose = poseNow('overlay', ov.id);
  if (!pose) return null;
  const set = (patch: Parameters<typeof editPose>[2]) => editPose('overlay', ov.id, patch);
  return (
    <>
      <Slider label="Tamaño" value={pose.size} min={0.05} max={2} step={0.01} format={pct} onChange={(v) => set({ size: v })} />
      <Slider label="Giro" value={deg(pose.rotation)} min={-180} max={180} step={1} format={(v) => `${v}°`} onChange={(v) => set({ rotation: (v * Math.PI) / 180 })} />
      <Slider label="Opacidad" value={pose.opacity} min={0} max={1} step={0.01} format={pct} onChange={(v) => set({ opacity: v })} />
      <div className="chips">
        <button className="chip" onClick={() => { checkpoint(); set({ x: 0.5, y: 0.5, size: 1, rotation: 0 }); }}>Pantalla completa</button>
        <button className="chip" onClick={() => { checkpoint(); set({ x: 0.5, y: 0.5 }); }}>Centrar</button>
        <button className="chip" onClick={() => { checkpoint(); set({ x: 0.75, y: 0.22, size: 0.42, rotation: 0 }); }}>Esquina</button>
      </div>
      <p className="label">Fusión</p>
      <div className="chips">
        {BLENDS.map((b) => (
          <button key={b.id} className={`chip ${ov.blend === b.id ? 'active' : ''}`} onClick={() => { checkpoint(); editSelected((o) => void ((o as unknown as OverlayItem).blend = b.id)); }}>
            {b.name}
          </button>
        ))}
      </div>
      {kind === 'video' && (
        <Slider label="Volumen" value={ov.volume} min={0} max={2} step={0.05} format={pct} onChange={(v) => editSelected((o) => void (o.volume = v))} />
      )}
      <div className="row">
        <button className="btn-ghost" onClick={() => useStore.getState().setPanel('color')}>Color</button>
        <button className="btn-ghost" onClick={() => useStore.getState().setPanel('keyframes')}><Diamond size={16} /> Animar</button>
      </div>
      <Hint>Arrastra la superposición sobre el video para moverla. Usa el círculo de la esquina (o dos dedos) para girarla y cambiar su tamaño. “Fusión” mezcla sus colores con el video de abajo (por ejemplo “Aclarar” quita un fondo negro).</Hint>
    </>
  );
}

/** Choose what to put on the overlay track: a new file or one already in the project. */
function OverlayPicker() {
  const assetsMap = useStore((s) => s.project!.assets);
  const assets = Object.values(assetsMap).filter((a) => !a.sticker && a.kind !== 'audio');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const done = () => useStore.getState().notify('Superposición agregada: arrástrala sobre el video');
  return (
    <div className="library">
      <Hint>Pon un video o una foto <b>encima</b> del video principal, en un recuadro (como un video de reacción). Se coloca donde está la línea blanca.</Hint>
      <button className="dropzone" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <span className="spinner" /> : <Upload size={22} />}
        <span>{busy ? 'Cargando…' : 'Elegir del dispositivo'}</span>
        <small>Videos o fotos</small>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_VISUAL}
        multiple
        hidden
        onChange={async (e) => {
          const files = e.target.files;
          if (!files?.length) return;
          setBusy(true);
          try {
            const { ok, failed } = await importFiles(files);
            addOverlays(ok);
            if (failed.length) useStore.getState().notify(`No se pudo abrir: ${failed.join(', ')}`);
            else if (ok.length) done();
          } finally {
            setBusy(false);
            e.target.value = '';
          }
        }}
      />
      {assets.length > 0 && (
        <>
          <p className="muted small">O toca uno de tus archivos:</p>
          <div className="asset-grid">
            {assets.map((a) => {
              const Icon = a.kind === 'image' ? ImageIcon : Film;
              return (
                <button key={a.id} className="asset" title={a.name} onClick={() => { addOverlays([a]); done(); }}>
                  <div className="asset-thumb">
                    {a.thumb ? <img src={a.thumb} alt="" /> : <Icon size={26} />}
                    <span className="asset-plus"><Layers size={16} /></span>
                  </div>
                  <span className="asset-name">{a.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- color ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ColorPanel() {
  const clip = useSelected<Clip>('clip');
  const ov = useSelected<OverlayItem>('overlay');
  const item = clip ?? ov;
  const [busy, setBusy] = useState(false);
  if (!item) return <NeedsSelection what="un video, una foto o una superposición" />;
  const kind: SelectionKind = clip ? 'clip' : 'overlay';
  const color = item.color ?? {};
  const setColor = (fn: (c: ColorAdjust) => ColorAdjust) =>
    editSelected((x) => {
      const next = fn({ ...(x.color ?? {}) });
      for (const k of COLOR_KEYS) if (!next[k]) delete next[k];
      if (Object.keys(next).length) x.color = next;
      else delete x.color;
    });

  const auto = async () => {
    setBusy(true);
    try {
      // Look at the clip itself: move the playhead into it first if needed.
      const s = useStore.getState();
      const p = s.project!;
      const range = kind === 'clip' ? layout(p).find((l) => l.clip.id === item.id) : null;
      const [from, to] = range ? [range.start, range.end] : [(item as OverlayItem).start, (item as OverlayItem).start + overlayDur(item as OverlayItem)];
      if (s.time < from || s.time >= to) {
        engine.seek(from + Math.min(0.5, (to - from) / 2));
        await sleep(450);
      }
      const px = engine.samplePixels(item);
      if (!px) return useStore.getState().notify('Espera a que cargue la imagen y vuelve a intentarlo');
      const a = autoColor(px);
      checkpoint();
      setColor(() => ({ ...a, vignette: color.vignette }));
      useStore.getState().notify('Color ajustado automáticamente');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row">
        <button className="btn-primary" disabled={busy} onClick={auto}>
          {busy ? <span className="spinner" /> : <Wand2 size={18} />} Auto
        </button>
        <button className="btn-ghost" onClick={() => { checkpoint(); setColor(() => ({})); }}>
          <RotateCcw size={16} /> Restablecer
        </button>
      </div>
      {COLOR_KEYS.map((k: ColorKey) => (
        <Slider
          key={k}
          label={COLOR_LABELS[k]}
          value={Math.round((color[k] ?? 0) * 100)}
          min={-100}
          max={100}
          step={1}
          format={(v) => (v > 0 ? `+${v}` : `${v}`)}
          onChange={(v) => setColor((c) => ({ ...c, [k]: v / 100 }))}
        />
      ))}
      {clip && (
        <button
          className="btn-ghost"
          onClick={() => {
            const s = useStore.getState();
            s.commit((p) => p.clips.forEach((c) => (item.color ? (c.color = { ...item.color }) : delete c.color)));
            s.notify('Color aplicado a todos los clips');
          }}
        >
          Aplicar a todos los clips
        </button>
      )}
      <Hint>“Auto” mira el fotograma actual y corrige el balance de blancos, la exposición y el contraste. “Luces” y “Sombras” son aproximados.</Hint>
    </>
  );
}

// ---------- keyframes ----------

type Animated = (OverlayItem | StickerItem | TextItem) & { start: number };
const ANIMATED: SelectionKind[] = ['overlay', 'sticker', 'text'];

/** The selected overlay, sticker or text, with its local time at the playhead. */
export function useAnimated() {
  const kind = useStore((s) => s.selection?.kind);
  const item = useStore((s) => {
    const sel = s.selection;
    if (!sel || !ANIMATED.includes(sel.kind)) return undefined;
    return (itemsOf(s.project!, sel.kind) as Animated[]).find((x) => x.id === sel.id);
  });
  // While playing, ~10 updates per second are enough for the keyframe button state.
  const time = useStore((s) => (s.playing ? Math.round(s.time * 10) / 10 : s.time));
  if (!item || !kind) return null;
  const p = useStore.getState().project!;
  return { kind, item, local: localTime(p, kind, item, time), inside: time >= item.start - 1e-6 && time - item.start <= localTime(p, kind, item, Infinity) + 1e-3 };
}

/**
 * Look of the timeline's keyframe button: hidden (null), playhead outside the item ('out'), inside it
 * ('in') or on a keyframe ('on'). A string, so the button re-renders only when it changes, not per frame.
 */
export function keyframeButtonState(s: ReturnType<typeof useStore.getState>): 'on' | 'in' | 'out' | null {
  const sel = s.selection;
  if (!s.advanced || !s.project || !sel || !ANIMATED.includes(sel.kind)) return null;
  const it = (itemsOf(s.project, sel.kind) as Animated[]).find((x) => x.id === sel.id);
  if (!it) return null;
  const t = s.time;
  const inside = t >= it.start - 1e-6 && t - it.start <= localTime(s.project, sel.kind, it, Infinity) + 1e-3;
  if (!inside) return 'out';
  return keyframeAt(it, localTime(s.project, sel.kind, it, t)) >= 0 ? 'on' : 'in';
}

/** Add the keyframe at the playhead, or remove it if there already is one. */
export function toggleKeyframe() {
  const s = useStore.getState();
  const sel = s.selection;
  if (!s.project || !sel || !ANIMATED.includes(sel.kind)) return;
  engine.pause();
  const it = (itemsOf(s.project, sel.kind) as Animated[]).find((x) => x.id === sel.id);
  if (!it) return;
  const end = it.start + localTime(s.project, sel.kind, it, Infinity);
  if (s.time < it.start - 1e-6 || s.time > end + 1e-3) return s.notify('Mueve la línea blanca dentro del elemento para agregar un fotograma clave');
  const local = localTime(s.project, sel.kind, it);
  const had = keyframeAt(it, local) >= 0;
  s.commit((p) => {
    const x = (itemsOf(p, sel.kind) as Animated[]).find((y) => y.id === sel.id);
    if (!x) return;
    if (had) removeKeyframe(x, local);
    else addKeyframe(x, local);
  });
  const n = ((itemsOf(useStore.getState().project!, sel.kind) as Animated[]).find((x) => x.id === sel.id)?.keyframes ?? []).length;
  s.notify(had ? 'Fotograma clave quitado' : n === 1 ? 'Fotograma clave agregado. Mueve la línea blanca y cambia la posición: se crea otro solo' : 'Fotograma clave agregado');
}

export function KeyframesPanel() {
  const a = useAnimated();
  if (!a) return <NeedsSelection what="una superposición, un sticker o un texto" />;
  const { kind, item, local } = a;
  const kfs = item.keyframes ?? [];
  const idx = keyframeAt(item, local);
  const pose = poseNow(kind, item.id)!;
  const set = (patch: Parameters<typeof editPose>[2]) => editPose(kind, item.id, patch);
  const sizeMax = kind === 'overlay' ? 2 : kind === 'sticker' ? 1.5 : 0.2;
  const sizeMin = kind === 'text' ? 0.02 : 0.04;
  const jump = (dir: -1 | 1) => {
    const list = dir > 0 ? kfs.filter((k) => k.t > local + KF_EPS) : kfs.filter((k) => k.t < local - KF_EPS).reverse();
    if (list[0]) engine.seek(item.start + list[0].t);
  };
  return (
    <>
      <div className="row kf-row">
        <button className="icon-btn" onClick={() => jump(-1)} aria-label="Fotograma clave anterior" title="Anterior"><ChevronLeft size={20} /></button>
        <button className={`btn-primary kf-toggle ${idx >= 0 ? 'on' : ''}`} onClick={toggleKeyframe}>
          <Diamond size={18} fill={idx >= 0 ? 'currentColor' : 'none'} /> {idx >= 0 ? 'Quitar fotograma clave' : 'Agregar fotograma clave'}
        </button>
        <button className="icon-btn" onClick={() => jump(1)} aria-label="Fotograma clave siguiente" title="Siguiente"><ChevronRight size={20} /></button>
      </div>
      <Hint>
        {kfs.length === 0
          ? 'Agrega un fotograma clave, mueve la línea blanca y cambia la posición, el tamaño, el giro o la opacidad: Clipo crea el movimiento entre ellos.'
          : `${kfs.length} fotograma${kfs.length === 1 ? '' : 's'} clave. Los cambios en este momento se guardan en un fotograma clave.`}
      </Hint>
      <Slider label="Posición horizontal" value={Math.round(pose.x * 100)} min={-20} max={120} step={1} format={(v) => `${v}`} onChange={(v) => set({ x: v / 100 })} />
      <Slider label="Posición vertical" value={Math.round(pose.y * 100)} min={-20} max={120} step={1} format={(v) => `${v}`} onChange={(v) => set({ y: v / 100 })} />
      <Slider label="Tamaño" value={pose.size} min={sizeMin} max={sizeMax} step={sizeMax / 200} format={(v) => `${Math.round((v / sizeMax) * 100)}`} onChange={(v) => set({ size: clamp(v, sizeMin, sizeMax) })} />
      <Slider label="Giro" value={deg(pose.rotation)} min={-360} max={360} step={1} format={(v) => `${v}°`} onChange={(v) => set({ rotation: (v * Math.PI) / 180 })} />
      <Slider label="Opacidad" value={pose.opacity} min={0} max={1} step={0.01} format={pct} onChange={(v) => set({ opacity: v })} />
      {idx >= 0 && idx < kfs.length - 1 && (
        <>
          <p className="label">Movimiento hasta el siguiente</p>
          <div className="chips">
            {EASINGS.map((e) => (
              <button
                key={e.id}
                className={`chip ${kfs[idx]!.ease === e.id ? 'active' : ''}`}
                onClick={() => {
                  checkpoint();
                  editSelected((x) => {
                    const k = x.keyframes?.[idx];
                    if (k) k.ease = e.id;
                  });
                }}
              >
                {e.name}
              </button>
            ))}
          </div>
        </>
      )}
      {kfs.length > 0 && (
        <button
          className="btn-ghost"
          onClick={() => {
            const s = useStore.getState();
            s.commit((p) => {
              const x = (itemsOf(p, kind) as Animated[]).find((y) => y.id === item.id);
              if (x) clearKeyframes(x, local);
            });
            s.notify('Animación quitada');
          }}
        >
          Quitar toda la animación
        </button>
      )}
    </>
  );
}
