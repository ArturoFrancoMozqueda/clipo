import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Captions, CheckCircle2, Download, Share2, TriangleAlert, VolumeX } from 'lucide-react';
import type { AudioItem, Clip, PanelId, SelectionKind, StickerItem, TextItem } from '../types';
import { itemsOf, useStore } from '../store';
import { canExport, exportVideo, type ExportProgress } from '../exporter';
import { FILTERS } from '../filters';
import { TEXT_STYLES, styleToCss } from '../textStyles';
import { clipDur, fmtTime, totalDuration } from '../model';
import { setAspect } from '../ops';
import { CAPTION_LANGUAGES, captionDownloadMB, cancelCaptions, generateCaptions, type CaptionProgress, type CaptionQuality } from '../captions';
import { FormatPicker } from './FormatPicker';
import { EffectsPanel, StickersPanel, TextAnimSection, TransitionPanel } from './VisualPanels';
import { MediaLibrary } from './MediaLibrary';
import { showOnboarding } from './Onboarding';
import { RecordPanel, TtsPanel } from './VoicePanels';
import { BackgroundPanel } from './BackgroundPanel';
import { BgError } from '../segmentation';

const TITLES: Record<PanelId, string> = {
  media: 'Agregar videos y fotos',
  audio: 'Música y sonidos',
  format: 'Formato del video',
  speed: 'Velocidad',
  volume: 'Volumen',
  filters: 'Filtros',
  text: 'Texto',
  captions: 'Subtítulos automáticos',
  transition: 'Transición',
  effects: 'Efectos de video',
  background: 'Quitar fondo',
  stickers: 'Stickers y emojis',
  record: 'Grabar tu voz',
  tts: 'Texto a voz',
  export: 'Guardar video',
  help: 'Cómo usar Clipo',
};

/** Settings panel. It never covers the preview so changes are visible right away. */
export function Sheet() {
  const panel = useStore((s) => s.panel);
  const exporting = useStore((s) => s.exporting);
  const captioning = useStore((s) => s.captioning);
  if (!panel) return null;
  const close = () => useStore.getState().setPanel(null);
  const body: Record<PanelId, ReactNode> = {
    media: <MediaLibrary />,
    audio: <MediaLibrary only="audio" />,
    format: <FormatPanel />,
    speed: <SpeedPanel />,
    volume: <VolumePanel />,
    filters: <FiltersPanel />,
    text: <TextPanel />,
    captions: <CaptionsPanel />,
    transition: <TransitionPanel />,
    effects: <EffectsPanel />,
    background: <BackgroundPanel />,
    stickers: <StickersPanel />,
    record: <RecordPanel />,
    tts: <TtsPanel />,
    export: <ExportPanel />,
    help: <HelpPanel />,
  };
  return (
    <section className={`sheet sheet-${panel}`} aria-label={TITLES[panel]}>
      <header>
        <h3>{TITLES[panel]}</h3>
        {!exporting && !captioning && (
          <button className="btn-done" onClick={close}>
            Listo
          </button>
        )}
      </header>
      <div className="sheet-body">{body[panel]}</div>
    </section>
  );
}

// ---------- helpers ----------

export function useSelected<T extends Clip | TextItem | AudioItem | StickerItem>(kind: SelectionKind) {
  return useStore((s) => {
    if (s.selection?.kind !== kind) return undefined;
    return (itemsOf(s.project!, kind) as T[]).find((x) => x.id === s.selection!.id);
  });
}

/** Change the selected item without a history step (call checkpoint() first). */
export function editSelected(fn: (item: Clip & TextItem & AudioItem & StickerItem) => void) {
  const s = useStore.getState();
  const sel = s.selection;
  if (!sel) return;
  s.live((p) => {
    const it = (itemsOf(p, sel.kind) as (Clip & TextItem & AudioItem & StickerItem)[]).find((x) => x.id === sel.id);
    if (it) fn(it);
  });
}

export const checkpoint = () => useStore.getState().checkpoint();

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span>
        {props.label} <b>{props.format(props.value)}</b>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onPointerDown={checkpoint}
        onKeyDown={checkpoint}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="muted small">{children}</p>;
}

export function NeedsSelection({ what }: { what: string }) {
  return <Hint>Toca {what} en la línea de tiempo para cambiar esto.</Hint>;
}

// ---------- panels ----------

function FormatPanel() {
  const aspect = useStore((s) => s.project!.aspect);
  return (
    <>
      <FormatPicker value={aspect} onPick={setAspect} />
      <Hint>Si un video no tiene la misma forma, se muestra completo con un fondo difuminado. Para que llene la pantalla, tócalo y elige “Rellenar”.</Hint>
    </>
  );
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 4];

function SpeedPanel() {
  const clip = useSelected<Clip>('clip');
  if (!clip) return <NeedsSelection what="un video" />;
  const setSpeed = (v: number) => editSelected((c) => void (c.speed = v));
  return (
    <>
      <div className="chips">
        {SPEEDS.map((v) => (
          <button key={v} className={`chip ${clip.speed === v ? 'active' : ''}`} onClick={() => { checkpoint(); setSpeed(v); }}>
            {v === 1 ? 'Normal' : `${v}×`}
          </button>
        ))}
      </div>
      <Slider label="Velocidad" value={clip.speed} min={0.25} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={setSpeed} />
      <Hint>
        Más rápido = clip más corto. Ahora dura <b>{fmtTime(clipDur(clip), true)}</b>. Menos de 1× crea cámara lenta.
      </Hint>
    </>
  );
}

function VolumePanel() {
  const clip = useSelected<Clip>('clip');
  const audio = useSelected<AudioItem>('audio');
  const item = clip ?? audio;
  if (!item) return <NeedsSelection what="un video o una música" />;
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const secs = (v: number) => (v ? `${v.toFixed(1)} s` : 'No');
  return (
    <>
      <Slider label="Volumen" value={item.volume} min={0} max={2} step={0.05} format={pct} onChange={(v) => editSelected((x) => void (x.volume = v))} />
      <div className="chips">
        <button className="chip" onClick={() => { checkpoint(); editSelected((x) => void (x.volume = item.volume ? 0 : 1)); }}>
          <VolumeX size={16} /> {item.volume ? 'Silenciar' : 'Activar sonido'}
        </button>
      </div>
      {audio && (
        <>
          <Slider label="Aparece poco a poco" value={audio.fadeIn} min={0} max={5} step={0.5} format={secs} onChange={(v) => editSelected((x) => void (x.fadeIn = v))} />
          <Slider label="Desaparece poco a poco" value={audio.fadeOut} min={0} max={5} step={0.5} format={secs} onChange={(v) => editSelected((x) => void (x.fadeOut = v))} />
        </>
      )}
      <Hint>Consejo: baja la música a 30–50 % cuando alguien habla en el video.</Hint>
    </>
  );
}

function FiltersPanel() {
  const clip = useSelected<Clip>('clip');
  const thumb = useStore((s) => (clip ? s.project!.assets[clip.assetId]?.thumb : undefined));
  if (!clip) return <NeedsSelection what="un video o una foto" />;
  return (
    <>
      <div className="filter-grid">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`filter ${clip.filter === f.id ? 'active' : ''}`}
            onClick={() => { checkpoint(); editSelected((c) => void (c.filter = f.id)); }}
          >
            <div className="filter-thumb" style={{ filter: f.css === 'none' ? undefined : f.css }}>
              {thumb && <img src={thumb} alt="" />}
            </div>
            <span>{f.name}</span>
          </button>
        ))}
      </div>
      <button
        className="btn-ghost"
        onClick={() => {
          const s = useStore.getState();
          s.commit((p) => p.clips.forEach((c) => (c.filter = clip.filter)));
          s.notify('Filtro aplicado a todos los clips');
        }}
      >
        Aplicar a todos los clips
      </button>
    </>
  );
}

const POSITIONS = [
  { label: 'Arriba', y: 0.15 },
  { label: 'Centro', y: 0.5 },
  { label: 'Abajo', y: 0.8 },
];

function TextPanel() {
  const text = useSelected<TextItem>('text');
  if (!text) return <NeedsSelection what="un texto" />;
  return (
    <>
      <textarea
        className="text-input"
        value={text.text}
        rows={2}
        autoFocus
        placeholder="Escribe aquí"
        onFocus={(e) => { checkpoint(); e.target.select(); }}
        onChange={(e) => editSelected((t) => void (t.text = e.target.value))}
      />
      <p className="label">Estilo</p>
      <div className="style-grid">
        {TEXT_STYLES.map((st) => (
          <button
            key={st.id}
            className={`style ${text.styleId === st.id ? 'active' : ''}`}
            onClick={() => { checkpoint(); editSelected((t) => void (t.styleId = st.id)); }}
          >
            <span style={styleToCss(st)}>{st.name}</span>
          </button>
        ))}
      </div>
      <Slider label="Tamaño" value={text.size} min={0.03} max={0.2} step={0.005} format={(v) => `${Math.round(v * 1000)}`} onChange={(v) => editSelected((t) => void (t.size = v))} />
      <p className="label">Posición</p>
      <div className="chips">
        {POSITIONS.map((pos) => (
          <button key={pos.label} className="chip" onClick={() => { checkpoint(); editSelected((t) => { t.x = 0.5; t.y = pos.y; }); }}>
            {pos.label}
          </button>
        ))}
      </div>
      <Slider label="Se muestra durante" value={text.duration} min={0.5} max={30} step={0.5} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => editSelected((t) => void (t.duration = v))} />
      <TextAnimSection text={text} />
      <Hint>También puedes arrastrar el texto sobre el video para moverlo.</Hint>
    </>
  );
}

const CAPTION_ERRORS: Record<string, string> = {
  'no-video': 'Primero agrega un video con sonido. Los subtítulos se crean a partir de lo que se dice en los videos.',
  'no-speech': 'No se escuchó a nadie hablar en los videos. Revisa que tengan sonido y que el volumen no esté en 0.',
};

const mb = (n: number) => `${Math.round(n / 1e6)} MB`;

function CaptionsPanel() {
  const hasCaptions = useStore((s) => s.project!.texts.some((t) => t.caption));
  const running = useStore((s) => s.captioning);
  const [language, setLanguage] = useState('spanish');
  const [quality, setQuality] = useState<CaptionQuality>('rapido');
  const [progress, setProgress] = useState<CaptionProgress | null>(null);
  const [error, setError] = useState('');

  const start = async () => {
    const s = useStore.getState();
    s.setCaptioning(true);
    setError('');
    setProgress(null);
    try {
      const n = await generateCaptions({ language, quality, onProgress: setProgress });
      const st = useStore.getState();
      st.setPanel(null);
      st.select(null);
      st.notify(`Listo: ${n} subtítulos. Toca uno para corregir el texto.`);
    } catch (e) {
      const m = (e as Error).message;
      if (m !== 'cancelled') setError(CAPTION_ERRORS[m] ?? 'No se pudieron crear los subtítulos. Revisa tu conexión (solo la primera vez) e intenta otra vez.');
      if (!CAPTION_ERRORS[m] && m !== 'cancelled') console.error(e);
    } finally {
      useStore.getState().setCaptioning(false);
    }
  };

  if (running) {
    const pct = progress?.pct ?? 0;
    const label =
      !progress || progress.phase === 'audio'
        ? 'Preparando el audio…'
        : progress.phase === 'download' && progress.pct >= 99.5
          ? 'Preparando el reconocimiento de voz…'
        : progress.phase === 'download'
          ? `Descargando el reconocimiento de voz (solo la primera vez)… ${progress.total ? `${mb(progress.loaded)} de ${mb(progress.total)}` : ''}`
          : 'Escuchando el video y escribiendo…';
    return (
      <div className="export-running">
        <div className="progress"><span style={{ width: `${pct}%` }} /></div>
        <p>
          {label} <b>{Math.round(pct)} %</b>
        </p>
        <Hint>Puedes esperar aquí. Se hace en tu dispositivo: nada se sube a internet.</Hint>
        <button className="btn-ghost" onClick={cancelCaptions}>Cancelar</button>
      </div>
    );
  }

  return (
    <>
      {error && <p className="warn"><TriangleAlert size={18} /> {error}</p>}
      <Hint>Clipo escucha lo que se dice en tus videos y lo escribe como subtítulos, en el momento justo.</Hint>
      <p className="label">¿En qué idioma hablan?</p>
      <div className="chips">
        {CAPTION_LANGUAGES.map((l) => (
          <button key={l.id} className={`chip ${language === l.id ? 'active' : ''}`} onClick={() => setLanguage(l.id)}>
            {l.label}
          </button>
        ))}
      </div>
      <p className="label">Modo</p>
      <div className="chips">
        <button className={`chip big ${quality === 'rapido' ? 'active' : ''}`} onClick={() => setQuality('rapido')}>
          Rápido <small>Recomendado · descarga de unos {captionDownloadMB('rapido')} MB</small>
        </button>
        <button className={`chip big ${quality === 'preciso' ? 'active' : ''}`} onClick={() => setQuality('preciso')}>
          Más preciso <small>Más lento · descarga de unos {captionDownloadMB('preciso')} MB</small>
        </button>
      </div>
      <button className="btn-primary big full" onClick={start}>
        <Captions size={22} /> {hasCaptions ? 'Volver a crear subtítulos' : 'Crear subtítulos'}
      </button>
      {hasCaptions && <Hint>Los subtítulos automáticos que ya tienes se reemplazarán. Puedes deshacerlo.</Hint>}
      <Hint>Todo se hace en tu dispositivo. La primera vez se descarga el reconocimiento de voz y queda guardado para la próxima.</Hint>
    </>
  );
}

type ExportState =
  | { kind: 'idle' }
  | { kind: 'running'; progress: ExportProgress | null }
  | { kind: 'done'; url: string; file: File }
  | { kind: 'error'; message: string };

function ExportPanel() {
  const project = useStore((s) => s.project!);
  const [quality, setQuality] = useState<720 | 1080>(720);
  const [state, setState] = useState<ExportState>({ kind: 'idle' });
  const dur = totalDuration(project);

  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => void (state.kind === 'done' && URL.revokeObjectURL(state.url)), [state]);
  useEffect(() => () => abort.current?.abort(), []);

  if (!canExport()) {
    return <Hint>Tu navegador no puede guardar videos. Usa Chrome, Edge o Safari actualizados.</Hint>;
  }
  if (!project.clips.length) return <Hint>Primero agrega al menos un video o una foto.</Hint>;

  const start = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setState({ kind: 'running', progress: null });
    try {
      const { blob, ext } = await exportVideo(quality, (progress) => !ac.signal.aborted && setState({ kind: 'running', progress }), ac.signal);
      const safe = project.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'video';
      const file = new File([blob], `${safe}.${ext}`, { type: blob.type });
      setState({ kind: 'done', url: URL.createObjectURL(file), file });
    } catch (e) {
      if ((e as Error).message === 'cancelled') setState({ kind: 'idle' });
      else setState({ kind: 'error', message: e instanceof BgError ? e.message : 'Algo salió mal al guardar. Intenta otra vez con calidad 720p.' });
    }
  };

  if (state.kind === 'running') {
    const pr = state.progress;
    const pct = pr?.pct ?? 0;
    return (
      <div className="export-running">
        <div className="progress"><span style={{ width: `${pct}%` }} /></div>
        <p>
          Guardando… <b>{Math.floor(pct)} %</b>
          {pr && (pr.eta == null ? ' · calculando el tiempo…' : ` · quedan unos ${fmtLeft(pr.eta)}`)}
        </p>
        {pr && !pr.fast && <Hint>Tu navegador guarda el video en tiempo real: tarda lo mismo que dura ({fmtTime(dur)}).</Hint>}
        <Hint>No cierres ni cambies de pestaña o de app mientras se guarda.</Hint>
        <button className="btn-ghost" onClick={() => abort.current?.abort()}>Cancelar</button>
      </div>
    );
  }

  if (state.kind === 'done') {
    const share = () => navigator.share({ files: [state.file], title: project.name }).catch(() => {});
    const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [state.file] });
    return (
      <div className="export-done">
        <p className="ok"><CheckCircle2 /> ¡Tu video está listo!</p>
        <video src={state.url} controls playsInline className="export-video" />
        <div className="row">
          <a className="btn-primary" href={state.url} download={state.file.name}>
            <Download size={18} /> Descargar
          </a>
          {canShare && (
            <button className="btn-primary alt" onClick={share}>
              <Share2 size={18} /> Compartir
            </button>
          )}
        </div>
        <button className="btn-ghost" onClick={() => setState({ kind: 'idle' })}>Volver a guardar</button>
      </div>
    );
  }

  return (
    <>
      {state.kind === 'error' && <p className="warn"><TriangleAlert size={18} /> {state.message}</p>}
      <p className="label">Calidad</p>
      <div className="chips">
        <button className={`chip big ${quality === 720 ? 'active' : ''}`} onClick={() => setQuality(720)}>
          720p <small>Recomendado · más ligero</small>
        </button>
        <button className={`chip big ${quality === 1080 ? 'active' : ''}`} onClick={() => setQuality(1080)}>
          1080p <small>Máxima calidad</small>
        </button>
      </div>
      <button className="btn-primary big full" onClick={start}>
        <Download size={22} /> Guardar video ({fmtTime(dur)})
      </button>
      <Hint>Sin marca de agua. Se procesa en tu dispositivo: nada se sube a internet.</Hint>
    </>
  );
}

/** "45 s" or "2 min 10 s". */
function fmtLeft(sec: number) {
  const s = Math.max(1, Math.ceil(sec));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

function HelpPanel() {
  return (
    <div className="help">
      <button className="btn-ghost" onClick={() => { useStore.getState().setPanel(null); showOnboarding(); }}>
        Ver la introducción otra vez
      </button>
      <h4>Lo básico</h4>
      <ul>
        <li><b>Moverte:</b> desliza la línea de tiempo. La línea blanca del centro es el momento actual.</li>
        <li><b>Cortar:</b> pon la línea blanca donde quieras cortar y toca “Dividir”. Luego borra el trozo que no quieras.</li>
        <li><b>Acortar un clip:</b> tócalo y arrastra sus bordes blancos.</li>
        <li><b>Cambiar el orden:</b> toca un clip y usa “Mover antes” / “Mover después”.</li>
        <li><b>Texto:</b> arrástralo sobre el video para moverlo; tócalo dos veces para editarlo.</li>
        <li><b>Acercar la línea de tiempo:</b> pellizca con dos dedos o usa los botones de lupa.</li>
        <li><b>Errores:</b> “Deshacer” arriba. Todo se guarda solo.</li>
      </ul>
      <h4>Atajos de teclado (PC)</h4>
      <ul className="keys">
        <li><kbd>Espacio</kbd> reproducir / pausar</li>
        <li><kbd>S</kbd> dividir</li>
        <li><kbd>Supr</kbd> eliminar lo seleccionado</li>
        <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> deshacer · <kbd>Ctrl</kbd>+<kbd>Y</kbd> rehacer</li>
        <li><kbd>←</kbd> <kbd>→</kbd> avanzar un fotograma (con <kbd>Shift</kbd>, un segundo)</li>
        <li><kbd>Ctrl</kbd>+rueda del ratón: acercar la línea de tiempo</li>
      </ul>
      <h4>Instalar como app</h4>
      <ul>
        <li><b>Android / PC (Chrome o Edge):</b> menú del navegador → “Instalar app”.</li>
        <li><b>iPhone / iPad (Safari):</b> botón Compartir → “Agregar a pantalla de inicio”.</li>
      </ul>
    </div>
  );
}
