import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Scissors, Search } from 'lucide-react';
import type { AudioItem, AudioMix, AudioRole, Clip, Project, VoiceFxId } from '../types';
import { uid, useStore } from '../store';
import { engine } from '../engine';
import { fmtTime, mainDuration, totalDuration } from '../model';
import { DUCK_DEFAULT, LOUDNESS_TARGET, VOICE_FX, analyzeAsset, mixOf, projectDuckCurve, voiceAssets } from '../audioFx';
import { FRAME, applySilenceCuts, audioRole, planSilenceCuts, type SilenceCut, type SilenceOptions } from '../audioDsp';
import type { LoudnessReport } from '../exporter';
import { Hint, Slider, checkpoint, editSelected, useSelected } from './Panels';

const setMix = (patch: Partial<AudioMix>, live = false) => {
  const s = useStore.getState();
  const fn = (p: Project) => void (p.audioMix = { ...mixOf(p), ...patch });
  if (live) s.live(fn);
  else s.commit(fn);
};

function Switch(props: { on: boolean; title: string; hint: string; onChange: (on: boolean) => void }) {
  return (
    <label className="adv-toggle">
      <input type="checkbox" checked={props.on} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="adv-switch" aria-hidden />
      <span>
        <b>{props.title}</b>
        <small>{props.hint}</small>
      </span>
    </label>
  );
}

// ---------- per item: voice effect and kind of audio ----------

/** Voice effects for the selected video or audio. */
export function VoiceFxSection() {
  const clip = useSelected<Clip>('clip');
  const audio = useSelected<AudioItem>('audio');
  const item = clip ?? audio;
  if (!item) return null;
  const cur = item.voiceFx ?? 'none';
  const pick = (id: VoiceFxId) => {
    checkpoint();
    editSelected((x) => {
      if (id === 'none') delete x.voiceFx;
      else x.voiceFx = id;
    });
  };
  return (
    <>
      <p className="label">Efecto de voz</p>
      <div className="chips">
        {VOICE_FX.map((f) => (
          <button key={f.id} className={`chip big ${cur === f.id ? 'active' : ''}`} onClick={() => pick(f.id)}>
            {f.name} <small>{f.hint}</small>
          </button>
        ))}
      </div>
      <p className="muted small">Toca reproducir para escucharlo. Queda igual en el video guardado.</p>
    </>
  );
}

const ROLES: { id: AudioRole; name: string; hint: string }[] = [
  { id: 'voice', name: 'Voz', hint: 'Alguien habla' },
  { id: 'music', name: 'Música', hint: 'Baja cuando hablan' },
  { id: 'sfx', name: 'Efecto', hint: 'Un sonido corto' },
];

/** Tells Clipo whether an audio is a voice, music or a sound effect (used by the ducking). */
export function AudioRoleSection() {
  const audio = useSelected<AudioItem>('audio');
  const name = useStore((s) => (audio ? s.project!.assets[audio.assetId]?.name ?? '' : ''));
  if (!audio) return null;
  const role = audioRole(audio, name);
  return (
    <>
      <p className="label">¿Qué es este audio?</p>
      <div className="chips">
        {ROLES.map((r) => (
          <button
            key={r.id}
            className={`chip big ${role === r.id ? 'active' : ''}`}
            onClick={() => { checkpoint(); editSelected((x) => void (x.role = r.id)); }}
          >
            {r.name} <small>{r.hint}</small>
          </button>
        ))}
      </div>
    </>
  );
}

// ---------- export: loudness ----------

const fmtDb = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} dB`;
const fmtLufs = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1).replace('.', ',')} LUFS` : 'sin sonido');

/** "Volumen parejo" switch with an optional measurement of the current mix. */
export function NormalizeOption() {
  const on = useStore((s) => !!s.project?.audioMix?.normalize);
  const project = useStore((s) => s.project);
  const [report, setReport] = useState<{ for: Project; r: LoudnessReport } | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  if (!project) return null;

  const measure = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    try {
      const { measureLoudness } = await import('../exporter');
      setReport({ for: project, r: await measureLoudness(project, ac.signal) });
    } catch {
      if (!ac.signal.aborted) useStore.getState().notify('No se pudo medir el volumen. Intenta otra vez.');
    } finally {
      setBusy(false);
    }
  };
  const r = report?.for === project ? report.r : null;

  return (
    <div className="smart-audio-box">
      <Switch
        on={on}
        title="Volumen parejo al guardar"
        hint={`Ajusta el volumen de todo el video a ${LOUDNESS_TARGET} LUFS, el nivel que usan TikTok, Instagram y YouTube, sin que suene saturado.`}
        onChange={(v) => setMix({ normalize: v })}
      />
      <div className="row-inline">
        <button className="btn-ghost small-btn" disabled={busy} onClick={measure}>
          <Search size={16} /> {busy ? 'Midiendo…' : 'Medir el volumen'}
        </button>
        {r && (
          <span className="small">
            Ahora: <b>{fmtLufs(r.lufs)}</b> · pico {Number.isFinite(r.peakDb) ? fmtDb(r.peakDb) : '—'}
            {Number.isFinite(r.lufs) && (Math.abs(r.gainDb) < 0.5 ? ' · ya está bien' : ` · se ${r.gainDb > 0 ? 'subirá' : 'bajará'} ${fmtDb(Math.abs(r.gainDb)).replace('+', '')}`)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- the "Audio inteligente" panel ----------

export function SmartAudioPanel() {
  return (
    <>
      <DuckingSection />
      <SilenceSection />
      <p className="label">Al guardar</p>
      <NormalizeOption />
      <Hint>Para cambiar la voz (robot, eco, teléfono…), toca un video o un audio y elige “Volumen”.</Hint>
    </>
  );
}

function DuckingSection() {
  const project = useStore((s) => s.project!);
  const urls = useStore((s) => s.urls);
  const { duck } = mixOf(project);
  const music = project.audios.filter((a) => audioRole(a, project.assets[a.assetId]?.name) === 'music').length;
  const [curve, setCurve] = useState<Float32Array | null>(null);

  // Draw where the music goes down, from the same analysis the player and the export use.
  useEffect(() => {
    if (duck <= 0) return setCurve(null);
    let alive = true;
    const ids = voiceAssets(project).filter((id) => urls[id]);
    Promise.all(ids.map((id) => analyzeAsset(id, urls[id]).then((a) => [id, a?.activity] as const))).then((list) => {
      if (alive) setCurve(projectDuckCurve(project, Object.fromEntries(list), totalDuration(project)));
    });
    return () => void (alive = false);
  }, [project, urls, duck]);

  return (
    <>
      <Switch
        on={duck > 0}
        title="Bajar la música cuando alguien habla"
        hint="Clipo escucha tus videos, grabaciones y narraciones, y baja la música suavemente mientras se habla."
        onChange={(v) => setMix({ duck: v ? DUCK_DEFAULT : 0 })}
      />
      {duck > 0 && (
        <>
          <Slider label="Cuánto baja la música" value={duck} min={3} max={24} step={1} format={(v) => `${v} dB`} onChange={(v) => setMix({ duck: v }, true)} />
          {curve && <DuckGraph curve={curve} depth={duck} />}
          {!music && <Hint>Todavía no hay música. Agrega una en “Música” para escuchar el efecto.</Hint>}
          <Hint>Se escucha al reproducir y queda igual en el video guardado. Si un audio no es música, tócalo, elige “Volumen” y marca qué es.</Hint>
        </>
      )}
    </>
  );
}

/** Small picture of the music's volume over the whole video: high = normal, low = ducked. */
function DuckGraph({ curve, depth }: { curve: Float32Array; depth: number }) {
  const W = 300;
  const H = 40;
  const path = useMemo(() => {
    const n = curve.length;
    if (n < 2) return '';
    const step = Math.max(1, Math.floor(n / W));
    const pts: string[] = [];
    for (let i = 0; i < n; i += step) {
      const db = 20 * Math.log10(Math.max(1e-4, curve[i]));
      const y = 4 + ((-db / Math.max(1, depth)) * (H - 8));
      pts.push(`${((i / (n - 1)) * W).toFixed(1)},${y.toFixed(1)}`);
    }
    return `M${pts.join('L')}`;
  }, [curve, depth]);
  return (
    <figure className="duck-graph">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Volumen de la música a lo largo del video">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="muted small">Volumen de la música: abajo = mientras alguien habla ({fmtTime(curve.length * FRAME)})</figcaption>
    </figure>
  );
}

const SENSITIVITY: { id: string; name: string; hint: string; depth: number }[] = [
  { id: 'quiet', name: 'Solo silencio', hint: 'Lugar callado', depth: 35 },
  { id: 'normal', name: 'Normal', hint: 'Recomendado', depth: 28 },
  { id: 'noisy', name: 'Con ruido', hint: 'Calle, viento, música', depth: 18 },
];

function SilenceSection() {
  const project = useStore((s) => s.project!);
  const urls = useStore((s) => s.urls);
  const [sens, setSens] = useState('normal');
  const [minDur, setMinDur] = useState(0.8);
  const [plan, setPlan] = useState<{ for: Project; cuts: SilenceCut[]; skip: Set<number> } | null>(null);
  const [busy, setBusy] = useState(false);
  const videos = project.clips.filter((c) => project.assets[c.assetId]?.kind === 'video').length;

  const find = async () => {
    setBusy(true);
    try {
      const ids = [...new Set(project.clips.map((c) => c.assetId))].filter((id) => project.assets[id]?.kind === 'video' && urls[id]);
      const levels = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, (await analyzeAsset(id, urls[id]))?.levels] as const)));
      const opts: SilenceOptions = { depth: SENSITIVITY.find((x) => x.id === sens)!.depth, minDuration: minDur, margin: 0.15 };
      const cuts = planSilenceCuts(project, levels, opts);
      setPlan({ for: project, cuts, skip: new Set() });
      if (!cuts.length) useStore.getState().notify('No se encontraron silencios largos');
    } finally {
      setBusy(false);
    }
  };

  const stale = plan && plan.for !== project;
  const chosen = plan && !stale ? plan.cuts.filter((_, i) => !plan.skip.has(i)) : [];
  const total = chosen.reduce((s, c) => s + (c.at.end - c.at.start), 0);
  const dur = mainDuration(project);

  const listen = (c: SilenceCut) => {
    engine.seek(Math.max(0, c.at.start - 1));
    engine.play();
  };
  const apply = () => {
    const s = useStore.getState();
    engine.pause();
    let removed = 0;
    s.commit((p) => void (removed = applySilenceCuts(p, chosen, uid)));
    s.select(null);
    setPlan(null);
    s.notify(`Se quitaron ${removed.toFixed(1).replace('.', ',')} s de silencios · puedes deshacerlo`);
  };
  const toggle = (i: number) =>
    plan && setPlan({ ...plan, skip: new Set(plan.skip.has(i) ? [...plan.skip].filter((x) => x !== i) : [...plan.skip, i]) });

  return (
    <div className="smart-audio-box">
      <p className="label">Quitar silencios</p>
      <Hint>Busca las pausas largas en tus videos (la pista principal) para que el video sea más dinámico. Primero ves qué se quitará.</Hint>
      {!videos ? (
        <Hint>Agrega un video con sonido para usar esto.</Hint>
      ) : (
        <>
          <div className="chips">
            {SENSITIVITY.map((x) => (
              <button key={x.id} className={`chip big ${sens === x.id ? 'active' : ''}`} onClick={() => { setSens(x.id); setPlan(null); }}>
                {x.name} <small>{x.hint}</small>
              </button>
            ))}
          </div>
          <label className="slider">
            <span>Quitar pausas de más de <b>{minDur.toFixed(1).replace('.', ',')} s</b></span>
            <input type="range" min={0.4} max={2} step={0.1} value={minDur} onChange={(e) => { setMinDur(Number(e.target.value)); setPlan(null); }} />
          </label>
          <button className="btn-ghost" disabled={busy} onClick={find}>
            <Search size={18} /> {busy ? 'Escuchando tus videos…' : 'Buscar silencios'}
          </button>
        </>
      )}

      {stale && <Hint>Cambiaste el video después de buscar. Toca “Buscar silencios” otra vez.</Hint>}
      {plan && !stale && plan.cuts.length > 0 && (
        <>
          <div className="silence-strip" aria-label="Partes que se quitarán, en rojo">
            {plan.cuts.map((c, i) => (
              <span
                key={i}
                className={plan.skip.has(i) ? 'kept' : ''}
                style={{ left: `${(c.at.start / dur) * 100}%`, width: `${Math.max(0.4, ((c.at.end - c.at.start) / dur) * 100)}%` }}
              />
            ))}
          </div>
          <ul className="silence-list">
            {plan.cuts.map((c, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={!plan.skip.has(i)} onChange={() => toggle(i)} />
                  {fmtTime(c.at.start, true)} · {(c.at.end - c.at.start).toFixed(1).replace('.', ',')} s
                </label>
                <button className="icon-btn round" onClick={() => listen(c)} aria-label={`Escuchar el silencio de ${fmtTime(c.at.start)}`}>
                  <Play size={16} />
                </button>
              </li>
            ))}
          </ul>
          <button className="btn-primary full" disabled={!chosen.length} onClick={apply}>
            <Scissors size={18} /> Quitar {chosen.length} {chosen.length === 1 ? 'silencio' : 'silencios'} ({total.toFixed(1).replace('.', ',')} s)
          </button>
          <Hint>Los textos, stickers y audios se mueven con el video. Si no te gusta, toca “Deshacer”.</Hint>
        </>
      )}
    </div>
  );
}
