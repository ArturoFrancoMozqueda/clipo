// Runs Whisper on the device. Loaded only when the user asks for captions,
// so the model code never weighs on normal editing.
import { pipeline, type AutomaticSpeechRecognitionPipeline, type ProgressInfo } from '@huggingface/transformers';

export interface CaptionWindow {
  id: number;
  samples: Float32Array;
}

export type WorkerIn = { type: 'run'; model: string; language: string; windows: CaptionWindow[] };

export type WorkerOut =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | { type: 'window'; id: number; chunks: { text: string; start: number; end: number | null }[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

let loaded: { key: string; asr: AutomaticSpeechRecognitionPipeline; device: 'webgpu' | 'wasm' } | null = null;

async function hasWebGPU() {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function load(model: string) {
  if (loaded?.key === model) return loaded;
  const progress_callback = (p: ProgressInfo) => {
    if (p.status === 'progress_total') post({ type: 'download', loaded: p.loaded, total: p.total });
  };
  const tryLoad = async (device: 'webgpu' | 'wasm') => {
    const dtype = device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' };
    // The union of every pipeline type is too large for TypeScript, so narrow it by hand.
    const asr = (await (pipeline as (...a: unknown[]) => Promise<unknown>)('automatic-speech-recognition', model, {
      device,
      dtype,
      progress_callback,
    })) as AutomaticSpeechRecognitionPipeline;
    return { key: model, asr, device };
  };
  if (await hasWebGPU()) {
    try {
      loaded = await tryLoad('webgpu');
      return loaded;
    } catch (e) {
      console.warn('WebGPU no disponible, usando WASM', e);
    }
  }
  loaded = await tryLoad('wasm');
  return loaded;
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type !== 'run') return;
  try {
    const { asr, device } = await load(msg.model);
    post({ type: 'ready', device });
    for (const w of msg.windows) {
      const out = await asr(w.samples, { language: msg.language, task: 'transcribe', return_timestamps: true });
      const res = (Array.isArray(out) ? out[0] : out) as { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
      const chunks = (res.chunks ?? [{ text: res.text, timestamp: [0, null] }]).map((c) => ({
        text: c.text,
        start: c.timestamp[0] ?? 0,
        end: c.timestamp[1] ?? null,
      }));
      post({ type: 'window', id: w.id, chunks });
    }
    post({ type: 'done' });
  } catch (err) {
    post({ type: 'error', message: String((err as Error)?.message ?? err) });
  }
};
