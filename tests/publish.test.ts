// Run with: npm test. Publishing center: queue states, the runner and YouTube post text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancel,
  canRetry,
  createJobs,
  failed,
  nextPending,
  progress,
  promoteDue,
  published,
  PublishError,
  PublishQueue,
  recoverOnLoad,
  retry,
  startUpload,
  type NewBatch,
} from '../src/publish/queue.ts';
import { buildYouTubeMetadata, checkYouTube, mergePost, parseHashtags, truncateBytes, youtubeTitle, youtubeUrl } from '../src/publish/text.ts';
import type { Publisher, PublishJob, UploadInput, VideoInfo } from '../src/publish/types.ts';

const vertical: VideoInfo = { name: 'viaje.mp4', type: 'video/mp4', bytes: 1000, width: 1080, height: 1920, duration: 30 };
const T0 = 1_000_000;

const batch = (over: Partial<NewBatch> = {}): NewBatch => ({
  batchId: 'b1',
  videoId: 'b1-video',
  video: vertical,
  targets: [
    { network: 'youtube_shorts', account: { id: 'UC1', name: 'Mi canal' } },
    { network: 'youtube', account: { id: 'UC1', name: 'Mi canal' } },
  ],
  posts: { youtube_shorts: { title: 'Short', description: 'd', hashtags: '#a' }, youtube: { title: 'Largo', description: 'd', hashtags: '' } },
  options: { privacy: 'public', madeForKids: false },
  now: T0,
  ...over,
});

// ---------- pure states ----------

test('a batch creates one pending job per target with its own text', () => {
  const jobs = createJobs(batch());
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map((j) => j.status.kind), ['pending', 'pending']);
  assert.equal(jobs[0].post.title, 'Short');
  assert.equal(jobs[1].post.title, 'Largo');
  assert.ok(jobs.every((j) => j.batchId === 'b1' && j.videoId === 'b1-video' && j.attempts === 0));
});

test('scheduling in the future waits; in the past means now', () => {
  assert.equal(createJobs(batch({ scheduledAt: T0 + 60_000 }))[0].status.kind, 'scheduled');
  const past = createJobs(batch({ scheduledAt: T0 - 1 }))[0];
  assert.equal(past.status.kind, 'pending');
  assert.equal(past.scheduledAt, undefined);
});

test('lifecycle: pending → uploading with % → published with link', () => {
  let j = startUpload(createJobs(batch())[0]);
  assert.deepEqual(j.status, { kind: 'uploading', pct: 0 });
  assert.equal(j.attempts, 1);
  j = progress(j, 42);
  assert.deepEqual(j.status, { kind: 'uploading', pct: 42 });
  assert.equal(progress(j, 10), j, 'progress never goes back');
  assert.deepEqual(progress(j, 250).status, { kind: 'uploading', pct: 100 });
  j = published(j, { url: 'https://youtu.be/x', remoteId: 'x' }, T0 + 5);
  assert.equal(j.status.kind, 'published');
  assert.equal(j.status.kind === 'published' && j.status.url, 'https://youtu.be/x');
  assert.throws(() => startUpload(j));
});

test('errors keep their reason; retryable ones go back to the queue', () => {
  const up = startUpload(createJobs(batch())[0]);
  const soft = failed(up, new PublishError('Sin internet', true), T0);
  assert.deepEqual(soft.status, { kind: 'error', reason: 'Sin internet', retryable: true, at: T0 });
  assert.ok(canRetry(soft));
  assert.equal(retry(soft).status.kind, 'pending');

  const hard = failed(up, new PublishError('Título vacío', false), T0);
  assert.equal(canRetry(hard), false);
  assert.equal(retry(hard), hard);

  const unknown = failed(up, new TypeError('boom'), T0);
  assert.equal(unknown.status.kind === 'error' && unknown.status.retryable, true);
  assert.match(unknown.status.kind === 'error' ? unknown.status.reason : '', /conexión/);
});

test('cancel works before and during the upload, not after publishing', () => {
  const j = createJobs(batch())[0];
  assert.equal(cancel(j).status.kind, 'cancelled');
  assert.equal(cancel(startUpload(j)).status.kind, 'cancelled');
  const done = published(startUpload(j), { url: 'u', remoteId: 'r' }, T0);
  assert.equal(cancel(done), done);
});

test('due scheduled jobs become pending, future ones wait', () => {
  const jobs = [
    ...createJobs(batch({ batchId: 'a', scheduledAt: T0 + 1000 })),
    ...createJobs(batch({ batchId: 'b', scheduledAt: T0 + 5000 })),
  ];
  const later = promoteDue(jobs, T0 + 2000);
  assert.deepEqual(later.map((j) => j.status.kind), ['pending', 'pending', 'scheduled', 'scheduled']);
  assert.equal(promoteDue(jobs, T0)[0], jobs[0], 'unchanged jobs keep their identity');
});

test('after a restart nothing is sent on its own', () => {
  const [a, b] = createJobs(batch());
  const [s1] = createJobs(batch({ batchId: 'old', scheduledAt: T0 + 1000 }));
  const [s2] = createJobs(batch({ batchId: 'future', scheduledAt: T0 + 99_000 }));
  const out = recoverOnLoad([startUpload(a), b, s1, s2, published(startUpload(a), { url: 'u', remoteId: 'r' }, T0)], T0 + 5000);
  assert.deepEqual(out.map((j) => j.status.kind), ['error', 'missed', 'missed', 'scheduled', 'published']);
  assert.ok(out.slice(0, 3).every(canRetry), 'the user can retry or publish now');
  assert.equal(retry(out[2]).scheduledAt, undefined);
});

test('the oldest pending job goes first', () => {
  const late = createJobs(batch({ batchId: 'late', now: T0 + 10 }));
  const early = createJobs(batch({ batchId: 'early', now: T0 }));
  assert.equal(nextPending([...late, ...early])?.id, 'early-0');
  assert.equal(nextPending([]), undefined);
});

// ---------- runner ----------

function fakePublisher(behave: (input: UploadInput, onProgress: (p: number) => void, signal: AbortSignal) => Promise<{ remoteId: string; url: string }>): Publisher {
  return {
    id: 'fake',
    networks: ['youtube', 'youtube_shorts'],
    availability: async () => ({ ok: true }),
    listAccounts: async () => [],
    connect: async () => {
      throw new Error('no');
    },
    cancelConnect() {},
    disconnect: async () => {},
    check: () => [],
    upload: behave,
    status: async () => ({ state: 'ready', detail: 'ok' }),
  };
}

function makeQueue(publisher: Publisher, blobs: Record<string, Blob> = { 'b1-video': new Blob(['v']) }) {
  const saved = new Map<string, PublishJob>();
  const settled: PublishJob[] = [];
  const seen: string[] = [];
  let now = T0;
  const q = new PublishQueue({
    publisherFor: () => publisher,
    storage: { saveJob: async (j) => void saved.set(j.id, j), getBlob: async (id) => blobs[id] },
    now: () => now,
    onChange: (jobs) => seen.push(jobs.map((j) => j.status.kind + (j.status.kind === 'uploading' ? j.status.pct : '')).join(',')),
    onSettled: (j) => settled.push(j),
  });
  return { q, saved, settled, seen, setNow: (t: number) => (now = t) };
}

test('runner uploads one at a time and saves every state', async () => {
  const order: string[] = [];
  const pub = fakePublisher(async (input, onProgress) => {
    order.push(`start ${input.network}`);
    onProgress(50);
    await new Promise((r) => setTimeout(r, 5));
    order.push(`end ${input.network}`);
    return { remoteId: input.jobId, url: `https://y/${input.jobId}` };
  });
  const { q, saved, settled, seen } = makeQueue(pub);
  await q.add(createJobs(batch()));
  await q.idle;
  assert.deepEqual(order, ['start youtube_shorts', 'end youtube_shorts', 'start youtube', 'end youtube']);
  assert.ok(q.list().every((j) => j.status.kind === 'published'));
  assert.ok([...saved.values()].every((j) => j.status.kind === 'published'));
  assert.equal(settled.length, 2);
  assert.ok(seen.includes('uploading50,pending'), 'progress is reported');
});

test('runner records the failure reason and retries on demand', async () => {
  let calls = 0;
  const pub = fakePublisher(async (input) => {
    calls++;
    if (calls === 1) throw new PublishError('Se acabó el cupo diario', true);
    return { remoteId: 'v', url: 'https://y/v' };
  });
  const { q } = makeQueue(pub);
  await q.add(createJobs(batch({ targets: [{ network: 'youtube', account: { id: 'UC1', name: 'c' } }] })));
  await q.idle;
  const [j] = q.list();
  assert.deepEqual(j.status.kind === 'error' && [j.status.reason, j.status.retryable], ['Se acabó el cupo diario', true]);
  await q.retry(j.id);
  await q.idle;
  assert.equal(q.list()[0].status.kind, 'published');
  assert.equal(q.list()[0].attempts, 2);
});

test('a missing video is a clear, final error', async () => {
  const { q } = makeQueue(fakePublisher(async () => ({ remoteId: 'x', url: 'u' })), {});
  await q.add(createJobs(batch({ targets: [{ network: 'youtube', account: { id: 'UC1', name: 'c' } }] })));
  await q.idle;
  const s = q.list()[0].status;
  assert.equal(s.kind, 'error');
  assert.equal(s.kind === 'error' && s.retryable, false);
});

test('cancelling a running upload aborts it and marks it cancelled', async () => {
  const pub = fakePublisher(
    (_i, _p, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new PublishError('Subida cancelada.')))),
  );
  const { q } = makeQueue(pub);
  await q.add(createJobs(batch({ targets: [{ network: 'youtube', account: { id: 'UC1', name: 'c' } }] })));
  await new Promise((r) => setTimeout(r, 1));
  assert.equal(q.list()[0].status.kind, 'uploading');
  await q.cancel(q.list()[0].id);
  await q.idle;
  assert.equal(q.list()[0].status.kind, 'cancelled');
});

test('scheduled jobs start on the tick after their time', async () => {
  const pub = fakePublisher(async () => ({ remoteId: 'x', url: 'u' }));
  const { q, setNow } = makeQueue(pub);
  await q.add(createJobs(batch({ scheduledAt: T0 + 60_000, targets: [{ network: 'youtube', account: { id: 'UC1', name: 'c' } }] })));
  await q.tick();
  assert.equal(q.list()[0].status.kind, 'scheduled');
  setNow(T0 + 60_000);
  await q.tick();
  assert.equal(q.list()[0].status.kind, 'published');
});

test('loading saved jobs never starts an upload', async () => {
  let calls = 0;
  const { q } = makeQueue(fakePublisher(async () => (calls++, { remoteId: 'x', url: 'u' })));
  await q.load(createJobs(batch()));
  await q.tick();
  assert.equal(calls, 0);
  assert.ok(q.list().every((j) => j.status.kind === 'missed'));
});

// ---------- text ----------

test('hashtags are normalized and deduplicated', () => {
  assert.deepEqual(parseHashtags('#viaje playa, #Mar #mar ##sol; día-1'), ['#viaje', '#playa', '#Mar', '#sol', '#día1']);
  assert.deepEqual(parseHashtags('  '), []);
});

test('per-network text falls back to the common text field by field', () => {
  const common = { title: 'T', description: 'D', hashtags: '#a' };
  assert.deepEqual(mergePost(common, { title: 'Otro', description: ' ', hashtags: '' }), { title: 'Otro', description: 'D', hashtags: '#a' });
  assert.deepEqual(mergePost(common), common);
});

test('YouTube metadata: title rules, hashtags, Shorts tag and kids flag', () => {
  const meta = buildYouTubeMetadata('youtube_shorts', vertical, { title: 'Mi <viaje>', description: 'Hola', hashtags: '#playa' }, { privacy: 'unlisted', madeForKids: true });
  assert.equal(meta.snippet.title, 'Mi viaje');
  assert.equal(meta.snippet.description, 'Hola\n\n#playa #Shorts');
  assert.deepEqual(meta.snippet.tags, ['playa', 'Shorts']);
  assert.deepEqual(meta.status, { privacyStatus: 'unlisted', selfDeclaredMadeForKids: true });

  const long = buildYouTubeMetadata('youtube', vertical, { description: 'Primera línea\nsegunda', hashtags: '' }, { privacy: 'public', madeForKids: false });
  assert.equal(long.snippet.title, 'Primera línea');
  assert.equal(long.snippet.tags, undefined);
  assert.equal(youtubeTitle({ description: '', hashtags: '' }, vertical), 'viaje');
  assert.equal([...youtubeTitle({ title: 'á'.repeat(150), description: '', hashtags: '' }, vertical)].length, 100);
});

test('YouTube native scheduling uploads as private with publishAt', () => {
  const at = Date.UTC(2026, 11, 24, 18, 0);
  const meta = buildYouTubeMetadata('youtube', vertical, { title: 't', description: '', hashtags: '' }, { privacy: 'public', madeForKids: false, nativePublishAt: at });
  assert.equal(meta.status.privacyStatus, 'private');
  assert.equal(meta.status.publishAt, '2026-12-24T18:00:00.000Z');
});

test('description is cut to 5000 bytes without breaking characters', () => {
  const s = truncateBytes('ñ'.repeat(3000), 5000);
  assert.equal(new TextEncoder().encode(s).length, 5000);
  assert.equal(truncateBytes('abc', 5000), 'abc');
});

test('Shorts must be vertical or square and up to 3 minutes', () => {
  const post = { title: 't', description: '', hashtags: '' };
  assert.deepEqual(checkYouTube('youtube_shorts', vertical, post), []);
  assert.equal(checkYouTube('youtube_shorts', { ...vertical, width: 1920, height: 1080 }, post).length, 1);
  assert.equal(checkYouTube('youtube_shorts', { ...vertical, duration: 200 }, post).length, 1);
  assert.deepEqual(checkYouTube('youtube', { ...vertical, width: 1920, height: 1080, duration: 600 }, post), []);
  assert.equal(youtubeUrl('youtube_shorts', 'abc'), 'https://www.youtube.com/shorts/abc');
  assert.equal(youtubeUrl('youtube', 'abc'), 'https://www.youtube.com/watch?v=abc');
});
