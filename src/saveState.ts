// What the editor shows about saving ("Guardando…" / "Guardado"), and the pieces around the
// autosave that the screens need: save right now, and throw away a project that was never used.
import { create } from 'zustand';
import type { Project } from './types';
import { deleteProject, saveProject } from './db';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export const useSaveState = create<{ status: SaveStatus }>()(() => ({ status: 'saved' }));
const set = (status: SaveStatus) => useSaveState.setState({ status });

/** Projects thrown away while open: a late autosave must not bring them back. */
const discarded = new Set<string>();
let inFlight: Promise<unknown> = Promise.resolve();

/** The save function the autosave uses (main.tsx): the real save, plus the status. */
export function trackedSave(p: Project, save: (p: Project) => Promise<void> = saveProject): Promise<void> {
  if (discarded.has(p.id)) return Promise.resolve();
  set('saving');
  const done = save(p).then(
    () => set('saved'),
    (e) => {
      set('error');
      throw e;
    },
  );
  inFlight = done.catch(() => {});
  return done;
}

/** An edit is waiting to be saved. */
export const markPending = () => useSaveState.getState().status !== 'saving' && set('pending');
/** A project was opened or closed: nothing is waiting. */
export const markSaved = () => set('saved');

let flusher: () => Promise<void> = () => Promise.resolve();
/** main.tsx hands over the autosave's flush. */
export const setSaveNow = (fn: () => Promise<void>) => void (flusher = fn);
/** Save the open project now instead of waiting for the next pause. */
export const saveNow = () => flusher();

/** Nothing was added to it: no media, no texts, no sounds. */
export const isUntouched = (p: Project) =>
  !Object.keys(p.assets ?? {}).length && !p.clips.length && !p.texts.length && !p.audios.length && !(p.stickers?.length || p.overlays?.length);

/**
 * Remove a project that was opened and left empty, so the project list doesn't fill up with
 * blank "Mi video" entries. Waits for a save already on its way, then deletes.
 */
export async function discardProject(p: Project): Promise<void> {
  discarded.add(p.id);
  await inFlight;
  await deleteProject(p).catch(() => {});
}
