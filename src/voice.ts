// Voiceovers: record the microphone over the video, or turn text into speech
// on the device. Both end up as WAV assets on the audio track, so they play,
// export and undo like any other music.
import type { Asset } from './types';
import { putBlob } from './db';
import { uid, useStore } from './store';
import { engine } from './engine';
import { totalDuration } from './model';
import type { TtsIn, TtsOut } from './ttsWorker';
import { CLONE_DOWNLOAD_MB, speakAs, type VoiceProfile } from './myVoice';

// ---------- saving audio to the project ----------

/** 16-bit mono WAV: every browser can play and seek it precisely. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Store the audio on the device and place it on the audio track, as one undoable step. */
export async function addVoiceToTimeline(samples: Float32Array, sampleRate: number, name: string, start: number) {
  const s = useStore.getState();
  if (!s.project) return;
  const blob = encodeWav(samples, sampleRate);
  const id = uid();
  let saved = true;
  await putBlob(id, blob).catch(() => (saved = false));
  const duration = samples.length / sampleRate;
  const asset: Asset = { id, kind: 'audio', name, duration, width: 0, height: 0 };
  s.addUrls({ [id]: URL.createObjectURL(blob) });
  const itemId = uid();
  s.commit((p) => {
    p.assets[id] = asset;
    p.audios.push({ id: itemId, assetId: id, start, in: 0, out: duration, volume: 1, fadeIn: 0, fadeOut: 0, role: 'voice' });
  });
  s.select({ kind: 'audio', id: itemId });
  if (!saved) s.notify('No hay espacio para guardar el audio: podrás editarlo, pero no se guardará al cerrar.');
}

const countOf = (prefix: string) => Object.values(useStore.getState().project?.assets ?? {}).filter((a) => a.name.startsWith(prefix)).length;

async function decodeMono(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  const data = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const buf = await ctx.decodeAudioData(data);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / buf.numberOfChannels;
  }
  return { samples: out, sampleRate: buf.sampleRate };
}

// ---------- microphone ----------

export type RecordError = 'unsupported' | 'denied' | 'no-mic' | 'failed';

export const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Ask for the microphone. Throws a RecordError message. */
export async function openMic(): Promise<MediaStream> {
  if (!canRecord()) throw new Error('unsupported');
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    const n = (e as DOMException)?.name;
    throw new Error(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'no-mic' : 'failed');
  }
}

export interface Recording {
  /** Timeline time where the voice starts. */
  start: number;
  /** Stop and keep the take. */
  finish(): Promise<void>;
  /** Stop and throw the take away. */
  discard(): void;
}

/**
 * Record the microphone while the project plays from the playhead.
 * Recording stops by itself when playback stops (end of video, pause, seek).
 */
export async function startRecording(stream: MediaStream, onStopped: (saved: boolean) => void): Promise<Recording> {
  const releaseMic = () => stream.getTracks().forEach((t) => t.stop());
  let made: MediaRecorder | undefined;
  const chunks: Blob[] = [];
  let stopped!: Promise<void>;
  try {
    const r = (made = new MediaRecorder(stream));
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    stopped = new Promise<void>((done) => (r.onstop = () => done()));
    const started = new Promise<void>((resolve, reject) => {
      r.onstart = () => resolve();
      r.onerror = (e) => reject((e as Event & { error?: unknown }).error ?? new Error('failed'));
      setTimeout(() => reject(new Error('timeout')), 5000);
    });
    started.catch(() => {}); // awaited below; this only avoids an unhandled rejection if start() throws
    r.start(500);
    await started;
  } catch (e) {
    // Never leave the microphone on when the recorder could not start.
    try {
      if (made && made.state !== 'inactive') made.stop();
    } catch {
      /* already stopped */
    }
    releaseMic();
    console.error(e);
    throw new Error('failed');
  }
  const rec = made;
  const recWall = performance.now();

  const s = useStore.getState();
  const hasVideo = !!s.project && totalDuration(s.project) > 0;
  if (hasVideo) engine.play();
  const playWall = performance.now();
  const start = useStore.getState().time;

  let done = false;
  let unsub = () => {};
  const end = async (keep: boolean) => {
    if (done) return;
    done = true;
    unsub();
    engine.pause();
    try {
      if (rec.state !== 'inactive') rec.stop();
      // A recorder that broke may never fire 'stop'.
      await Promise.race([stopped, new Promise((r) => setTimeout(r, 3000))]);
    } catch (e) {
      console.error(e);
    }
    releaseMic();
    if (!keep) return onStopped(false);
    try {
      const { samples, sampleRate } = await decodeMono(new Blob(chunks, { type: rec.mimeType }));
      // Drop what was captured before the video started moving.
      const lead = Math.min(samples.length, Math.round(((playWall - recWall) / 1000) * sampleRate));
      const voice = samples.subarray(lead);
      if (voice.length < sampleRate * 0.3) return onStopped(false);
      await addVoiceToTimeline(voice, sampleRate, `Voz ${countOf('Voz ') + 1}`, start);
      onStopped(true);
    } catch (e) {
      console.error(e);
      onStopped(false);
    }
  };
  // The recorder failing mid-take (mic unplugged…) keeps what was captured so far.
  rec.onerror = () => void end(true);
  if (hasVideo) unsub = useStore.subscribe((st, prev) => void (prev.playing && !st.playing && end(true)));
  return { start, finish: () => end(true), discard: () => void end(false) };
}

// ---------- text to speech ----------

export interface Voice {
  id: string;
  name: string;
  desc: string;
  /** Approximate first-time download, in MB. */
  mb: number;
  /** 'clone' = the user's own recorded voice (myVoice.ts). */
  engine?: 'piper' | 'clone';
  /** Saved voice profile, for cloned voices. */
  profileId?: string;
  /** 0.25..1: how lively a cloned voice sounds. */
  exaggeration?: number;
  model: string;
  speaker?: string;
  voice?: string;
  lang?: string;
}

const SUPERTONIC = 'onnx-community/Supertonic-TTS-2-ONNX';
/** Fixed commit of the Supertonic repo (Hugging Face API `sha`, 2026-10-15), so a change upstream can't swap the files. */
export const SUPERTONIC_REVISION = '68d4d9420d0e0e51d14656e1ec5c9b091490b49e';
// TODO: ttsWorker.ts loads the model with pipeline(); pass `revision: SUPERTONIC_REVISION` there too.
const voiceUrl = (v: string) => `https://huggingface.co/${SUPERTONIC}/resolve/${SUPERTONIC_REVISION}/voices/${v}.bin`;

// Piper voices first: natural sounding, light, and each one an actual Spanish speaker.
// Licenses (model cards): claude Apache-2.0, ald Unlicense, daniela CC BY-SA 4.0, davefx CC0, sharvard CC BY 3.0.
const piper = (id: string, name: string, desc: string, path: string, mb: number, speaker?: string): Voice => ({ id, name, desc, mb, engine: 'piper', model: path, speaker });

export const VOICES: Voice[] = [
  piper('claude', 'Claudia', 'México · natural', 'es/es_MX/claude/high/es_MX-claude-high', 63),
  piper('ald', 'Aldo', 'México · natural', 'es/es_MX/ald/medium/es_MX-ald-medium', 63),
  piper('daniela', 'Daniela', 'Argentina · natural', 'es/es_AR/daniela/high/es_AR-daniela-high', 114),
  piper('davefx', 'David', 'España · natural', 'es/es_ES/davefx/medium/es_ES-davefx-medium', 63),
  piper('sharvard-f', 'Lucía', 'España · natural', 'es/es_ES/sharvard/medium/es_ES-sharvard-medium', 77, 'F'),
  piper('sharvard-m', 'Martín', 'España · natural', 'es/es_ES/sharvard/medium/es_ES-sharvard-medium', 77, 'M'),
  { id: 'F1', name: 'Sofía', desc: 'Estudio · expresiva, pesada', mb: 260, model: SUPERTONIC, voice: voiceUrl('F1'), lang: 'es' },
  { id: 'M1', name: 'Mateo', desc: 'Estudio · expresiva, pesada', mb: 260, model: SUPERTONIC, voice: voiceUrl('M1'), lang: 'es' },
];

/** A saved "Mi voz" recording as a voice the narration panel can use. */
export const profileVoice = (p: VoiceProfile): Voice => ({ id: `my-${p.id}`, name: p.name, desc: 'Tu voz', mb: CLONE_DOWNLOAD_MB, engine: 'clone', model: 'chatterbox', profileId: p.id });

/** Approximate first-time download in MB. */
export const voiceDownloadMB = (v: Voice) => v.mb;

export const SPEEDS = [
  { label: 'Lenta', value: 0.85 },
  { label: 'Normal', value: 1 },
  { label: 'Rápida', value: 1.2 },
];

export type TtsProgress = { phase: 'download'; pct: number; loaded: number; total: number } | { phase: 'speak'; pct: number };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { onProgress?: (p: TtsProgress) => void; resolve: (r: { samples: Float32Array; sampleRate: number }) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./ttsWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<TtsOut>) => {
    const m = e.data;
    if (m.type === 'download') {
      // The download is shared by every request waiting on that model.
      const pct = m.total ? (m.loaded / m.total) * 100 : 0;
      for (const p of pending.values()) p.onProgress?.({ phase: 'download', pct, loaded: m.loaded, total: m.total });
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'part') p.onProgress?.({ phase: 'speak', pct: (m.done / m.total) * 100 });
    else {
      pending.delete(m.id);
      if (m.type === 'audio') p.resolve({ samples: m.samples, sampleRate: m.sampleRate });
      else p.reject(new Error(m.message));
    }
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'worker'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Split into sentences of a comfortable length so long texts aren't cut off. */
export function splitSentences(text: string, max = 220): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const out: string[] = [];
  for (const sentence of clean.match(/[^.!?¡¿…]*[.!?…]+["»”)]*|[^.!?…]+$/g) ?? [clean]) {
    let rest = sentence.trim();
    while (rest.length > max) {
      const cut = Math.max(rest.lastIndexOf(',', max), rest.lastIndexOf(' ', max));
      const at = cut > max / 3 ? cut + 1 : max;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest && /[\p{L}\p{N}]/u.test(rest)) out.push(rest);
  }
  return out;
}

export function synthesize(text: string, voice: Voice, speed: number, onProgress?: (p: TtsProgress) => void) {
  const parts = splitSentences(text);
  if (!parts.length) return Promise.reject(new Error('empty'));
  if (voice.engine === 'clone' && voice.profileId) return speakAs(voice.profileId, text, speed, onProgress);
  const id = nextId++;
  return new Promise<{ samples: Float32Array; sampleRate: number }>((resolve, reject) => {
    pending.set(id, { onProgress, resolve, reject });
    const msg: TtsIn = { type: 'speak', id, engine: voice.engine === 'piper' ? 'piper' : undefined, model: voice.model, speaker: voice.speaker, voice: voice.voice, lang: voice.lang, speed, parts };
    getWorker().postMessage(msg);
  });
}

/** Create a narration and put it on the audio track at `start`. */
export async function addNarration(text: string, voice: Voice, speed: number, start: number, onProgress?: (p: TtsProgress) => void) {
  const { samples, sampleRate } = await synthesize(text, voice, speed, onProgress);
  const short = text.trim().replace(/\s+/g, ' ');
  await addVoiceToTimeline(samples, sampleRate, `Narración: ${short.length > 24 ? short.slice(0, 24) + '…' : short}`, start);
  return samples.length / sampleRate;
}
