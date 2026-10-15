import { useSyncExternalStore } from 'react';
import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import wasmLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import wasmLoaderNoSimd from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url';
import wasmBinaryNoSimd from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url';
import wasmLoaderModule from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmBinaryModule from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import type { BgRemoval, Project } from './types';
import type { SegIn, SegOut } from './segWorker';
import { requestRedraw } from './redraw';

/**
 * "Quitar fondo": person segmentation that runs entirely on the device (MediaPipe Selfie
 * Segmenter, WebAssembly + WebGL). The runtime and the 250 KB model ship with the app and are
 * only loaded the first time a clip uses it. Masks are cached per source frame so scrubbing,
 * replaying and exporting don't segment the same picture twice.
 *
 * Two places run the model:
 * - The live preview hands frames to a Web Worker (segWorker.ts) and draws the newest mask it has
 *   while the exact one is made, so the main thread never waits for the model. The worker loads the
 *   ES-module build of the WebAssembly glue (tasks-vision falls back from importScripts to import()
 *   in module workers) and needs WebGL in OffscreenCanvas; where that is missing (Safari < 17, no
 *   module workers) or the worker fails, the preview segments on the main thread in a separate,
 *   throttled task as before.
 * - The export and the reframe analysis need the exact mask of each frame synchronously (the fast
 *   exporter's renderFrame and the reframe sampler are synchronous per frame), so they keep a
 *   main-thread instance, loaded by loadSegmenter(). Both already show a progress screen, and an
 *   awaited round trip per frame would change no pixel but add copies and latency. That instance
 *   is closed after a minute without such use when the preview has the worker.
 * Everything is released when no clip uses "Quitar fondo" for a while, and right away when the
 * project closes.
 */

export type SegStatus = 'idle' | 'loading' | 'ready' | 'error';

export const BG_DEFAULT: BgRemoval = { mode: 'color', color: '#ffffff', smooth: 0.4 };
export const BG_COLORS = ['#ffffff', '#111111', '#7c6cff', '#00b140', '#2f80ed', '#ff8a65', '#ffd54f', '#f48fb1'];

/** Thrown (with a message for the user) when the export needs the model and it can't load. */
export class BgError extends Error {}
export const BG_LOAD_ERROR = 'No se pudo preparar “Quitar fondo” en este dispositivo. Revisa tu conexión y vuelve a intentarlo.';

/** Read when the model loads, not at import (keeps this module loadable outside Vite, e.g. in Node tests). */
const modelUrl = () => `${import.meta.env.BASE_URL}models/selfie_segmenter.tflite`;
/** The worker resolves URLs against its own location, so it gets absolute ones. */
const abs = (u: string) => new URL(u, document.baseURI).href;

let status: SegStatus = 'idle';
const listeners = new Set<() => void>();

function setStatus(s: SegStatus) {
  if (s === status) return;
  status = s;
  listeners.forEach((l) => l());
}

/** Ready as soon as either instance can segment; error only when nothing loads. */
function refreshStatus() {
  setStatus(
    segmenter || wState === 'ready' ? 'ready' : loading || wState === 'loading' ? 'loading' : mainFailed ? 'error' : 'idle',
  );
}

export const segStatus = () => status;

/** Status for the UI: re-renders when the model starts loading, is ready or failed. */
export function useSegStatus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

export const usesBgRemoval = (p: Project) => p.clips.some((c) => c.bgRemoval);

// ---------- main-thread instance (export, reframe, and the preview where the worker can't run) ----------

let segmenter: ImageSegmenter | null = null;
let loading: Promise<void> | null = null;
let mainFailed = false;

/**
 * Loads the main-thread segmenter once (the export and the reframe analysis need it for exact,
 * synchronous masks). Tries the GPU first and falls back to the CPU. Safe to call repeatedly.
 */
export function loadSegmenter(): Promise<void> {
  lastExact = performance.now();
  scheduleSweep();
  // "Reintentar": a worker that failed for a passing reason (network) gets another chance too.
  if (status === 'error' && wState === 'failed' && !workerUnsupported) wState = 'off';
  return loadMain();
}

function loadMain(): Promise<void> {
  if (segmenter) return Promise.resolve();
  if (loading) return loading;
  const attempt = (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const simd = await FilesetResolver.isSimdSupported();
    const fileset = simd
      ? { wasmLoaderPath: wasmLoader, wasmBinaryPath: wasmBinary }
      : { wasmLoaderPath: wasmLoaderNoSimd, wasmBinaryPath: wasmBinaryNoSimd };
    let last: unknown;
    for (const delegate of ['GPU', 'CPU'] as const) {
      let s: ImageSegmenter | null = null;
      try {
        s = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelUrl(), delegate },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
        // A first run can still fail on a GPU that accepted the setup.
        probe(s);
        return s;
      } catch (e) {
        last = e;
        s?.close();
      }
    }
    throw last;
  })().then(
    (s) => {
      if (loading !== attempt) {
        s.close(); // released while it was loading
        return;
      }
      segmenter = s;
      mainFailed = false;
      refreshStatus();
      requestRedraw();
      scheduleSweep();
    },
    (e) => {
      console.warn('Background removal unavailable', e);
      if (loading === attempt) {
        loading = null; // allow "Reintentar"
        mainFailed = true;
        refreshStatus();
      }
      throw new BgError(BG_LOAD_ERROR);
    },
  );
  loading = attempt;
  refreshStatus();
  return attempt;
}

function probe(s: ImageSegmenter) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  c.getContext('2d')!.fillRect(0, 0, 16, 16);
  s.segment(c).close();
}

function closeMain() {
  segmenter?.close();
  segmenter = null;
  loading = null;
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
  input = null;
  inputCtx = null;
}

// ---------- masks ----------

/** Person opacity (0..255), one byte per pixel, at the size the model was given. */
export interface Mask {
  w: number;
  h: number;
  alpha: Uint8ClampedArray;
}

interface Entry extends Mask {
  /** Made at the reduced size used while playing. */
  lo: boolean;
}

/** Longest side of the picture handed to the model. */
const SIZE_HI = 256;
const SIZE_LO = 160;
const CACHE_MAX = 300; // ~20 MB at 256 px
const cache = new Map<string, Entry>();
/** Last mask per asset, shown while the exact one for this frame is still being made. */
const lastOf = new Map<string, Entry>();
let lastRun = 0;
let avgMs = 15;

/** Fits sw×sh so its longest side is at most `max`. */
function fitSize(sw: number, sh: number, max: number) {
  const k = Math.min(1, max / Math.max(sw, sh));
  return [Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k))] as const;
}

let input: HTMLCanvasElement | null = null;
let inputCtx: CanvasRenderingContext2D | null = null;

/** Copy the picture into the main-thread model's input canvas, scaled so its longest side is `max`. */
function stage(src: CanvasImageSource, sw: number, sh: number, max: number) {
  if (!input) {
    input = document.createElement('canvas');
    inputCtx = input.getContext('2d', { willReadFrequently: false })!;
  }
  const [w, h] = fitSize(sw, sh, max);
  if (input.width !== w || input.height !== h) {
    input.width = w;
    input.height = h;
  }
  inputCtx!.drawImage(src, 0, 0, w, h);
  return input;
}

/** Run the main-thread model on the staged input. Null when it produced nothing usable. */
function run(lo: boolean): Entry | null {
  const t0 = performance.now();
  let entry: Entry | null = null;
  try {
    const res = segmenter!.segment(input!);
    try {
      const masks = res.confidenceMasks ?? [];
      // Two outputs = [background, person]; one output = person.
      const m = masks.length > 1 ? masks[1] : masks[0];
      if (m) {
        const conf = m.getAsFloat32Array();
        const alpha = new Uint8ClampedArray(m.width * m.height);
        // Tighten the soft model output a little so edges don't look foggy; smoothing is added at draw time.
        for (let i = 0; i < alpha.length; i++) alpha[i] = (conf[i]! - 0.3) * 637.5; // 0.3..0.7 -> 0..255
        entry = { w: m.width, h: m.height, alpha, lo };
      }
    } finally {
      res.close();
    }
  } catch (e) {
    console.warn('Segmentation failed', e);
    return null;
  }
  avgMs = avgMs * 0.8 + (performance.now() - t0) * 0.2;
  lastRun = performance.now();
  return entry;
}

function store(key: string, assetId: string, entry: Entry, stale: boolean) {
  lastOf.set(assetId, entry);
  // A video element that is still seeking shows an older frame: don't file it under this time.
  if (stale) return;
  cache.set(key, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

/** A cached mask good enough for this request (a full-size one also serves playback). */
const covers = (e: { lo: boolean } | undefined, lo: boolean) => !!e && (lo || !e.lo);

interface Job {
  key: string;
  assetId: string;
  lo: boolean;
  stale: boolean;
}

// ---------- preview on the main thread (fallback) ----------

/** The one frame waiting to be segmented off the drawing path (newer requests replace it). */
let pending: Job | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(lo: boolean) {
  if (timer) return;
  // While playing, leave the main thread most of the time to decoding and drawing.
  const gap = lo ? Math.max(50, avgMs * 3) : 0;
  const wait = Math.max(0, lastRun + gap - performance.now());
  timer = setTimeout(() => {
    timer = null;
    const job = pending;
    pending = null;
    if (!job || !segmenter) return;
    if (covers(cache.get(job.key), job.lo)) return;
    const entry = run(job.lo);
    if (entry) {
      store(job.key, job.assetId, entry, job.stale);
      requestRedraw();
    }
    // A newer frame may have been requested by the redraw above.
    const next = pending as Job | null;
    if (next) schedule(next.lo);
  }, wait);
}

// ---------- preview in the worker ----------

type WorkerState = 'off' | 'loading' | 'ready' | 'failed';
let worker: Worker | null = null;
let wState: WorkerState = 'off';
/** This browser can't run it (no WebGL in OffscreenCanvas, no module workers): don't try again. */
let workerUnsupported = false;
let nextId = 1;
/** The frame the worker is segmenting; it gets one at a time. */
let inflight: (Job & { id: number; since: number }) | null = null;
/** The newest frame waiting for it (newer requests replace it). */
let queued: (Job & { image: ImageBitmap }) | null = null;
/** A worker that hasn't answered in this long is considered stuck. */
const WORKER_STALL_MS = 10_000;

const workerPossible = () =>
  !workerUnsupported &&
  wState !== 'failed' &&
  typeof Worker !== 'undefined' &&
  typeof OffscreenCanvas !== 'undefined' &&
  'transferToImageBitmap' in OffscreenCanvas.prototype;

function startWorker() {
  wState = 'loading';
  refreshStatus();
  let w: Worker;
  try {
    w = new Worker(new URL('./segWorker.ts', import.meta.url), { type: 'module' });
  } catch (e) {
    workerFailed(e, true);
    return;
  }
  worker = w;
  w.onmessage = (e: MessageEvent<SegOut>) => {
    if (worker === w) onWorkerMessage(e.data);
  };
  // A script that doesn't load or a crash: the preview goes back to the main thread.
  w.onerror = (e) => {
    e.preventDefault();
    if (worker === w) workerFailed(e.message || 'worker error', false);
  };
  const init: SegIn = { type: 'init', loader: abs(wasmLoaderModule), binary: abs(wasmBinaryModule), model: abs(modelUrl()) };
  w.postMessage(init);
}

function stopWorker(next: WorkerState) {
  worker?.terminate();
  worker = null;
  wState = next;
  inflight = null;
  queued?.image.close();
  queued = null;
}

function workerFailed(why: unknown, unsupported: boolean) {
  console.warn('Background removal worker unavailable; segmenting on the main thread.', why);
  if (unsupported) workerUnsupported = true;
  stopWorker('failed');
  if (!segmenter && !loading) loadMain().catch(() => {});
  refreshStatus();
  requestRedraw();
}

let avgWorkerMs = 0;

function onWorkerMessage(m: SegOut) {
  if (m.type === 'ready') {
    wState = 'ready';
    refreshStatus();
    requestRedraw();
    scheduleSweep();
  } else if (m.type === 'error') {
    workerFailed(m.message, m.unsupported);
  } else if (m.type === 'mask') {
    const job = inflight;
    if (!job || job.id !== m.id) return;
    inflight = null;
    avgWorkerMs = avgWorkerMs ? avgWorkerMs * 0.8 + m.ms * 0.2 : m.ms;
    if (m.alpha) {
      store(job.key, job.assetId, { w: m.w, h: m.h, alpha: m.alpha, lo: job.lo }, job.stale);
      requestRedraw();
    }
    pump();
  }
}

/** Hand the queued frame to the worker if it is free. */
function pump() {
  if (inflight || !queued || !worker || wState !== 'ready') return;
  const job = queued;
  queued = null;
  if (covers(cache.get(job.key), job.lo)) {
    job.image.close();
    return;
  }
  const id = nextId++;
  inflight = { key: job.key, assetId: job.assetId, lo: job.lo, stale: job.stale, id, since: performance.now() };
  const msg: SegIn = { type: 'segment', id, image: job.image };
  worker.postMessage(msg, [job.image]);
}

let snap: OffscreenCanvas | null = null;
let snapCtx: OffscreenCanvasRenderingContext2D | null = null;

/** A small copy of the picture for the worker, taken now (the video moves on). */
function snapshot(src: CanvasImageSource, sw: number, sh: number, max: number): ImageBitmap | null {
  const [w, h] = fitSize(sw, sh, max);
  try {
    if (!snap) {
      snap = new OffscreenCanvas(w, h);
      snapCtx = snap.getContext('2d');
    } else if (snap.width !== w || snap.height !== h) {
      snap.width = w;
      snap.height = h;
    }
    if (!snapCtx) return null;
    snapCtx.drawImage(src, 0, 0, w, h);
    return snap.transferToImageBitmap(); // synchronous and without a copy
  } catch (e) {
    console.warn('Could not capture the frame for background removal', e);
    return null;
  }
}

function requestWorker(job: Job, src: CanvasImageSource, sw: number, sh: number) {
  // Already on its way (a full-size mask also serves playback).
  const same = (o: Job | null) => !!o && o.key === job.key && !o.stale && covers(o, job.lo);
  if (same(inflight) || same(queued)) return;
  if (inflight && performance.now() - inflight.since > WORKER_STALL_MS) {
    workerFailed('no answer', false);
    return;
  }
  const image = snapshot(src, sw, sh, job.lo ? SIZE_LO : SIZE_HI);
  if (!image) return;
  queued?.image.close();
  queued = { ...job, image };
  pump();
}

/** Which instance makes the preview's masks; null while it is loading (it starts loading). */
function previewBackend(): 'worker' | 'main' | null {
  if (wState === 'ready') return 'worker';
  if (workerPossible()) {
    if (wState === 'off') startWorker();
    return null;
  }
  if (segmenter) return 'main';
  if (!loading && !mainFailed) loadMain().catch(() => {});
  return null;
}

/**
 * Gets the preview ready (the panel calls it when "Quitar fondo" is turned on or retried): starts
 * the worker where it can run, otherwise the main-thread instance. Unlike loadSegmenter(), it
 * doesn't load the main-thread model only to leave it idle.
 */
export function preparePreview() {
  if (status === 'error' && wState === 'failed' && !workerUnsupported) wState = 'off';
  if (status === 'error' && mainFailed && !loading) mainFailed = false;
  previewBackend();
  refreshStatus();
}

// ---------- lookups ----------

/**
 * The person mask of a picture, or null while no mask is available yet (the model starts loading).
 * `key` names the picture (asset + source frame). With `live` (playback) it uses a smaller input.
 * With `wait` (the export and the reframe analysis) it segments right away on this thread and
 * returns the exact mask (loadSegmenter() must have resolved); otherwise (the preview) it never
 * blocks drawing: it returns the cached mask, or the last one of the asset while the exact one is
 * made in the worker (or a later task), then asks for a redraw.
 */
export function maskFor(
  key: string, assetId: string, src: CanvasImageSource, sw: number, sh: number, live: boolean, wait = !live,
): Mask | null {
  lastUse = performance.now();
  if (wait) lastExact = lastUse;
  scheduleSweep();
  const hit = cache.get(key);
  if (covers(hit, live)) {
    cache.delete(key); // keep it fresh in the LRU order
    cache.set(key, hit!);
    return hit!;
  }
  // A low-res mask of this very frame beats the last mask of another one.
  const prev = hit ?? lastOf.get(assetId) ?? null;
  const lo = live;
  const stale = src instanceof HTMLVideoElement && src.seeking;
  const job: Job = { key, assetId, lo, stale };

  if (wait) {
    if (!segmenter) {
      if (!loading && !mainFailed) loadMain().catch(() => {});
      return null;
    }
    stage(src, sw, sh, lo ? SIZE_LO : SIZE_HI);
    if (pending) {
      // The staged picture was replaced: the preview asks for it again on its next redraw.
      pending = null;
      requestRedraw();
    }
    const entry = run(lo);
    if (!entry) return prev;
    store(key, assetId, entry, stale);
    return entry;
  }

  const backend = previewBackend();
  if (backend === 'worker') requestWorker(job, src, sw, sh);
  else if (backend === 'main') {
    // Snapshot the picture now (it is cheap at this size); the model runs on it later.
    if (pending?.key !== key) {
      stage(src, sw, sh, lo ? SIZE_LO : SIZE_HI);
      pending = job;
    }
    schedule(lo);
  }
  return prev;
}

/** Forget the masks of an asset (e.g. its file changed). */
export function dropMasks(assetId: string) {
  for (const k of cache.keys()) if (k.startsWith(`${assetId}@`)) cache.delete(k);
  lastOf.delete(assetId);
}

let maskCanvas: HTMLCanvasElement | null = null;
let maskImage: ImageData | null = null;
let painted: Mask | null = null;

/** Paints a mask as alpha into a reusable canvas; use it right away (it is overwritten by the next call). */
export function maskImageOf(m: Mask): HTMLCanvasElement {
  if (!maskCanvas) maskCanvas = document.createElement('canvas');
  // The same mask is often drawn many frames in a row (paused, or reused while playing).
  if (painted === m && maskCanvas.width === m.w && maskCanvas.height === m.h) return maskCanvas;
  painted = m;
  if (maskCanvas.width !== m.w || maskCanvas.height !== m.h || !maskImage) {
    maskCanvas.width = m.w;
    maskCanvas.height = m.h;
    maskImage = new ImageData(m.w, m.h);
  }
  const d = maskImage.data;
  for (let i = 0, j = 3; i < m.alpha.length; i++, j += 4) d[j] = m.alpha[i]!;
  maskCanvas.getContext('2d')!.putImageData(maskImage, 0, 0);
  return maskCanvas;
}

// ---------- freeing memory ----------

/** How often loaded models are checked for idleness. */
const SWEEP_MS = 15_000;
/** Nothing uses "Quitar fondo" (and no export or reframe ran) for this long: free everything. */
const RELEASE_MS = 30_000;
/** The main-thread instance, when the preview has the worker, is kept this long after its last use. */
const EXACT_IDLE_MS = 60_000;
let inUse = false;
let lastUse = 0;
let lastExact = 0;
let sweepTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSweep() {
  if (sweepTimer || typeof setTimeout === 'undefined') return;
  sweepTimer = setTimeout(sweep, SWEEP_MS);
}

function sweep() {
  sweepTimer = null;
  const now = performance.now();
  if (!inUse && now - Math.max(lastUse, lastExact) > RELEASE_MS) {
    releaseAll();
    return;
  }
  if (segmenter && wState === 'ready' && now - lastExact > EXACT_IDLE_MS) closeMain();
  if (segmenter || loading || worker || cache.size) scheduleSweep();
}

/** Terminates the worker, closes the models and drops every mask. They load again when needed. */
function releaseAll() {
  if (sweepTimer) clearTimeout(sweepTimer);
  sweepTimer = null;
  stopWorker(workerUnsupported ? 'failed' : 'off');
  closeMain();
  mainFailed = false;
  cache.clear();
  lastOf.clear();
  snap = null;
  snapCtx = null;
  maskCanvas = null;
  maskImage = null;
  painted = null;
  refreshStatus();
}

/**
 * Told by the engine whenever the project changes: whether any clip uses "Quitar fondo". Without
 * one, the models are freed after a while; when the project closes (`closed`), right away.
 */
export function setBgRemovalInUse(on: boolean, closed = false) {
  inUse = on;
  if (closed) releaseAll();
  else if (!on) scheduleSweep();
}
