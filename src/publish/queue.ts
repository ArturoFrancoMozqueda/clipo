// The publishing queue: pure state changes plus a small runner that uploads one job at a time.
// It never starts an upload on its own after a restart: anything interrupted or missed waits
// for the user to press "Reintentar" / "Publicar ahora".
import type { ConnectedAccount, JobStatus, NetworkId, PostOptions, PostText, Publisher, PublishJob, VideoInfo } from './types';

/** An upload failure with a reason the user can read. */
export class PublishError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = 'PublishError';
    this.retryable = retryable;
  }
}

export interface Target {
  network: NetworkId;
  account: Pick<ConnectedAccount, 'id' | 'name'>;
}

export interface NewBatch {
  batchId: string;
  videoId: string;
  video: VideoInfo;
  thumbnailId?: string;
  targets: Target[];
  /** Text for each network (already merged with the common text). */
  posts: Partial<Record<NetworkId, PostText>>;
  options: PostOptions;
  /** Local scheduling (epoch ms). Missing or in the past = now. */
  scheduledAt?: number;
  /**
   * Networks that can't schedule natively (Instagram). When `options.nativePublishAt` is set, their
   * jobs wait locally for that time instead (Clipo must be open then).
   */
  localOnly?: NetworkId[];
  now: number;
}

export function createJobs(b: NewBatch): PublishJob[] {
  const { nativePublishAt, ...rest } = b.options;
  return b.targets.map((t, i): PublishJob => {
    const local = nativePublishAt != null && !!b.localOnly?.includes(t.network);
    const at = local ? nativePublishAt : b.scheduledAt;
    const later = at != null && at > b.now;
    return {
      id: `${b.batchId}-${i}`,
      batchId: b.batchId,
      network: t.network,
      accountId: t.account.id,
      accountName: t.account.name,
      videoId: b.videoId,
      video: b.video,
      thumbnailId: b.thumbnailId,
      post: b.posts[t.network] ?? { description: '', hashtags: '' },
      options: local ? rest : b.options,
      scheduledAt: later ? at : undefined,
      createdAt: b.now,
      attempts: 0,
      status: later ? { kind: 'scheduled' } : { kind: 'pending' },
    };
  });
}

const set = (job: PublishJob, status: JobStatus): PublishJob => ({ ...job, status });

export const isFinal = (j: PublishJob) => j.status.kind === 'published' || j.status.kind === 'cancelled';
export const isActive = (j: PublishJob) => j.status.kind === 'uploading';
export const canRetry = (j: PublishJob) =>
  (j.status.kind === 'error' && j.status.retryable) || j.status.kind === 'missed';
export const canCancel = (j: PublishJob) =>
  j.status.kind === 'scheduled' || j.status.kind === 'pending' || j.status.kind === 'uploading' || j.status.kind === 'missed' || j.status.kind === 'error';

export function startUpload(job: PublishJob): PublishJob {
  if (job.status.kind !== 'pending') throw new Error(`cannot start a ${job.status.kind} job`);
  return { ...job, attempts: job.attempts + 1, status: { kind: 'uploading', pct: 0 } };
}

export function progress(job: PublishJob, pct: number): PublishJob {
  if (job.status.kind !== 'uploading') return job;
  const p = Math.max(job.status.pct, Math.min(100, Math.max(0, pct)));
  return p === job.status.pct ? job : set(job, { kind: 'uploading', pct: p });
}

export function published(job: PublishJob, r: { url: string; remoteId: string; note?: string }, now: number): PublishJob {
  return set(job, { kind: 'published', url: r.url, remoteId: r.remoteId, note: r.note, at: now });
}

export function failed(job: PublishJob, err: unknown, now: number): PublishJob {
  const pe = err instanceof PublishError ? err : null;
  const reason = pe?.message || 'Algo salió mal al subir el video. Revisa tu conexión a internet e intenta otra vez.';
  return set(job, { kind: 'error', reason, retryable: pe ? pe.retryable : true, at: now });
}

/** "Reintentar" or "Publicar ahora" on a missed one: back to the queue, right away. */
export function retry(job: PublishJob): PublishJob {
  if (!canRetry(job)) return job;
  return { ...set(job, { kind: 'pending' }), scheduledAt: undefined };
}

export function cancel(job: PublishJob): PublishJob {
  return canCancel(job) ? set(job, { kind: 'cancelled' }) : job;
}

/** Scheduled jobs whose time came while Clipo is open become pending. */
export function promoteDue(jobs: PublishJob[], now: number): PublishJob[] {
  return jobs.map((j) => (j.status.kind === 'scheduled' && (j.scheduledAt ?? 0) <= now ? set(j, { kind: 'pending' }) : j));
}

/**
 * What to do with saved jobs when Clipo opens again. Nothing is sent automatically:
 * an upload cut by closing the app becomes a retryable error, and anything that should
 * have run while Clipo was closed is "missed". Scheduled jobs still in the future keep waiting.
 */
export function recoverOnLoad(jobs: PublishJob[], now: number): PublishJob[] {
  return jobs.map((j) => {
    switch (j.status.kind) {
      case 'uploading':
        return set(j, { kind: 'error', reason: 'La subida se cortó porque Clipo se cerró. Puedes reintentarla.', retryable: true, at: now });
      case 'pending':
        return set(j, { kind: 'missed', reason: 'Clipo se cerró antes de empezar a subirlo.' });
      case 'scheduled':
        return (j.scheduledAt ?? 0) <= now ? set(j, { kind: 'missed', reason: 'Clipo estaba cerrado a la hora programada.' }) : j;
      default:
        return j;
    }
  });
}

/** The next job to upload: the oldest pending one. */
export function nextPending(jobs: PublishJob[]): PublishJob | undefined {
  return jobs
    .filter((j) => j.status.kind === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
}

export interface QueueStorage {
  saveJob(job: PublishJob): Promise<void>;
  getBlob(id: string): Promise<Blob | undefined>;
}

export interface QueueDeps {
  publisherFor(network: NetworkId): Publisher | undefined;
  storage: QueueStorage;
  now?: () => number;
  /** Called with the full list after every change (including progress). */
  onChange?: (jobs: PublishJob[]) => void;
  /** Called when a job reaches published or error. */
  onSettled?: (job: PublishJob) => void;
}

/** Runs the queue: one upload at a time, oldest first. */
export class PublishQueue {
  private jobs: PublishJob[] = [];
  private running: { id: string; ac: AbortController } | null = null;
  private deps: QueueDeps;
  private now: () => number;
  /** Resolves when the current pump loop ends (tests wait on it). */
  idle: Promise<void> = Promise.resolve();

  constructor(deps: QueueDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  list() {
    return this.jobs;
  }

  /** Load saved jobs (after recoverOnLoad). Does not start anything. */
  async load(saved: PublishJob[]) {
    const recovered = recoverOnLoad(saved, this.now());
    this.jobs = recovered;
    await Promise.all(recovered.filter((j, i) => j !== saved[i]).map((j) => this.save(j)));
    this.emit();
  }

  async add(jobs: PublishJob[]) {
    this.jobs = [...this.jobs, ...jobs];
    await Promise.all(jobs.map((j) => this.save(j)));
    this.emit();
    this.tick();
  }

  /** Check the clock and start the next upload if nothing is running. Call it on a timer. */
  tick() {
    const promoted = promoteDue(this.jobs, this.now());
    promoted.forEach((j, i) => j !== this.jobs[i] && this.save(j));
    if (promoted.some((j, i) => j !== this.jobs[i])) {
      this.jobs = promoted;
      this.emit();
    }
    if (!this.running && nextPending(this.jobs)) this.idle = this.pump().catch((e) => console.error('Clipo: cola de publicación', e));
    return this.idle;
  }

  async retry(id: string) {
    await this.update(id, retry);
    this.tick();
  }

  async cancel(id: string) {
    if (this.running?.id === id) this.running.ac.abort();
    await this.update(id, cancel);
  }

  /** Forget jobs (history cleanup). Running ones are cancelled first. */
  remove(ids: string[]) {
    if (this.running && ids.includes(this.running.id)) this.running.ac.abort();
    this.jobs = this.jobs.filter((j) => !ids.includes(j.id));
    this.emit();
  }

  private async pump() {
    for (let job = nextPending(this.jobs); job; job = nextPending(this.jobs)) {
      const before = job;
      await this.run(job);
      // Never spin on a job that could not leave 'pending'.
      if (this.jobs.find((j) => j.id === before.id)?.status.kind === 'pending') break;
    }
  }

  private async run(job: PublishJob) {
    const ac = new AbortController();
    this.running = { id: job.id, ac };
    try {
      await this.update(job.id, startUpload);
      const publisher = this.deps.publisherFor(job.network);
      if (!publisher) throw new PublishError('Esta red todavía no se puede usar desde Clipo.', false);
      const video = await this.deps.storage.getBlob(job.videoId);
      if (!video) throw new PublishError('No se encontró el video guardado. Vuelve a guardarlo y publícalo otra vez.', false);
      const thumbnail = job.thumbnailId ? await this.deps.storage.getBlob(job.thumbnailId) : undefined;
      const result = await publisher.upload(
        { jobId: job.id, accountId: job.accountId, network: job.network, video, videoInfo: job.video, thumbnail, post: job.post, options: job.options },
        (pct) => {
          const i = this.jobs.findIndex((j) => j.id === job.id);
          const cur = this.jobs[i];
          if (!cur || ac.signal.aborted) return;
          const next = progress(cur, pct);
          if (next !== cur) {
            this.jobs = this.jobs.map((j, k) => (k === i ? next : j));
            this.emit();
          }
        },
        ac.signal,
      );
      if (!ac.signal.aborted) await this.update(job.id, (j) => published(j, result, this.now()), true);
    } catch (err) {
      if (!ac.signal.aborted) await this.update(job.id, (j) => failed(j, err, this.now()), true);
    } finally {
      this.running = null;
    }
  }

  /** Save a job; a storage failure is logged, the queue in memory keeps going. */
  private save(job: PublishJob) {
    return this.deps.storage.saveJob(job).catch((e) => console.error('Clipo: no se pudo guardar la publicación', e));
  }

  private async update(id: string, fn: (j: PublishJob) => PublishJob, settled = false) {
    const cur = this.jobs.find((j) => j.id === id);
    if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    this.jobs = this.jobs.map((j) => (j.id === id ? next : j));
    await this.save(next);
    this.emit();
    if (settled) this.deps.onSettled?.(next);
  }

  private emit() {
    this.deps.onChange?.(this.jobs);
  }
}
