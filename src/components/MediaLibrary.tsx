import { useMemo, useRef, useState } from 'react';
import { Check, Eye, Film, Image as ImageIcon, Music, Plus, Upload, X } from 'lucide-react';
import { useStore } from '../store';
import { clamp, fmtTime } from '../model';
import { ACCEPT_MEDIA } from '../media';
import { addAssetsToTimeline } from '../ops';
import { ImportButton } from './ImportButton';
import { Modal } from './Modal';
import { MusicSection } from './SoundPanels';
import type { Asset, MediaKind } from '../types';

const ICON: Record<MediaKind, typeof Film> = { video: Film, image: ImageIcon, audio: Music };

const addAgain = (a: Asset) => {
  addAssetsToTimeline([a]);
  useStore.getState().notify('Agregado a tu video');
};

/**
 * One imported file. With a mouse, moving over a video shows its frames (left = start, right = end),
 * so you can see what is inside before adding it. The eye opens the full preview (also on touch).
 */
function AssetTile({ a, used, onPreview }: { a: Asset; used: boolean; onPreview: () => void }) {
  const Icon = ICON[a.kind];
  const url = useStore((s) => s.urls[a.id]);
  const video = useRef<HTMLVideoElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const canScrub = a.kind === 'video' && !!url;

  const move = (e: React.PointerEvent) => {
    if (!canScrub || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = clamp((e.clientX - r.left) / r.width, 0, 1);
    setScrub(f);
    const v = video.current;
    if (v && v.readyState >= 1) v.currentTime = Math.min(f * a.duration, Math.max(0, a.duration - 0.05));
  };

  return (
    <div className={`asset ${used ? 'used' : ''}`}>
      <button className="asset-add" onClick={() => addAgain(a)} title={`Agregar ${a.name} al video`}>
        <div className="asset-thumb" onPointerMove={move} onPointerLeave={() => setScrub(null)}>
          {a.thumb ? <img src={a.thumb} alt="" /> : <Icon size={26} />}
          {scrub !== null && (
            <>
              <video ref={video} className="asset-live" src={url} muted playsInline preload="auto" onLoadedMetadata={(e) => (e.currentTarget.currentTime = scrub * a.duration)} />
              <span className="asset-scrub" style={{ left: `${scrub * 100}%` }} />
              <span className="asset-time">{fmtTime(scrub * a.duration)}</span>
            </>
          )}
          <span className="asset-plus"><Plus size={16} /></span>
          {used && <span className="asset-used" title="Ya está en tu video"><Check size={12} /></span>}
          {a.kind !== 'image' && scrub === null && <span className="asset-dur">{fmtTime(a.duration)}</span>}
        </div>
        <span className="asset-name">{a.name}</span>
      </button>
      {a.kind !== 'audio' && url && (
        <button className="asset-eye" onClick={onPreview} aria-label={`Ver ${a.name}`} title="Ver completo">
          <Eye size={15} />
        </button>
      )}
    </div>
  );
}

/** Full-size look at an imported file, with its own player, before adding it. */
function AssetPreview({ a, onClose }: { a: Asset; onClose: () => void }) {
  const url = useStore((s) => s.urls[a.id]);
  return (
    <Modal onClose={onClose} labelledBy="asset-preview-title" className="asset-preview">
      <header>
        <h3 id="asset-preview-title">{a.name}</h3>
        <button className="icon-btn" aria-label="Cerrar" onClick={onClose}><X /></button>
      </header>
      <div className="asset-preview-media">
        {a.kind === 'video' ? <video src={url} controls autoPlay playsInline /> : <img src={url} alt={a.name} />}
      </div>
      <p className="muted small">
        {a.width}×{a.height}
        {a.kind === 'video' && ` · ${fmtTime(a.duration)}`}
      </p>
      <button className="btn-primary full" onClick={() => { addAgain(a); onClose(); }}>
        <Plus size={18} /> Agregar al video
      </button>
    </Modal>
  );
}

/** Imported files of this project. Tapping one adds it to the video again. */
export function MediaLibrary({ only }: { only?: 'audio' }) {
  const project = useStore((s) => s.project!);
  const assets = Object.values(project.assets).filter((a) => !a.sticker && (only ? a.kind === only : true));
  const used = useMemo(
    () => new Set([...project.clips, ...project.audios, ...(project.overlays ?? [])].map((x) => x.assetId)),
    [project.clips, project.audios, project.overlays],
  );
  const [preview, setPreview] = useState<Asset | null>(null);

  return (
    <div className="library">
      {only === 'audio' && <MusicSection />}
      {only === 'audio' && <p className="label">Tu propia música</p>}
      <ImportButton className="dropzone" accept={only === 'audio' ? 'audio/*' : ACCEPT_MEDIA}>
        <Upload size={22} />
        <span>{only === 'audio' ? 'Elegir música del dispositivo' : 'Elegir del dispositivo'}</span>
        <small>{only === 'audio' ? 'MP3, M4A, WAV…' : 'Videos, fotos o música'}</small>
      </ImportButton>
      {assets.length > 0 && (
        <>
          <p className="muted small">Toca un archivo para agregarlo otra vez, o el ojo para verlo completo.</p>
          <div className="asset-grid">
            {assets.map((a) => (
              <AssetTile key={a.id} a={a} used={used.has(a.id)} onPreview={() => setPreview(a)} />
            ))}
          </div>
        </>
      )}
      {only === 'audio' && (
        <p className="muted small">La música se coloca donde está la línea blanca. Usa solo música que tengas derecho a usar.</p>
      )}
      {preview && <AssetPreview a={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
