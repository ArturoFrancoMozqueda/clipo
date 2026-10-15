import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2, CircleAlert, ClipboardCopy, Crosshair, Download, Eye, EyeOff, ImageIcon, ListChecks, Share2, TriangleAlert, Undo2,
} from 'lucide-react';
import type { AspectId, PlatformId, Project, PublishInfo, PublishTarget } from '../types';
import { useStore } from '../store';
import { ASPECTS, canvasSize, totalDuration } from '../model';
import {
  PLATFORMS, PLATFORM_IDS, checkVersion, postCaption, worstLevel, type AudioLevels, type Issue, type ItemBox,
} from '../platforms';
import type { ExportProgress } from '../exporter';
import { canExport, canFastExport, UnsupportedAspectError } from '../exportSupport';
import { canShareFile, saveFile, saveFiles, shareFile } from '../nativeShare';
import { autoReframe, clearReframe, reframable, usesReframe, type ReframeProgress } from '../reframeAnalyze';
import { setAspect } from '../ops';
import { engine } from '../engine';
import { drawText } from '../textStyles';
import { loadProjectFonts } from '../fonts';
import { poseAt } from '../keyframes';
import { BgError, BG_LOAD_ERROR } from '../segmentation';
import { useGuide } from './SafeZoneGuide';
import { checkpoint, Hint } from './Panels';
import './social.css';

const pub = (p: Project): PublishInfo => p.publish ?? {};
const targetsOf = (p: Project): PublishTarget[] => (pub(p).targets ?? []).filter((t) => PLATFORMS[t.platform]);

/** The project's networks, grouped by the format each one gets: one exported file per format. */
function versionsOf(targets: PublishTarget[]) {
  const by = new Map<AspectId, PlatformId[]>();
  for (const t of targets) by.set(t.aspect, [...(by.get(t.aspect) ?? []), t.platform]);
  return [...by.entries()].map(([aspect, platforms]) => ({ aspect, platforms }));
}

const names = (ids: PlatformId[]) => ids.map((id) => PLATFORMS[id].name).join(', ');

/** "Adaptar a redes": where it goes, safe zones, reframing, checks, several versions, cover and text. */
export function SocialPanel() {
  const project = useStore((s) => s.project!);
  const targets = targetsOf(project);

  const toggle = (id: PlatformId) =>
    useStore.getState().commit((p) => {
      const info = (p.publish ??= {});
      const list = targetsOf(p);
      info.targets = list.some((t) => t.platform === id)
        ? list.filter((t) => t.platform !== id)
        : [...list, { platform: id, aspect: PLATFORMS[id].formats[0] }];
    });

  if (!project.clips.length) return <Hint>Primero agrega al menos un video o una foto.</Hint>;

  return (
    <div className="social">
      <p className="label">¿Dónde lo vas a publicar?</p>
      <div className="net-grid">
        {PLATFORM_IDS.map((id) => {
          const on = targets.some((t) => t.platform === id);
          return (
            <button key={id} className={`net ${on ? 'active' : ''}`} onClick={() => toggle(id)} aria-pressed={on}>
              <strong>{on ? '✓ ' : ''}{PLATFORMS[id].name}</strong>
              <small>{PLATFORMS[id].hint} · {PLATFORMS[id].formats[0]}</small>
            </button>
          );
        })}
      </div>
      {!targets.length ? (
        <Hint>Elige una o varias redes. Clipo te dirá qué formato usar, dónde no poner textos y si el video cumple sus reglas.</Hint>
      ) : (
        <>
          <TargetsSection targets={targets} />
          <ReframeSection />
          <CheckSection targets={targets} />
          <VersionsSection targets={targets} />
          <PostSection targets={targets} />
        </>
      )}
    </div>
  );
}

// ---------- formats and safe zones ----------

function TargetsSection({ targets }: { targets: PublishTarget[] }) {
  const aspect = useStore((s) => s.project!.aspect);
  const guide = useGuide((s) => s.platform);
  const setFormat = (id: PlatformId, a: AspectId) =>
    useStore.getState().commit((p) => {
      const t = (p.publish?.targets ?? []).find((x) => x.platform === id);
      if (t) t.aspect = a;
    });
  const showGuide = (t: PublishTarget) => {
    if (guide === t.platform) return useGuide.getState().set(null);
    if (t.aspect !== aspect) {
      setAspect(t.aspect);
      useStore.getState().notify(`Vista previa en ${t.aspect} para ver la zona de ${PLATFORMS[t.platform].name}. Puedes deshacerlo.`);
    }
    useGuide.getState().set(t.platform);
  };
  return (
    <>
      <h4>Formato de cada red</h4>
      {targets.map((t) => {
        const p = PLATFORMS[t.platform];
        return (
          <div key={t.platform} className="net-row">
            <b>{p.name}</b>
            {p.formats.map((f) => (
              <button key={f} className={`chip small ${t.aspect === f ? 'active' : ''}`} onClick={() => setFormat(t.platform, f)}>
                {ASPECTS[f].label} {f}
                {f === p.formats[0] ? ' ★' : ''}
              </button>
            ))}
            <button className="chip small" onClick={() => showGuide(t)} title="Muestra en la vista previa dónde tapan los botones de la app">
              {guide === t.platform ? <EyeOff size={16} /> : <Eye size={16} />} {guide === t.platform ? 'Ocultar zona segura' : 'Ver zona segura'}
            </button>
          </div>
        );
      })}
      <Hint>★ = recomendado. La zona segura es solo una guía en pantalla: no aparece en el video guardado.</Hint>
    </>
  );
}

// ---------- automatic reframing ----------

/** "Seguir a la persona": also shown in the format panel. */
export function ReframeSection() {
  const project = useStore((s) => s.project!);
  const [progress, setProgress] = useState<ReframeProgress | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const active = usesReframe(project);
  const count = reframable(project).length;
  if (!count) return null;

  const start = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setError('');
    setProgress({ pct: 0, done: 0, total: 1 });
    engine.pause();
    try {
      const { found, total } = await autoReframe(setProgress, ac.signal);
      useStore
        .getState()
        .notify(found ? `Listo: la imagen sigue a la persona en ${found} de ${total} clips.` : 'No se encontró a ninguna persona en los clips.');
    } catch (e) {
      if ((e as Error).message !== 'cancelled') setError(e instanceof BgError ? e.message : BG_LOAD_ERROR);
    } finally {
      setProgress(null);
    }
  };

  return (
    <>
      <h4><Crosshair size={18} /> Reencuadre automático</h4>
      {error && <p className="warn"><TriangleAlert size={18} /> {error}</p>}
      {progress ? (
        <div className="export-running">
          <div className="progress"><span style={{ width: `${progress.pct}%` }} /></div>
          <p>Buscando a la persona en tus clips… <b>{Math.floor(progress.pct)} %</b></p>
          <button className="btn-ghost" onClick={() => abort.current?.abort()}>Cancelar</button>
        </div>
      ) : (
        <>
          <div className="row">
            <button className="btn-primary" onClick={start}>
              <Crosshair size={18} /> {active ? 'Volver a buscar a la persona' : 'Seguir a la persona'}
            </button>
            {active && (
              <button className="btn-ghost" onClick={clearReframe}>
                <Undo2 size={18} /> Quitar reencuadre
              </button>
            )}
          </div>
          <Hint>
            {active
              ? 'La imagen se mueve sola para mantener a la persona en el centro, en cualquier formato. Se ve igual en el video guardado.'
              : 'Al pasar de horizontal a vertical (o al revés), Clipo recorta la imagen siguiendo a la persona para que no quede cortada. Se hace en tu dispositivo.'}
          </Hint>
        </>
      )}
    </>
  );
}

// ---------- checks ----------

/** Smallest box holding both. */
const grow = (a: ItemBox | null, b: ItemBox): ItemBox =>
  a ? { ...a, x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : b;

/** Where every text and sticker sits in a format, as fractions of the frame (union over its keyframes). */
async function itemBoxes(p: Project, aspect: AspectId): Promise<ItemBox[]> {
  await loadProjectFonts(p);
  const [W, H] = canvasSize(aspect);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const out: ItemBox[] = [];
  const momentsOf = (it: { keyframes?: { t: number }[] }) => [0, ...(it.keyframes ?? []).map((k) => k.t)];
  for (const t of p.texts) {
    if (!t.text.trim()) continue;
    let b: ItemBox | null = null;
    for (const m of momentsOf(t)) {
      const pose = poseAt(t, m);
      const r = drawText(ctx, { ...t, x: pose.x, y: pose.y, size: pose.size }, W, H);
      const nb = { x0: r.x / W, y0: r.y / H, x1: (r.x + r.w) / W, y1: (r.y + r.h) / H };
      b = grow(b, { kind: 'text', label: t.text, ...nb });
    }
    if (b) out.push(b);
  }
  const short = Math.min(W, H);
  for (const st of p.stickers ?? []) {
    const a = st.assetId ? p.assets[st.assetId] : undefined;
    let b: ItemBox | null = null;
    for (const m of momentsOf(st)) {
      const pose = poseAt(st, m);
      const w = pose.size * short;
      const h = a && a.width ? (w * a.height) / a.width : w;
      // Bounding box of the rotated sticker.
      const bw = Math.abs(w * Math.cos(pose.rotation)) + Math.abs(h * Math.sin(pose.rotation));
      const bh = Math.abs(w * Math.sin(pose.rotation)) + Math.abs(h * Math.cos(pose.rotation));
      const nb = { x0: (pose.x * W - bw / 2) / W, y0: (pose.y * H - bh / 2) / H, x1: (pose.x * W + bw / 2) / W, y1: (pose.y * H + bh / 2) / H };
      b = grow(b, { kind: 'sticker', label: st.emoji ?? '', ...nb });
    }
    if (b) out.push(b);
  }
  return out;
}

const ICONS = { error: CircleAlert, warn: TriangleAlert, ok: CheckCircle2 } as const;

function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <ul className="issues">
      {issues.map((i, n) => {
        const Icon = ICONS[i.level];
        return (
          <li key={n} className={i.level}>
            <Icon size={18} />
            <span>
              {i.text}
              {i.fix && <small>{i.fix}</small>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function CheckSection({ targets }: { targets: PublishTarget[] }) {
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'running' } | { kind: 'done'; results: { t: PublishTarget; issues: Issue[] }[] }>({
    kind: 'idle',
  });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  // Results go stale when the project changes.
  const updatedAt = useStore((s) => s.project!.updatedAt);
  useEffect(() => setState((st) => (st.kind === 'done' ? { kind: 'idle' } : st)), [updatedAt]);

  const run = async () => {
    const p = useStore.getState().project!;
    const ac = new AbortController();
    abort.current = ac;
    setState({ kind: 'running' });
    let audio: AudioLevels | null = null;
    try {
      const { measureAudio } = await import('../exporter');
      audio = await measureAudio(p, ac.signal);
    } catch (e) {
      if ((e as Error).message === 'cancelled') return setState({ kind: 'idle' });
      console.warn('Audio check failed', e);
    }
    const boxes = new Map<AspectId, ItemBox[]>();
    for (const t of targets) if (!boxes.has(t.aspect)) boxes.set(t.aspect, await itemBoxes(p, t.aspect));
    if (ac.signal.aborted) return;
    const dur = totalDuration(p);
    const results = targets.map((t) => {
      const post = pub(p).posts?.[t.platform];
      return {
        t,
        issues: checkVersion({
          platform: t.platform,
          aspect: t.aspect,
          duration: dur,
          short: lastQuality,
          audio,
          boxes: boxes.get(t.aspect) ?? [],
          description: post?.description,
          hashtags: post?.hashtags,
          title: post?.title,
        }),
      };
    });
    setState({ kind: 'done', results });
  };

  return (
    <>
      <h4><ListChecks size={18} /> Revisar antes de publicar</h4>
      {state.kind === 'running' ? (
        <div className="export-running">
          <p>Revisando duración, peso, sonido y textos…</p>
          <button className="btn-ghost" onClick={() => abort.current?.abort()}>Cancelar</button>
        </div>
      ) : (
        <button className="btn-primary" onClick={run}>
          <ListChecks size={18} /> {state.kind === 'done' ? 'Revisar otra vez' : 'Revisar'}
        </button>
      )}
      {state.kind === 'done' &&
        state.results.map(({ t, issues }) => {
          const worst = worstLevel(issues);
          const Icon = ICONS[worst];
          return (
            <details key={t.platform} open={worst !== 'ok'}>
              <summary className={worst}>
                <Icon size={16} /> {PLATFORMS[t.platform].name} ({t.aspect}):{' '}
                {worst === 'ok' ? 'todo bien' : worst === 'warn' ? 'revisa los avisos' : 'hay que corregir algo'}
              </summary>
              <IssueList issues={issues} />
            </details>
          );
        })}
      {state.kind === 'idle' && <Hint>Revisa la duración, el peso estimado, el volumen del sonido y que ningún texto quede debajo de los botones de cada app.</Hint>}
    </>
  );
}

// ---------- several versions ----------

let lastQuality: 720 | 1080 = 1080;
/** Quality shared by the checks (estimated size) and the export of the versions. */
function useExportQuality() {
  const [q, setQ] = useState(lastQuality);
  return [q, (v: 720 | 1080) => setQ((lastQuality = v))] as const;
}

interface Version {
  aspect: AspectId;
  platforms: PlatformId[];
  file: File;
}

function VersionsSection({ targets }: { targets: PublishTarget[] }) {
  const project = useStore((s) => s.project!);
  const [quality, setQuality] = useExportQuality();
  const [running, setRunning] = useState<{ index: number; total: number; progress: ExportProgress | null } | null>(null);
  const [done, setDone] = useState<Version[]>([]);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  if (!canExport()) return <Hint>Tu navegador no puede guardar videos. Usa Chrome, Edge o Safari actualizados.</Hint>;
  const all = versionsOf(targets);
  // Without WebCodecs the video is filmed from the preview, which only has the project's own format.
  const fast = canFastExport();
  const versions = fast ? all : all.filter((v) => v.aspect === project.aspect);
  const skipped = all.length - versions.length;

  const start = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setError('');
    setDone([]);
    const safe = project.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'video';
    const made: Version[] = [];
    try {
      const { exportVideo } = await import('../exporter');
      for (const [i, v] of versions.entries()) {
        setRunning({ index: i, total: versions.length, progress: null });
        const { blob, ext } = await exportVideo(quality, (progress) => !ac.signal.aborted && setRunning({ index: i, total: versions.length, progress }), ac.signal, {
          aspect: v.aspect,
        });
        const file = new File([blob], `${safe} - ${v.aspect.replace(':', 'x')}.${ext}`, { type: blob.type });
        made.push({ ...v, file });
        setDone([...made]);
      }
    } catch (e) {
      const m = (e as Error).message;
      if (e instanceof UnsupportedAspectError) {
        // The fast path didn't work here, and filming the preview only works in the project's format.
        const rest = versions.slice(made.length).map((v) => v.aspect).join(', ');
        const why = e.reason === 'decode' ? 'Con estos archivos' : 'En este dispositivo';
        setError(`${why} solo se puede guardar el formato que ves ahora (${project.aspect}). Para ${rest}, cambia el formato en “Formato” y vuelve a guardar.`);
      } else if (m !== 'cancelled') {
        const { ExportError } = await import('../exporter');
        setError(e instanceof BgError || e instanceof ExportError ? m : 'Algo salió mal al guardar. Intenta otra vez con calidad 720p.');
      }
    } finally {
      setRunning(null);
    }
  };

  const downloadAll = () => void saveFiles(done.map((v) => v.file));
  const current = running ? versions[running.index] : undefined;

  return (
    <>
      <h4><Download size={18} /> Guardar una versión para cada formato</h4>
      {error && <p className="warn"><TriangleAlert size={18} /> {error}</p>}
      {running ? (
        <div className="export-running">
          <div className="progress"><span style={{ width: `${running.progress?.pct ?? 0}%` }} /></div>
          <p>
            Guardando versión {running.index + 1} de {running.total}{current && <> ({current.aspect} · {names(current.platforms)})</>}…{' '}
            <b>{Math.floor(running.progress?.pct ?? 0)} %</b>
          </p>
          <Hint>No cierres ni cambies de pestaña o de app mientras se guarda.</Hint>
          <button className="btn-ghost" onClick={() => abort.current?.abort()}>Cancelar</button>
        </div>
      ) : (
        <>
          <ul className="versions">
            {versions.map((v) => (
              <li key={v.aspect}>
                <b>{ASPECTS[v.aspect].label} {v.aspect}</b> <span>para {names(v.platforms)}</span>
              </li>
            ))}
          </ul>
          {skipped > 0 && (
            <p className="warn">
              <TriangleAlert size={18} /> Este navegador solo puede guardar el formato actual ({project.aspect}). Para los demás, cambia el formato y guarda otra vez, o usa Chrome o Edge.
            </p>
          )}
          <div className="chips">
            <button className={`chip big ${quality === 1080 ? 'active' : ''}`} onClick={() => setQuality(1080)}>
              1080p <small>Recomendado para redes</small>
            </button>
            <button className={`chip big ${quality === 720 ? 'active' : ''}`} onClick={() => setQuality(720)}>
              720p <small>Más rápido y ligero</small>
            </button>
          </div>
          {versions.length > 0 && (
            <button className="btn-primary big full" onClick={start}>
              <Download size={22} /> {versions.length === 1 ? 'Guardar 1 versión' : `Guardar ${versions.length} versiones`}
            </button>
          )}
        </>
      )}
      {done.length > 0 && !running && (
        <>
          <p className="ok"><CheckCircle2 size={18} /> {done.length === 1 ? 'Versión lista' : `${done.length} versiones listas`}</p>
          <ul className="versions">
            {done.map((v) => (
              <li key={v.aspect}>
                <button className="btn-primary" onClick={() => void saveFile(v.file)}>
                  <Download size={18} /> {v.aspect} · {names(v.platforms)}
                </button>
                {canShareFile(v.file) && (
                  <button className="btn-primary alt" onClick={() => void shareFile(v.file, project.name)}>
                    <Share2 size={18} /> Compartir
                  </button>
                )}
              </li>
            ))}
          </ul>
          {done.length > 1 && (
            <button className="btn-ghost" onClick={downloadAll}>
              <Download size={18} /> Descargar todas
            </button>
          )}
        </>
      )}
      <Hint>Un solo proyecto: textos, stickers y subtítulos se acomodan a cada formato. Sin marca de agua, todo en tu dispositivo.</Hint>
    </>
  );
}

// ---------- cover and post text ----------

/** Lets the preview redraw once; the timeout covers hidden windows, where frames don't run. */
const nextFrame = () => new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(r));
  setTimeout(r, 150);
});

/** Small JPEG of what the preview shows now (without selection handles or the safe-zone guide). */
async function snapshotPreview(): Promise<string | null> {
  const s = useStore.getState();
  if (s.selection) s.select(null);
  await nextFrame();
  const src = document.querySelector<HTMLCanvasElement>('.preview-canvas');
  if (!src || !src.width) return null;
  const k = Math.min(1, 360 / Math.min(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k);
  c.height = Math.round(src.height * k);
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

function PostSection({ targets }: { targets: PublishTarget[] }) {
  const info = useStore((s) => pub(s.project!));
  const time = useStore((s) => s.time);

  const editInfo = (fn: (i: PublishInfo) => void) => useStore.getState().live((p) => fn((p.publish ??= {})));
  const editPost = (id: PlatformId, fn: (post: NonNullable<PublishInfo['posts']>[PlatformId] & object) => void) =>
    editInfo((i) => {
      const posts = (i.posts ??= {});
      fn((posts[id] ??= { description: '', hashtags: '' }));
    });

  const pickCover = async () => {
    engine.pause();
    const t = useStore.getState().time;
    const thumb = await snapshotPreview();
    if (!thumb) return;
    useStore.getState().commit((p) => {
      const i = (p.publish ??= {});
      i.coverTime = t;
      i.coverThumb = thumb;
    });
    useStore.getState().notify('Portada guardada.');
  };
  const goToCover = () => info.coverTime != null && engine.seek(info.coverTime);

  // Copy the text of the first network to all others, for people who use the same text everywhere.
  const copyToAll = (from: PlatformId) =>
    useStore.getState().commit((p) => {
      const posts = ((p.publish ??= {}).posts ??= {});
      const src = posts[from];
      if (!src) return;
      for (const t of targetsOf(p)) if (t.platform !== from) posts[t.platform] = { ...posts[t.platform], description: src.description, hashtags: src.hashtags };
    });

  const copyText = async (id: PlatformId) => {
    const post = info.posts?.[id];
    const text = [post?.title, postCaption(post?.description ?? '', post?.hashtags ?? '')].filter(Boolean).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      useStore.getState().notify('Texto copiado. Pégalo al publicar.');
    } catch {
      useStore.getState().notify('No se pudo copiar. Selecciona el texto y cópialo a mano.');
    }
  };

  return (
    <>
      <h4><ImageIcon size={18} /> Portada y texto de la publicación</h4>
      <div className="cover">
        {info.coverThumb ? <img src={info.coverThumb} alt="Portada elegida" /> : null}
        <div>
          <button className="btn-primary" onClick={pickCover}>
            <ImageIcon size={18} /> Usar este momento ({time.toFixed(1)} s) como portada
          </button>
          {info.coverTime != null && (
            <button className="btn-ghost" onClick={goToCover}>Ir a la portada ({info.coverTime.toFixed(1)} s)</button>
          )}
        </div>
      </div>
      <Hint>Mueve la línea de tiempo hasta la imagen que quieras y toca el botón.</Hint>

      {targets.map((t, n) => {
        const p = PLATFORMS[t.platform];
        const post = info.posts?.[t.platform];
        const len = postCaption(post?.description ?? '', post?.hashtags ?? '').length;
        return (
          <details key={t.platform} open={n === 0}>
            <summary>Texto para {p.name}</summary>
            {p.hasTitle && (
              <>
                <p className="label">Título</p>
                <input
                  type="text"
                  value={post?.title ?? ''}
                  maxLength={p.titleMax}
                  placeholder="Un título corto y claro"
                  onFocus={checkpoint}
                  onChange={(e) => editPost(t.platform, (x) => void (x.title = e.target.value))}
                />
              </>
            )}
            <p className="label">Descripción</p>
            <textarea
              value={post?.description ?? ''}
              placeholder="¿De qué trata tu video?"
              onFocus={checkpoint}
              onChange={(e) => editPost(t.platform, (x) => void (x.description = e.target.value))}
            />
            <p className="label">Hashtags</p>
            <input
              type="text"
              value={post?.hashtags ?? ''}
              placeholder="#viaje #playa"
              onFocus={checkpoint}
              onChange={(e) => editPost(t.platform, (x) => void (x.hashtags = e.target.value))}
            />
            <p className={`count ${len > p.captionMax ? 'over' : ''}`}>
              {len} / {p.captionMax} caracteres
            </p>
            <div className="row">
              <button className="btn-ghost" onClick={() => copyText(t.platform)}>
                <ClipboardCopy size={18} /> Copiar texto
              </button>
              {targets.length > 1 && (
                <button className="btn-ghost" onClick={() => copyToAll(t.platform)}>
                  Usar este texto en todas las redes
                </button>
              )}
            </div>
          </details>
        );
      })}
      <Hint>Se guarda con el proyecto.</Hint>
    </>
  );
}
