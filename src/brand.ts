// "Mi marca": the user's favorite font, colors and style, saved on this device and used for
// every new text. Kept outside the projects so it follows the user from video to video.
import { useSyncExternalStore } from 'react';
import type { TextItem } from './types';

export interface BrandKit {
  /** Font id (src/fonts.ts); the style's own font when missing. */
  font?: string;
  styleId: string;
  /** Main color: the text. */
  fill?: string;
  /** Second color: the highlighted word of captions. */
  accent: string;
  /** Use it for texts added from now on. */
  forNew: boolean;
}

const KEY = 'clipo.brandKit';
const listeners = new Set<() => void>();
let cached: BrandKit | null | undefined;

export function getBrand(): BrandKit | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as BrandKit) : null;
    cached = v && typeof v.styleId === 'string' ? v : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function saveBrand(kit: BrandKit | null) {
  cached = kit;
  try {
    if (kit) localStorage.setItem(KEY, JSON.stringify(kit));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or full storage: the kit still works until the app is closed.
  }
  listeners.forEach((l) => l());
}

export function useBrand() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    getBrand,
  );
}

/** Give a text the brand look (font, style, color). */
export function brandLook(t: TextItem, kit: BrandKit) {
  t.font = kit.font;
  t.styleId = kit.styleId;
  if (kit.fill) t.fill = kit.fill;
  else delete t.fill;
  if (t.karaoke) t.karaoke = { ...t.karaoke, color: kit.accent };
  return t;
}

/** New texts follow the brand kit when the user turned that on. */
export function applyBrand(t: TextItem): TextItem {
  const kit = getBrand();
  return kit?.forNew ? brandLook(t, kit) : t;
}
