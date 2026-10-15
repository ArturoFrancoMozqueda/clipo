// Piper neural voices (rhasspy/piper-voices) running inside the TTS worker.
// Text → phonemes with the espeak-ng based piper-phonemize WASM, phonemes → audio with ONNX Runtime.
// Both runtimes ship with the app; each voice model (20–110 MB) is downloaded once and kept in
// the browser's Cache Storage, so later narrations work offline.
import * as ort from 'onnxruntime-web/wasm';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import phonemizeWasm from '@diffusionstudio/piper-wasm/build/piper_phonemize.wasm?url';
import phonemizeData from '@diffusionstudio/piper-wasm/build/piper_phonemize.data?url';

const VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0';
const CACHE = 'clipo-voices-v1';

ort.env.wasm.wasmPaths = { wasm: ortWasm, mjs: ortMjs };
// Threads need cross-origin isolation, which Clipo doesn't enable (see PUBLICAR.md).
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

interface PiperConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers: number;
  speaker_id_map: Record<string, number>;
}

interface LoadedVoice {
  config: PiperConfig;
  session: ort.InferenceSession;
}

export type DownloadProgress = (loaded: number, total: number) => void;

/** Fetch a file, reporting progress, from the cache when we already have it. */
async function cachedFetch(url: string, onProgress?: DownloadProgress): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let at = 0;
  for (const p of parts) {
    buf.set(p, at);
    at += p.length;
  }
  await cache?.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
  return buf.buffer;
}

const voices = new Map<string, Promise<LoadedVoice>>();

/** `path` is the voice path inside piper-voices, e.g. "es/es_MX/claude/high/es_MX-claude-high". */
export function loadVoice(path: string, onProgress?: DownloadProgress) {
  let v = voices.get(path);
  if (!v) {
    v = (async () => {
      const config = JSON.parse(new TextDecoder().decode(await cachedFetch(`${VOICES_BASE}/${path}.onnx.json`))) as PiperConfig;
      const model = await cachedFetch(`${VOICES_BASE}/${path}.onnx`, onProgress);
      const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
      return { config, session };
    })();
    v.catch(() => voices.delete(path));
    voices.set(path, v);
  }
  return v;
}

// The espeak-ng data (18 MB) is read once and handed to every phonemizer instance.
let phonemizeDataBuf: Promise<ArrayBuffer> | null = null;
const getPhonemizeData = () => (phonemizeDataBuf ??= fetch(phonemizeData).then((r) => r.arrayBuffer()));

type PhonemizeModule = { callMain(args: string[]): void };
type Factory = (opts: Record<string, unknown>) => Promise<PhonemizeModule>;

/** Text → Piper phoneme ids for an espeak voice ("es", "es-419"). */
async function phonemize(text: string, espeakVoice: string): Promise<number[]> {
  const data = await getPhonemizeData();
  return new Promise<number[]>((resolve, reject) => {
    (createPiperPhonemize as unknown as Factory)({
      print: (line: string) => {
        try {
          resolve(JSON.parse(line).phoneme_ids);
        } catch (e) {
          reject(e);
        }
      },
      printErr: (msg: string) => console.warn('[piper]', msg),
      locateFile: (file: string) => (file.endsWith('.wasm') ? phonemizeWasm : file.endsWith('.data') ? phonemizeData : file),
      getPreloadedPackage: () => data,
    })
      .then((m) => m.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']))
      .catch(reject);
  });
}

const int64 = (values: number[]) => BigInt64Array.from(values.map((v) => BigInt(v)));

/** Speak one sentence. `speed` > 1 talks faster. Returns mono samples. */
export async function piperSpeak(path: string, text: string, speed: number, speaker: string | undefined, onProgress?: DownloadProgress) {
  const { config, session } = await loadVoice(path, onProgress);
  const ids = await phonemize(text, config.espeak.voice);
  const { noise_scale, length_scale, noise_w } = config.inference;
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', int64(ids), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', int64([ids.length]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([noise_scale, length_scale / Math.max(0.5, speed), noise_w]), [3]),
  };
  if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', int64([config.speaker_id_map[speaker ?? ''] ?? 0]), [1]);
  const out = await session.run(feeds);
  return { audio: out.output.data as Float32Array, sampling_rate: config.audio.sample_rate };
}
