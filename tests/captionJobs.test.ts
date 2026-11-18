import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/hooks.ts';
import { sampleProject } from './fixtures/project.ts';
const { useStore } = await import('../src/store.ts');
const { createCaptionJobs } = await import('../src/automation/captionJobs.ts');
const options = { language: 'spanish', quality: 'preciso' as const, look: { style: 'viral', karaoke: 'color' as const, color: '#ffe500', chunk: 'corto' as const } };
const tick = () => new Promise<void>((r) => setImmediate(r));
afterEach(() => useStore.getState().close());

test('caption jobs return immediately, expose real progress and complete only after saving', async () => {
  useStore.getState().open(sampleProject(), {});
  let finish!: (n: number) => void;
  let finishSave!: () => void;
  const jobs = createCaptionJobs({ load: async () => ({
    generateCaptions: async ({ onProgress }) => { onProgress({ phase: 'listen', pct: 40 }); return new Promise<number>((r) => { finish = r; }); },
    cancelCaptions() {},
  }), save: () => new Promise<void>((r) => { finishSave = r; }) });
  const job = jobs.start(options);
  assert.equal(job.status, 'queued');
  assert.equal(useStore.getState().captioning, true);
  assert.throws(() => jobs.start(options), /curso/);
  await tick();
  assert.equal(jobs.read(job.id).status, 'running');
  assert.deepEqual(jobs.read(job.id).progress, { phase: 'listen', pct: 40 });
  finish(8); await tick();
  assert.equal(jobs.read(job.id).status, 'saving');
  finishSave(); await tick();
  assert.equal(jobs.read(job.id).status, 'completed');
  assert.equal(jobs.read(job.id).count, 8);
  assert.equal(useStore.getState().captioning, false);
});

test('cancelling an unknown/completed job cannot cancel a different active run', async () => {
  useStore.getState().open(sampleProject(), {});
  let aborted = 0;
  let rejectRun!: (e: Error) => void;
  const jobs = createCaptionJobs({ load: async () => ({
    generateCaptions: () => new Promise<number>((_, reject) => { rejectRun = reject; }),
    cancelCaptions() { aborted++; rejectRun(new Error('cancelled')); },
  }), save: async () => {} });
  const job = jobs.start(options); await tick();
  assert.throws(() => jobs.cancel('unknown'), /inexistente/); assert.equal(aborted, 0);
  jobs.cancel(job.id); await tick();
  assert.equal(jobs.read(job.id).status, 'cancelled');
  assert.equal(useStore.getState().captioning, false);
  jobs.cancel(job.id); assert.equal(aborted, 1);
});

test('recognition and saving failures are visible and always release the busy state', async () => {
  useStore.getState().open(sampleProject(), {});
  for (const failSave of [false, true]) {
    const jobs = createCaptionJobs({ load: async () => ({
      generateCaptions: async () => { if (!failSave) throw new Error('no-speech'); return 3; }, cancelCaptions() {},
    }), save: async () => { throw new Error('disk full'); } });
    const job = jobs.start(options); await tick();
    assert.equal(jobs.read(job.id).status, 'error');
    assert.equal(jobs.read(job.id).error, failSave ? 'disk full' : 'no-speech');
    assert.equal(useStore.getState().captioning, false);
  }
});

test('source review returns source word times without changing or saving captions', async () => {
  useStore.getState().open(sampleProject(), {});
  const before = useStore.getState().project;
  let saved = false;
  const result = { text: 'otro carro', wordTimed: true, words: [{ text: 'carro', start: 1.1, end: 1.6 }] };
  const jobs = createCaptionJobs({ load: async () => ({
    generateCaptions: async () => { throw new Error('Must not regenerate captions during review'); },
    reviewSourceAudio: async () => result,
    cancelCaptions() {},
  }), save: async () => { saved = true; } });
  const job = jobs.start({ ...options, source: { assetId: 'v1', from: 0, to: 2 } });
  await tick();
  assert.equal(jobs.read(job.id).kind, 'audio-review');
  assert.equal(jobs.read(job.id).status, 'completed');
  assert.deepEqual(jobs.read(job.id).result, result);
  assert.equal(useStore.getState().project, before);
  assert.equal(saved, false);
});
