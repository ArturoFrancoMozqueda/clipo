// Voice cloning on the device with Chatterbox Multilingual (Resemble AI, MIT license).
// A ~10 s recording of the user's own voice is turned into speaker embeddings, then any Spanish
// text is spoken in that voice. Runs in its own worker: the model is ~1.5 GB and is only
// downloaded the first time someone uses "Mi voz".
import { AutoConfig, AutoTokenizer, ChatterboxModel, Tensor, env, type ProgressInfo } from '@huggingface/transformers';

const MODEL = 'onnx-community/chatterbox-multilingual-ONNX';
/** Space the model needs in the browser cache, in bytes (plus a margin). */
const NEEDS = 1.7e9;
// The multilingual export ships without config files; the architecture matches the English one.
const CONFIG_FROM = 'onnx-community/chatterbox-ONNX';
export const CLONE_SAMPLE_RATE = 24000;

export type CloneIn =
  | { type: 'load'; id: number }
  | { type: 'speak'; id: number; voiceKey: string; reference: Float32Array; parts: string[]; exaggeration: number; lang: string };

export type CloneOut =
  | { type: 'download'; id: number; loaded: number; total: number }
  /** Loading stage, for diagnostics. */
  | { type: 'stage'; id: number; stage: string }
  | { type: 'ready'; id: number; device: 'webgpu' | 'wasm'; cached: boolean }
  | { type: 'part'; id: number; done: number; total: number }
  | { type: 'audio'; id: number; samples: Float32Array; sampleRate: number }
  | { type: 'error'; id: number; message: string };

const post = (m: CloneOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

type Loaded = {
  /** False when there was no room to keep the model: it will download again next time. */
  cached: boolean;
  model: ChatterboxModel;
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  device: 'webgpu' | 'wasm';
};
let loading: Promise<Loaded> | null = null;
const speakers = new Map<string, Record<string, Tensor>>();

// ---------- robust download ----------
// Transformers.js downloads each file in one request and gives up on the first network hiccup,
// which is common with 1.5 GB over home Wi-Fi. We fetch the files ourselves in ranges, retrying
// each piece, and store them in the cache Transformers.js reads from ("transformers-cache", keyed
// by the file's Hugging Face URL), so it then loads everything from disk.

const HF = 'https://huggingface.co';
const CACHE_NAME = 'transformers-cache';
const CHUNK = 32 * 1024 * 1024;
const hfUrl = (repo: string, f: string) => `${HF}/${repo}/resolve/main/${f}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetries<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= tries) throw e;
      await sleep(Math.min(15000, 1000 * 2 ** attempt));
    }
  }
}

async function remoteSize(url: string) {
  return withRetries(async () => {
    const r = await fetch(url, { method: 'HEAD' });
    if (!r.ok) throw new Error(`HEAD ${r.status}`);
    // Small text files come compressed without a length: 0 means "fetch it whole".
    return Number(r.headers.get('x-linked-size') ?? r.headers.get('content-length')) || 0;
  });
}

async function fetchRange(url: string, start: number, end: number) {
  return withRetries(async () => {
    const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    if (r.status !== 206 && !(r.status === 200 && start === 0)) throw new Error(`range ${r.status}`);
    const b = await r.blob();
    if (r.status === 206 && b.size !== end - start + 1) throw new Error('short read');
    return b;
  });
}

/** Make sure every file is in the cache, downloading what is missing. Reports overall bytes. */
async function prefetch(files: { repo: string; file: string }[], onProgress: (loaded: number, total: number) => void) {
  const cache = await caches.open(CACHE_NAME);
  const todo: { url: string; size: number }[] = [];
  for (const f of files) {
    const url = hfUrl(f.repo, f.file);
    if (!(await cache.match(url))) todo.push({ url, size: await remoteSize(url) });
  }
  const total = todo.reduce((n, t) => n + t.size, 0);
  let loaded = 0;
  for (const t of todo) {
    if (!t.size) {
      const whole = await withRetries(async () => {
        const r = await fetch(t.url);
        if (!r.ok) throw new Error(`GET ${r.status}`);
        return r.blob();
      });
      await cache.put(t.url, new Response(whole, { headers: { 'content-length': String(whole.size) } }));
      continue;
    }
    const parts: Blob[] = [];
    for (let start = 0; start < t.size; start += CHUNK) {
      const end = Math.min(t.size, start + CHUNK) - 1;
      parts.push(await fetchRange(t.url, start, end));
      loaded += end - start + 1;
      onProgress(loaded, total);
    }
    await cache.put(t.url, new Response(new Blob(parts), { headers: { 'content-length': String(t.size), 'content-type': 'application/octet-stream' } }));
  }
}

async function hasWebGPU() {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

function load(id: number) {
  if (loading) return loading;
  loading = (async () => {
    const device = (await hasWebGPU()) ? 'webgpu' : 'wasm';
    // Writing 1.5 GB into a cache that has no room for it stalls the download, so skip the cache then.
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    const cached = !est?.quota || est.quota - (est.usage ?? 0) > NEEDS;
    env.useBrowserCache = cached;
    // Sum per-file progress ourselves: the model is several files and not every build reports a total.
    const files = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (info: ProgressInfo) => {
      if (info.status === 'progress_total') return post({ type: 'download', id, loaded: info.loaded, total: info.total });
      if (info.status === 'progress') {
        files.set(info.file, { loaded: info.loaded, total: info.total });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        post({ type: 'download', id, loaded, total });
      } else if (info.status === 'initiate' || info.status === 'done') post({ type: 'stage', id, stage: `${info.status} ${info.file}` });
    };
    post({ type: 'stage', id, stage: `device ${device}` });
    if (cached) {
      const q = device === 'webgpu' ? 'q4f16' : 'q4';
      const onnx = ['embed_tokens', 'speech_encoder', `language_model_${q}`, 'conditional_decoder'].flatMap((n) => [`onnx/${n}.onnx`, `onnx/${n}.onnx_data`]);
      await prefetch(
        [
          ...['tokenizer.json', 'tokenizer_config.json', 'generation_config.json', ...onnx].map((file) => ({ repo: MODEL, file })),
          { repo: CONFIG_FROM, file: 'config.json' },
        ],
        (loaded, total) => post({ type: 'download', id, loaded, total }),
      );
      post({ type: 'stage', id, stage: 'files ready on disk' });
    }
    const config = await AutoConfig.from_pretrained(CONFIG_FROM);
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
    post({ type: 'stage', id, stage: 'config and tokenizer ready' });
    const create = (dev: 'webgpu' | 'wasm') =>
      ChatterboxModel.from_pretrained(MODEL, {
        config,
        device: dev,
        dtype: {
          embed_tokens: 'fp32',
          speech_encoder: 'fp32',
          language_model: dev === 'webgpu' ? 'q4f16' : 'q4',
          conditional_decoder: 'fp32',
        },
        progress_callback,
      }) as Promise<ChatterboxModel>;
    let model: ChatterboxModel;
    let used: 'webgpu' | 'wasm' = device;
    try {
      model = await create(device);
    } catch (e) {
      if (device !== 'webgpu') throw e;
      // Some graphics cards lack what the model needs (e.g. 16-bit floats): use the processor instead.
      post({ type: 'stage', id, stage: `webgpu failed, using wasm: ${String((e as Error)?.message ?? e)}` });
      used = 'wasm';
      model = await create('wasm');
    }
    post({ type: 'stage', id, stage: 'model sessions created' });
    return { model, tokenizer, device: used, cached };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

// The multilingual tokenizer wraps the text with special tokens named in its post-processor
// (EXAGGERATION, BOS, EOS, START_SPEECH). Transformers.js looks those names up in the vocabulary,
// doesn't find them and emits [UNK] instead, so the model never sees "start speaking" and stops at
// once. We add them ourselves, with the ids the reference Python tokenizer produces.
const EXAGGERATION = 6563;
const BOS = 255;
const EOS = 0;
const START_SPEECH = 6561;

type Tok = (text: string, opts: { add_special_tokens: boolean }) => { input_ids: Tensor };

/** Token ids for one sentence; the language is chosen with a tag in front of the text. */
function encodeText(tokenizer: unknown, text: string, lang: string) {
  const body = Array.from((tokenizer as Tok)(`[${lang}]${text}`, { add_special_tokens: false }).input_ids.data as BigInt64Array, Number);
  const ids = [EXAGGERATION, BOS, ...body, EOS, START_SPEECH, START_SPEECH];
  return {
    input_ids: new Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    attention_mask: new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]),
  };
}

/** Pause between sentences, in seconds. */
const GAP = 0.2;

type Encode = (audio: Tensor) => Promise<Record<string, Tensor>>;
type Generate = (inputs: Record<string, unknown>) => Promise<Tensor>;

async function speak(msg: Extract<CloneIn, { type: 'speak' }>) {
  const { model, tokenizer } = await load(msg.id);
  let speaker = speakers.get(msg.voiceKey);
  if (!speaker) {
    const ref = new Tensor('float32', msg.reference, [1, msg.reference.length]);
    post({ type: 'stage', id: msg.id, stage: 'encoding speaker' });
    speaker = await (model as unknown as { encode_speech: Encode }).encode_speech(ref);
    post({ type: 'stage', id: msg.id, stage: 'speaker encoded' });
    speakers.set(msg.voiceKey, speaker);
  }
  const pieces: Float32Array[] = [];
  for (let i = 0; i < msg.parts.length; i++) {
    const inputs = encodeText(tokenizer, msg.parts[i], msg.lang);
    post({ type: 'stage', id: msg.id, stage: `generating part ${i + 1}, ${inputs.input_ids.dims[1]} tokens` });
    const wave = await (model as unknown as { generate: Generate }).generate({
      ...inputs,
      ...speaker,
      exaggeration: msg.exaggeration,
      max_new_tokens: 400,
    });
    pieces.push(new Float32Array(wave.data as Float32Array));
    post({ type: 'part', id: msg.id, done: i + 1, total: msg.parts.length });
  }
  const gap = Math.round(GAP * CLONE_SAMPLE_RATE);
  const samples = new Float32Array(pieces.reduce((n, p) => n + p.length, 0) + gap * Math.max(0, pieces.length - 1));
  let at = 0;
  for (const p of pieces) {
    samples.set(p, at);
    at += p.length + gap;
  }
  post({ type: 'audio', id: msg.id, samples, sampleRate: CLONE_SAMPLE_RATE }, [samples.buffer]);
}

// One request at a time: the model can't run two generations at once.
let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<CloneIn>) => {
  const msg = e.data;
  queue = queue.then(async () => {
    try {
      if (msg.type === 'load') {
        const { device, cached } = await load(msg.id);
        post({ type: 'ready', id: msg.id, device, cached });
      } else await speak(msg);
    } catch (err) {
      post({ type: 'error', id: msg.id, message: String((err as Error)?.message ?? err) });
    }
  });
};
