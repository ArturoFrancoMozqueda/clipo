// What the start screen does with saved projects besides opening them: rename, duplicate,
// search and sort. The pure parts are tested in tests/projects.test.ts.
import type { Project } from './types';
import { getProject, projectMeta, saveProject, type ProjectMeta } from './db';
import { uid } from './store';

export type ProjectSort = 'recent' | 'oldest' | 'name' | 'longest';

export const SORT_LABELS: Record<ProjectSort, string> = {
  recent: 'Más recientes',
  oldest: 'Más antiguos',
  name: 'Por nombre',
  longest: 'Más largos',
};

/** Lowercase and without accents, so "cumpleanos" finds "Cumpleaños". */
export const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Projects whose name has every word of the search. */
export function filterProjects<T extends { name: string }>(list: T[], query: string): T[] {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((p) => {
    const name = plain(p.name);
    return words.every((w) => name.includes(w));
  });
}

export function sortProjects<T extends Pick<ProjectMeta, 'name' | 'updatedAt' | 'duration'>>(list: T[], by: ProjectSort): T[] {
  const out = [...list];
  if (by === 'name') out.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }) || b.updatedAt - a.updatedAt);
  else if (by === 'oldest') out.sort((a, b) => a.updatedAt - b.updatedAt);
  else if (by === 'longest') out.sort((a, b) => b.duration - a.duration || b.updatedAt - a.updatedAt);
  else out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** Name for a copy that no other project has: "Viaje (copia)", "Viaje (copia 2)"… */
export function copyName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(plain));
  const base = name.replace(/\s*\(copia(?: \d+)?\)\s*$/i, '').trim() || 'Mi video';
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base} (copia)` : `${base} (copia ${n})`;
    if (!used.has(plain(candidate))) return candidate;
  }
}

/** "Hace un momento", "Hace 5 min", "Hoy, 14:30", "Ayer", "Hace 3 días", then the date. */
export function relativeDate(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'Hace un momento';
  if (min < 60) return `Hace ${min} min`;
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(ts)) / 86_400_000);
  if (days === 0) return `Hoy, ${new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'Ayer';
  if (days < 7) return `Hace ${days} días`;
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Project length in words a beginner reads at a glance: "45 s", "1 min 20 s". */
export function fmtLength(sec: number): string {
  const s = Math.round(Math.max(0, sec));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

/** Give a saved project another name. Returns its new summary (undefined if it no longer exists). */
export async function renameProject(id: string, name: string): Promise<ProjectMeta | undefined> {
  const p = await getProject(id);
  const clean = name.trim();
  if (!p || !clean) return undefined;
  const next: Project = { ...p, name: clean };
  await saveProject(next);
  return projectMeta(next);
}

/**
 * Copy a saved project. The copy shares the media files with the original (they are kept while
 * any project uses them), so it takes almost no extra space.
 */
export async function duplicateProject(id: string, takenNames: Iterable<string>): Promise<ProjectMeta | undefined> {
  const p = await getProject(id);
  if (!p) return undefined;
  const now = Date.now();
  const copy: Project = { ...structuredClone(p), id: uid(), name: copyName(p.name, takenNames), createdAt: now, updatedAt: now };
  await saveProject(copy);
  return projectMeta(copy);
}
