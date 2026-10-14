// Automatic captions: pull the speech out of the main-track videos and
// turn it into timed text items, all on the device.
import type { TextItem } from './types';
import { layout } from './model';
import { uid, useStore } from './store';
import type { CaptionWindow, WorkerIn, WorkerOut } from './captionsWorker';

export const CAPTION_LANGUAGES = [
  { id: 'spanish', label: 'Español' },
  { id: 'english', label: 'Inglés' },
  { id: 'portuguese', label: 'Portugués' },
  { id: 'french', label: 'Francés' },
  { id: 'italian', label: 'Italiano' },
  { id: 'german', label: 'Alemán' },
];

export const CAPTION_MODELS = {
  rapido: 'onnx-community/whisper-base',
  preciso: 'onnx-community/whisper-small',
} as const;
export type CaptionQuality = keyof typeof CAPTION_MODELS;

/** Approximate first-time download in MB. The GPU version uses larger files but runs much faster. */
export function captionDownloadMB(q: CaptionQuality) {
  const gpu = 'gpu' in navigator;
  return q === 'rapido' ? (gpu ? 210 : 80) : gpu ? 590 : 250;
}

export type CaptionProgress =
  | { phase: 'audio'; pct: number }
  | { phase: 'download'; pct: number; loaded: number; total: number }
  | { phase: 'listen'; pct: number };

const SR = 16000; // Whisper expects 16 kHz mono.
const MAX_WINDOW = 28; // seconds; Whisper reads 30 s at a time.
const MIN_WINDOW_CUT = 18;
const SILENCE_RMS = 0.004;
const MAX_CHARS = 38;
const MIN_SHOW = 0.6;

/** Lines Whisper tends to invent over silence or music. */
const HALLUCINATIONS = /amara\.org|subt[ií]tulos (realizados|por|hechos)|^\s*(gracias( por ver)?\.?|suscr[ií]bete.*|thanks for watching.*)\s*$/i;

interface WindowMeta {
  /** Timeline position of the clip and the clip's speed. */
  clipStart: number;
  clipEnd: number;
  speed: number;
  /** Seconds from the clip's in point (source time) to this window. */
  offset: number;
  length: number;
}

async function decodeMono(url: string): Promise<Float32Array | null> {
  try {
    const data = await (await fetch(url)).arrayBuffer();
    // An offline context at 16 kHz makes the browser resample for us.
    const ctx = new OfflineAudioContext(1, 1, SR);
    const buf = await ctx.decodeAudioData(data);
    if (buf.numberOfChannels === 1) return buf.getChannelData(0);
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < out.length; i++) out[i] += ch[i] / buf.numberOfChannels;
    }
    return out;
  } catch {
    return null; // no audio track, or a codec the browser can't decode
  }
}

function rms(s: Float32Array, a = 0, b = s.length) {
  let sum = 0;
  for (let i = a; i < b; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / Math.max(1, b - a));
}

/** Cut long audio into windows, preferring the quietest moment so words aren't split. */
function splitWindows(s: Float32Array): [number, number][] {
  const out: [number, number][] = [];
  const frame = SR * 0.05;
  let start = 0;
  while (s.length - start > MAX_WINDOW * SR) {
    let best = start + MAX_WINDOW * SR;
    let bestE = Infinity;
    for (let i = start + MIN_WINDOW_CUT * SR; i + frame <= start + MAX_WINDOW * SR; i += frame) {
      const e = rms(s, i, i + frame);
      if (e < bestE) [bestE, best] = [e, i + frame / 2];
    }
    best = Math.round(best);
    out.push([start, best]);
    start = best;
  }
  if (s.length - start > SR * 0.3) out.push([start, s.length]);
  return out;
}

/** Break a sentence into short lines that are easy to read on a phone. */
function phrases(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur.length + 1 + w.length > MAX_CHARS || (/[.?!…]$/.test(cur) && cur.length > 12))) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  // Don't leave one short word alone on screen for a split second.
  const last = lines[lines.length - 1];
  if (lines.length > 1 && last.length < 12 && lines[lines.length - 2].length + last.length < MAX_CHARS + 12) {
    lines.splice(-2, 2, `${lines[lines.length - 2]} ${last}`);
  }
  return lines;
}

function cleanChunk(text: string) {
  const t = text.replace(/[[(（][^\])）]*[\])）]/g, '').replace(/[♪♫]/g, '').trim();
  if (!t || !/[\p{L}\p{N}]/u.test(t) || HALLUCINATIONS.test(t)) return '';
  return t;
}

let worker: Worker | null = null;
let abortRun: (() => void) | null = null;

/** Stop a running transcription. The model stays cached for next time. */
export function cancelCaptions() {
  worker?.terminate();
  worker = null;
  abortRun?.();
}

/**
 * Transcribe the main-track videos and add one caption per phrase as a single undoable step.
 * Returns how many captions were added.
 */
export async function generateCaptions(opts: {
  language: string;
  quality: CaptionQuality;
  onProgress: (p: CaptionProgress) => void;
}): Promise<number> {
  const s = useStore.getState();
  const p = s.project;
  if (!p) return 0;
  const placed = layout(p).filter((l) => p.assets[l.clip.assetId]?.kind === 'video' && l.clip.volume > 0);
  if (!placed.length) throw new Error('no-video');

  // 1. Audio of each clip, respecting in/out. Each asset is decoded once.
  opts.onProgress({ phase: 'audio', pct: 0 });
  const decoded = new Map<string, Float32Array | null>();
  const windows: CaptionWindow[] = [];
  const metas: WindowMeta[] = [];
  for (let k = 0; k < placed.length; k++) {
    const { clip, start, end } = placed[k];
    if (!decoded.has(clip.assetId)) decoded.set(clip.assetId, await decodeMono(s.urls[clip.assetId]));
    const all = decoded.get(clip.assetId);
    opts.onProgress({ phase: 'audio', pct: ((k + 1) / placed.length) * 100 });
    if (!all) continue;
    const slice = all.subarray(Math.floor(clip.in * SR), Math.min(all.length, Math.ceil(clip.out * SR)));
    for (const [a, b] of splitWindows(slice)) {
      if (rms(slice, a, b) < SILENCE_RMS) continue;
      windows.push({ id: windows.length, samples: slice.slice(a, b) });
      metas.push({ clipStart: start, clipEnd: end, speed: clip.speed, offset: a / SR, length: (b - a) / SR });
    }
  }
  decoded.clear();
  if (!windows.length) throw new Error('no-speech');

  // 2. Whisper in a worker so the editor stays responsive.
  worker ??= new Worker(new URL('./captionsWorker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const found: { text: string; start: number; end: number }[] = [];
  await new Promise<void>((resolve, reject) => {
    let done = 0;
    abortRun = () => reject(new Error('cancelled'));
    w.onerror = (e) => reject(new Error(e.message || 'worker'));
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'download') {
        opts.onProgress({ phase: 'download', pct: m.total ? (m.loaded / m.total) * 100 : 0, loaded: m.loaded, total: m.total });
      } else if (m.type === 'ready') {
        opts.onProgress({ phase: 'listen', pct: 0 });
      } else if (m.type === 'window') {
        const meta = metas[m.id];
        const toTimeline = (t: number) => Math.min(meta.clipEnd, meta.clipStart + (meta.offset + t) / meta.speed);
        for (const c of m.chunks) {
          const text = cleanChunk(c.text);
          if (!text) continue;
          const a = Math.min(c.start, meta.length);
          const b = Math.min(c.end ?? meta.length, meta.length);
          const lines = phrases(text);
          const total = lines.reduce((n, l) => n + l.length, 0);
          let t = a;
          for (const line of lines) {
            const d = ((b - a) * line.length) / total;
            found.push({ text: line, start: toTimeline(t), end: toTimeline(t + d) });
            t += d;
          }
        }
        opts.onProgress({ phase: 'listen', pct: (++done / windows.length) * 100 });
      } else if (m.type === 'done') {
        resolve();
      } else if (m.type === 'error') {
        reject(new Error(m.message));
      }
    };
    const msg: WorkerIn = { type: 'run', model: CAPTION_MODELS[opts.quality], language: opts.language, windows };
    w.postMessage(msg, windows.map((x) => x.samples.buffer));
  }).finally(() => (abortRun = null));

  // 3. Tidy timing: no overlaps, each line visible long enough to read.
  found.sort((a, b) => a.start - b.start);
  const items: TextItem[] = [];
  for (let i = 0; i < found.length; i++) {
    const f = found[i];
    const next = found[i + 1]?.start ?? Infinity;
    const end = Math.min(Math.max(f.end, f.start + MIN_SHOW), next);
    if (end - f.start < 0.15) continue;
    items.push({ id: uid(), text: f.text, start: f.start, duration: end - f.start, x: 0.5, y: 0.8, size: 0.06, styleId: 'amarillo', caption: true });
  }
  if (!items.length) throw new Error('no-speech');

  useStore.getState().commit((q) => {
    q.texts = q.texts.filter((t) => !t.caption).concat(items);
  });
  return items.length;
}
