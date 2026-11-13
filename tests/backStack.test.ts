import { test } from 'node:test';
import assert from 'node:assert/strict';

// A minimal browser history: entries, back() fires popstate asynchronously like real browsers.
const listeners: Array<() => void> = [];

let index = 0;
(globalThis as Record<string, unknown>).window = {
  addEventListener: (type: string, fn: () => void) => type === 'popstate' && listeners.push(fn),
};
(globalThis as Record<string, unknown>).history = {
  pushState: () => {
    index++;

  },
  back: () => {
    if (index === 0) return;
    index--;
    queueMicrotask(() => listeners.forEach((l) => l()));
  },
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const systemBack = async () => {
  (globalThis as unknown as { history: { back(): void } }).history.back();
  await tick();
};

const { pushBackLayer, backDepth } = await import('../src/backStack.ts');

test('system back closes the top layer first, then the one below', async () => {
  const closed: string[] = [];
  const releaseEditor = pushBackLayer(() => void closed.push('editor'));
  pushBackLayer(() => void closed.push('panel'));
  assert.equal(backDepth(), 2);
  await systemBack();
  assert.deepEqual(closed, ['panel']);
  await systemBack();
  assert.deepEqual(closed, ['panel', 'editor']);
  assert.equal(backDepth(), 0);
  releaseEditor(); // already closed by back: must not pop another entry
  await tick();
  assert.equal(index, 0);
});

test('closing a layer from the app removes its entry without closing anything else', async () => {
  const closed: string[] = [];
  pushBackLayer(() => void closed.push('editor'));
  const releasePanel = pushBackLayer(() => void closed.push('panel'));
  releasePanel();
  await tick();
  assert.deepEqual(closed, []);
  assert.equal(backDepth(), 1);
  await systemBack();
  assert.deepEqual(closed, ['editor']);
  assert.equal(index, 0);
});

test('a layer that refuses to close (busy export) stays and keeps its entry', async () => {
  let busy = true;
  const closed: string[] = [];
  pushBackLayer(() => {
    if (busy) return false;
    closed.push('export');
  });
  await systemBack();
  assert.deepEqual(closed, []);
  assert.equal(backDepth(), 1);
  assert.equal(index, 1);
  busy = false;
  await systemBack();
  assert.deepEqual(closed, ['export']);
  assert.equal(backDepth(), 0);
});
