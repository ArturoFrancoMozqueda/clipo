// Small "favorites" and "recently used" lists for the pickers (text looks, stickers…),
// remembered on this device. Ids that no longer exist are simply ignored by whoever reads a list.
import { useSyncExternalStore } from 'react';

const KEY = (list: string) => `clipo.picks.${list}`;
const cache = new Map<string, string[]>();
const listeners = new Set<() => void>();

function read(list: string): string[] {
  let v = cache.get(list);
  if (!v) {
    v = [];
    try {
      const raw = JSON.parse(localStorage.getItem(KEY(list)) ?? '[]') as unknown;
      if (Array.isArray(raw)) v = raw.filter((x): x is string => typeof x === 'string');
    } catch {
      // unreadable or blocked storage: start empty
    }
    cache.set(list, v);
  }
  return v;
}

function write(list: string, v: string[]) {
  cache.set(list, v);
  try {
    localStorage.setItem(KEY(list), JSON.stringify(v));
  } catch {
    // storage full or blocked: the list still works until the app is closed
  }
  listeners.forEach((l) => l());
}

/** Newest first, without repeats, at most `max` long. */
export function pushRecent(prev: string[], id: string, max: number) {
  return [id, ...prev.filter((x) => x !== id)].slice(0, max);
}

/** Remember that `id` was just used (newest first). */
export const addRecent = (list: string, id: string, max = 12) => write(list, pushRecent(read(list), id, max));

/** Add `id` to a favorites list, or take it out if it was there. */
export function toggleFavorite(list: string, id: string) {
  const cur = read(list);
  write(list, cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur]);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The saved ids of a list, re-rendering when it changes. */
export const usePicks = (list: string) => useSyncExternalStore(subscribe, () => read(list));
