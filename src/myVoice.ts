// "Mi voz": the user records their own voice once, with explicit consent, and Clipo can then
// narrate any text in that voice (cloneWorker.ts, Chatterbox Multilingual). The recording never
// leaves the device: it is stored in IndexedDB next to the project media.
import { getBlob, putBlob } from './db';
import { uid } from './store';
import { encodeWav } from './voice';
import type { CloneIn, CloneOut } from './cloneWorker';

export const CLONE_RATE = 24000;
/** Rough first-time download of the cloning model, in MB. */
export const CLONE_DOWNLOAD_MB = 1550;
export const MIN_SECONDS = 6;
export const MAX_SECONDS = 25;

export interface VoiceProfile {
  id: string;
  name: string;
  createdAt: number;
  /** The person confirmed it is their own voice (or that they have permission). */
  consent: true;
  seconds: number;
}

const LIST_KEY = 'clipo.myVoices';
const blobKey = (id: string) => `myvoice:${id}`;

export function listProfiles(): VoiceProfile[] {
  try {
    return JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]') as VoiceProfile[];
  } catch {
    return [];
  }
}

function writeProfiles(list: VoiceProfile[]) {
  localStorage.setItem(LIST_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event('clipo:myvoices'));
}

/** The text read aloud during the recording: a spoken consent plus a sentence with every Spanish sound. */
export const consentScript = (name: string) =>
  `Yo, ${name.trim() || 'la persona que habla'}, autorizo a Clipo a crear una copia de mi voz para usarla en mis propios videos. ` +
  'El veloz murciélago hindú comía feliz cardillo y kiwi, mientras la cigüeña tocaba el saxofón detrás del palenque de paja.';

export async function saveProfile(name: string, samples: Float32Array): Promise<VoiceProfile> {
  const id = uid();
  await putBlob(blobKey(id), encodeWav(samples, CLONE_RATE));
  const profile: VoiceProfile = { id, name: name.trim() || 'Mi voz', createdAt: Date.now(), consent: true, seconds: samples.length / CLONE_RATE };
  writeProfiles([...listProfiles(), profile]);
  return profile;
}

export async function deleteProfile(id: string) {
  writeProfiles(listProfiles().filter((p) => p.id !== id));
  // The project store has no "delete blob" API; overwrite with an empty blob so nothing remains.
  await putBlob(blobKey(id), new Blob([])).catch(() => {});
  cache.delete(id);
}

const cache = new Map<string, Float32Array>();

/** The saved recording as mono 24 kHz samples (what the cloning model expects). */
export async function loadReference(id: string): Promise<Float32Array> {
  const hit = cache.get(id);
  if (hit) return hit;
  const blob = await getBlob(blobKey(id));
  if (!blob || !blob.size) throw new Error('missing-voice');
  const samples = await decodeTo24k(blob);
  cache.set(id, samples);
  return samples;
}

async function decodeTo24k(blob: Blob): Promise<Float32Array> {
  const buf = await new OfflineAudioContext(1, 1, CLONE_RATE).decodeAudioData(await blob.arrayBuffer());
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}

/** Trim silence at both ends and bring the level to a consistent peak. */
function tidy(s: Float32Array): Float32Array {
  const win = Math.round(CLONE_RATE * 0.02);
  const loud = (i: number) => {
    let e = 0;
    for (let k = i; k < Math.min(s.length, i + win); k++) e += s[k] * s[k];
    return e / win > 1e-4;
  };
  let a = 0;
  while (a < s.length && !loud(a)) a += win;
  let b = s.length - win;
  while (b > a && !loud(b)) b -= win;
  const pad = Math.round(CLONE_RATE * 0.15);
  const out = s.slice(Math.max(0, a - pad), Math.min(s.length, b + win + pad));
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.9 / peak;
  return out;
}

export interface QualityReport {
  seconds: number;
  ok: boolean;
  /** Plain-language problems to fix before saving. */
  problems: string[];
}

/** Simple checks the user can act on: length, too quiet, distorted. */
export function checkQuality(raw: Float32Array, cleaned: Float32Array): QualityReport {
  const seconds = cleaned.length / CLONE_RATE;
  let peak = 0;
  let clipped = 0;
  let energy = 0;
  for (const v of raw) {
    const a = Math.abs(v);
    peak = Math.max(peak, a);
    if (a > 0.99) clipped++;
    energy += v * v;
  }
  const rms = Math.sqrt(energy / Math.max(1, raw.length));
  const problems: string[] = [];
  if (seconds < MIN_SECONDS) problems.push(`La grabación es muy corta (${seconds.toFixed(1)} s). Lee el texto completo: se necesitan al menos ${MIN_SECONDS} segundos.`);
  if (peak < 0.05 || rms < 0.005) problems.push('Casi no se te escucha. Acércate al micrófono o habla un poco más fuerte.');
  if (clipped > raw.length * 0.002) problems.push('El sonido se satura (distorsiona). Aléjate un poco del micrófono.');
  return { seconds, ok: problems.length === 0, problems };
}

// ---------- recording ----------

export interface VoiceRecording {
  /** 0..1 input level, for a live meter. */
  level(): number;
  elapsed(): number;
  stop(): Promise<{ raw: Float32Array; cleaned: Float32Array; report: QualityReport }>;
  cancel(): void;
}

export async function recordSample(): Promise<VoiceRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const meter = new Float32Array(analyser.fftSize);
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  const started = performance.now();
  rec.start(250);
  const release = () => {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };
  return {
    level() {
      analyser.getFloatTimeDomainData(meter);
      let p = 0;
      for (const v of meter) p = Math.max(p, Math.abs(v));
      return Math.min(1, p * 1.4);
    },
    elapsed: () => (performance.now() - started) / 1000,
    async stop() {
      if (rec.state !== 'inactive') rec.stop();
      await stopped;
      release();
      const raw = await decodeTo24k(new Blob(chunks, { type: rec.mimeType }));
      const cleaned = tidy(raw);
      return { raw, cleaned, report: checkQuality(raw, cleaned) };
    },
    cancel() {
      if (rec.state !== 'inactive') rec.stop();
      release();
    },
  };
}

// ---------- speaking in the cloned voice ----------

export type CloneProgress = { phase: 'download'; pct: number; loaded: number; total: number } | { phase: 'speak'; pct: number };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { onProgress?: (p: CloneProgress) => void; resolve: (r: { samples: Float32Array; sampleRate: number }) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./cloneWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<CloneOut>) => {
    const m = e.data;
    // Loading stages are useful when diagnosing a slow or stuck first run.
    if (m.type === 'stage' || m.type === 'ready') return console.info('[clipo-clone]', m.type === 'stage' ? m.stage : `ready on ${m.device}, cached=${m.cached}`);
    if (m.type === 'download') {
      const pct = m.total ? (m.loaded / m.total) * 100 : 0;
      for (const p of pending.values()) p.onProgress?.({ phase: 'download', pct, loaded: m.loaded, total: m.total });
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'part') p.onProgress?.({ phase: 'speak', pct: (m.done / m.total) * 100 });
    else if (m.type === 'audio') {
      pending.delete(m.id);
      p.resolve({ samples: m.samples, sampleRate: m.sampleRate });
    } else if (m.type === 'error') {
      pending.delete(m.id);
      p.reject(new Error(m.message));
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

let warmed = false;
/** Start downloading and preparing the cloning model in the background (it takes minutes). */
export function warmUpClone() {
  if (warmed) return;
  warmed = true;
  const msg: CloneIn = { type: 'load', id: nextId++ };
  getWorker().postMessage(msg);
}

/** Speak `parts` (already split into short sentences) in a saved voice. */
export async function speakAs(profileId: string, parts: string[], exaggeration: number, onProgress?: (p: CloneProgress) => void) {
  const reference = await loadReference(profileId);
  const id = nextId++;
  return new Promise<{ samples: Float32Array; sampleRate: number }>((resolve, reject) => {
    pending.set(id, { onProgress, resolve, reject });
    // The reference is copied (not transferred) so the cache keeps its own.
    const msg: CloneIn = { type: 'speak', id, voiceKey: profileId, reference: reference.slice(), parts, exaggeration, lang: 'es' };
    getWorker().postMessage(msg);
  });
}
