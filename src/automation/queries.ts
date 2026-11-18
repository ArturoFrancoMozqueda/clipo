import type { Project } from '../types';
import { layout, totalDuration } from '../model';

export function projectSummary(p: Project) {
  return { id: p.id, name: p.name, aspect: p.aspect, duration: totalDuration(p),
    counts: { assets: Object.keys(p.assets).length, clips: p.clips.length, texts: p.texts.length, audios: p.audios.length,
      overlays: p.overlays?.length ?? 0, stickers: p.stickers?.length ?? 0 } };
}
export function publicProject(p: Project) {
  return { ...p, assets: Object.fromEntries(Object.entries(p.assets).map(([id, { thumb: _thumb, ...a }]) => [id, a])),
    luts: p.luts ? Object.fromEntries(Object.entries(p.luts).map(([id, { data: _data, ...lut }]) => [id, lut])) : undefined,
    publish: p.publish ? { ...p.publish, coverThumb: undefined } : undefined };
}
export function compactResult(value: unknown) {
  if (!value || typeof value !== 'object' || !('project' in value)) return value;
  const { project, timeline: _timeline, ...rest } = value as { project: Project | null; timeline?: unknown; [key: string]: unknown };
  return { ...rest, projectSummary: project ? projectSummary(project) : null };
}
export function page<T>(items: T[], offset: number, limit?: number) {
  const slice = items.slice(offset, limit === undefined ? undefined : offset + limit);
  return { items: slice, total: items.length, offset, nextOffset: offset + slice.length < items.length ? offset + slice.length : null };
}
export interface ProjectQuery {
  section: 'summary' | 'assets' | 'clips' | 'texts' | 'audios' | 'overlays' | 'stickers';
  from?: number; to?: number; search: string; offset: number; limit: number;
}
export function queryProject(p: Project, q: ProjectQuery) {
  if (q.to !== undefined && q.to <= (q.from ?? 0)) throw new Error('Intervalo de consulta inválido.');
  if (q.section === 'summary') return { summary: projectSummary(p) };
  const clean = publicProject(p);
  const rows = q.section === 'clips' ? layout(p).map(({ clip, start, end }) => ({ ...clip, start, end }))
    : q.section === 'assets' ? Object.values(clean.assets) : (clean[q.section] ?? []);
  const selected = rows.filter((row) => {
    const item = row as { start?: number; end?: number; duration?: number; out?: number; in?: number };
    if (q.section !== 'assets') {
      const start = item.start ?? 0; const end = item.end ?? start + (item.duration ?? item.out! - item.in!);
      if (end <= (q.from ?? 0) || (q.to !== undefined && start >= q.to)) return false;
    }
    return !q.search || JSON.stringify(row).toLocaleLowerCase().includes(q.search.toLocaleLowerCase());
  });
  return { section: q.section, ...page(selected, q.offset, q.limit) };
}
