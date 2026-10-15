import { create } from 'zustand';
import type { AudioItem, Clip, OverlayItem, PanelId, Project, Selection, SelectionKind, StickerItem, TextItem } from './types';
import { clamp } from './model';
import { produce } from './draft';
import { normalizeProject } from './normalize';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const HISTORY_LIMIT = 100;

interface State {
  project: Project | null;
  /** Object URLs for asset blobs, keyed by asset id. */
  urls: Record<string, string>;
  selection: Selection;
  time: number;
  playing: boolean;
  panel: PanelId | null;
  past: Project[];
  future: Project[];
  /** Timeline zoom in pixels per second. */
  pps: number;
  toast: { id: number; text: string } | null;
  exporting: boolean;
  /** Automatic captions are being generated. */
  captioning: boolean;
  /** Shows the advanced tools (overlays, keyframes, color correction). Remembered per device. */
  advanced: boolean;

  open(p: Project, urls: Record<string, string>): void;
  close(): void;
  /** Apply an edit as one undoable step. */
  commit(fn: (p: Project) => void): void;
  /** Apply an edit without recording history (use after checkpoint() for drags/sliders). */
  live(fn: (p: Project) => void): void;
  checkpoint(): void;
  undo(): void;
  redo(): void;
  setTime(t: number): void;
  setPlaying(b: boolean): void;
  select(s: Selection): void;
  setPanel(p: PanelId | null): void;
  setPps(n: number): void;
  notify(text: string): void;
  addUrls(u: Record<string, string>): void;
  setExporting(b: boolean): void;
  setCaptioning(b: boolean): void;
  setAdvanced(b: boolean): void;
}

const ADVANCED_KEY = 'clipo.advanced';
function loadAdvanced() {
  try {
    return localStorage.getItem(ADVANCED_KEY) === '1';
  } catch {
    return false;
  }
}

/** The selection if its item is still in the project, else null. */
export function selectionExists(p: Project | null, s: Selection): Selection {
  if (!p || !s) return null;
  const list = itemsOf(p, s.kind);
  return list.some((x) => x.id === s.id) ? s : null;
}

/** The list holding items of a selection kind. */
export function itemsOf(p: Project, kind: SelectionKind): { id: string }[] {
  if (kind === 'clip') return p.clips;
  if (kind === 'text') return p.texts;
  if (kind === 'audio') return p.audios;
  if (kind === 'overlay') return p.overlays ?? [];
  return p.stickers ?? [];
}

/** Item types by selection kind. */
export interface ItemByKind {
  clip: Clip;
  text: TextItem;
  audio: AudioItem;
  sticker: StickerItem;
  overlay: OverlayItem;
}

/** The item of `kind` with `id`, typed by its kind. */
export function findItem<K extends SelectionKind>(p: Project, kind: K, id: string): ItemByKind[K] | undefined {
  return (itemsOf(p, kind) as ItemByKind[K][]).find((x) => x.id === id);
}

/**
 * Change one item, typed by its kind. `live` (default) skips history: call checkpoint() first,
 * as for drags and sliders; `commit` records an undo step.
 */
export function editItem<K extends SelectionKind>(kind: K, id: string, fn: (item: ItemByKind[K]) => void, mode: 'live' | 'commit' = 'live') {
  useStore.getState()[mode]((p) => {
    const it = findItem(p, kind, id);
    if (it) fn(it);
  });
}

/**
 * Apply an edit copy-on-write: only the objects on the path to a change are copied, everything
 * else (assets with their thumbnails, LUTs, untouched items) is shared with `p`. So undo
 * snapshots are cheap references and `p` itself is never modified.
 */
function mutate(p: Project, fn: (p: Project) => void) {
  return produce(p, (d) => {
    fn(d);
    d.updatedAt = Date.now();
  });
}

const pushPast = (past: Project[], p: Project) => (past[past.length - 1] === p ? past : [...past.slice(-HISTORY_LIMIT + 1), p]);

let toastId = 0;

export const useStore = create<State>()((set, get) => ({
  project: null,
  urls: {},
  selection: null,
  time: 0,
  playing: false,
  panel: null,
  past: [],
  future: [],
  pps: 60,
  toast: null,
  exporting: false,
  captioning: false,
  advanced: loadAdvanced(),

  open: (p, urls) => {
    let project: Project;
    try {
      project = normalizeProject(p);
    } catch (e) {
      console.error(e);
      return get().notify('Este proyecto está dañado y no se puede abrir.');
    }
    set({ project, urls, selection: null, time: 0, playing: false, panel: null, past: [], future: [] });
  },
  close: () => {
    for (const u of Object.values(get().urls)) URL.revokeObjectURL(u);
    set({ project: null, urls: {}, selection: null, time: 0, playing: false, panel: null, past: [], future: [] });
  },
  commit: (fn) => {
    const { project, past } = get();
    if (!project) return;
    const next = mutate(project, fn);
    set({ project: next, past: pushPast(past, project), future: [], selection: selectionExists(next, get().selection) });
  },
  live: (fn) => {
    const { project } = get();
    if (!project) return;
    set({ project: mutate(project, fn) });
  },
  checkpoint: () => {
    const { project, past } = get();
    if (project) set({ past: pushPast(past, project), future: [] });
  },
  undo: () => {
    const { project, past, future } = get();
    if (!project) return;
    // A checkpoint with no change after it is not a step of its own.
    let i = past.length - 1;
    while (i >= 0 && past[i] === project) i--;
    if (i < 0) return past.length ? set({ past: [] }) : undefined;
    const prev = past[i];
    set({ project: prev, past: past.slice(0, i), future: [project, ...future], selection: selectionExists(prev, get().selection) });
  },
  redo: () => {
    const { project, past, future } = get();
    if (!project || !future.length) return;
    const next = future[0];
    set({ project: next, past: pushPast(past, project), future: future.slice(1), selection: selectionExists(next, get().selection) });
  },
  setTime: (t) => set({ time: t }),
  setPlaying: (b) => set({ playing: b }),
  select: (s) => set({ selection: s }),
  setPanel: (p) => set({ panel: p }),
  setPps: (n) => set({ pps: clamp(n, 8, 500) }),
  notify: (text) => set({ toast: { id: ++toastId, text } }),
  addUrls: (u) => set({ urls: { ...get().urls, ...u } }),
  setExporting: (b) => set({ exporting: b }),
  setCaptioning: (b) => set({ captioning: b }),
  setAdvanced: (b) => {
    try {
      localStorage.setItem(ADVANCED_KEY, b ? '1' : '0');
    } catch {
      /* private mode: only this session */
    }
    set({ advanced: b });
  },
}));
