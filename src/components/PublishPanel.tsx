import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, CheckCircle2, ExternalLink, ImagePlus, Link2, RotateCcw, Share2, TriangleAlert, Upload, X } from 'lucide-react';
import { fmtTime } from '../model';
import { useStore } from '../store';
import { canShareFile, saveFile, shareFile } from '../nativeShare';
import { bridgeError, desktop, type YouTubeConfig } from '../publish/desktop';
import { PUBLISH_FLAGS } from '../publish/flags';
import { NETWORK_ORDER, NETWORKS } from '../publish/networks';
import { canCancel, canRetry, PublishError } from '../publish/queue';
import { cancelJob, forgetBatch, publisherFor, queuePublish, refreshAccounts, retryJob, usePublish } from '../publish/store';
import { mergePost } from '../publish/text';
import type { ConnectedAccount, NetworkId, Privacy, PostText, PublishJob, RemoteStatus, VideoInfo } from '../publish/types';
import { youtubePublisher } from '../publish/youtube';
import '../publish/publish.css';

const Note = ({ children }: { children: ReactNode }) => <p className="muted small">{children}</p>;

type Tab = 'new' | 'history' | 'accounts';

/** "Publicar": connect accounts, send one video to several networks, and follow each upload. */
export function PublishPanel() {
  const isDesktop = usePublish((s) => s.desktop);
  const jobs = usePublish((s) => s.jobs);
  const [tab, setTab] = useState<Tab>('new');
  if (!isDesktop) return <WebPublish />;
  const busy = jobs.filter((j) => j.status.kind === 'uploading' || j.status.kind === 'pending').length;
  return (
    <div className="publish">
      <div className="chips" role="tablist">
        <button role="tab" aria-selected={tab === 'new'} className={`chip ${tab === 'new' ? 'active' : ''}`} onClick={() => setTab('new')}>Publicar</button>
        <button role="tab" aria-selected={tab === 'history'} className={`chip ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          Historial{busy ? ` (${busy})` : ''}
        </button>
        <button role="tab" aria-selected={tab === 'accounts'} className={`chip ${tab === 'accounts' ? 'active' : ''}`} onClick={() => setTab('accounts')}>Cuentas</button>
      </div>
      {tab === 'new' && <NewPost onQueued={() => setTab('history')} onAccounts={() => setTab('accounts')} />}
      {tab === 'history' && <History />}
      {tab === 'accounts' && <Accounts />}
    </div>
  );
}

// ---------- browser / phone ----------

function WebPublish() {
  const file = usePublish((s) => s.handoff);
  const canShare = !!file && canShareFile(file);
  return (
    <div className="publish">
      <p className="pub-callout">
        Publicar directo en YouTube y otras redes funciona en la <b>app de Clipo para computadora</b>, porque ahí tus cuentas se conectan de forma segura en tu propio equipo.
      </p>
      <Note>Desde aquí puedes usar “Compartir” para mandar el video a la app de cada red, o descargarlo y subirlo tú.</Note>
      {file && (
        <div className="row">
          {canShare && (
            <button className="btn-primary" onClick={() => void shareFile(file, file.name)}>
              <Share2 size={18} /> Compartir
            </button>
          )}
          <button className="btn-primary alt" onClick={() => void saveFile(file)}>Descargar</button>
        </div>
      )}
      {!file && <Note>Primero guarda tu video con “Guardar video”.</Note>}
    </div>
  );
}

// ---------- new post ----------

const PRIVACY: { id: Privacy; label: string; hint: string }[] = [
  { id: 'public', label: 'Público', hint: 'Cualquiera puede verlo' },
  { id: 'unlisted', label: 'No listado', hint: 'Solo con el enlace' },
  { id: 'private', label: 'Privado', hint: 'Solo tú' },
];

const targetKey = (accountId: string, network: NetworkId) => `${accountId}|${network}`;

function useVideoInfo(file: File | null) {
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setInfo(null);
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () =>
      setInfo({ name: file.name, type: file.type || 'video/mp4', bytes: file.size, width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : 0 });
    v.src = u;
    return () => {
      v.removeAttribute('src');
      URL.revokeObjectURL(u);
    };
  }, [file]);
  return { info, url };
}

function NewPost({ onQueued, onAccounts }: { onQueued: () => void; onAccounts: () => void }) {
  const handoff = usePublish((s) => s.handoff);
  const accounts = usePublish((s) => s.accounts);
  const [file, setFile] = useState<File | null>(handoff);
  useEffect(() => setFile(handoff), [handoff]);
  const { info, url } = useVideoInfo(file);
  const [availability, setAvailability] = useState<string | null>(null);
  useEffect(() => void youtubePublisher.availability().then((a) => setAvailability(a.ok ? null : a.reason)), [accounts]);

  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [common, setCommon] = useState<PostText>({ title: '', description: '', hashtags: '' });
  const [own, setOwn] = useState<Partial<Record<NetworkId, PostText>>>({});
  const [privacy, setPrivacy] = useState<Privacy>('public');
  const [kids, setKids] = useState(false);
  const [cover, setCover] = useState<Blob | null>(null);
  // Created inside the effect: a memoized URL would be revoked by StrictMode's double mount.
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!cover) return setCoverUrl(null);
    const u = URL.createObjectURL(cover);
    setCoverUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [cover]);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [date, setDate] = useState('');
  const [schedMode, setSchedMode] = useState<'native' | 'local'>('native');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = accounts.flatMap((a) => a.networks.filter((n) => targets.has(targetKey(a.id, n))).map((network) => ({ network, account: a })));
  const networks = [...new Set(chosen.map((t) => t.network))];
  const postFor = (n: NetworkId) => mergePost(common, own[n]);
  const scheduledAt = when === 'later' && date ? new Date(date).getTime() : undefined;
  const native = when === 'later' && schedMode === 'native';

  const issues: string[] = [];
  if (!file) issues.push('Elige el video que quieres publicar.');
  else if (!info) issues.push('Leyendo el video…');
  if (!chosen.length) issues.push('Marca al menos un destino.');
  if (when === 'later' && (!scheduledAt || scheduledAt < Date.now() + 60_000)) issues.push('Elige una fecha y hora en el futuro.');
  if (native && scheduledAt && scheduledAt < Date.now() + 15 * 60_000) issues.push('Para que YouTube lo programe, elige una hora al menos 15 minutos más adelante.');
  if (info) for (const n of networks) for (const i of publisherFor(n)?.check(n, info, postFor(n)) ?? []) issues.push(`${NETWORKS[n].name}: ${i}`);
  const uniqueIssues = [...new Set(issues)];

  const toggle = (k: string) =>
    setTargets((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const send = async () => {
    if (!file || !info) return;
    setSending(true);
    setError(null);
    try {
      await queuePublish({
        file,
        video: info,
        thumbnail: cover ?? undefined,
        targets: chosen.map((t) => ({ network: t.network, account: t.account })),
        posts: Object.fromEntries(networks.map((n) => [n, postFor(n)])),
        options: { privacy: native ? 'public' : privacy, madeForKids: kids, nativePublishAt: native ? scheduledAt : undefined },
        scheduledAt: when === 'later' && !native ? scheduledAt : undefined,
      });
      useStore.getState().notify(when === 'later' && !native ? 'Publicación programada' : 'Publicación en marcha');
      setConfirming(false);
      onQueued();
    } catch (e) {
      setError(e instanceof PublishError ? e.message : 'No se pudo preparar la publicación. Intenta otra vez.');
    } finally {
      setSending(false);
    }
  };

  const pickFile = (accept: string, onFile: (f: File) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => input.files?.[0] && onFile(input.files[0]);
    input.click();
  };

  return (
    <>
      <p className="label">1. Video</p>
      {file ? (
        <div className="pub-video">
          {url && <video src={url} controls playsInline id="pub-preview" />}
          <div>
            <b>{file.name}</b>
            <Note>{info ? `${info.width}×${info.height} · ${fmtTime(info.duration)} · ${(info.bytes / 1e6).toFixed(1)} MB` : 'Leyendo…'}</Note>
            <button className="btn-ghost" onClick={() => pickFile('video/mp4,video/*', setFile)}>Elegir otro</button>
          </div>
        </div>
      ) : (
        <>
          <Note>Guarda tu video con “Guardar video” y pulsa “Publicar en redes”, o elige uno de tu computadora.</Note>
          <button className="btn-ghost" onClick={() => pickFile('video/mp4,video/*', setFile)}>Elegir un video</button>
        </>
      )}

      <p className="label">2. Dónde publicar</p>
      {availability && (
        <p className="warn"><TriangleAlert size={18} /> {availability}</p>
      )}
      {!accounts.length && !availability && (
        <Note>Todavía no conectaste ningún canal. <button className="link" onClick={onAccounts}>Conectar en Cuentas</button></Note>
      )}
      <div className="pub-targets">
        {accounts.map((a) =>
          a.networks.map((n) => {
            const shape = info && n === 'youtube_shorts' ? (publisherFor(n)?.check(n, info, { ...common, title: 'x' }) ?? []) : [];
            const k = targetKey(a.id, n);
            return (
              <label key={k} className={`pub-target ${shape.length ? 'off' : ''}`}>
                <input type="checkbox" checked={targets.has(k)} disabled={!!shape.length && !targets.has(k)} onChange={() => toggle(k)} />
                <span>
                  <b>{NETWORKS[n].name}</b> · {a.name}
                  {shape.length > 0 && <small>{shape.join(' ')}</small>}
                </span>
              </label>
            );
          }),
        )}
      </div>
      {PUBLISH_FLAGS.upcomingNetworks && (
        <Note>
          TikTok, Instagram, Facebook, X y LinkedIn todavía requieren configuración. <button className="link" onClick={onAccounts}>Ver qué falta</button>
        </Note>
      )}

      <p className="label">3. Texto</p>
      <PostFields value={common} onChange={setCommon} />
      {networks.map((n) => (
        <details key={n} className="pub-own" open={!!own[n]}>
          <summary
            onClick={(e) => {
              e.preventDefault();
              setOwn((o) => {
                const next = { ...o };
                if (next[n]) delete next[n];
                else next[n] = { ...common };
                return next;
              });
            }}
          >
            {own[n] ? `Usar el texto común en ${NETWORKS[n].name}` : `Escribir un texto distinto para ${NETWORKS[n].name}`}
          </summary>
          {own[n] && <PostFields value={own[n]!} onChange={(v) => setOwn((o) => ({ ...o, [n]: v }))} />}
        </details>
      ))}

      <p className="label">4. Portada (opcional)</p>
      <div className="row">
        {coverUrl && <img src={coverUrl} alt="Portada elegida" className="pub-cover" />}
        <button className="btn-ghost" onClick={() => pickFile('image/jpeg,image/png', setCover)}>
          <ImagePlus size={18} /> Elegir imagen
        </button>
        {url && (
          <button className="btn-ghost" onClick={() => grabFrame().then((b) => b && setCover(b))}>
            Usar el cuadro que se ve en el video
          </button>
        )}
        {cover && <button className="btn-ghost" onClick={() => setCover(null)}>Quitar</button>}
      </div>
      <Note>Si no eliges ninguna, YouTube usa un cuadro del video. Para portadas propias YouTube pide tener el canal verificado.</Note>

      <p className="label">5. Cuándo</p>
      <div className="chips">
        <button className={`chip ${when === 'now' ? 'active' : ''}`} onClick={() => setWhen('now')}>Ahora</button>
        <button className={`chip ${when === 'later' ? 'active' : ''}`} onClick={() => setWhen('later')}>
          <CalendarClock size={16} /> Programar
        </button>
      </div>
      {when === 'later' && (
        <div className="pub-schedule">
          <input type="datetime-local" className="text-input" value={date} onChange={(e) => setDate(e.target.value)} />
          <label className="pub-radio">
            <input type="radio" checked={schedMode === 'native'} onChange={() => setSchedMode('native')} />
            <span>
              <b>Que YouTube lo publique a esa hora</b> (recomendado)
              <small>Clipo lo sube ahora como privado y YouTube lo hace público a esa hora, aunque cierres Clipo o apagues la computadora.</small>
            </span>
          </label>
          <label className="pub-radio">
            <input type="radio" checked={schedMode === 'local'} onChange={() => setSchedMode('local')} />
            <span>
              <b>Que Clipo lo suba a esa hora</b>
              <small>Solo funciona si a esa hora Clipo está abierto y la computadora encendida y con internet. Si no, quedará como “No se publicó” y tú decides si subirlo.</small>
            </span>
          </label>
        </div>
      )}

      {!native && (
        <>
          <p className="label">6. Quién puede verlo</p>
          <div className="chips">
            {PRIVACY.map((p) => (
              <button key={p.id} className={`chip big ${privacy === p.id ? 'active' : ''}`} onClick={() => setPrivacy(p.id)}>
                {p.label} <small>{p.hint}</small>
              </button>
            ))}
          </div>
        </>
      )}
      <label className="pub-radio">
        <input type="checkbox" checked={kids} onChange={(e) => setKids(e.target.checked)} />
        <span>
          Es un video hecho para niños
          <small>YouTube pide declararlo. Si lo marcas, se desactivan los comentarios y otras funciones.</small>
        </span>
      </label>

      {error && <p className="warn"><TriangleAlert size={18} /> {error}</p>}
      {uniqueIssues.length > 0 && (
        <ul className="pub-issues">
          {uniqueIssues.map((i) => <li key={i}>{i}</li>)}
        </ul>
      )}
      {!confirming ? (
        <button className="btn-primary big full" disabled={uniqueIssues.length > 0} onClick={() => setConfirming(true)}>
          <Upload size={20} /> {when === 'later' ? 'Programar' : 'Publicar'}{chosen.length ? ` en ${chosen.length} ${chosen.length === 1 ? 'destino' : 'destinos'}` : ''}
        </button>
      ) : (
        <div className="pub-confirm">
          <p><b>¿Confirmas?</b> Se subirá “{info?.name}” a:</p>
          <ul>
            {chosen.map((t) => (
              <li key={targetKey(t.account.id, t.network)}>{NETWORKS[t.network].name} · {t.account.name}</li>
            ))}
          </ul>
          <p className="small">
            {when === 'now' && `Ahora, como ${PRIVACY.find((p) => p.id === privacy)!.label.toLowerCase()}.`}
            {native && scheduledAt && `Se sube ahora como privado y YouTube lo publica el ${new Date(scheduledAt).toLocaleString('es')}.`}
            {when === 'later' && !native && scheduledAt && `Clipo lo subirá el ${new Date(scheduledAt).toLocaleString('es')} si está abierto.`}
          </p>
          <div className="row">
            <button className="btn-primary" disabled={sending} onClick={send}>{sending ? 'Preparando…' : 'Sí, publicar'}</button>
            <button className="btn-ghost" disabled={sending} onClick={() => setConfirming(false)}>Volver</button>
          </div>
        </div>
      )}
    </>
  );
}

/** JPEG of the frame currently shown in the panel's video preview. */
function grabFrame(): Promise<Blob | null> {
  const v = document.getElementById('pub-preview') as HTMLVideoElement | null;
  if (!v || !v.videoWidth) return Promise.resolve(null);
  const c = document.createElement('canvas');
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext('2d')!.drawImage(v, 0, 0);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
}

function PostFields({ value, onChange }: { value: PostText; onChange: (v: PostText) => void }) {
  return (
    <div className="pub-fields">
      <input className="text-input" placeholder="Título (YouTube lo pide, máx. 100 letras)" maxLength={100} value={value.title ?? ''} onChange={(e) => onChange({ ...value, title: e.target.value })} />
      <textarea className="text-input" rows={3} placeholder="Descripción" value={value.description} onChange={(e) => onChange({ ...value, description: e.target.value })} />
      <input className="text-input" placeholder="Hashtags, por ejemplo: #viaje #playa" value={value.hashtags} onChange={(e) => onChange({ ...value, hashtags: e.target.value })} />
    </div>
  );
}

// ---------- history ----------

function statusText(j: PublishJob): string {
  const s = j.status;
  switch (s.kind) {
    case 'scheduled':
      return `Programado para el ${new Date(j.scheduledAt!).toLocaleString('es')} · Clipo debe estar abierto`;
    case 'pending':
      return 'En espera';
    case 'uploading':
      return `Subiendo… ${Math.floor(s.pct)} %`;
    case 'published':
      return 'Publicado';
    case 'error':
      return s.reason;
    case 'missed':
      return `No se publicó: ${s.reason}`;
    case 'cancelled':
      return 'Cancelado';
  }
}

function History() {
  const jobs = usePublish((s) => s.jobs);
  const loaded = usePublish((s) => s.loaded);
  const batches = useMemo(() => {
    const m = new Map<string, PublishJob[]>();
    for (const j of [...jobs].sort((a, b) => b.createdAt - a.createdAt)) m.set(j.batchId, [...(m.get(j.batchId) ?? []), j]);
    return [...m.values()];
  }, [jobs]);
  if (!loaded) return <Note>Cargando…</Note>;
  if (!batches.length) return <Note>Aquí verás cada publicación y su estado en cada red.</Note>;
  return (
    <div className="pub-history">
      {batches.map((list) => {
        const [first] = list;
        if (!first) return null;
        const settled = list.every((j) => !['uploading', 'pending', 'scheduled'].includes(j.status.kind));
        return (
          <section key={first.batchId} className="pub-batch">
            <header>
              <b>{first.post.title || first.video.name}</b>
              <span className="muted small">{new Date(first.createdAt).toLocaleString('es')}</span>
            </header>
            {list.map((j) => <JobRow key={j.id} job={j} />)}
            {settled && (
              <button className="link small" onClick={() => forgetBatch(first.batchId)}>Quitar del historial</button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function JobRow({ job }: { job: PublishJob }) {
  const [remote, setRemote] = useState<RemoteStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const s = job.status;
  const check = async () => {
    if (s.kind !== 'published') return;
    setChecking(true);
    setRemote((await publisherFor(job.network)?.status(job.accountId, s.remoteId)) ?? null);
    setChecking(false);
  };
  return (
    <div className={`pub-job ${s.kind}`}>
      <div className="pub-job-head">
        <span>
          <b>{NETWORKS[job.network].name}</b> · {job.accountName}
        </span>
        {s.kind === 'published' && <CheckCircle2 size={18} className="ok-icon" />}
      </div>
      {s.kind === 'uploading' && (
        <div className="progress"><span style={{ width: `${s.pct}%` }} /></div>
      )}
      <p className="small">{statusText(job)}</p>
      {s.kind === 'published' && s.note && <p className="small muted">{s.note}</p>}
      {remote && <p className="small muted">{remote.detail}</p>}
      <div className="row">
        {s.kind === 'published' && (
          <>
            <a className="btn-ghost" href={s.url} target="_blank" rel="noreferrer">
              <ExternalLink size={16} /> Abrir
            </a>
            <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(s.url)}>
              <Link2 size={16} /> Copiar enlace
            </button>
            <button className="btn-ghost" disabled={checking} onClick={check}>{checking ? 'Consultando…' : 'Consultar estado'}</button>
          </>
        )}
        {canRetry(job) && (
          <button className="btn-ghost" onClick={() => retryJob(job.id)}>
            <RotateCcw size={16} /> {s.kind === 'missed' ? 'Publicar ahora' : 'Reintentar'}
          </button>
        )}
        {canCancel(job) && (
          <button className="btn-ghost" onClick={() => cancelJob(job.id)}>
            <X size={16} /> {s.kind === 'error' || s.kind === 'missed' ? 'Descartar' : 'Cancelar'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- accounts ----------

function Accounts() {
  const accounts = usePublish((s) => s.accounts);
  const [cfg, setCfg] = useState<YouTubeConfig | null>(null);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [connecting, setConnecting] = useState(false);

  const reload = () =>
    desktop()?.youtube.getConfig().then((c) => {
      setCfg(c);
      setClientId(c.clientId);
    });
  useEffect(() => void reload(), []);

  const saveCfg = async () => {
    setMsg(null);
    if (cfg?.clientId && clientId.trim() !== cfg.clientId && accounts.length && !confirm('Con otro ID de cliente tendrás que volver a conectar tus canales. ¿Continuar?')) return;
    try {
      await desktop()!.youtube.setConfig({ clientId, clientSecret: secret || undefined });
      setSecret('');
      await reload();
      await refreshAccounts();
      setMsg({ ok: true, text: 'Guardado.' });
    } catch (e) {
      setMsg({ ok: false, text: bridgeError(e).message });
    }
  };

  const connect = async () => {
    setMsg(null);
    setConnecting(true);
    try {
      const a = await youtubePublisher.connect();
      await refreshAccounts();
      setMsg({ ok: true, text: `Conectado: ${a.name}` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo conectar.' });
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async (a: ConnectedAccount) => {
    if (!confirm(`¿Desconectar “${a.name}”? Clipo borrará su acceso guardado en este equipo.`)) return;
    await youtubePublisher.disconnect(a.id);
    await refreshAccounts();
  };

  return (
    <>
      <section className="pub-card">
        <header><b>YouTube y YouTube Shorts</b></header>
        {cfg && !cfg.encryption && (
          <p className="warn"><TriangleAlert size={18} /> Este equipo no permite guardar la sesión cifrada, así que Clipo no conecta cuentas.</p>
        )}
        {accounts.map((a) => (
          <div key={a.id} className="pub-account">
            {a.avatar && <img src={a.avatar} alt="" referrerPolicy="no-referrer" />}
            <span><b>{a.name}</b><small className="muted"> · conectado el {new Date(a.connectedAt).toLocaleDateString('es')}</small></span>
            <button className="btn-ghost" onClick={() => disconnect(a)}>Desconectar</button>
          </div>
        ))}
        {connecting ? (
          <div className="pub-callout">
            Se abrió tu navegador para entrar con Google. Elige tu cuenta, acepta los permisos y vuelve aquí.
            <div className="row"><button className="btn-ghost" onClick={() => youtubePublisher.cancelConnect()}>Cancelar</button></div>
          </div>
        ) : (
          <button className="btn-primary" disabled={!cfg?.clientId || !cfg.encryption} onClick={connect}>
            {accounts.length ? 'Conectar otro canal' : 'Conectar mi canal de YouTube'}
          </button>
        )}
        {msg && <p className={msg.ok ? 'pub-ok' : 'warn'}>{msg.text}</p>}

        <details className="pub-own" open={!cfg?.clientId}>
          <summary>Configuración de Google (se hace una sola vez)</summary>
          <ol className="pub-steps small">
            <li>Entra a <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a> y crea un proyecto.</li>
            <li>Activa la “YouTube Data API v3”.</li>
            <li>Configura la pantalla de consentimiento (tipo Externo) y agrega tu correo como usuario de prueba.</li>
            <li>En Credenciales crea un “ID de cliente de OAuth” de tipo <b>App de escritorio</b>.</li>
            <li>Pega aquí el ID de cliente y el secreto que te muestra Google.</li>
          </ol>
          <div className="pub-fields">
            <input className="text-input" placeholder="ID de cliente (termina en .apps.googleusercontent.com)" value={clientId} onChange={(e) => setClientId(e.target.value)} spellCheck={false} />
            <input className="text-input" type="password" placeholder={cfg?.hasSecret ? 'Secreto del cliente: guardado (escribe para cambiarlo)' : 'Secreto del cliente'} value={secret} onChange={(e) => setSecret(e.target.value)} spellCheck={false} />
          </div>
          <button className="btn-ghost" onClick={saveCfg}>Guardar</button>
          <Note>
            Todo se guarda cifrado en este equipo. Con apps de escritorio Google entrega un “secreto” que no es realmente secreto, pero igual lo pide al conectar.
            Tu proyecto puede subir hasta 100 videos por día. Mientras la app de Google esté “en prueba”, Google corta la conexión cada 7 días y hay que volver a conectar.
          </Note>
        </details>
      </section>

      {PUBLISH_FLAGS.upcomingNetworks &&
        NETWORK_ORDER.filter((n) => NETWORKS[n].state === 'needs-setup').map((n) => (
          <section key={n} className="pub-card pending">
            <header>
              <b>{NETWORKS[n].name}</b>
              <span className="pub-badge">Requiere configuración</span>
            </header>
            <p className="small">Clipo todavía no puede publicar aquí. Lo que falta:</p>
            <ul className="small">
              {NETWORKS[n].needs.map((x) => <li key={x}>{x}</li>)}
            </ul>
            <a className="small" href={NETWORKS[n].docs} target="_blank" rel="noreferrer">Ver la documentación oficial</a>
          </section>
        ))}
    </>
  );
}
