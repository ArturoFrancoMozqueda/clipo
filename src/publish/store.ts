// App-wide state of the publishing center: connected accounts, the queue and its local scheduler.
import { create } from 'zustand';
import { useStore } from '../store';
import { desktop } from './desktop';
import { NETWORKS } from './networks';
import { createJobs, isFinal, PublishQueue, type NewBatch } from './queue';
import { deleteBlobs, deleteJobs, getBlob, listJobs, putBlob, saveJob } from './storage';
import type { ConnectedAccount, NetworkId, Publisher, PublishJob } from './types';
import { youtubePublisher } from './youtube';

const PUBLISHERS: Publisher[] = [youtubePublisher];

export function publisherFor(network: NetworkId): Publisher | undefined {
  if (NETWORKS[network].state !== 'ready') return undefined;
  return PUBLISHERS.find((p) => p.networks.includes(network));
}

interface PublishState {
  /** Desktop app with the publish bridge. */
  desktop: boolean;
  loaded: boolean;
  jobs: PublishJob[];
  accounts: ConnectedAccount[];
  /** Video handed over by "Guardar video" → "Publicar en redes". */
  handoff: File | null;
}

export const usePublish = create<PublishState>(() => ({
  desktop: !!desktop(),
  loaded: false,
  jobs: [],
  accounts: [],
  handoff: null,
}));

const queue = new PublishQueue({
  publisherFor,
  storage: { saveJob, getBlob },
  onChange: (jobs) => usePublish.setState({ jobs }),
  onSettled: (job) => {
    const name = NETWORKS[job.network].name;
    if (job.status.kind === 'published') useStore.getState().notify(`Publicado en ${name}`);
    if (job.status.kind === 'error') useStore.getState().notify(`No se pudo publicar en ${name}`);
    void cleanBlobs();
  },
});

let started = false;

/** Load the saved queue and start the local scheduler. Only in the desktop app. */
export async function startPublishing() {
  if (started || !desktop()) return;
  started = true;
  try {
    await queue.load(await listJobs());
    await refreshAccounts();
  } finally {
    usePublish.setState({ loaded: true });
  }
  // Local scheduling: checked every 20 s while Clipo is open.
  window.setInterval(() => queue.tick(), 20_000);
}

export async function refreshAccounts() {
  const all = await Promise.all(PUBLISHERS.map((p) => p.listAccounts().catch(() => [])));
  usePublish.setState({ accounts: all.flat() });
}

export function handOffVideo(file: File) {
  usePublish.setState({ handoff: file });
}

export interface PublishRequest extends Omit<NewBatch, 'batchId' | 'videoId' | 'thumbnailId' | 'now'> {
  file: Blob;
  thumbnail?: Blob;
}

/** Called only from the "Sí, publicar" button: stores the video and queues one job per target. */
export async function queuePublish(req: PublishRequest) {
  const batchId = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const videoId = `${batchId}-video`;
  const thumbnailId = req.thumbnail ? `${batchId}-cover` : undefined;
  await putBlob(videoId, req.file);
  if (req.thumbnail && thumbnailId) await putBlob(thumbnailId, req.thumbnail);
  await queue.add(createJobs({ ...req, batchId, videoId, thumbnailId, now: Date.now() }));
}

export const retryJob = (id: string) => queue.retry(id);
export async function cancelJob(id: string) {
  await queue.cancel(id);
  await cleanBlobs();
}

/** Remove finished jobs of a batch from the history (and their stored video). */
export async function forgetBatch(batchId: string) {
  const ids = queue.list().filter((j) => j.batchId === batchId).map((j) => j.id);
  queue.remove(ids);
  await deleteJobs(ids);
  await deleteBlobs([`${batchId}-video`, `${batchId}-cover`]);
}

/** Free the stored video once nothing in its batch can be uploaded again. */
async function cleanBlobs() {
  const byBatch = new Map<string, PublishJob[]>();
  for (const j of queue.list()) byBatch.set(j.batchId, [...(byBatch.get(j.batchId) ?? []), j]);
  const done = [...byBatch].filter(([, jobs]) => jobs.every(isFinal)).map(([b]) => b);
  if (done.length) await deleteBlobs(done.flatMap((b) => [`${b}-video`, `${b}-cover`])).catch(() => {});
}
