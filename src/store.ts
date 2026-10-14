import { create } from 'zustand';
import type { PanelId, Project, Selection, SelectionKind } from './types';
import { clamp } from './model';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const HISTORY_LIMIT = 100;

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
}

function selectionExists(p: Project | null, s: Selection): Selection {
  if (!p || !s) return null;
  const list = itemsOf(p, s.kind);
  return list.some((x) => x.id === s.id) ? s : null;
}

/** The list holding items of a selection kind. */
export function itemsOf(p: Project, kind: SelectionKind): { id: string }[] {
  if (kind === 'clip') return p.clips;
  if (kind === 'text') return p.texts;
  if (kind === 'audio') return p.audios;
  return p.stickers ?? [];
}

function mutate(p: Project, fn: (p: Project) => void) {
  const next = structuredClone(p);
  fn(next);
  next.updatedAt = Date.now();
  return next;
}

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

  open: (p, urls) =>
    set({ project: p.stickers ? p : { ...p, stickers: [] }, urls, selection: null, time: 0, playing: false, panel: null, past: [], future: [] }),
  close: () => {
    for (const u of Object.values(get().urls)) URL.revokeObjectURL(u);
    set({ project: null, urls: {}, selection: null, time: 0, playing: false, panel: null, past: [], future: [] });
  },
  commit: (fn) => {
    const { project, past } = get();
    if (!project) return;
    const next = mutate(project, fn);
    set({ project: next, past: [...past.slice(-HISTORY_LIMIT + 1), project], future: [], selection: selectionExists(next, get().selection) });
  },
  live: (fn) => {
    const { project } = get();
    if (!project) return;
    set({ project: mutate(project, fn) });
  },
  checkpoint: () => {
    const { project, past } = get();
    if (project) set({ past: [...past.slice(-HISTORY_LIMIT + 1), project], future: [] });
  },
  undo: () => {
    const { project, past, future } = get();
    if (!project || !past.length) return;
    const prev = past[past.length - 1];
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future], selection: selectionExists(prev, get().selection) });
  },
  redo: () => {
    const { project, past, future } = get();
    if (!project || !future.length) return;
    const next = future[0];
    set({ project: next, past: [...past, project], future: future.slice(1), selection: selectionExists(next, get().selection) });
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
}));
