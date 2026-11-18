import type { Project } from '../types';
import { layout, totalDuration } from '../model';

function entries(p: Project) {
  const main = layout(p).map(({ clip, start, end }) => ({ kind: 'clip', id: clip.id, start, end, item: clip }));
  const aux = (['texts', 'audios', 'overlays', 'stickers'] as const).flatMap((kind) => (p[kind] ?? []).map((item) => ({
    kind, id: item.id, start: item.start, end: item.start + ('duration' in item ? item.duration : item.out - item.in), item,
  })));
  return [...main, ...aux];
}
export function planDifferences(before: Project, after: Project) {
  const previous = new Map(entries(before).map((e) => [e.id, e])); const next = new Map(entries(after).map((e) => [e.id, e]));
  const differences = [...new Set([...previous.keys(), ...next.keys()])].flatMap((id) => {
    const a = previous.get(id); const b = next.get(id);
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    const oldFields = (a?.item ?? {}) as Record<string, unknown>; const newFields = (b?.item ?? {}) as Record<string, unknown>;
    const fields = [...new Set([...Object.keys(oldFields), ...Object.keys(newFields)])].filter((key) => JSON.stringify(oldFields[key]) !== JSON.stringify(newFields[key]));
    return [{ id, kind: (b ?? a)!.kind, change: !a ? 'added' : !b ? 'removed' : 'updated', fields,
      before: a ? { start: a.start, end: a.end } : null, after: b ? { start: b.start, end: b.end } : null }];
  });
  const settings = (['name', 'aspect', 'audioMix', 'publish'] as const).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
  const durationDelta = totalDuration(after) - totalDuration(before);
  const mainDurationBefore = layout(before).at(-1)?.end ?? 0;
  const mainDurationAfter = layout(after).at(-1)?.end ?? 0;
  const warnings: Array<{ code: string; ids: string[]; message: string }> = [];
  if (differences.some((d) => d.kind === 'clip' && (d.change !== 'updated' || d.before?.start !== d.after?.start || d.before?.end !== d.after?.end))) {
    const unchanged = entries(before).filter((e) => e.kind !== 'clip' && JSON.stringify(e.item) === JSON.stringify(next.get(e.id)?.item)).map((e) => e.id);
    if (unchanged.length) warnings.push({ code: 'AUXILIARY_TIMES_UNCHANGED', ids: unchanged, message: 'El lote preciso no aplica ripple: revisa estas pistas que conservan sus tiempos absolutos.' });
  }
  const outside = entries(after).filter((e) => e.kind !== 'clip' && e.end > mainDurationAfter + 0.001).map((e) => e.id);
  if (outside.length) warnings.push({ code: 'ITEMS_BEYOND_TIMELINE', ids: outside, message: 'Estos elementos terminan después de la pista principal.' });
  return { durationBefore: totalDuration(before), durationAfter: totalDuration(after), durationDelta,
    mainDurationBefore, mainDurationAfter, mainDurationDelta: mainDurationAfter - mainDurationBefore, differences, settings, warnings,
    idsAreIllustrative: true, ripple: false };
}
