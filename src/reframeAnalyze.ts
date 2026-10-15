import { loadSegmenter, maskFor } from './segmentation';
import { maskCenter, sampleTimes, smoothTrack, type Sample } from './reframe';
import { useStore } from './store';
import type { Clip, Project, Reframe } from './types';

/**
 * Finds where the person is in each main-track clip (on the device, with the same segmentation
 * as "Quitar fondo") and saves a smooth path in the clip, so changing the format keeps them in frame.
 */

export interface ReframeProgress {
  /** 0..100 */
  pct: number;
  done: number;
  total: number;
}

/** Analyzed moments per second of source. */
const RATE = 3;

/** Clips that can be reframed: videos and photos on the main track. */
export function reframable(p: Project): Clip[] {
  return p.clips.filter((c) => {
    const k = p.assets[c.assetId]?.kind;
    return k === 'video' || k === 'image';
  });
}

const cancelled = () => new Error('cancelled');

function seek(v: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve, reject) => {
    if (Math.abs(v.currentTime - t) < 1e-3 && v.readyState >= 2) return resolve();
    const done = () => {
      v.removeEventListener('seeked', done);
      v.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      v.removeEventListener('seeked', done);
      v.removeEventListener('error', fail);
      reject(new Error('video error'));
    };
    v.addEventListener('seeked', done);
    v.addEventListener('error', fail);
    v.currentTime = t;
  });
}

async function loadVideo(url: string) {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () => reject(new Error('video error'));
  });
  return v;
}

async function analyzeClip(p: Project, c: Clip, urls: Record<string, string>, tick: () => void, signal: AbortSignal): Promise<Reframe | null> {
  const asset = p.assets[c.assetId];
  const url = urls[c.assetId];
  if (!asset || !url) return null;
  if (asset.kind === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode();
    const m = maskFor(`${asset.id}@img`, asset.id, img, img.naturalWidth, img.naturalHeight, false);
    tick();
    const ctr = m && maskCenter(m);
    return ctr ? { points: smoothTrack([{ t: 0, ...ctr }]) } : null;
  }
  const v = await loadVideo(url);
  try {
    const end = Math.min(c.out, Math.max(0, asset.duration - 0.05));
    const samples: Sample[] = [];
    for (const t of sampleTimes(c.in, end, 1 / RATE)) {
      if (signal.aborted) throw cancelled();
      await seek(v, t);
      // Same cache key as the renderer, so "Quitar fondo" can reuse these masks.
      const m = maskFor(`${asset.id}@${Math.round(t * 30)}`, asset.id, v, v.videoWidth, v.videoHeight, false);
      const ctr = m && maskCenter(m);
      samples.push(ctr ? { t, ...ctr } : { t });
      tick();
    }
    if (!samples.some((s) => s.x != null)) return null;
    return { points: smoothTrack(samples) };
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}

/**
 * Analyzes every clip and saves the paths as one undoable step. Clips are set to "Rellenar" so the
 * crop can follow the person. Returns how many clips had a person.
 */
export async function autoReframe(onProgress: (p: ReframeProgress) => void, signal: AbortSignal): Promise<{ found: number; total: number }> {
  const s = useStore.getState();
  const p = s.project;
  if (!p) throw new Error('No hay proyecto abierto');
  await loadSegmenter();
  const clips = reframable(p);
  const counts = clips.map((c) => (p.assets[c.assetId]?.kind === 'image' ? 1 : sampleTimes(c.in, c.out, 1 / RATE).length));
  const total = Math.max(1, counts.reduce((a, b) => a + b, 0));
  let done = 0;
  const tick = () => {
    done++;
    onProgress({ pct: Math.min(100, (done / total) * 100), done, total });
  };
  const found = new Map<string, Reframe>();
  for (const c of clips) {
    if (signal.aborted) throw cancelled();
    const r = await analyzeClip(p, c, s.urls, tick, signal).catch((e) => {
      if (signal.aborted) throw cancelled();
      console.warn('Reframe analysis failed for a clip', e);
      return null;
    });
    if (r) found.set(c.id, r);
  }
  if (signal.aborted) throw cancelled();
  useStore.getState().commit((proj) => {
    for (const c of proj.clips) {
      const r = found.get(c.id);
      if (!r) continue;
      c.reframe = r;
      c.fit = 'fill';
    }
  });
  return { found: found.size, total: clips.length };
}

/** Back to the plain centered crop. */
export function clearReframe() {
  useStore.getState().commit((p) => {
    for (const c of p.clips) delete c.reframe;
  });
}

export const usesReframe = (p: Project) => p.clips.some((c) => c.reframe?.points.length);
