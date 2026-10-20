import { Suspense, lazy, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { CheckCircle2, Download, Send, Share2, TriangleAlert, VolumeX } from 'lucide-react';
import type { AudioItem, Clip, OverlayItem, PanelId, SelectionKind, StickerItem, TextItem } from '../types';
import { itemsOf, useStore } from '../store';
import type { ExportProgress } from '../exporter';
import { canExport } from '../exportSupport';
import { canShareFile, saveFile, shareFile } from '../nativeShare';
import { FILTERS } from '../filters';
import { clipDur, fmtTime, totalDuration } from '../model';
import { setAspect } from '../ops';
import { FormatPicker } from './FormatPicker';
import { MediaLibrary } from './MediaLibrary';
import { showOnboarding } from './Onboarding';
import { AdvancedToggle, ColorPanel, KeyframesPanel, OverlayPanel } from './AdvancedPanels';
import { BgError } from '../segmentation';
import { ProxyToggle } from './ProxyStatus';

/**
 * A named export of a module that is only downloaded the first time it's shown, so the editor
 * starts without the code of every panel (captions, voice, publishing…).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyNamed<M extends Record<string, any>, K extends keyof M>(load: () => Promise<M>, key: K): M[K] {
  return lazy(() => load().then((m) => ({ default: m[key] as ComponentType<unknown> }))) as unknown as M[K];
}
const visual = () => import('./VisualPanels');
const CropPanel = lazyNamed(visual, 'CropPanel');
const EffectsPanel = lazyNamed(visual, 'EffectsPanel');
const LutSection = lazyNamed(visual, 'LutSection');
const StickersPanel = lazyNamed(visual, 'StickersPanel');
const TransitionPanel = lazyNamed(visual, 'TransitionPanel');
const texts = () => import('./TextPanels');
const CaptionsPanel = lazyNamed(texts, 'CaptionsPanel');
const TextPanel = lazyNamed(texts, 'TextPanel');
const SfxPanel = lazyNamed(() => import('./SoundPanels'), 'SfxPanel');
const voice = () => import('./VoicePanels');
const RecordPanel = lazyNamed(voice, 'RecordPanel');
const TtsPanel = lazyNamed(voice, 'TtsPanel');
const BackgroundPanel = lazyNamed(() => import('./BackgroundPanel'), 'BackgroundPanel');
const audio = () => import('./AudioPanels');
const AudioRoleSection = lazyNamed(audio, 'AudioRoleSection');
const NormalizeOption = lazyNamed(audio, 'NormalizeOption');
const SmartAudioPanel = lazyNamed(audio, 'SmartAudioPanel');
const VoiceFxSection = lazyNamed(audio, 'VoiceFxSection');
const social = () => import('./SocialPanel');
const ReframeSection = lazyNamed(social, 'ReframeSection');
const SocialPanel = lazyNamed(social, 'SocialPanel');
const PublishPanel = lazyNamed(() => import('./PublishPanel'), 'PublishPanel');

/** Shown for the moment a panel's code takes to arrive. */
function PanelLoading() {
  return (
    <p className="muted small" role="status">
      <span className="spinner" /> Cargando…
    </p>
  );
}

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
  publish: 'Publicar en redes',
  overlay: 'Superposición',
  color: 'Corrección de color',
  keyframes: 'Fotogramas clave',
  sfx: 'Efectos de sonido',
  crop: 'Recortar y voltear',
  smartAudio: 'Audio inteligente',
  social: 'Adaptar a redes',
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
    publish: <PublishPanel />,
    overlay: <OverlayPanel />,
    color: <ColorPanel />,
    keyframes: <KeyframesPanel />,
    sfx: <SfxPanel />,
    crop: <CropPanel />,
    smartAudio: <SmartAudioPanel />,
    social: <SocialPanel />,
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
      <div className="sheet-body">
        <Suspense fallback={<PanelLoading />}>{body[panel]}</Suspense>
      </div>
    </section>
  );
}

// ---------- helpers ----------

export function useSelected<T extends Clip | TextItem | AudioItem | StickerItem | OverlayItem>(kind: SelectionKind) {
  return useStore((s) => {
    if (s.selection?.kind !== kind) return undefined;
    return (itemsOf(s.project!, kind) as T[]).find((x) => x.id === s.selection!.id);
  });
}

/**
 * Re-render with the playhead only where the item's pose depends on it: paused, and the item has
 * keyframes. Otherwise scrubbing the timeline would re-render the whole panel on every step.
 */
export function usePoseTime(item: { keyframes?: unknown[] } | null | undefined) {
  const animated = !!item?.keyframes?.length;
  return useStore((s) => (s.playing || !animated ? -1 : s.time));
}

/** Change the selected item without a history step (call checkpoint() first). */
export function editSelected(fn: (item: Clip & TextItem & AudioItem & StickerItem & OverlayItem) => void) {
  const s = useStore.getState();
  const sel = s.selection;
  if (!sel) return;
  s.live((p) => {
    const it = (itemsOf(p, sel.kind) as (Clip & TextItem & AudioItem & StickerItem & OverlayItem)[]).find((x) => x.id === sel.id);
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
      <ReframeSection />
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
      <AudioRoleSection />
      <VoiceFxSection />
      <Hint>Consejo: en “Audio inteligente” Clipo puede bajar la música sola cuando alguien habla.</Hint>
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
      <LutSection clip={clip} />
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
      const { exportVideo } = await import('../exporter');
      const { blob, ext } = await exportVideo(quality, (progress) => !ac.signal.aborted && setState({ kind: 'running', progress }), ac.signal);
      const safe = project.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'video';
      const file = new File([blob], `${safe}.${ext}`, { type: blob.type });
      setState({ kind: 'done', url: URL.createObjectURL(file), file });
    } catch (e) {
      if ((e as Error).message === 'cancelled') setState({ kind: 'idle' });
      else {
        const { ExportError } = await import('../exporter');
        const known = e instanceof BgError || e instanceof ExportError;
        setState({ kind: 'error', message: known ? (e as Error).message : 'Algo salió mal al guardar. Intenta otra vez con calidad 720p.' });
      }
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
    const share = () => void shareFile(state.file, project.name);
    const canShare = canShareFile(state.file);
    return (
      <div className="export-done">
        <p className="ok"><CheckCircle2 /> ¡Tu video está listo!</p>
        <video src={state.url} controls playsInline className="export-video" />
        <div className="row">
          <button className="btn-primary" onClick={() => void saveFile(state.file)}>
            <Download size={18} /> Descargar
          </button>
          {canShare && (
            <button className="btn-primary alt" onClick={share}>
              <Share2 size={18} /> Compartir
            </button>
          )}
        </div>
        <button className="btn-primary full" onClick={async () => {
          const { handOffVideo } = await import('../publish/store');
          handOffVideo(state.file);
          useStore.getState().setPanel('publish');
        }}>
          <Send size={18} /> Publicar en redes
        </button>
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
      <NormalizeOption />
      <button className="btn-primary big full" onClick={start}>
        <Download size={22} /> Guardar video ({fmtTime(dur)})
      </button>
      <Hint>Sin marca de agua. Se procesa en tu dispositivo: nada se sube a internet.</Hint>
      <button className="btn-ghost" onClick={() => useStore.getState().setPanel('publish')}>
        <Send size={18} /> Publicar en redes y ver publicaciones
      </button>
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
      <AdvancedToggle />
      <ProxyToggle />
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
