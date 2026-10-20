// Preview proxies, like the "optimized media" of desktop editors: a 4K HEVC iPhone video or a
// 120 fps screen recording is too heavy to decode live (several at once at a cut) on a laptop, so
// the preview stutters. Heavy videos get a light H.264 copy (≤ 1280 px, ≤ 30 fps, a key frame every
// second) made in the background, one at a time, while the editor isn't playing. The preview
// switches to it when it is ready; export, captions and every analysis keep reading the original.
import type { Asset } from './types';
import { useStore } from './store';
import { getBlob, getProxy, putProxy } from './db';
import { makeProxy, proxyEncoder, readVideoTraits } from './convertVideo';
import { proxyReason, proxyTarget } from './proxyPlan';

/** Per asset of the open project: being looked at / made, ready, or not needed (or not possible). */
type Status = 'pending' | 'ready' | 'none';
const status = new Map<string, Status>();
/** Object URLs of the ready proxies (mirrored to the store's proxyUrls). */
const urls = new Map<string, string>();
const queue: string[] = [];
let running = false;
let current: { id: string; ctrl: AbortController; requeue: boolean } | null = null;

const publish = () => useStore.getState().setProxyUrls(Object.fromEntries(urls));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type S = ReturnType<typeof useStore.getState>;
/** The heavy work only runs while nothing plays or exports, and while the optimized preview is on. */
const free = (s: S) => !s.playing && !s.exporting && s.proxyPreview && !!s.project;

/** Resolves once the editor is free (see `free`), or right away when `signal` aborts. */
function whenFree(signal?: AbortSignal): Promise<void> {
  if (free(useStore.getState()) || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      off();
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const off = useStore.subscribe((s) => free(s) && done());
    signal?.addEventListener('abort', done);
  });
}

/** Video assets of the open project that have a file. */
function wanted(s: S): Map<string, Asset> {
  const out = new Map<string, Asset>();
  for (const a of Object.values(s.project?.assets ?? {})) if (a.kind === 'video' && s.urls[a.id]) out.set(a.id, a);
  return out;
}

function update() {
  const s = useStore.getState();
  const want = wanted(s);
  let changed = false;
  // Another project (or none): free what the previous one used.
  for (const [id, u] of urls) {
    if (want.has(id)) continue;
    URL.revokeObjectURL(u);
    urls.delete(id);
    changed = true;
  }
  for (const id of [...status.keys()]) if (!want.has(id)) status.delete(id);
  if (current && !want.has(current.id)) current.ctrl.abort();
  for (let i = queue.length - 1; i >= 0; i--) if (!want.has(queue[i]!)) queue.splice(i, 1);
  for (const id of want.keys()) {
    if (status.has(id)) continue;
    status.set(id, 'pending');
    queue.push(id);
  }
  if (changed) publish();
  void pump();
}

function ready(id: string, blob: Blob) {
  if (status.get(id) !== 'pending') return; // left the project meanwhile
  status.set(id, 'ready');
  urls.set(id, URL.createObjectURL(blob));
  publish();
}

async function original(id: string): Promise<Blob | undefined> {
  const saved = await getBlob(id).catch(() => undefined);
  if (saved) return saved;
  const url = useStore.getState().urls[id]; // not saved (no space left): the file of this session
  return url ? fetch(url).then((r) => r.blob()).catch(() => undefined) : undefined;
}

async function process(id: string) {
  const saved = await getProxy(id).catch(() => undefined);
  if (saved?.size) return ready(id, saved);
  // No WebCodecs encoder (older browsers, some phones): the preview keeps the original.
  if (!(await proxyEncoder())) return void status.set(id, 'none');
  const file = await original(id);
  const traits = file && (await readVideoTraits(file));
  if (!file || !traits || !proxyReason(traits)) return void status.set(id, 'none');

  const ctrl = new AbortController();
  const job = (current = { id, ctrl, requeue: false });
  await sleep(1000); // let the import (thumbnails, timeline) settle first
  await whenFree(ctrl.signal);
  if (ctrl.signal.aborted || status.get(id) !== 'pending') {
    current = null;
    if (job.requeue && status.get(id) === 'pending') queue.unshift(id);
    return;
  }
  const name = useStore.getState().project?.assets[id]?.name ?? '';
  const setJob = useStore.getState().setProxyJob;
  let shown = -1;
  setJob({ name, progress: 0 });
  try {
    const blob = await makeProxy(file, proxyTarget(traits), {
      signal: ctrl.signal,
      gate: () => whenFree(ctrl.signal),
      onProgress: (p) => {
        const pct = Math.floor(p * 100);
        if (pct === shown) return;
        shown = pct;
        setJob({ name, progress: p });
      },
    });
    // Saved for the next time the project opens; if there's no space it still serves this session.
    await putProxy(id, blob).catch(() => {});
    ready(id, blob);
  } catch (e) {
    if (job.requeue && status.get(id) === 'pending') queue.unshift(id);
    else {
      if (!ctrl.signal.aborted) console.warn('Clipo: no se pudo optimizar el video para editar', e);
      if (status.get(id) === 'pending') status.set(id, 'none');
    }
  } finally {
    current = null;
    setJob(null);
  }
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      if (status.get(id) !== 'pending') continue;
      await process(id).catch(() => status.get(id) === 'pending' && status.set(id, 'none'));
    }
  } finally {
    running = false;
  }
}

/** Start watching the open project for videos that need a proxy. Call once. */
export function startProxies() {
  useStore.subscribe((s, prev) => {
    if (s.project?.assets !== prev.project?.assets || s.urls !== prev.urls) update();
    // Export needs the whole machine (and its video decoders): stop, and start over afterwards.
    if (s.exporting && !prev.exporting && current) {
      current.requeue = true;
      current.ctrl.abort();
    }
  });
  update();
}
