import { useSyncExternalStore } from 'react';
import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import wasmLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import wasmLoaderNoSimd from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url';
import wasmBinaryNoSimd from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url';
import type { BgRemoval, Project } from './types';

/**
 * "Quitar fondo": person segmentation that runs entirely on the device (MediaPipe Selfie
 * Segmenter, WebAssembly + WebGL). The runtime and the 250 KB model ship with the app and are
 * only loaded the first time a clip uses it. Masks are cached per source frame so scrubbing,
 * replaying and exporting don't segment the same picture twice.
 */

export type SegStatus = 'idle' | 'loading' | 'ready' | 'error';

export const BG_DEFAULT: BgRemoval = { mode: 'color', color: '#ffffff', smooth: 0.4 };
export const BG_COLORS = ['#ffffff', '#111111', '#7c6cff', '#00b140', '#2f80ed', '#ff8a65', '#ffd54f', '#f48fb1'];

/** Thrown (with a message for the user) when the export needs the model and it can't load. */
export class BgError extends Error {}
export const BG_LOAD_ERROR = 'No se pudo preparar “Quitar fondo” en este dispositivo. Revisa tu conexión y vuelve a intentarlo.';

const MODEL_URL = `${import.meta.env.BASE_URL}models/selfie_segmenter.tflite`;

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
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
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
    () => setStatus('ready'),
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
/** Last mask per asset, reused while playing when the device can't keep up. */
const lastOf = new Map<string, Entry>();
let lastRun = 0;
let avgMs = 15;

const input = document.createElement('canvas');
const inputCtx = input.getContext('2d', { willReadFrequently: false })!;

/**
 * The person mask of a picture, or null while the model isn't loaded (it starts loading).
 * `key` names the picture (asset + source frame). With `live` (playback) it uses a smaller
 * input and, on slow devices, reuses the previous mask instead of segmenting every frame.
 */
export function maskFor(key: string, assetId: string, src: CanvasImageSource, sw: number, sh: number, live: boolean): Mask | null {
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
  const prev = lastOf.get(assetId);
  const now = performance.now();
  if (live && prev && now - lastRun < Math.max(33, avgMs * 2)) return prev;

  const lo = live;
  const max = lo ? SIZE_LO : SIZE_HI;
  const k = Math.min(1, max / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  if (input.width !== w || input.height !== h) {
    input.width = w;
    input.height = h;
  }
  inputCtx.drawImage(src, 0, 0, w, h);

  let entry: Entry;
  try {
    const res = segmenter.segment(input);
    try {
      const masks = res.confidenceMasks ?? [];
      // Two outputs = [background, person]; one output = person.
      const m = masks.length > 1 ? masks[1] : masks[0];
      if (!m) return prev ?? null;
      const conf = m.getAsFloat32Array();
      const alpha = new Uint8ClampedArray(m.width * m.height);
      // Tighten the soft model output a little so edges don't look foggy; smoothing is added at draw time.
      for (let i = 0; i < alpha.length; i++) alpha[i] = (conf[i] - 0.3) * 637.5; // 0.3..0.7 -> 0..255
      entry = { w: m.width, h: m.height, alpha, lo };
    } finally {
      res.close();
    }
  } catch (e) {
    console.warn('Segmentation failed', e);
    return prev ?? null;
  }
  const ms = performance.now() - now;
  avgMs = avgMs * 0.8 + ms * 0.2;
  lastRun = performance.now();
  lastOf.set(assetId, entry);

  // A video element that is still seeking shows an older frame: don't file it under this time.
  const stale = src instanceof HTMLVideoElement && src.seeking;
  if (!stale) {
    cache.set(key, entry);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return entry;
}

/** Forget the masks of an asset (e.g. its file changed). */
export function dropMasks(assetId: string) {
  for (const k of cache.keys()) if (k.startsWith(`${assetId}@`)) cache.delete(k);
  lastOf.delete(assetId);
}

const maskCanvas = document.createElement('canvas');
let maskImage: ImageData | null = null;

/** Paints a mask as alpha into a reusable canvas; use it right away (it is overwritten by the next call). */
export function maskImageOf(m: Mask): HTMLCanvasElement {
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
