// Bundled sticker art: Microsoft Fluent Emoji (MIT), downloaded by scripts/fetch-fluent-emoji.mjs.
// Using pictures instead of the system emoji font makes stickers look the same on every phone and PC.
import catalog from './stickerCatalog.json';
import type { Project } from './types';

export interface StickerArt {
  glyph: string;
  file: string;
  name: string;
  group: string;
}

export const STICKER_ART = catalog as StickerArt[];

/** Sticker art grouped for the picker, in catalog order. */
export const STICKER_GROUPS: { name: string; list: StickerArt[] }[] = [];
for (const s of STICKER_ART) {
  let g = STICKER_GROUPS.find((x) => x.name === s.group);
  if (!g) STICKER_GROUPS.push((g = { name: s.group, list: [] }));
  g.list.push(s);
}

// Lookup tolerant of the optional emoji variation selector (U+FE0F).
const norm = (glyph: string) => glyph.replace(/️/g, '');
const byGlyph = new Map(STICKER_ART.map((s) => [norm(s.glyph), s]));

export const stickerUrl = (s: StickerArt) => `./stickers/fluent/${s.file}`;

const images = new Map<string, HTMLImageElement>();

/** The bundled picture for an emoji, starting its download on first use. Undefined if we don't ship one. */
export function emojiImage(glyph: string | undefined): HTMLImageElement | undefined {
  if (!glyph) return undefined;
  const art = byGlyph.get(norm(glyph));
  if (!art) return undefined;
  let img = images.get(art.file);
  if (!img) {
    img = new Image();
    img.src = stickerUrl(art);
    images.set(art.file, img);
  }
  return img;
}

/** Wait until every emoji sticker in the project has its picture, so exports never miss one. */
export async function preloadEmojis(p: Project) {
  const imgs = (p.stickers ?? []).map((s) => emojiImage(s.emoji)).filter((i): i is HTMLImageElement => !!i);
  await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
}
