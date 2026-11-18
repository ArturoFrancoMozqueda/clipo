import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/hooks.ts';
import { sampleProject } from './fixtures/project.ts';
import { toolSchemas } from '../src/automation/schema.ts';
import { frameMetrics, histogramDistance, sampleTimes } from '../src/automation/visualMetrics.ts';
const { queryProject, compactResult } = await import('../src/automation/queries.ts');
const { planDifferences } = await import('../src/automation/plan.ts');
const { applyEdits } = await import('../src/automation/edits.ts');

test('bounded sampling excludes EOF; metrics distinguish black and hard colour changes', () => {
  assert.deepEqual(sampleTimes(0, 3, 6), [0.25, 0.75, 1.25, 1.75, 2.25, 2.75]);
  for (const args of [[0, 121, 12], [3, 2, 1], [0, 1, 25], [NaN, 1, 1]]) assert.throws(() => sampleTimes(...args as [number, number, number]));
  const red = frameMetrics(new Uint8ClampedArray([255, 0, 0, 255]));
  const blue = frameMetrics(new Uint8ClampedArray([0, 0, 255, 255]));
  const black = frameMetrics(new Uint8ClampedArray([0, 0, 0, 255]));
  assert.equal(black.darkFraction, 1); assert.equal(black.meanLuma, 0);
  assert.equal(histogramDistance(red.histogram, red.histogram), 0);
  assert.ok(histogramDistance(red.histogram, blue.histogram) > 0.5);
});
test('project queries page and filter actual timeline intersections, excluding media payloads', () => {
  const p = sampleProject();
  const base = { section: 'clips' as const, offset: 0, limit: 1, search: '' };
  const first = queryProject(p, base); assert.ok('items' in first);
  assert.equal(first.items!.length, 1); assert.equal(first.nextOffset, 1);
  const range = queryProject(p, { ...base, from: 10, to: 11 });
  assert.ok('items' in range);
  assert.equal((range.items![0] as { id: string }).id, 'c2');
  const assets = queryProject(p, { ...base, section: 'assets', search: 'a.mp4' });
  assert.ok('total' in assets);
  assert.equal(assets.total, 1); assert.ok(!JSON.stringify(assets).includes('data:image'));
  assert.throws(() => queryProject(p, { ...base, from: 5, to: 4 }));
  const compact = compactResult({ project: p, timeline: [1], revision: 9, job: { id: 'j' } });
  assert.ok(!JSON.stringify(compact).includes('B'.repeat(100))); assert.ok(compact && typeof compact === 'object' && !('project' in compact));
  assert.equal(toolSchemas.clipo_get_project.parse({}).response, undefined);
});
test('plans reveal downstream time shifts and warn about auxiliary tracks without ripple', () => {
  const p = sampleProject(); const original = structuredClone(p);
  const ops = toolSchemas.clipo_edit.parse({ projectId: p.id, expectedRevision: 0, operations: [{ op: 'update_clip', id: 'c1', changes: { out: 5 } }] }).operations;
  const after = applyEdits(p, ops).project; const diff = planDifferences(p, after);
  assert.deepEqual(p, original); assert.equal(diff.durationDelta, 0); assert.equal(diff.mainDurationDelta, -5);
  assert.deepEqual(diff.differences.find((d) => d.id === 'c2')!.after, { start: 5, end: 7 });
  assert.ok(diff.warnings.some((w) => w.code === 'AUXILIARY_TIMES_UNCHANGED' && w.ids.includes('t1')));
  assert.ok(diff.warnings.some((w) => w.code === 'ITEMS_BEYOND_TIMELINE' && w.ids.includes('au1')));
});
