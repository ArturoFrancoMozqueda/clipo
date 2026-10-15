// Turns a parsed CapCut draft plus the media files the user picked into a Clipo project.
import type { Asset, Project } from '../types';
import type { DraftPlan } from './capcut';
import { importFiles } from '../media';
import { newProject } from '../ops';
import { uid, useStore } from '../store';

export interface BuildResult {
  project: Project;
  urls: Record<string, string>;
  /** Spanish notes about pieces dropped while building (missing or unplayable files). */
  problems: string[];
}

export async function buildProject(plan: DraftPlan, files: Map<string, File>): Promise<BuildResult> {
  const assets = new Map<string, Asset>();
  const unplayable: string[] = [];
  for (const [key, file] of files) {
    const { ok } = await importFiles([file]);
    if (ok[0]) assets.set(key, ok[0]);
    else unplayable.push(file.name);
  }

  const p = newProject(plan.aspect);
  p.name = plan.name;
  for (const a of assets.values()) p.assets[a.id] = a;

  let dropped = 0;
  for (const c of plan.clips) {
    const a = assets.get(c.media);
    if (!a || a.kind === 'audio') {
      dropped++;
      continue;
    }
    if (a.kind === 'image') {
      p.clips.push({ id: uid(), assetId: a.id, in: 0, out: Math.min(c.out, a.duration), speed: 1, volume: 1, filter: 'none', fit: 'fit' });
      continue;
    }
    // The file may be shorter than the draft expects (e.g. a trimmed copy).
    const out = Math.min(c.out, a.duration);
    if (out - c.in < 0.05) {
      dropped++;
      continue;
    }
    p.clips.push({ id: uid(), assetId: a.id, in: c.in, out, speed: c.speed, volume: c.volume, filter: 'none', fit: 'fit' });
  }

  for (const au of plan.audios) {
    const a = assets.get(au.media);
    const out = a ? Math.min(au.out, a.duration) : 0;
    if (!a || out - au.in < 0.05) {
      dropped++;
      continue;
    }
    p.audios.push({ id: uid(), assetId: a.id, start: au.start, in: au.in, out, volume: au.volume, fadeIn: 0, fadeOut: 0 });
  }

  for (const t of plan.texts) p.texts.push({ id: uid(), ...t, styleId: 'clasico' });

  const problems: string[] = [];
  const missing = Object.values(plan.media).filter((m) => !files.has(m.key)).map((m) => m.fileName);
  if (missing.length) problems.push(`Faltan archivos: ${missing.join(', ')}.`);
  if (unplayable.length) problems.push(`No se pudieron abrir: ${unplayable.join(', ')}.`);
  if (dropped) problems.push(`${dropped} ${dropped === 1 ? 'pieza quedó' : 'piezas quedaron'} fuera por falta de su archivo.`);

  // importFiles registered object URLs in the store; hand them to the new project.
  const all = useStore.getState().urls;
  const urls: Record<string, string> = {};
  for (const a of assets.values()) {
    const url = all[a.id];
    if (url) urls[a.id] = url;
  }
  return { project: p, urls, problems };
}
