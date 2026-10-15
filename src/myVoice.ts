// "Mi voz": the user records their own voice once, with explicit consent, and Clipo can then
// narrate any text in that voice. A natural Clipo voice (Piper) speaks the text and the OpenVoice
// tone converter (toneWorker.ts) gives it the user's timbre: light (131 MB) and fast. The
// recording never leaves the device: it is stored in IndexedDB next to the project media.
import { getBlob, putBlob } from './db';
import { uid } from './store';
import { VOICES, encodeWav, synthesize, type TtsProgress } from './voice';
import type { ToneIn, ToneOut } from './toneWorker';
import { TONE_RATE } from './toneConvert';

export const CLONE_RATE = 24000;
/** Rough first-time download for "Mi voz" (tone converter + base voice), in MB. */
export const CLONE_DOWNLOAD_MB = 195;
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
    for (let i = 0; i < out.length; i++) out[i]! += d[i]! / buf.numberOfChannels;
  }
  return out;
}

/** Trim silence at both ends and bring the level to a consistent peak. */
function tidy(s: Float32Array): Float32Array {
  const win = Math.round(CLONE_RATE * 0.02);
  const loud = (i: number) => {
    let e = 0;
    for (let k = i; k < Math.min(s.length, i + win); k++) e += s[k]! * s[k]!;
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
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i]! *= 0.9 / peak;
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

// ---------- speaking in the user's voice ----------

async function resample(samples: Float32Array, from: number, to: number) {
  if (from === to) return samples;
  const ctx = new OfflineAudioContext(1, Math.ceil((samples.length * to) / from), to);
  const buf = ctx.createBuffer(1, samples.length, from);
  buf.copyToChannel(new Float32Array(samples), 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/** Median pitch in Hz (autocorrelation over voiced frames), 0 if none. */
export function medianPitch(s: Float32Array, sr: number) {
  const n = Math.round(sr * 0.046);
  const f0s: number[] = [];
  for (let o = 0; o + n < s.length; o += n * 2) {
    let e = 0;
    for (let i = o; i < o + n; i++) e += s[i]! * s[i]!;
    if (e / n < 0.001) continue;
    let best = 0;
    let lagBest = 0;
    for (let lag = Math.floor(sr / 400); lag < Math.floor(sr / 70); lag++) {
      let c = 0;
      for (let i = o; i + lag < o + n; i++) c += s[i]! * s[i + lag]!;
      if (c > best) {
        best = c;
        lagBest = lag;
      }
    }
    if (lagBest) f0s.push(sr / lagBest);
  }
  f0s.sort((a, b) => a - b);
  return f0s[f0s.length >> 1] ?? 0;
}

/** The converter keeps the base voice's pitch, so start from a voice of the same register. */
const baseVoiceFor = (pitch: number) => VOICES.find((v) => v.id === (pitch > 165 ? 'claude' : 'ald'))!;
const SAMPLE_TEXT = 'Hola, esta es una muestra de mi voz. Me gusta hablar con calma y con claridad para que todos me entiendan bien.';

const reference22 = new Map<string, Float32Array>();
const baseSamples = new Map<string, Float32Array>();

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { onProgress?: (p: TtsProgress) => void; resolve: (s: Float32Array) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./toneWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<ToneOut>) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'download') p.onProgress?.({ phase: 'download', pct: m.total ? (m.loaded / m.total) * 100 : 0, loaded: m.loaded, total: m.total });
    else {
      pending.delete(m.id);
      if (m.type === 'audio') p.resolve(m.samples);
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

/** Speak `text` in a saved voice: a natural Clipo voice re-timbred to the user's recording. */
export async function speakAs(profileId: string, text: string, speed: number, onProgress?: (p: TtsProgress) => void) {
  let ref = reference22.get(profileId);
  if (!ref) {
    ref = await resample(await loadReference(profileId), CLONE_RATE, TONE_RATE);
    reference22.set(profileId, ref);
  }
  const base = baseVoiceFor(medianPitch(ref, TONE_RATE));
  // Speech first (Piper, 22.05 kHz), then the timbre swap.
  const spoken = await synthesize(text, base, speed, (p) => onProgress?.({ ...p, pct: p.pct * 0.5 }));
  let sample = baseSamples.get(base.id);
  if (!sample) {
    sample = (await synthesize(SAMPLE_TEXT, base, 1)).samples;
    baseSamples.set(base.id, sample);
  }
  const audio = await resample(spoken.samples, spoken.sampleRate, TONE_RATE);
  const id = nextId++;
  const samples = await new Promise<Float32Array>((resolve, reject) => {
    pending.set(id, { onProgress: (p) => onProgress?.(p.phase === 'download' ? p : { phase: 'speak', pct: 50 + p.pct / 2 }), resolve, reject });
    const msg: ToneIn = { type: 'convert', id, audio, srcKey: base.id, srcSample: sample.slice(), destKey: profileId, dest: ref.slice(), tau: 0.3 };
    getWorker().postMessage(msg, [audio.buffer]);
  });
  onProgress?.({ phase: 'speak', pct: 100 });
  return { samples, sampleRate: TONE_RATE };
}

/** Start downloading the tone converter early, so the first narration is quicker. */
export function warmUpClone() {
  const id = nextId++;
  pending.set(id, { resolve: () => {}, reject: () => {} });
  // An empty conversion just loads the models; its error (no audio) is ignored.
  getWorker().postMessage({ type: 'convert', id, audio: new Float32Array(0), srcKey: '', srcSample: new Float32Array(0), destKey: '', dest: new Float32Array(0), tau: 0.3 } satisfies ToneIn);
}
