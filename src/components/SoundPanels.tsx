import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, Plus, RefreshCw, Star } from 'lucide-react';
import { useStore } from '../store';
import { mainDuration } from '../model';
import { MOODS, SFX, SFX_CATEGORIES, addGenerated, onPreviewEnd, previewAsync, renderSfx, renderSong, stopPreview, type Mood, type Sfx, type SfxCategory } from '../sound';
import { byIds, loadFavorites, loadRecents, pushRecent, searchSounds, toggleFavorite } from '../sfxLibrary';
import './soundPanels.css';

type View = 'trend' | 'fav' | 'recent' | 'all' | 'premium' | SfxCategory;

const TRENDING = SFX.filter((s) => s.trending);

/** Sound effects placed at the white line: trending first, then favorites, recents, categories and search. */
export function SfxPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [view, setView] = useState<View>('trend');
  const [query, setQuery] = useState('');
  const [favs, setFavs] = useState<string[]>(() => loadFavorites());
  const [recents, setRecents] = useState<string[]>(() => loadRecents());
  useEffect(() => {
    const off = onPreviewEnd(() => setPlaying(null));
    return () => {
      off();
      stopPreview();
    };
  }, []);

  const searching = query.trim().length > 0;
  const list = useMemo(() => {
    // Searching looks through every sound, whatever chip is selected.
    if (searching) return searchSounds(SFX, query);
    if (view === 'trend') return TRENDING;
    if (view === 'fav') return byIds(SFX, favs);
    if (view === 'recent') return byIds(SFX, recents);
    if (view === 'all') return SFX;
    if (view === 'premium') return SFX.filter((s) => s.premium);
    return SFX.filter((s) => s.category === view);
  }, [view, query, searching, favs, recents]);

  const listen = (s: Sfx) => {
    if (playing === s.id) {
      stopPreview();
      setPlaying(null);
      return;
    }
    setPlaying(s.id);
    // If a newer tap takes over while this renders, previewAsync simply doesn't play it.
    previewAsync(() => renderSfx(s)).catch(() => setPlaying((p) => (p === s.id ? null : p)));
  };
  const add = async (s: Sfx) => {
    setBusy(s.id);
    try {
      const st = useStore.getState();
      await addGenerated(await renderSfx(s), `Sonido: ${s.name}`, st.time, { role: 'sfx' });
      setRecents(pushRecent(s.id));
      st.notify(`“${s.name}” agregado donde está la línea blanca`);
    } catch {
      useStore.getState().notify('No se pudo agregar el sonido. Intenta otra vez.');
    } finally {
      setBusy(null);
    }
  };

  const views: { id: View; label: string; cls?: string; hidden?: boolean }[] = [
    { id: 'trend', label: 'Tendencia', cls: 'chip-trend' },
    { id: 'fav', label: '★ Favoritos', hidden: !favs.length },
    { id: 'recent', label: 'Recientes', hidden: !recents.length },
    { id: 'all', label: 'Todos' },
    { id: 'premium', label: 'Estudio', cls: 'chip-pro' },
    ...SFX_CATEGORIES.map((c) => ({ id: c as View, label: c })),
  ];
  const showCat = searching || view === 'all' || view === 'trend' || view === 'fav' || view === 'recent' || view === 'premium';

  return (
    <>
      <input
        className="sfx-search"
        type="search"
        aria-label="Buscar sonidos"
        placeholder={`Buscar entre ${SFX.length} sonidos (ej. aplausos, golpe, dinero)`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="sfx-views" role="tablist" aria-label="Tipos de sonido">
        {views.filter((v) => !v.hidden).map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={!searching && view === v.id}
            className={`chip ${!searching && view === v.id ? 'active' : ''} ${v.cls ?? ''}`}
            onClick={() => {
              setQuery('');
              setView(v.id);
            }}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="sound-list">
        {list.map((s) => (
          <div key={s.id} className="sound-row">
            <button className={`icon-btn round ${playing === s.id ? 'playing' : ''}`} onClick={() => listen(s)} aria-label={`${playing === s.id ? 'Detener' : 'Escuchar'} ${s.name}`}>
              {playing === s.id ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <div className="sound-text">
              <strong>
                {s.name}
                {s.trending ? <span className="trend-tag">Tendencia</span> : s.premium ? <span className="pro-tag">Estudio</span> : null}
              </strong>
              <small>{s.use}{showCat ? ` · ${s.category}` : ''}</small>
            </div>
            <button
              className={`icon-btn round fav-btn ${favs.includes(s.id) ? 'on' : ''}`}
              aria-pressed={favs.includes(s.id)}
              aria-label={favs.includes(s.id) ? `Quitar ${s.name} de favoritos` : `Guardar ${s.name} en favoritos`}
              onClick={() => setFavs(toggleFavorite(s.id))}
            >
              <Star size={16} fill={favs.includes(s.id) ? 'currentColor' : 'none'} />
            </button>
            <button className="btn-ghost small-btn" disabled={busy === s.id} onClick={() => add(s)}>
              <Plus size={16} /> Agregar
            </button>
          </div>
        ))}
        {!list.length && (
          <p className="muted small sound-empty">
            {searching ? 'No encontramos ese sonido. Prueba otra palabra, como “golpe”, “dinero” o “susto”.' : view === 'fav' ? 'Toca la estrella de un sonido para guardarlo aquí.' : 'Todavía no hay sonidos aquí.'}
          </p>
        )}
      </div>
      <p className="muted small">Hechos por Clipo y por Kenney (dominio público): puedes usarlos en cualquier video, también con fines comerciales.</p>
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
  useEffect(() => {
    const off = onPreviewEnd(() => setPlaying(null));
    return () => {
      off();
      stopPreview();
    };
  }, []);

  const seconds = dur > 0 ? Math.min(MAX_SONG, Math.round(dur * 10) / 10) : 30;
  const v = (m: Mood) => version[m.id] ?? 1;

  const listen = (m: Mood) => {
    if (playing === m.id) {
      stopPreview();
      setPlaying(null);
      return;
    }
    setPlaying(m.id);
    previewAsync(() => renderSong(m, 14, v(m))).catch(() => setPlaying((p) => (p === m.id ? null : p)));
  };

  const add = async (m: Mood) => {
    setBusy(m.id);
    stopPreview();
    setPlaying(null);
    try {
      const samples = await renderSong(m, seconds, v(m));
      // Music sits under voices: a bit lower, with soft start and end.
      await addGenerated(samples, `Música: ${m.name}${v(m) > 1 ? ` ${v(m)}` : ''}`, 0, { volume: 0.6, fadeIn: 1, fadeOut: 2, role: 'music' });
      useStore.getState().notify(`Música “${m.name}” agregada (${seconds} s)`);
    } catch {
      useStore.getState().notify('No se pudo crear la música. Intenta otra vez.');
    } finally {
      setBusy(null);
    }
  };

  const card = (m: Mood) => (
    <div key={m.id} className={`mood mood-${m.id}`}>
      {m.trending && <span className="trend-tag">Tendencia</span>}
      <strong>{m.name}</strong>
      <small>{m.hint}</small>
      <div className="mood-actions">
        <button className="icon-btn round" onClick={() => listen(m)} aria-label={playing === m.id ? 'Detener' : `Escuchar ${m.name}`}>
          {playing === m.id ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          className="icon-btn round"
          title="Otra versión"
          aria-label={`Otra versión de ${m.name}`}
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
  );

  return (
    <div className="music-section">
      <p className="label">Música de Clipo</p>
      <p className="muted small">Hecha por Clipo para tu video ({seconds} s). Sin derechos de autor: úsala donde quieras.</p>
      <p className="label music-trend-title">Estilos del momento</p>
      <div className="mood-grid">{MOODS.filter((m) => m.trending).map(card)}</div>
      <p className="label music-trend-title">Clásicas</p>
      <div className="mood-grid">{MOODS.filter((m) => !m.trending).map(card)}</div>
    </div>
  );
}
