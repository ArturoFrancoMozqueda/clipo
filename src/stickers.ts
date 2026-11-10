// Bundled sticker art: Microsoft Fluent Emoji (MIT), downloaded by scripts/fetch-fluent-emoji.mjs,
// plus Clipo's own arrows, bubbles, badges and buttons (scripts/make-clipo-stickers.mjs).
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

// Clipo's own groups come first: they are the ones for pointing, selling and asking for follows.
const FIRST = ['Señalar', 'Redes', 'Ofertas', 'Globos'];
STICKER_GROUPS.sort((a, b) => (FIRST.indexOf(a.name) + 1 || 99) - (FIRST.indexOf(b.name) + 1 || 99));

/** Stickers matching a search (name in Spanish, glyph or group); the catalog names of emoji are in English, so the group counts. */
export function searchStickers(q: string): StickerArt[] {
  const n = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = n(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return STICKER_ART.filter((s) => {
    const hay = n(`${s.name} ${s.group} ${s.glyph} ${EXTRA_WORDS[s.glyph] ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
}

/** Spanish words for popular emoji so "fuego" or "corazón" find them. */
const EXTRA_WORDS: Record<string, string> = {
  '🔥': 'fuego caliente', '❤️': 'corazon amor', '😂': 'risa jaja gracioso', '😍': 'enamorado amor', '👍': 'bien ok me gusta', '👎': 'mal no',
  '👏': 'aplausos bravo', '🙏': 'gracias por favor', '💪': 'fuerza gym', '🎉': 'fiesta celebrar', '🎂': 'pastel cumpleanos', '⭐': 'estrella',
  '✅': 'listo correcto palomita', '❌': 'error equis no', '💰': 'dinero plata', '💎': 'diamante', '🚀': 'cohete lanzamiento', '🎬': 'cine video',
  '📸': 'foto camara', '📱': 'celular telefono', '🛒': 'compras carrito', '🛍️': 'compras bolsas tienda', '📍': 'ubicacion lugar mapa', '💡': 'idea foco',
  '🎶': 'musica notas', '🎧': 'musica audifonos', '🎤': 'microfono cantar', '👀': 'ojos mirar', '😭': 'llorar', '🤯': 'sorpresa mente', '😱': 'susto miedo',
  '🥳': 'fiesta', '😎': 'lentes cool', '☀️': 'sol', '🌙': 'luna noche', '🌈': 'arcoiris', '🐶': 'perro', '🐱': 'gato', '🍕': 'pizza comida', '☕': 'cafe',
  '🏆': 'premio trofeo ganar', '👑': 'corona reina rey', '✈️': 'avion viaje', '🏠': 'casa hogar', '⏰': 'alarma reloj hora', '📣': 'anuncio megafono',
};

// Lookup tolerant of the optional emoji variation selector (U+FE0F).
const norm = (glyph: string) => glyph.replace(/️/g, '');
const byGlyph = new Map(STICKER_ART.map((s) => [norm(s.glyph), s]));

/** Fluent emoji files sit in stickers/fluent; Clipo's own art is listed as `clipo/name.svg`. */
export const stickerUrl = (s: StickerArt) => (s.file.includes('/') ? `./stickers/${s.file}` : `./stickers/fluent/${s.file}`);

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
