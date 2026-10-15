// Piper neural voices (rhasspy/piper-voices) running inside the TTS worker.
// Text → phonemes with the espeak-ng based piper-phonemize WASM, phonemes → audio with ONNX Runtime.
// Both runtimes ship with the app; each voice model (20–110 MB) is downloaded once and kept in
// the browser's Cache Storage, so later narrations work offline.
// Same ONNX Runtime entry and WASM file as transformers.js, which shares this worker: one runtime
// in the app, and transformers.js picks up the local wasmPaths set below instead of a CDN.
import * as ort from 'onnxruntime-web/webgpu';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import phonemizeWasm from '@diffusionstudio/piper-wasm/build/piper_phonemize.wasm?url';
import phonemizeData from '@diffusionstudio/piper-wasm/build/piper_phonemize.data?url';

// Downloads come from one fixed commit (the one the v1.0.0 tag points to) and are checked against
// their SHA-256 before they are used or cached. Cache keys keep the v1.0.0 URLs, so voices that
// earlier versions downloaded are reused.
const VOICES_REPO = 'https://huggingface.co/rhasspy/piper-voices';
const VOICES_REVISION = '375a0fe641dea077c2a47b4e9a056d6da521eed3';
const VOICES_BASE = `${VOICES_REPO}/resolve/${VOICES_REVISION}`;
const CACHE_BASE = `${VOICES_REPO}/resolve/v1.0.0`;
const CACHE = 'clipo-voices-v1';

/** SHA-256 of each voice file at VOICES_REVISION (Hugging Face API `?blobs=true`, and the .json files hashed). */
const SHA256: Record<string, string> = {
  'es/es_MX/claude/high/es_MX-claude-high.onnx': '3ef40a71ea63852cd8ab7e6fa7d2ecdcfa67a0b47c9c48e3f10e02ee02083ea0',
  'es/es_MX/claude/high/es_MX-claude-high.onnx.json': '1afc81f703c0e4cb3b4d7c0dca096b8b54a98806807f0170cf5eb5557723c12d',
  'es/es_MX/ald/medium/es_MX-ald-medium.onnx': '019b3803293c93e34a206dd2e53a3889209a514e786fd7144f7b70196c579b63',
  'es/es_MX/ald/medium/es_MX-ald-medium.onnx.json': 'efab736e62e5321dd5d063d1b46e63c59ce655419816355b81d025c1a8d6b03c',
  'es/es_AR/daniela/high/es_AR-daniela-high.onnx': '7ceb1fc0dab349418c5b54a639ae9ee595212d7c9ea422220d8419163d5cc985',
  'es/es_AR/daniela/high/es_AR-daniela-high.onnx.json': 'aedbf69647e1d754c62ecf8e0366ca5f16af3e768e3c6b5329af6eb6bde3852b',
  'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx': '6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917',
  'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json': '0e0dda87c732f6f38771ff274a6380d9252f327dca77aa2963d5fbdf9ec54842',
  'es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx': '40febfb1679c69a4505ff311dc136e121e3419a13a290ef264fdf43ddedd0fb1',
  'es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx.json': '7438c9b699c72b0c3388dae1b68d3f364dc66a2150fe554a1c11f03372957b2c',
};

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

ort.env.wasm.wasmPaths = { wasm: ortWasm, mjs: ortMjs };
// Threads need cross-origin isolation (COOP/COEP; see PUBLICAR.md); without it, one thread.
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

/** Fetch a voice file (path inside piper-voices), reporting progress, from the cache when we already have it. */
async function cachedFetch(file: string, onProgress?: DownloadProgress): Promise<ArrayBuffer> {
  const key = `${CACHE_BASE}/${file}`;
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = await cache?.match(key);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(`${VOICES_BASE}/${file}`);
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
  // A corrupted or tampered download is never cached nor handed to ONNX Runtime.
  const want = SHA256[file];
  if (want && (await sha256Hex(buf)) !== want) throw new Error(`integrity: ${file} does not match its SHA-256`);
  if (!want) console.warn('[piper] no pinned SHA-256 for', file);
  await cache?.put(key, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
  return buf.buffer;
}

const voices = new Map<string, Promise<LoadedVoice>>();

/** `path` is the voice path inside piper-voices, e.g. "es/es_MX/claude/high/es_MX-claude-high". */
export function loadVoice(path: string, onProgress?: DownloadProgress) {
  let v = voices.get(path);
  if (!v) {
    v = (async () => {
      const config = JSON.parse(new TextDecoder().decode(await cachedFetch(`${path}.onnx.json`))) as PiperConfig;
      const model = await cachedFetch(`${path}.onnx`, onProgress);
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
  if (!out.output) throw new Error('piper: the model returned no output');
  return { audio: out.output.data as Float32Array, sampling_rate: config.audio.sample_rate };
}
