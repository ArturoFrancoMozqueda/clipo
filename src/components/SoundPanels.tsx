import { useEffect, useState } from 'react';
import { Pause, Play, Plus, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { mainDuration } from '../model';
import { MOODS, SFX, addGenerated, playPreview, renderSfx, renderSong, stopPreview, type Mood, type Sfx } from '../sound';

/** Sound effects placed at the white line. */
export function SfxPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => stopPreview, []);

  const listen = async (s: Sfx) => playPreview(await renderSfx(s));
  const add = async (s: Sfx) => {
    setBusy(s.id);
    try {
      const st = useStore.getState();
      await addGenerated(await renderSfx(s), `Sonido: ${s.name}`, st.time);
      st.notify(`“${s.name}” agregado donde está la línea blanca`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <p className="muted small">Toca ▶ para escuchar y + para ponerlo donde está la línea blanca.</p>
      <div className="sound-list">
        {SFX.map((s) => (
          <div key={s.id} className="sound-row">
            <button className="icon-btn round" onClick={() => listen(s)} aria-label={`Escuchar ${s.name}`}>
              <Play size={18} />
            </button>
            <div className="sound-text">
              <strong>{s.name}</strong>
              <small>{s.use}</small>
            </div>
            <button className="btn-ghost small-btn" disabled={busy === s.id} onClick={() => add(s)}>
              <Plus size={16} /> Agregar
            </button>
          </div>
        ))}
      </div>
      <p className="muted small">Creados por Clipo: puedes usarlos en cualquier video, también con fines comerciales.</p>
    </>
  );
}

const MAX_SONG = 180;

/** Background music composed on the device, as long as the video. */
export function MusicSection() {
  // Match the video track, not the whole project: music must never make the video longer.
  const dur = useStore((s) => (s.project ? mainDuration(s.project) : 0));
  const [version, setVersion] = useState<Record<string, number>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => stopPreview, []);

  const seconds = dur > 0 ? Math.min(MAX_SONG, Math.round(dur * 10) / 10) : 30;
  const v = (m: Mood) => version[m.id] ?? 1;

  const listen = async (m: Mood) => {
    if (playing === m.id) {
      stopPreview();
      setPlaying(null);
      return;
    }
    setPlaying(m.id);
    playPreview(await renderSong(m, 12, v(m)));
  };

  const add = async (m: Mood) => {
    setBusy(m.id);
    stopPreview();
    setPlaying(null);
    try {
      const samples = await renderSong(m, seconds, v(m));
      // Music sits under voices: a bit lower, with soft start and end.
      await addGenerated(samples, `Música: ${m.name}${v(m) > 1 ? ` ${v(m)}` : ''}`, 0, { volume: 0.6, fadeIn: 1, fadeOut: 2 });
      useStore.getState().notify(`Música “${m.name}” agregada (${seconds} s)`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="music-section">
      <p className="label">Música de Clipo</p>
      <p className="muted small">Hecha por Clipo para tu video ({seconds} s). Sin derechos de autor: úsala donde quieras.</p>
      <div className="mood-grid">
        {MOODS.map((m) => (
          <div key={m.id} className={`mood mood-${m.id}`}>
            <strong>{m.name}</strong>
            <small>{m.hint}</small>
            <div className="mood-actions">
              <button className="icon-btn round" onClick={() => listen(m)} aria-label={playing === m.id ? 'Detener' : `Escuchar ${m.name}`}>
                {playing === m.id ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button
                className="icon-btn round"
                title="Otra versión"
                aria-label="Otra versión de la melodía"
                onClick={() => {
                  stopPreview();
                  setPlaying(null);
                  setVersion((x) => ({ ...x, [m.id]: v(m) + 1 }));
                }}
              >
                <RefreshCw size={16} />
              </button>
              <button className="btn-ghost small-btn" disabled={busy === m.id} onClick={() => add(m)}>
                {busy === m.id ? 'Creando…' : <><Plus size={16} /> Usar</>}
              </button>
            </div>
            {v(m) > 1 && <em className="mood-version">Versión {v(m)}</em>}
          </div>
        ))}
      </div>
    </div>
  );
}
