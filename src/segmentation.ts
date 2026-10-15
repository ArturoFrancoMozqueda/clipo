import { useSyncExternalStore } from 'react';
import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import wasmLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import wasmLoaderNoSimd from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url';
import wasmBinaryNoSimd from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url';
import type { BgRemoval, Project } from './types';
import { requestRedraw } from './redraw';

/**
 * "Quitar fondo": person segmentation that runs entirely on the device (MediaPipe Selfie
 * Segmenter, WebAssembly + WebGL). The runtime and the 250 KB model ship with the app and are
 * only loaded the first time a clip uses it. Masks are cached per source frame so scrubbing,
 * replaying and exporting don't segment the same picture twice.
 *
 * MediaPipe runs synchronously on the calling thread. The preview never calls it while drawing: it
 * shows the last mask and segments the newest frame in a separate, throttled task. A worker would
 * free the main thread completely, but the tasks-vision loader relies on importScripts (not
 * available in module workers) and the GPU delegate needs WebGL in OffscreenCanvas, which older
 * iOS versions lack, so it stays on the main thread for now.
 */

export type SegStatus = 'idle' | 'loading' | 'ready' | 'error';

export const BG_DEFAULT: BgRemoval = { mode: 'color', color: '#ffffff', smooth: 0.4 };
export const BG_COLORS = ['#ffffff', '#111111', '#7c6cff', '#00b140', '#2f80ed', '#ff8a65', '#ffd54f', '#f48fb1'];

/** Thrown (with a message for the user) when the export needs the model and it can't load. */
export class BgError extends Error {}
export const BG_LOAD_ERROR = 'No se pudo preparar “Quitar fondo” en este dispositivo. Revisa tu conexión y vuelve a intentarlo.';

/** Read when the model loads, not at import (keeps this module loadable outside Vite, e.g. in Node tests). */
const modelUrl = () => `${import.meta.env.BASE_URL}models/selfie_segmenter.tflite`;

let status: SegStatus = 'idle';
let segmenter: ImageSegmenter | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setStatus(s: SegStatus) {
  status = s;
  listeners.forEach((l) => l());
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

/** Loads the segmenter once. Tries the GPU first and falls back to the CPU. Safe to call repeatedly. */
export function loadSegmenter(): Promise<void> {
  if (segmenter) return Promise.resolve();
  if (loading) return loading;
  setStatus('loading');
  loading = (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const simd = await FilesetResolver.isSimdSupported();
    const fileset = simd
      ? { wasmLoaderPath: wasmLoader, wasmBinaryPath: wasmBinary }
      : { wasmLoaderPath: wasmLoaderNoSimd, wasmBinaryPath: wasmBinaryNoSimd };
    let last: unknown;
    for (const delegate of ['GPU', 'CPU'] as const) {
      try {
        segmenter = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelUrl(), delegate },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
        // A first run can still fail on a GPU that accepted the setup.
        probe(segmenter);
        return;
      } catch (e) {
        last = e;
        segmenter?.close();
        segmenter = null;
      }
    }
    throw last;
  })().then(
    () => {
      setStatus('ready');
      requestRedraw();
    },
    (e) => {
      console.warn('Background removal unavailable', e);
      loading = null; // allow "Reintentar"
      setStatus('error');
      throw new BgError(BG_LOAD_ERROR);
    },
  );
  return loading;
}

function probe(s: ImageSegmenter) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  c.getContext('2d')!.fillRect(0, 0, 16, 16);
  s.segment(c).close();
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

let input: HTMLCanvasElement | null = null;
let inputCtx: CanvasRenderingContext2D | null = null;

/** Copy the picture into the model's input canvas, scaled so its longest side is `max`. */
function stage(src: CanvasImageSource, sw: number, sh: number, max: number) {
  if (!input) {
    input = document.createElement('canvas');
    inputCtx = input.getContext('2d', { willReadFrequently: false })!;
  }
  const k = Math.min(1, max / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  if (input.width !== w || input.height !== h) {
    input.width = w;
    input.height = h;
  }
  inputCtx!.drawImage(src, 0, 0, w, h);
  return input;
}

/** Run the model on the staged input. Null when it produced nothing usable. */
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
        for (let i = 0; i < alpha.length; i++) alpha[i] = (conf[i] - 0.3) * 637.5; // 0.3..0.7 -> 0..255
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

/** The one frame waiting to be segmented off the drawing path (newer requests replace it). */
let pending: { key: string; assetId: string; lo: boolean; stale: boolean } | null = null;
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
    if (cache.has(job.key) && (job.lo || !cache.get(job.key)!.lo)) return;
    const entry = run(job.lo);
    if (entry) {
      store(job.key, job.assetId, entry, job.stale);
      requestRedraw();
    }
    // A newer frame may have been requested by the redraw above.
    const next = pending as { lo: boolean } | null;
    if (next) schedule(next.lo);
  }, wait);
}

/**
 * The person mask of a picture, or null while the model isn't loaded (it starts loading).
 * `key` names the picture (asset + source frame). With `live` (playback) it uses a smaller input.
 * With `wait` (the export and the reframe analysis) it segments right away and returns the exact
 * mask; otherwise (the preview) it never blocks drawing: it returns the cached mask, or the last
 * one of the asset while the exact one is made in a later task, then asks for a redraw.
 */
export function maskFor(
  key: string, assetId: string, src: CanvasImageSource, sw: number, sh: number, live: boolean, wait = !live,
): Mask | null {
  if (!segmenter) {
    if (status === 'idle') loadSegmenter().catch(() => {});
    return null;
  }
  const hit = cache.get(key);
  if (hit && (live || !hit.lo)) {
    cache.delete(key); // keep it fresh in the LRU order
    cache.set(key, hit);
    return hit;
  }
  // A low-res mask of this very frame beats the last mask of another one.
  const prev = hit ?? lastOf.get(assetId) ?? null;
  const lo = live;
  const stale = src instanceof HTMLVideoElement && src.seeking;
  if (!wait) {
    // Snapshot the picture now (it is cheap at this size); the model runs on it later.
    if (pending?.key !== key) {
      stage(src, sw, sh, lo ? SIZE_LO : SIZE_HI);
      pending = { key, assetId, lo, stale };
    }
    schedule(lo);
    return prev;
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
  for (let i = 0, j = 3; i < m.alpha.length; i++, j += 4) d[j] = m.alpha[i];
  maskCanvas.getContext('2d')!.putImageData(maskImage, 0, 0);
  return maskCanvas;
}
