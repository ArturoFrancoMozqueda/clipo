import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stub } from './helpers/hooks.ts';
stub('fonts', 'export function warmFont() {}');
const { cleanWords, cuesToItems, captionSourceGroups } = await import('../src/captions.ts');
const { layout } = await import('../src/model.ts');
import { sampleProject } from './fixtures/project.ts';
const look = { style: 'viral', karaoke: 'color' as const, color: '#ffe500', chunk: 'corto' as const };

test('automatic captions cannot extend a trimmed video or keep phantom end words', () => {
  const words = cleanWords([{ text: 'real', start: 3.5, end: 4 }, { text: 'phantom', start: 4, end: null }], 4);
  assert.equal(words.length, 1);
  const items = cuesToItems([
    { text: 'final', start: 11.7, end: 12, words: [{ text: 'final', start: 11.7, end: 12.3 }] },
    { text: 'phantom', start: 12, end: 12.1 },
  ], look, 12);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.start + items[0]!.duration, 12);
  assert.ok(items[0]!.words!.every((w) => w.end <= items[0]!.duration));
});

test('nearby cuts are recognized in one source context while retaining repeated clips', () => {
  const p = sampleProject();
  p.clips = [
    { ...p.clips[0]!, id: 'a', in: 0.45, out: 4.45 },
    { ...p.clips[0]!, id: 'b', in: 5.1, out: 9.1 },
    { ...p.clips[0]!, id: 'c', in: 10, out: 14 },
  ];
  assert.deepEqual(captionSourceGroups(layout(p)), [{ assetId: 'v1', clipIds: ['a', 'b', 'c'], from: 0.45, to: 14 }]);
  p.clips[2]!.assetId = 'v2';
  assert.equal(captionSourceGroups(layout(p)).length, 2);
  p.clips[2]!.assetId = 'v1'; p.clips[2]!.in = 100; p.clips[2]!.out = 104;
  assert.equal(captionSourceGroups(layout(p)).length, 2);
});
