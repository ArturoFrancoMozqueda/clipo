// Turns text into speech on the device. Loaded only when the user asks for a
// narration, so the voice models never weigh on normal editing.
import { pipeline, type ProgressInfo, type TextToAudioPipeline } from '@huggingface/transformers';
import { piperSpeak } from './piperEngine';

export type TtsIn = {
  type: 'speak';
  id: number;
  /** 'piper' voices run on our own Piper engine; otherwise a transformers.js model. */
  engine?: 'piper';
  /** Model id, or for Piper the voice path inside rhasspy/piper-voices. */
  model: string;
  /** Piper speaker name for multi-speaker voices. */
  speaker?: string;
  /** Supertonic voice file (URL); omitted for single-voice models. */
  voice?: string;
  /** Supertonic language tag, e.g. "es". */
  lang?: string;
  speed: number;
  /** Already split into sentences so long texts aren't truncated. */
  parts: string[];
};

export type TtsOut =
  | { type: 'download'; id: number; loaded: number; total: number }
  | { type: 'part'; id: number; done: number; total: number }
  | { type: 'audio'; id: number; samples: Float32Array; sampleRate: number }
  | { type: 'error'; id: number; message: string };

const post = (m: TtsOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

/**
 * Model files come from a fixed commit, not from "main". Same value as SUPERTONIC_REVISION in
 * voice.ts (not imported: voice.ts would pull the editor's store and database into this worker).
 */
const REVISIONS: Record<string, string> = {
  'onnx-community/Supertonic-TTS-2-ONNX': '68d4d9420d0e0e51d14656e1ec5c9b091490b49e',
};

type Loaded = { tts: TextToAudioPipeline; device: 'webgpu' | 'wasm' };
const loaded = new Map<string, Promise<Loaded>>();
/** Set once the GPU has failed; later loads go straight to WASM. */
let gpuBroken = false;

async function hasWebGPU() {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

function load(model: string, id: number, forceWasm = false) {
  let p = loaded.get(model);
  if (p) return p;
  const progress_callback = (info: ProgressInfo) => {
    if (info.status === 'progress_total') post({ type: 'download', id, loaded: info.loaded, total: info.total });
  };
  const tryLoad = async (device: 'webgpu' | 'wasm'): Promise<Loaded> => {
    // The union of every pipeline type is too large for TypeScript, so narrow it by hand.
    const tts = (await (pipeline as (...a: unknown[]) => Promise<unknown>)('text-to-speech', model, {
      device,
      progress_callback,
      ...(REVISIONS[model] ? { revision: REVISIONS[model] } : {}),
      ...(model.includes('mms') ? { dtype: 'q8' } : {}),
    })) as TextToAudioPipeline;
    return { tts, device };
  };
  p = (async () => {
    if (!forceWasm && !gpuBroken && (await hasWebGPU())) {
      try {
        return await tryLoad('webgpu');
      } catch (e) {
        console.warn('WebGPU no disponible para la voz, usando WASM', e);
      }
    }
    return tryLoad('wasm');
  })();
  p.catch(() => loaded.delete(model));
  loaded.set(model, p);
  return p;
}

type Speak = (t: string, o: object) => Promise<{ audio: Float32Array; sampling_rate: number }>;

/** Run on the GPU when possible; if the GPU gives up mid-run, switch this model to WASM and retry. */
async function run(msg: TtsIn, text: string, opts: object) {
  const { tts, device } = await load(msg.model, msg.id);
  try {
    return await (tts as unknown as Speak)(text, opts);
  } catch (e) {
    if (device !== 'webgpu') throw e;
    console.warn('La voz falló en WebGPU, reintentando con WASM', e);
    gpuBroken = true;
    loaded.delete(msg.model);
    tts.dispose?.().catch(() => {});
    const retry = await load(msg.model, msg.id, true);
    return (retry.tts as unknown as Speak)(text, opts);
  }
}

/** Short pause between sentences, in seconds. */
const GAP = 0.25;

// One request at a time: a model can't run two generations at once.
let queue = Promise.resolve();

self.onmessage = (e: MessageEvent<TtsIn>) => {
  const msg = e.data;
  if (msg.type !== 'speak') return;
  queue = queue.then(() => speak(msg));
};

async function speak(msg: TtsIn) {
  try {
    const pieces: Float32Array[] = [];
    let sampleRate = 0;
    for (let i = 0; i < msg.parts.length; i++) {
      const out =
        msg.engine === 'piper'
          ? await piperSpeak(msg.model, msg.parts[i], msg.speed, msg.speaker, (loaded, total) => post({ type: 'download', id: msg.id, loaded, total }))
          : await run(msg, msg.lang ? `<${msg.lang}>${msg.parts[i]}</${msg.lang}>` : msg.parts[i], msg.voice ? { speaker_embeddings: msg.voice, num_inference_steps: 16, speed: msg.speed } : {});
      sampleRate = out.sampling_rate;
      pieces.push(out.audio);
      post({ type: 'part', id: msg.id, done: i + 1, total: msg.parts.length });
    }
    const gap = Math.round(GAP * sampleRate);
    const total = pieces.reduce((n, p) => n + p.length, 0) + gap * Math.max(0, pieces.length - 1);
    const samples = new Float32Array(total);
    let at = 0;
    for (const p of pieces) {
      samples.set(p, at);
      at += p.length + gap;
    }
    post({ type: 'audio', id: msg.id, samples, sampleRate }, [samples.buffer]);
  } catch (err) {
    post({ type: 'error', id: msg.id, message: String((err as Error)?.message ?? err) });
  }
}
