// Frames for the timeline's filmstrips, grabbed lazily from a hidden <video> one at a time (phones
// have few video decoders and the preview needs them) and kept as small JPEG object URLs.
import { useEffect, useState } from 'react';
import { useStore } from './store';

const H = 72;
/** Frames kept; the oldest are released first (~4 KB each). */
const MAX = 480;

type Cb = (url: string) => void;
interface Job {
  key: string;
  assetId: string;
  src: string;
  t: number;
  cbs: Set<Cb>;
}

const cache = new Map<string, string>();
/** Assets whose frames can't be grabbed: the timeline keeps their single thumbnail. */
const failed = new Set<string>();
const jobs = new Map<string, Job>();
let busy = false;
let vid: HTMLVideoElement | null = null;
let vidSrc = '';
let release: ReturnType<typeof setTimeout> | undefined;

const keyOf = (assetId: string, t: number) => `${assetId}@${t}`;

/** A frame already grabbed (marks it as recently used). */
export function cachedFrame(assetId: string, t: number) {
  const k = keyOf(assetId, t);
  const u = cache.get(k);
  if (u) {
    cache.delete(k);
    cache.set(k, u);
  }
  return u;
}

/** Ask for the frame of `assetId` at source time `t`; `cb` gets its URL. Returns a cancel function. */
export function requestFrame(assetId: string, src: string, t: number, cb: Cb): () => void {
  if (failed.has(assetId) || typeof document === 'undefined') return () => {};
  const hit = cachedFrame(assetId, t);
  if (hit) {
    cb(hit);
    return () => {};
  }
  const key = keyOf(assetId, t);
  let j = jobs.get(key);
  if (j) jobs.delete(key); // re-insert: the newest requests (what is on screen now) go first
  else j = { key, assetId, src, t, cbs: new Set() };
  jobs.set(key, j);
  j.cbs.add(cb);
  void pump();
  const job = j;
  return () => {
    job.cbs.delete(cb);
    if (!job.cbs.size && jobs.get(key) === job) jobs.delete(key);
  };
}

function once(el: EventTarget, ev: string, ms: number) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${ev} timeout`)), ms);
    el.addEventListener(ev, () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Next job: the newest one for the file already open, else the newest one. */
function next(): Job | undefined {
  let last: Job | undefined;
  let same: Job | undefined;
  for (const j of jobs.values()) {
    last = j;
    if (j.src === vidSrc) same = j;
  }
  return same ?? last;
}

async function pump() {
  if (busy) return;
  busy = true;
  clearTimeout(release);
  try {
    for (let j = next(); j; j = next()) {
      // Don't compete with playback for the decoder.
      while (useStore.getState().playing) await pause(400);
      jobs.delete(j.key);
      if (!j.cbs.size || failed.has(j.assetId)) continue;
      try {
        const url = await grab(j.src, j.t);
        cache.set(j.key, url);
        if (cache.size > MAX) {
          const [k, u] = cache.entries().next().value!;
          cache.delete(k);
          URL.revokeObjectURL(u);
        }
        for (const cb of j.cbs) cb(url);
      } catch {
        failed.add(j.assetId);
        closeVideo();
      }
      await pause(0);
    }
  } finally {
    busy = false;
    // Give the decoder back when nothing is left to grab.
    release = setTimeout(closeVideo, 4000);
  }
}

function closeVideo() {
  if (!vid) return;
  vid.removeAttribute('src');
  vid.load();
  vid = null;
  vidSrc = '';
}

async function grab(src: string, t: number): Promise<string> {
  if (!vid || vidSrc !== src) {
    closeVideo();
    vid = document.createElement('video');
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'auto';
    vidSrc = src;
    const ready = Promise.race([once(vid, 'loadeddata', 15000), once(vid, 'error', 15000).then(() => { throw new Error('error'); })]);
    vid.src = src;
    await ready;
  }
  const v = vid;
  const time = Math.min(t, Math.max(0, (v.duration || t) - 0.05));
  if (Math.abs(v.currentTime - time) > 0.01) {
    const s = once(v, 'seeked', 5000);
    v.currentTime = time;
    await s;
  }
  if (!v.videoWidth) throw new Error('no picture');
  const c = document.createElement('canvas');
  c.height = H;
  c.width = Math.max(1, Math.round((H * v.videoWidth) / v.videoHeight));
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.7));
  if (!blob) throw new Error('no blob');
  return URL.createObjectURL(blob);
}

/** URL of a filmstrip frame once it's ready; keeps the previous one meanwhile (no flicker while trimming). */
export function useFrame(assetId: string, src: string | undefined, t: number) {
  const [url, setUrl] = useState(() => cachedFrame(assetId, t));
  useEffect(() => {
    if (!src) return;
    const hit = cachedFrame(assetId, t);
    if (hit) return void setUrl(hit);
    return requestFrame(assetId, src, t, setUrl);
  }, [assetId, src, t]);
  return url;
}
