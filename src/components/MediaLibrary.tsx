import { Film, Image as ImageIcon, Music, Plus, Upload } from 'lucide-react';
import { useStore } from '../store';
import { fmtTime } from '../model';
import { addAssetsToTimeline } from '../ops';
import { ImportButton } from './ImportButton';
import { MusicSection } from './SoundPanels';
import type { MediaKind } from '../types';

const ICON: Record<MediaKind, typeof Film> = { video: Film, image: ImageIcon, audio: Music };

/** Imported files of this project. Tapping one adds it to the video again. */
export function MediaLibrary({ only }: { only?: 'audio' }) {
  const assetsMap = useStore((s) => s.project!.assets);
  const assets = Object.values(assetsMap).filter((a) => !a.sticker && (only ? a.kind === only : true));

  return (
    <div className="library">
      {only === 'audio' && <MusicSection />}
      {only === 'audio' && <p className="label">Tu propia música</p>}
      <ImportButton className="dropzone" accept={only === 'audio' ? 'audio/*' : 'video/*,image/*,audio/*'}>
        <Upload size={22} />
        <span>{only === 'audio' ? 'Elegir música del dispositivo' : 'Elegir del dispositivo'}</span>
        <small>{only === 'audio' ? 'MP3, M4A, WAV…' : 'Videos, fotos o música'}</small>
      </ImportButton>
      {assets.length > 0 && (
        <>
          <p className="muted small">Toca un archivo para agregarlo otra vez:</p>
          <div className="asset-grid">
            {assets.map((a) => {
              const Icon = ICON[a.kind];
              return (
                <button
                  key={a.id}
                  className="asset"
                  onClick={() => {
                    addAssetsToTimeline([a]);
                    useStore.getState().notify('Agregado a tu video');
                  }}
                  title={a.name}
                >
                  <div className="asset-thumb">
                    {a.thumb ? <img src={a.thumb} alt="" /> : <Icon size={26} />}
                    <span className="asset-plus"><Plus size={16} /></span>
                    {a.kind !== 'image' && <span className="asset-dur">{fmtTime(a.duration)}</span>}
                  </div>
                  <span className="asset-name">{a.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {only === 'audio' && (
        <p className="muted small">La música se coloca donde está la línea blanca. Usa solo música que tengas derecho a usar.</p>
      )}
    </div>
  );
}
