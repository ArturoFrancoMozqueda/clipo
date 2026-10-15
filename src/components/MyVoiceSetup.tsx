import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from './Modal';
import { Check, Mic, Pause, Play, RotateCcw, ShieldCheck, Square, TriangleAlert, X } from 'lucide-react';
import { MAX_SECONDS, consentScript, recordSample, saveProfile, type QualityReport, type VoiceProfile, type VoiceRecording } from '../myVoice';
import { encodeWav } from '../voice';
import { CLONE_RATE } from '../myVoice';

type Step = 'intro' | 'ready' | 'recording' | 'review' | 'saving';

/**
 * Guided "Mi voz" setup: consent, read a short text aloud, check the take, save.
 * Reading a consent sentence in your own voice is part of the sample on purpose.
 */
export function MyVoiceSetup({ onClose, onSaved }: { onClose: () => void; onSaved: (p: VoiceProfile) => void }) {
  const [step, setStep] = useState<Step>('intro');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [count, setCount] = useState(0);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<{ cleaned: Float32Array; report: QualityReport; url: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const rec = useRef<VoiceRecording | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      rec.current?.cancel();
      audio.current?.pause();
    },
    [],
  );
  useEffect(() => () => void (take && URL.revokeObjectURL(take.url)), [take]);

  // Live level meter and automatic stop at the maximum length.
  useEffect(() => {
    if (step !== 'recording') return;
    let raf = 0;
    const tick = () => {
      const r = rec.current;
      if (!r) return;
      setLevel(r.level());
      const t = r.elapsed();
      setElapsed(t);
      if (t >= MAX_SECONDS) void stop();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const start = async () => {
    setError('');
    for (let n = 3; n > 0; n--) {
      setCount(n);
      await new Promise((r) => setTimeout(r, 800));
    }
    setCount(0);
    try {
      rec.current = await recordSample();
      setStep('recording');
    } catch (e) {
      const denied = (e as Error)?.name === 'NotAllowedError';
      setError(denied ? 'Clipo no tiene permiso para usar el micrófono. Actívalo en la configuración y vuelve a intentarlo.' : 'No se encontró un micrófono. Conecta uno e intenta otra vez.');
      setStep('ready');
    }
  };

  const stop = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    const { cleaned, report } = await r.stop();
    setTake({ cleaned, report, url: URL.createObjectURL(encodeWav(cleaned, CLONE_RATE)) });
    setStep('review');
  };

  const listen = () => {
    if (!take) return;
    if (playing) {
      audio.current?.pause();
      return setPlaying(false);
    }
    const a = new Audio(take.url);
    audio.current = a;
    a.onended = () => setPlaying(false);
    setPlaying(true);
    a.play().catch(() => setPlaying(false));
  };

  const save = async () => {
    if (!take) return;
    setStep('saving');
    try {
      onSaved(await saveProfile(name, take.cleaned));
    } catch {
      setError('No hay espacio para guardar la grabación en este dispositivo.');
      setStep('review');
    }
  };

  // Rendered on <body>: the settings panel is animated (transformed), which would trap a fixed overlay inside it.
  return createPortal(
    <Modal onClose={onClose} labelledBy="mv-title" className="myvoice">
        <header>
          <h3 id="mv-title">Crear mi voz</h3>
          <button className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <X />
          </button>
        </header>
        {error && <p className="warn"><TriangleAlert size={18} /> {error}</p>}

        {step === 'intro' && (
          <>
            <p>Graba tu voz leyendo un texto corto (unos 15 segundos). Después podrás escribir cualquier cosa y Clipo la dirá con tu voz.</p>
            <ul className="mv-tips">
              <li>Busca un lugar en silencio.</li>
              <li>Habla con tu tono natural, como si grabaras un video.</li>
              <li>Mantén el micrófono a un palmo de tu boca.</li>
            </ul>
            <label className="mv-field">
              <span>¿Cómo te llamas?</span>
              <input className="text-input" value={name} maxLength={40} placeholder="Tu nombre" onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="mv-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                <ShieldCheck size={16} /> Es <b>mi propia voz</b>. No la usaré para hacerme pasar por otra persona ni para engañar a nadie.
              </span>
            </label>
            <p className="muted small">La grabación se queda en este dispositivo. La voz se crea aquí mismo, sin subir nada a internet.</p>
            <button className="btn-primary big full" disabled={!consent || !name.trim()} onClick={() => setStep('ready')}>
              Continuar
            </button>
          </>
        )}

        {(step === 'ready' || step === 'recording') && (
          <>
            <p className="label">Lee este texto en voz alta:</p>
            <blockquote className="mv-script">{consentScript(name)}</blockquote>
            {step === 'recording' ? (
              <>
                <div className="mv-meter" aria-label="Nivel del micrófono">
                  <span style={{ width: `${Math.round(level * 100)}%` }} />
                </div>
                <p className="mv-timer">
                  <span className="mv-dot" /> Grabando… {elapsed.toFixed(0)} s
                </p>
                <button className="btn-primary big full" onClick={stop}>
                  <Square size={20} /> Terminé de leer
                </button>
              </>
            ) : count ? (
              <p className="mv-count">{count}</p>
            ) : (
              <button className="btn-primary big full" onClick={start}>
                <Mic size={22} /> Empezar a grabar
              </button>
            )}
          </>
        )}

        {(step === 'review' || step === 'saving') && take && (
          <>
            <p>Escucha cómo quedó tu grabación ({take.report.seconds.toFixed(1)} s).</p>
            <button className="btn-ghost" onClick={listen}>
              {playing ? <Pause size={18} /> : <Play size={18} />} {playing ? 'Pausar' : 'Escuchar grabación'}
            </button>
            {take.report.ok ? (
              <p className="ok"><Check size={18} /> La grabación se escucha bien.</p>
            ) : (
              <ul className="mv-problems">
                {take.report.problems.map((p) => (
                  <li key={p}><TriangleAlert size={16} /> {p}</li>
                ))}
              </ul>
            )}
            <div className="row">
              <button className="btn-ghost" disabled={step === 'saving'} onClick={() => { setTake(null); setStep('ready'); }}>
                <RotateCcw size={18} /> Grabar otra vez
              </button>
              <button className="btn-primary" disabled={!take.report.ok || step === 'saving'} onClick={save}>
                <Check size={18} /> {step === 'saving' ? 'Guardando…' : 'Guardar mi voz'}
              </button>
            </div>
          </>
        )}
    </Modal>,
    document.body,
  );
}
