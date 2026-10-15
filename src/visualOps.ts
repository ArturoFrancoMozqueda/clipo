// Editing actions for the picture of a clip: freeze frame and imported LUTs.
import type { Clip } from './types';
import { layout } from './model';
import { uid, useStore } from './store';
import { engine } from './engine';
import { sourceTime } from './visuals';
import { lutFromCube } from './lut';

const get = () => useStore.getState();

export const FREEZE_DEFAULT = 2;

/** Insert a still copy of the picture under the playhead (2 s, silent), splitting the clip there. */
export function freezeAtPlayhead() {
  const s = get();
  const p = s.project;
  if (!p) return;
  engine.pause();
  const t = s.time;
  const placed = layout(p);
  const sel = s.selection?.kind === 'clip' ? s.selection.id : null;
  const hit = placed.find((l) => l.clip.id === sel && t >= l.start - 0.05 && t <= l.end + 0.05) ?? placed.find((l) => t >= l.start && t < l.end);
  if (!hit) return s.notify('Coloca la línea blanca sobre un video para congelar esa imagen');
  const asset = p.assets[hit.clip.assetId];
  if (asset?.kind !== 'video') return s.notify('Solo se puede congelar la imagen de un video (las fotos ya están quietas)');
  if (hit.clip.freeze != null) return s.notify('Este clip ya es una imagen congelada: arrastra sus bordes para que dure más');
  const at = Math.min(Math.max(t, hit.start), hit.end);
  const still = sourceTime(hit, Math.min(at, hit.end - 0.04), asset.duration);
  const MIN = 0.1;
  const id = uid();
  s.commit((q) => {
    const c = q.clips[hit.index];
    if (!c) return;
    const freeze: Clip = { ...c, id, in: 0, out: FREEZE_DEFAULT, speed: 1, volume: 0, freeze: still };
    delete freeze.transition;
    if (at <= hit.start + MIN) q.clips.splice(hit.index, 0, freeze);
    else if (at >= hit.end - MIN) {
      // The clip's transition now leads out of the still picture.
      if (c.transition) freeze.transition = c.transition;
      delete c.transition;
      q.clips.splice(hit.index + 1, 0, freeze);
    } else {
      const cut = c.in + (at - hit.start) * c.speed;
      q.clips.splice(hit.index + 1, 0, freeze, { ...c, id: uid(), in: cut });
      c.out = cut;
      delete c.transition; // it stays at the end of the second piece
    }
  });
  s.select({ kind: 'clip', id });
  s.notify(`Imagen congelada (${FREEZE_DEFAULT} s). Arrastra sus bordes para cambiar cuánto dura`);
}

/** Read .cube files into the project. Returns the id of the last one that worked. */
export async function importLuts(files: File[]): Promise<string | undefined> {
  const s = get();
  let last: string | undefined;
  const errors: string[] = [];
  for (const f of files) {
    if (!/\.cube$/i.test(f.name)) {
      errors.push(`${f.name}: no es un archivo .cube`);
      continue;
    }
    if (f.size > 20 * 1024 * 1024) {
      errors.push(`${f.name}: es demasiado grande`);
      continue;
    }
    try {
      const lut = lutFromCube(uid(), f.name, await f.text());
      s.commit((p) => void ((p.luts ??= {})[lut.id] = lut));
      last = lut.id;
    } catch (e) {
      errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  if (errors.length) s.notify(`No se pudo usar ${errors.join('; ')}`);
  return last;
}

/** Remove an imported LUT from the project and from every clip that used it. */
export function deleteLut(id: string) {
  get().commit((p) => {
    if (p.luts) delete p.luts[id];
    for (const c of p.clips) if (c.lut?.id === id) delete c.lut;
  });
}
