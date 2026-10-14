import { useEffect, useRef, useState } from 'react';
import { Droplets, ImageUp, Palette, RefreshCw, TriangleAlert, UserRound } from 'lucide-react';
import type { BgMode, BgRemoval, Clip } from '../types';
import { useStore } from '../store';
import { importFiles } from '../media';
import { BG_COLORS, BG_DEFAULT, BG_LOAD_ERROR, loadSegmenter, useSegStatus } from '../segmentation';
import { Hint, NeedsSelection, Slider, checkpoint, editSelected, useSelected } from './Panels';
import './background.css';

const MODES: { id: BgMode; name: string; icon: typeof Palette }[] = [
  { id: 'color', name: 'Color', icon: Palette },
  { id: 'blur', name: 'Difuminar', icon: Droplets },
  { id: 'media', name: 'Foto o video', icon: ImageUp },
];

/** One undoable step that changes (or creates) the selected clip's background settings. */
const setBg = (fn: (b: BgRemoval) => void) => {
  checkpoint();
  editSelected((c) => {
    const b = c.bgRemoval ?? { ...BG_DEFAULT };
    fn(b);
    c.bgRemoval = b;
  });
};

/** "Quitar fondo": cut the person out of a video or photo and put something else behind. */
export function BackgroundPanel() {
  const clip = useSelected<Clip>('clip');
  const status = useSegStatus();
  const assets = useStore((s) => s.project!.assets);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const on = !!clip?.bgRemoval;

  // Start loading the model as soon as it is needed.
  useEffect(() => {
    if (on && status === 'idle') loadSegmenter().catch(() => {});
  }, [on, status]);

  if (!clip) return <NeedsSelection what="un video o una foto" />;
  const bg = clip.bgRemoval;
  const bgAsset = bg?.assetId ? assets[bg.assetId] : undefined;

  const pickMedia = async (files: FileList) => {
    setBusy(true);
    try {
      const { ok } = await importFiles(files);
      const a = ok.find((x) => x.kind === 'image' || x.kind === 'video');
      if (!a) {
        useStore.getState().notify('Elige una foto o un video para el fondo');
        return;
      }
      const s = useStore.getState();
      s.commit((p) => {
        p.assets[a.id] = a;
        const c = p.clips.find((x) => x.id === clip.id);
        if (c) c.bgRemoval = { ...(c.bgRemoval ?? BG_DEFAULT), mode: 'media', assetId: a.id };
      });
      s.notify('Fondo cambiado');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row">
        <button
          className={`chip big ${on ? 'active' : ''}`}
          onClick={() => {
            const s = useStore.getState();
            s.commit((p) => {
              const c = p.clips.find((x) => x.id === clip.id);
              if (c) c.bgRemoval = on ? undefined : { ...BG_DEFAULT };
            });
            s.notify(on ? 'Fondo original restaurado' : 'Quitando el fondo…');
          }}
        >
          <span><UserRound size={16} /> {on ? 'Fondo quitado' : 'Quitar fondo'}</span>
          <small>{on ? 'Toca para volver al fondo original' : 'Deja solo a la persona'}</small>
        </button>
      </div>

      {on && status === 'loading' && (
        <p className="bg-status"><span className="spinner" /> Preparando la herramienta… (solo la primera vez)</p>
      )}
      {on && status === 'error' && (
        <div className="bg-status bg-error">
          <TriangleAlert size={18} />
          <span>{BG_LOAD_ERROR}</span>
          <button className="btn-ghost" onClick={() => loadSegmenter().catch(() => {})}>
            <RefreshCw size={16} /> Reintentar
          </button>
        </div>
      )}

      {bg && (
        <>
          <p className="label">Nuevo fondo</p>
          <div className="chips">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`chip ${bg.mode === m.id ? 'active' : ''}`}
                onClick={() => (m.id === 'media' && !bg.assetId ? input.current?.click() : setBg((b) => void (b.mode = m.id)))}
              >
                <m.icon size={16} /> {m.name}
              </button>
            ))}
          </div>

          {bg.mode === 'color' && (
            <div className="bg-swatches">
              {BG_COLORS.map((c) => (
                <button
                  key={c}
                  className={`bg-swatch ${bg.color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                  onClick={() => setBg((b) => void (b.color = c))}
                />
              ))}
              <label className="bg-swatch bg-custom" aria-label="Otro color">
                <input
                  type="color"
                  value={bg.color}
                  onClick={checkpoint}
                  onChange={(e) => editSelected((c) => c.bgRemoval && void (c.bgRemoval.color = e.target.value))}
                />
              </label>
            </div>
          )}

          {bg.mode === 'media' && (
            <button className="dropzone" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <span className="spinner" /> : bgAsset?.thumb ? <img className="bg-thumb" src={bgAsset.thumb} alt="" /> : <ImageUp size={22} />}
              <span>{busy ? 'Cargando…' : bgAsset ? 'Cambiar foto o video del fondo' : 'Elegir foto o video del fondo'}</span>
              {bgAsset && <small>{bgAsset.name}{bgAsset.kind === 'video' ? ' · se repite si es más corto' : ''}</small>}
            </button>
          )}

          <Slider
            label="Suavizar bordes"
            value={bg.smooth}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)} %`}
            onChange={(v) => editSelected((c) => c.bgRemoval && void (c.bgRemoval.smooth = v))}
          />
          <Hint>Funciona mejor con una persona bien iluminada y de frente. Todo se procesa en tu dispositivo: nada se sube a internet.</Hint>
        </>
      )}

      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          if (e.target.files?.length) pickMedia(e.target.files).finally(() => (e.target.value = ''));
        }}
      />
    </>
  );
}
