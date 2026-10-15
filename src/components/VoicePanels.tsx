import { useEffect, useRef, useState } from 'react';
import { AudioLines, Mic, Pause, Play, Plus, Square, Trash2, TriangleAlert } from 'lucide-react';
import { useStore } from '../store';
import { engine } from '../engine';
import { fmtTime } from '../model';
import type { TextItem } from '../types';
import {
  SPEEDS, VOICES, addNarration, canRecord, encodeWav, openMic, profileVoice, startRecording, synthesize, voiceDownloadMB,
  type Recording, type TtsProgress, type Voice,
} from '../voice';
import './voice.css';
import { deleteProfile, listProfiles, warmUpClone, type VoiceProfile } from '../myVoice';
import { MyVoiceSetup } from './MyVoiceSetup';

const LIVELINESS = [
  { label: 'Tranquila', value: 0.3 },
  { label: 'Normal', value: 0.5 },
  { label: 'Animada', value: 0.8 },
];

function useProfiles() {
  const [list, setList] = useState<VoiceProfile[]>(listProfiles);
  useEffect(() => {
    const h = () => setList(listProfiles());
    window.addEventListener('clipo:myvoices', h);
    return () => window.removeEventListener('clipo:myvoices', h);
  }, []);
  return list;
}

const mb = (n: number) => `${Math.round(n / 1e6)} MB`;

// ---------- Grabar voz ----------

const MIC_ERRORS: Record<string, string> = {
  unsupported: 'Este navegador no puede grabar audio. Usa Chrome, Edge o Safari actualizados.',
  denied: 'Clipo no tiene permiso para usar el micrófono. Permítelo en el candado junto a la dirección de la página y vuelve a intentarlo.',
  'no-mic': 'No se encontró ningún micrófono. Conecta uno o revisa la configuración de tu dispositivo.',
  failed: 'No se pudo abrir el micrófono. Cierra otras apps que lo estén usando e intenta otra vez.',
};

type RecState = { kind: 'idle' } | { kind: 'asking' } | { kind: 'countdown'; n: number } | { kind: 'recording'; since: number } | { kind: 'saving' };

export function RecordPanel() {
  const [state, setState] = useState<RecState>({ kind: 'idle' });
  const [error, setError] = useState('');
  const [now, setNow] = useState(0);
  const rec = useRef<Recording | null>(null);
  // Bumped to abandon a countdown in progress (cancel button or panel closed).
  const run = useRef(0);
  const mounted = useRef(true);
  const stream = useRef<MediaStream | null>(null);
  const hasVideo = useStore((s) => (s.project?.clips.length ?? 0) > 0);

  const releaseMic = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  // Closing the panel keeps whatever was recorded and releases the microphone.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      run.current++;
      if (rec.current) rec.current.finish();
      else releaseMic();
    };
  }, []);

  useEffect(() => {
    if (state.kind !== 'recording') return;
    const t = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(t);
  }, [state.kind]);

  const begin = async () => {
    const id = ++run.current;
    setError('');
    engine.pause();
    setState({ kind: 'asking' });
    let ms: MediaStream;
    try {
      ms = await openMic();
    } catch (e) {
      if (id !== run.current) return;
      setError(MIC_ERRORS[(e as Error).message] ?? MIC_ERRORS.failed);
      return setState({ kind: 'idle' });
    }
    stream.current = ms;
    for (const n of [3, 2, 1]) {
      if (id !== run.current) return releaseMic();
      setState({ kind: 'countdown', n });
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (id !== run.current) return releaseMic();
    stream.current = null;
    rec.current = await startRecording(ms, (saved) => {
      rec.current = null;
      const s = useStore.getState();
      if (saved) {
        s.notify('¡Voz grabada! Está en la pista de audio. Puedes deshacerlo.');
        if (mounted.current) s.setPanel(null);
      } else if (mounted.current) {
        setState({ kind: 'idle' });
        setError('La grabación quedó vacía o no se pudo leer. Habla después de la cuenta regresiva e intenta otra vez.');
      }
    });
    setNow(performance.now());
    setState({ kind: 'recording', since: performance.now() });
  };

  const stopCountdown = () => {
    run.current++;
    releaseMic();
    setState({ kind: 'idle' });
  };

  if (state.kind === 'countdown' || state.kind === 'asking') {
    return (
      <div className="voice-center">
        {state.kind === 'asking' ? (
          <p>Permite el uso del micrófono si el navegador te lo pide…</p>
        ) : (
          <>
            <div className="countdown" key={state.n} aria-live="assertive">{state.n}</div>
            <p>Prepárate para hablar…</p>
          </>
        )}
        <button className="btn-ghost" onClick={stopCountdown}>Cancelar</button>
      </div>
    );
  }

  if (state.kind === 'recording' || state.kind === 'saving') {
    const secs = state.kind === 'recording' ? Math.max(0, (now - state.since) / 1000) : 0;
    return (
      <div className="voice-center">
        <p className="rec-live"><span className="rec-dot" /> {state.kind === 'saving' ? 'Guardando tu voz…' : `Grabando · ${fmtTime(secs, true)}`}</p>
        {state.kind === 'recording' && (
          <button
            className="btn-rec stop"
            onClick={() => {
              setState({ kind: 'saving' });
              rec.current?.finish();
            }}
          >
            <Square size={26} /> Detener
          </button>
        )}
        <p className="muted small">{hasVideo ? 'La grabación termina sola al llegar al final del video.' : 'Toca “Detener” cuando termines.'}</p>
      </div>
    );
  }

  return (
    <>
      {error && <p className="warn"><TriangleAlert size={18} /> {error}</p>}
      <p className="muted small">
        {hasVideo
          ? 'El video se reproduce desde la línea blanca mientras hablas, para que tu voz quede en el momento justo.'
          : 'Graba tu voz. Se pondrá en la línea de tiempo donde está la línea blanca.'}
      </p>
      <button className="btn-rec" onClick={begin} disabled={!canRecord()}>
        <Mic size={28} /> Grabar voz
      </button>
      <p className="muted small">Consejo: usa audífonos para que el sonido del video no se grabe junto con tu voz.</p>
    </>
  );
}

// ---------- Texto a voz ----------

const SAMPLE = 'Hola, así suena mi voz en tu video.';

export function TtsPanel() {
  const project = useStore((s) => s.project!);
  // Read the selected text once: picking a text then opening this panel narrates it.
  const [source] = useState<TextItem | undefined>(() => {
    const s = useStore.getState();
    return s.selection?.kind === 'text' ? s.project!.texts.find((t) => t.id === s.selection!.id) : undefined;
  });
  const [text, setText] = useState(source?.text ?? '');
  const profiles = useProfiles();
  const myVoices = profiles.map(profileVoice);
  const [voice, setVoice] = useState<Voice>(() => myVoices[0] ?? VOICES[0]);
  const [speed, setSpeed] = useState(1);
  const [liveliness, setLiveliness] = useState(0.5);
  const [setup, setSetup] = useState(false);
  const isClone = voice.engine === 'clone';
  // Cloned voices take their liveliness from the panel; the others ignore it.
  const effective = (v: Voice): Voice => (v.engine === 'clone' ? { ...v, exaggeration: liveliness } : v);
  // Your voice needs a few minutes to get ready: start while the user is still typing.
  useEffect(() => {
    if (isClone) warmUpClone();
  }, [isClone]);
  const [busy, setBusy] = useState<'create' | string | null>(null);
  const [progress, setProgress] = useState<TtsProgress | null>(null);
  const [error, setError] = useState('');
  const player = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const samples = useRef(new Map<string, string>());

  useEffect(
    () => () => {
      player.current?.pause();
      for (const u of samples.current.values()) URL.revokeObjectURL(u);
    },
    [],
  );

  const fail = (e: unknown) => {
    console.error(e);
    setError(
      `No se pudo preparar la voz. Revisa tu conexión a internet (solo se necesita la primera vez) e intenta otra vez.${
        voice.engine !== 'piper' ? ' Si tu dispositivo tiene poca memoria, prueba una voz natural (Claudia, Aldo…), que son más ligeras.' : ''
      }`,
    );
  };

  const preview = async (v: Voice) => {
    if (playing === v.id) {
      player.current?.pause();
      return setPlaying(null);
    }
    player.current?.pause();
    setPlaying(null);
    setVoice(v);
    setError('');
    const key = `${v.id}@${speed}@${liveliness}`;
    let url = samples.current.get(key);
    if (!url) {
      setBusy(v.id);
      setProgress(null);
      try {
        const out = await synthesize(SAMPLE, effective(v), speed, setProgress);
        url = URL.createObjectURL(encodeWav(out.samples, out.sampleRate));
        samples.current.set(key, url);
      } catch (e) {
        return fail(e);
      } finally {
        setBusy(null);
      }
    }
    const a = new Audio(url);
    player.current = a;
    a.onended = () => setPlaying(null);
    setPlaying(v.id);
    a.play().catch(() => setPlaying(null));
  };

  const create = async () => {
    if (!text.trim()) return setError('Escribe primero lo que quieres que se diga.');
    player.current?.pause();
    setPlaying(null);
    engine.pause();
    setError('');
    setBusy('create');
    setProgress(null);
    const start = source?.start ?? useStore.getState().time;
    try {
      const secs = await addNarration(text, effective(voice), speed, start, setProgress);
      const s = useStore.getState();
      s.setPanel(null);
      s.notify(`Narración lista (${fmtTime(secs)}). Está en la pista de audio. Puedes deshacerlo.`);
    } catch (e) {
      if ((e as Error).message === 'empty') setError('Escribe primero lo que quieres que se diga.');
      else fail(e);
    } finally {
      setBusy(null);
    }
  };

  const progressLabel = () => {
    if (!progress) return 'Preparando la voz…';
    if (progress.phase === 'download')
      return progress.pct >= 99.5
        ? 'Preparando la voz…'
        : `Descargando la voz (solo la primera vez)… ${progress.total ? `${mb(progress.loaded)} de ${mb(progress.total)}` : ''}`;
    return busy === 'create' ? 'Leyendo el texto en voz alta…' : 'Creando la muestra…';
  };

  const texts = project.texts.filter((t) => t.text.trim());

  return (
    <>
      {error && <p className="warn"><TriangleAlert size={18} /> {error}</p>}
      <textarea
        className="text-input"
        rows={3}
        value={text}
        placeholder="Escribe lo que quieres que diga la voz"
        disabled={!!busy}
        onChange={(e) => setText(e.target.value)}
      />
      {!source && texts.length > 0 && (
        <div className="chips tts-texts">
          <span className="muted small">Usar un texto del video:</span>
          {texts.slice(0, 6).map((t) => (
            <button key={t.id} className="chip" disabled={!!busy} onClick={() => setText(t.text)}>
              {t.text.length > 20 ? t.text.slice(0, 20) + '…' : t.text}
            </button>
          ))}
        </div>
      )}
      <p className="label">Mi voz</p>
      <div className="voice-grid">
        {myVoices.map((v) => (
          <div key={v.id} className={`voice-card mine ${voice.id === v.id ? 'active' : ''}`}>
            <button className="voice-pick" disabled={!!busy} onClick={() => setVoice(v)} aria-pressed={voice.id === v.id}>
              <b>{v.name}</b>
              <small>{v.desc}</small>
            </button>
            <button className="voice-play" disabled={!!busy && busy !== v.id} onClick={() => preview(v)} aria-label={`Escuchar ${v.name}`} title="Escuchar">
              {busy === v.id ? <span className="spinner" /> : playing === v.id ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button
              className="voice-play"
              disabled={!!busy}
              title="Borrar esta voz"
              aria-label={`Borrar la voz ${v.name}`}
              onClick={async () => {
                if (!confirm(`¿Borrar la voz "${v.name}"? Se elimina la grabación de este dispositivo.`)) return;
                await deleteProfile(v.profileId!);
                if (voice.id === v.id) setVoice(VOICES[0]);
              }}
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
        <button className="voice-card voice-new" disabled={!!busy} onClick={() => setSetup(true)}>
          <span><Plus size={18} /> <b>{myVoices.length ? 'Grabar otra voz' : 'Crear mi voz'}</b></span>
          <small>Grábate 15 segundos y Clipo hablará como tú</small>
        </button>
      </div>
      <p className="label">Voces de Clipo</p>
      <div className="voice-grid">
        {VOICES.map((v) => (
          <div key={v.id} className={`voice-card ${voice.id === v.id ? 'active' : ''}`}>
            <button className="voice-pick" disabled={!!busy} onClick={() => setVoice(v)} aria-pressed={voice.id === v.id}>
              <b>{v.name}</b>
              <small>{v.desc}</small>
            </button>
            <button
              className="voice-play"
              disabled={!!busy && busy !== v.id}
              onClick={() => preview(v)}
              aria-label={`Escuchar la voz ${v.name}`}
              title="Escuchar"
            >
              {busy === v.id ? <span className="spinner" /> : playing === v.id ? <Pause size={20} /> : <Play size={20} />}
            </button>
          </div>
        ))}
      </div>
      {isClone && (
        <>
          <p className="label">Expresión</p>
          <div className="chips">
            {LIVELINESS.map((l) => (
              <button key={l.value} className={`chip ${liveliness === l.value ? 'active' : ''}`} disabled={!!busy} onClick={() => setLiveliness(l.value)}>
                {l.label}
              </button>
            ))}
          </div>
        </>
      )}
      {!isClone && <p className="label">Velocidad</p>}
      {!isClone && (
      <div className="chips">
        {SPEEDS.map((sp) => (
          <button
            key={sp.value}
            className={`chip ${speed === sp.value ? 'active' : ''}`}
            disabled={!!busy}
            onClick={() => setSpeed(sp.value)}
          >
            {sp.label}
          </button>
        ))}
      </div>
      )}
      {busy ? (
        <div className="export-running">
          <div className="progress"><span style={{ width: `${progress?.pct ?? 0}%` }} /></div>
          <p>
            {progressLabel()} <b>{Math.round(progress?.pct ?? 0)} %</b>
          </p>
        </div>
      ) : (
        <button className="btn-primary big full" onClick={create}>
          <AudioLines size={22} /> Crear narración
        </button>
      )}
      <p className="muted small">
        {source ? 'La voz empezará donde empieza el texto seleccionado. ' : 'La voz empezará donde está la línea blanca. '}
        Se crea en tu dispositivo; la primera vez se descarga la voz (unos {voiceDownloadMB(voice)} MB) y queda guardada.
        {isClone && ' Con tu voz, la primera narración de cada sesión tarda unos minutos en prepararse y cada frase alrededor de un minuto. Puedes seguir editando mientras tanto.'}
      </p>
      {setup && (
        <MyVoiceSetup
          onClose={() => setSetup(false)}
          onSaved={(p) => {
            setSetup(false);
            setVoice(profileVoice(p));
            useStore.getState().notify(`Tu voz "${p.name}" está lista. Escribe un texto y toca Crear narración.`);
          }}
        />
      )}
    </>
  );
}
