// "Quitar fondo" for the live preview, off the main thread: runs the MediaPipe Selfie Segmenter on
// the frames the preview hands over (ImageBitmaps) and sends back the person mask as bytes.
//
// It is an ES module worker like the other workers (vite.config worker.format 'es'). The tasks-vision
// loader tries importScripts() first and, when that throws in a module worker, falls back to
// import(): that is why the main thread passes the ES-module build of the WebAssembly glue
// (vision_wasm_module_internal.js), which sets globalThis.ModuleFactory when imported. No eval, so
// it would also run under a CSP (the hosts only send one with the HTML page anyway).
//
// MediaPipe uploads every picture as a WebGL texture, CPU delegate included, so the worker needs
// WebGL in OffscreenCanvas (missing in Safari before 17). Without it, init reports 'unsupported' and
// the main thread segments by itself as before.
import type { ImageSegmenter } from '@mediapipe/tasks-vision';

export type SegIn =
  | { type: 'init'; loader: string; binary: string; model: string }
  | { type: 'segment'; id: number; image: ImageBitmap };

export type SegOut =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'error'; message: string; unsupported: boolean }
  /** alpha: person opacity 0..255, one byte per pixel (null when the model produced nothing). */
  | { type: 'mask'; id: number; w: number; h: number; alpha: Uint8ClampedArray | null; ms: number };

const post = (m: SegOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let segmenter: ImageSegmenter | null = null;

function webglWorks() {
  if (typeof OffscreenCanvas === 'undefined') return false;
  try {
    const c = new OffscreenCanvas(1, 1);
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext(); // only a probe: give the context back
    return !!gl;
  } catch {
    return false;
  }
}

async function init(m: Extract<SegIn, { type: 'init' }>) {
  if (!webglWorks()) {
    post({ type: 'error', message: 'WebGL in OffscreenCanvas is not available', unsupported: true });
    return;
  }
  const { ImageSegmenter } = await import('@mediapipe/tasks-vision');
  let last: unknown;
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      segmenter = await ImageSegmenter.createFromOptions(
        { wasmLoaderPath: m.loader, wasmBinaryPath: m.binary },
        {
          baseOptions: { modelAssetPath: m.model, delegate },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
          // Given explicitly: otherwise MediaPipe falls back to document.createElement on Safari < 17.
          canvas: new OffscreenCanvas(1, 1),
        },
      );
      // A first run can still fail on a GPU that accepted the setup.
      const probe = new OffscreenCanvas(16, 16);
      probe.getContext('2d')!.fillRect(0, 0, 16, 16);
      segmenter.segment(probe).close();
      console.info(`[Clipo] Quitar fondo: segmentando en un Worker (${delegate})`);
      post({ type: 'ready', delegate });
      return;
    } catch (e) {
      last = e;
      segmenter?.close();
      segmenter = null;
    }
  }
  throw last;
}

function segment(id: number, image: ImageBitmap) {
  const t0 = performance.now();
  let w = 0;
  let h = 0;
  let alpha: Uint8ClampedArray | null = null;
  try {
    const res = segmenter!.segment(image);
    try {
      const masks = res.confidenceMasks ?? [];
      // Two outputs = [background, person]; one output = person.
      const m = masks.length > 1 ? masks[1] : masks[0];
      if (m) {
        const conf = m.getAsFloat32Array();
        w = m.width;
        h = m.height;
        alpha = new Uint8ClampedArray(w * h);
        // Tighten the soft model output a little so edges don't look foggy; smoothing is added at draw time.
        for (let i = 0; i < alpha.length; i++) alpha[i] = (conf[i]! - 0.3) * 637.5; // 0.3..0.7 -> 0..255
      }
    } finally {
      res.close();
    }
  } catch (e) {
    console.warn('Segmentation failed', e);
  } finally {
    image.close();
  }
  post({ type: 'mask', id, w, h, alpha, ms: performance.now() - t0 }, alpha ? [alpha.buffer] : []);
}

self.onmessage = (e: MessageEvent<SegIn>) => {
  const m = e.data;
  if (m.type === 'init') {
    init(m).catch((err) => post({ type: 'error', message: String(err?.message ?? err), unsupported: false }));
  } else if (m.type === 'segment') {
    if (segmenter) segment(m.id, m.image);
    else {
      m.image.close();
      post({ type: 'mask', id: m.id, w: 0, h: 0, alpha: null, ms: 0 });
    }
  }
};
