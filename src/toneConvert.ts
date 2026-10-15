// OpenVoice V2 tone color conversion (MyShell, MIT) via ONNX Runtime: makes any speech sound
// like a reference voice by swapping its timbre. Much lighter than full voice cloning (131 MB,
// seconds per sentence), so "Mi voz" can be a natural Clipo voice re-timbred to the user's voice.
// Models: huggingface.co/seasonstudio/openvoice_tone_clone_onnx. Audio prep follows OpenVoice's
// spectrogram_torch: 22.05 kHz, n_fft 1024, hop 256, Hann window, reflect padding, magnitude.
// Same ONNX Runtime entry and WASM file as transformers.js (captions, narration), so the app ships
// a single runtime: the "webgpu" build also runs the plain WASM backend used here.
import * as ort from 'onnxruntime-web/webgpu';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';

export const TONE_RATE = 22050;
const N_FFT = 1024;
const HOP = 256;
const BINS = N_FFT / 2 + 1;
// Pinned to one commit of the model repo, and every file is checked against its SHA-256 (from the
// Hugging Face API, `?blobs=true` → lfs.sha256) before it is used or cached.
const REPO = 'https://huggingface.co/seasonstudio/openvoice_tone_clone_onnx';
const REVISION = 'abb763f5399bed4a70b79f65915259f285b1956b';
const BASE = `${REPO}/resolve/${REVISION}`;
/** Cache keys stay the old "main" URLs so models downloaded by earlier versions are reused. */
const CACHE_BASE = `${REPO}/resolve/main`;
const CACHE = 'clipo-tone-v1';
const SHA256: Record<string, string> = {
  'tone_color_extract_model.onnx': 'a90ce9048c8ad43ef3ebeb15ea5a1837ffa28669d61d78f749ccc2a648710747',
  'tone_clone_model.onnx': 'ea01c404712bc208694f79613488212e8cb7ad171c58361c22b645ca8b380197',
};

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

ort.env.wasm.wasmPaths = { wasm: ortWasm, mjs: ortMjs };
ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 2)) : 1;

// ---------- spectrogram ----------

const hann = Float32Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT));
const bitrev = (() => {
  const r = new Uint16Array(N_FFT);
  const bits = Math.log2(N_FFT);
  for (let i = 0; i < N_FFT; i++) {
    let x = i;
    let y = 0;
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1);
      x >>= 1;
    }
    r[i] = y;
  }
  return r;
})();
const twCos = Float32Array.from({ length: N_FFT / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / N_FFT));
const twSin = Float32Array.from({ length: N_FFT / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / N_FFT));

/** In-place radix-2 FFT of one frame. */
function fft(re: Float32Array, im: Float32Array) {
  for (let i = 0; i < N_FFT; i++) {
    const j = bitrev[i]!;
    if (j > i) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= N_FFT; size <<= 1) {
    const half = size >> 1;
    const step = N_FFT / size;
    for (let start = 0; start < N_FFT; start += size) {
      for (let k = 0; k < half; k++) {
        const c = twCos[k * step]!;
        const s = twSin[k * step]!;
        const a = start + k;
        const b = a + half;
        const rb = re[b]!;
        const ib = im[b]!;
        const tr = rb * c - ib * s;
        const ti = rb * s + ib * c;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a]! += tr;
        im[a]! += ti;
      }
    }
  }
}

/** Linear magnitude spectrogram, frame-major: [frames][513]. */
export function spectrogram(y: Float32Array): { data: Float32Array; frames: number } {
  const pad = (N_FFT - HOP) / 2;
  const n = y.length + 2 * pad;
  const at = (i: number) => {
    // Reflect padding like torch.nn.functional.pad(mode="reflect").
    let k = i - pad;
    if (k < 0) k = -k;
    if (k >= y.length) k = 2 * (y.length - 1) - k;
    return y[Math.max(0, Math.min(y.length - 1, k))]!;
  };
  const frames = Math.max(1, Math.floor((n - N_FFT) / HOP) + 1);
  const data = new Float32Array(frames * BINS);
  const re = new Float32Array(N_FFT);
  const im = new Float32Array(N_FFT);
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    for (let i = 0; i < N_FFT; i++) {
      re[i] = at(o + i) * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < BINS; b++) data[f * BINS + b] = Math.sqrt(re[b]! * re[b]! + im[b]! * im[b]! + 1e-6);
  }
  return { data, frames };
}

function transpose(s: { data: Float32Array; frames: number }) {
  const out = new Float32Array(s.data.length);
  for (let f = 0; f < s.frames; f++) for (let b = 0; b < BINS; b++) out[b * s.frames + f] = s.data[f * BINS + b]!;
  return out;
}

// ---------- models ----------

class IntegrityError extends Error {
  constructor(name: string) {
    super(`integrity: ${name} does not match its SHA-256`);
  }
}

async function model(name: string, onProgress?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  const url = `${BASE}/${name}`;
  const key = `${CACHE_BASE}/${name}`;
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = await cache?.match(key);
  if (hit) return hit.arrayBuffer();
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body.getReader();
      const parts: BlobPart[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        loaded += value.length;
        onProgress?.(loaded, total);
      }
      const blob = new Blob(parts);
      const buf = await blob.arrayBuffer();
      // A corrupted or tampered download is never cached nor handed to ONNX Runtime.
      if (SHA256[name] && (await sha256Hex(buf)) !== SHA256[name]) throw new IntegrityError(name);
      await cache?.put(key, new Response(blob)).catch(() => {});
      return buf;
    } catch (e) {
      if (attempt >= 5 || e instanceof IntegrityError) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

let sessions: Promise<{ extract: ort.InferenceSession; clone: ort.InferenceSession }> | null = null;

export function loadTone(onProgress?: (loaded: number, total: number) => void) {
  if (!sessions) {
    sessions = (async () => {
      const extract = await ort.InferenceSession.create(await model('tone_color_extract_model.onnx'), { executionProviders: ['wasm'] });
      const clone = await ort.InferenceSession.create(await model('tone_clone_model.onnx', onProgress), { executionProviders: ['wasm'] });
      return { extract, clone };
    })();
    sessions.catch(() => (sessions = null));
  }
  return sessions;
}

/** The 256-number "tone color" of a voice, from mono audio at 22.05 kHz. */
export async function toneColor(y: Float32Array): Promise<Float32Array> {
  const { extract } = await loadTone();
  const s = spectrogram(y);
  const out = await extract.run({ input: new ort.Tensor('float32', s.data, [1, s.frames, BINS]) });
  return new Float32Array((out[extract.outputNames[0]!] as ort.Tensor).data as Float32Array);
}

/** Re-timbre speech `y` (22.05 kHz) from the `src` tone color to the `dest` one. */
export async function convertTone(y: Float32Array, src: Float32Array, dest: Float32Array, tau = 0.3): Promise<Float32Array> {
  const { clone } = await loadTone();
  const s = spectrogram(y);
  const out = await clone.run({
    audio: new ort.Tensor('float32', transpose(s), [1, BINS, s.frames]),
    audio_length: new ort.Tensor('int64', BigInt64Array.from([BigInt(s.frames)]), [1]),
    src_tone: new ort.Tensor('float32', src, [1, 256, 1]),
    dest_tone: new ort.Tensor('float32', dest, [1, 256, 1]),
    tau: new ort.Tensor('float32', Float32Array.from([tau]), [1]),
  });
  return new Float32Array((out[clone.outputNames[0]!] as ort.Tensor).data as Float32Array);
}
