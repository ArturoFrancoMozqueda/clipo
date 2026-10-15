// Autosave of the open project: waits for a pause in the editing (a drag or slider changes the
// project on every pointer move), saves only versions not saved yet, one write at a time, and
// reports a failure once until a save works again.
import type { Project } from './types';
import { saveProject } from './db';

export interface AutosaveOptions {
  save?: (p: Project) => Promise<void>;
  /** Called once when saving starts failing; again only after a save worked in between. */
  onError?: (e: unknown) => void;
  /** Quiet time after the last change before saving (ms). */
  delay?: number;
  /** Longest a change waits while edits keep coming (ms). */
  maxWait?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  now?: () => number;
}

export function createAutosave(o: AutosaveOptions = {}) {
  const save = o.save ?? saveProject;
  const delay = o.delay ?? 800;
  const maxWait = o.maxWait ?? 5000;
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as number));
  const clock = o.now ?? Date.now;

  let pending: Project | null = null;
  let lastSaved: Project | null = null;
  let firstChange = 0;
  let timer: unknown;
  let failing = false;
  let chain: Promise<void> = Promise.resolve();

  const write = (p: Project) =>
    save(p).then(
      () => {
        lastSaved = p;
        failing = false;
      },
      (e) => {
        console.error('Clipo: no se pudo guardar el proyecto', e);
        if (!failing) {
          failing = true;
          o.onError?.(e);
        }
      },
    );

  /** Save what is waiting now (page hidden, project closed). */
  function flush(): Promise<void> {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    const p = pending;
    pending = null;
    if (p && p !== lastSaved) chain = chain.then(() => write(p));
    return chain;
  }

  /** The open project changed (null = closed). */
  function changed(p: Project | null) {
    // Closing, or switching to another project: the previous one is saved right away.
    if (!p || (pending && pending.id !== p.id)) {
      void flush();
      if (!p) return;
    }
    const now = clock();
    if (!pending) firstChange = now;
    pending = p;
    if (timer !== undefined) clearTimer(timer);
    const wait = Math.max(0, Math.min(delay, firstChange + maxWait - now));
    timer = setTimer(() => {
      timer = undefined;
      void flush();
    }, wait);
  }

  return { changed, flush };
}
