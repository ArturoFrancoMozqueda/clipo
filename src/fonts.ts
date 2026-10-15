// Typefaces bundled with the app (self-hosted from Fontsource, so they work offline once used).
// Every family is SIL Open Font License 1.1 or Apache 2.0; see docs/video-editor/LICENSES.md.
// Fonts are registered with the FontFace API and downloaded only when a text uses them
// (or the font picker shows them), so a hundred fonts don't slow down opening the app.
import type { Project } from './types';
import { FONT_FILES } from './fontFiles';

export type FontCategory =
  | 'modernas' | 'condensadas' | 'serif' | 'caligrafia' | 'manuscritas' | 'retro'
  | 'tecnologia' | 'maquina' | 'divertidas' | 'comic' | 'decorativas' | 'elegantes';

export interface FontDef {
  id: string;
  /** Name shown to the user (also the CSS family name). */
  name: string;
  category: FontCategory;
  weight: number;
  /** What the font is good for, in plain words. */
  hint: string;
  /** SPDX id; OFL-1.1 when missing. */
  license?: 'Apache-2.0';
}

/** Tabs of the font picker, in order. "populares" is a curated list across categories. */
export const FONT_CATEGORIES: { id: FontCategory | 'populares'; name: string }[] = [
  { id: 'populares', name: 'Populares' },
  { id: 'modernas', name: 'Modernas' },
  { id: 'condensadas', name: 'Condensadas' },
  { id: 'serif', name: 'Serif' },
  { id: 'manuscritas', name: 'Manuscritas' },
  { id: 'caligrafia', name: 'Caligrafía' },
  { id: 'retro', name: 'Retro' },
  { id: 'comic', name: 'Cómic' },
  { id: 'divertidas', name: 'Redondeadas' },
  { id: 'elegantes', name: 'Elegantes' },
  { id: 'tecnologia', name: 'Tecnología' },
  { id: 'maquina', name: 'Máquina de escribir' },
  { id: 'decorativas', name: 'Decorativas y terror' },
];

/** The fonts Clipo always had, kept first so saved projects and habits stay the same. */
export const POPULAR_FONTS = [
  'montserrat', 'poppins', 'bebas', 'anton', 'oswald', 'bangers', 'luckiest',
  'righteous', 'marker', 'caveat', 'pacifico', 'lobster', 'dancing', 'playfair',
];

// Ids of the first 14 fonts are the ones saved in older projects; don't rename them.
export const FONTS: FontDef[] = [
  { id: 'montserrat', name: 'Montserrat', category: 'modernas', weight: 800, hint: 'Moderna y clara' },
  { id: 'poppins', name: 'Poppins', category: 'modernas', weight: 700, hint: 'Redonda y amigable' },
  { id: 'inter', name: 'Inter', category: 'modernas', weight: 800, hint: 'Muy legible' },
  { id: 'roboto', name: 'Roboto', category: 'modernas', weight: 700, hint: 'Neutra, de Android' },
  { id: 'open-sans', name: 'Open Sans', category: 'modernas', weight: 800, hint: 'Clara y abierta' },
  { id: 'lato', name: 'Lato', category: 'modernas', weight: 900, hint: 'Seria y cálida' },
  { id: 'dm-sans', name: 'DM Sans', category: 'modernas', weight: 800, hint: 'Limpia y actual' },
  { id: 'manrope', name: 'Manrope', category: 'modernas', weight: 800, hint: 'Moderna, de apps' },
  { id: 'rubik', name: 'Rubik', category: 'modernas', weight: 800, hint: 'Esquinas suaves' },
  { id: 'urbanist', name: 'Urbanist', category: 'modernas', weight: 800, hint: 'Geométrica fina' },
  { id: 'outfit', name: 'Outfit', category: 'modernas', weight: 800, hint: 'Geométrica, de marcas' },
  { id: 'jost', name: 'Jost', category: 'modernas', weight: 700, hint: 'Estilo clásico alemán' },
  { id: 'sora', name: 'Sora', category: 'modernas', weight: 800, hint: 'Tecnológica y ancha' },
  { id: 'lexend', name: 'Lexend', category: 'modernas', weight: 700, hint: 'Fácil de leer' },
  { id: 'atkinson-hyperlegible', name: 'Atkinson Hyperlegible', category: 'modernas', weight: 700, hint: 'Para leer sin esfuerzo' },
  { id: 'noto-sans', name: 'Noto Sans', category: 'modernas', weight: 800, hint: 'Muchos idiomas' },
  { id: 'bebas', name: 'Bebas Neue', category: 'condensadas', weight: 400, hint: 'Títulos altos' },
  { id: 'anton', name: 'Anton', category: 'condensadas', weight: 400, hint: 'Impacto, estilo viral' },
  { id: 'oswald', name: 'Oswald', category: 'condensadas', weight: 700, hint: 'Condensada, noticias' },
  { id: 'barlow-condensed', name: 'Barlow Condensed', category: 'condensadas', weight: 800, hint: 'Deportiva' },
  { id: 'roboto-condensed', name: 'Roboto Condensed', category: 'condensadas', weight: 800, hint: 'Estrecha y neutra' },
  { id: 'teko', name: 'Teko', category: 'condensadas', weight: 600, hint: 'Cuadrada y alta' },
  { id: 'fjalla-one', name: 'Fjalla One', category: 'condensadas', weight: 400, hint: 'Titulares de revista' },
  { id: 'saira-condensed', name: 'Saira Condensed', category: 'condensadas', weight: 800, hint: 'Carreras y deporte' },
  { id: 'playfair', name: 'Playfair Display', category: 'serif', weight: 700, hint: 'Clásica, con serifa' },
  { id: 'merriweather', name: 'Merriweather', category: 'serif', weight: 900, hint: 'Seria, de periódico' },
  { id: 'lora', name: 'Lora', category: 'serif', weight: 700, hint: 'Libro moderno' },
  { id: 'libre-baskerville', name: 'Libre Baskerville', category: 'serif', weight: 700, hint: 'Libro clásico' },
  { id: 'cormorant-garamond', name: 'Cormorant Garamond', category: 'serif', weight: 700, hint: 'Fina y literaria' },
  { id: 'dm-serif-display', name: 'DM Serif Display', category: 'serif', weight: 400, hint: 'Titulares con estilo' },
  { id: 'eb-garamond', name: 'EB Garamond', category: 'serif', weight: 700, hint: 'Antigua y elegante' },
  { id: 'bodoni-moda', name: 'Bodoni Moda', category: 'serif', weight: 700, hint: 'Moda y revistas' },
  { id: 'prata', name: 'Prata', category: 'serif', weight: 400, hint: 'Delicada' },
  { id: 'noto-serif', name: 'Noto Serif', category: 'serif', weight: 700, hint: 'Serifa, muchos idiomas' },
  { id: 'dancing', name: 'Dancing Script', category: 'caligrafia', weight: 700, hint: 'Elegante, invitaciones' },
  { id: 'great-vibes', name: 'Great Vibes', category: 'caligrafia', weight: 400, hint: 'Bodas' },
  { id: 'allura', name: 'Allura', category: 'caligrafia', weight: 400, hint: 'Firma fina' },
  { id: 'sacramento', name: 'Sacramento', category: 'caligrafia', weight: 400, hint: 'Trazo fino' },
  { id: 'parisienne', name: 'Parisienne', category: 'caligrafia', weight: 400, hint: 'Romántica' },
  { id: 'alex-brush', name: 'Alex Brush', category: 'caligrafia', weight: 400, hint: 'Pincel elegante' },
  { id: 'italianno', name: 'Italianno', category: 'caligrafia', weight: 400, hint: 'Caligrafía italiana' },
  { id: 'pinyon-script', name: 'Pinyon Script', category: 'caligrafia', weight: 400, hint: 'Formal, invitaciones' },
  { id: 'caveat', name: 'Caveat', category: 'manuscritas', weight: 700, hint: 'Escrita a mano' },
  { id: 'kalam', name: 'Kalam', category: 'manuscritas', weight: 700, hint: 'Apuntes a mano' },
  { id: 'patrick-hand', name: 'Patrick Hand', category: 'manuscritas', weight: 400, hint: 'Letra de cuaderno' },
  { id: 'shadows-into-light', name: 'Shadows Into Light', category: 'manuscritas', weight: 400, hint: 'Lápiz suelto' },
  { id: 'indie-flower', name: 'Indie Flower', category: 'manuscritas', weight: 400, hint: 'Alegre, a mano' },
  { id: 'marker', name: 'Permanent Marker', category: 'manuscritas', weight: 400, hint: 'Rotulador', license: 'Apache-2.0' },
  { id: 'satisfy', name: 'Satisfy', category: 'manuscritas', weight: 400, hint: 'Pincel suave', license: 'Apache-2.0' },
  { id: 'kaushan-script', name: 'Kaushan Script', category: 'manuscritas', weight: 400, hint: 'Brocha con energía' },
  { id: 'righteous', name: 'Righteous', category: 'retro', weight: 400, hint: 'Retro' },
  { id: 'lobster', name: 'Lobster', category: 'retro', weight: 400, hint: 'Cursiva llamativa' },
  { id: 'pacifico', name: 'Pacifico', category: 'retro', weight: 400, hint: 'Playera' },
  { id: 'abril-fatface', name: 'Abril Fatface', category: 'retro', weight: 400, hint: 'Cartel antiguo' },
  { id: 'alfa-slab-one', name: 'Alfa Slab One', category: 'retro', weight: 400, hint: 'Western, gruesa' },
  { id: 'limelight', name: 'Limelight', category: 'retro', weight: 400, hint: 'Cine de los años 20' },
  { id: 'bungee', name: 'Bungee', category: 'retro', weight: 400, hint: 'Letrero de calle' },
  { id: 'bowlby-one-sc', name: 'Bowlby One SC', category: 'retro', weight: 400, hint: 'Cartel de los 70' },
  { id: 'orbitron', name: 'Orbitron', category: 'tecnologia', weight: 800, hint: 'Futurista' },
  { id: 'rajdhani', name: 'Rajdhani', category: 'tecnologia', weight: 700, hint: 'Tecnológica' },
  { id: 'oxanium', name: 'Oxanium', category: 'tecnologia', weight: 700, hint: 'Videojuegos' },
  { id: 'audiowide', name: 'Audiowide', category: 'tecnologia', weight: 400, hint: 'Ciencia ficción' },
  { id: 'exo-2', name: 'Exo 2', category: 'tecnologia', weight: 800, hint: 'Deportes electrónicos' },
  { id: 'chakra-petch', name: 'Chakra Petch', category: 'tecnologia', weight: 700, hint: 'Pantallas y datos' },
  { id: 'space-grotesk', name: 'Space Grotesk', category: 'tecnologia', weight: 700, hint: 'Moderna, startups' },
  { id: 'space-mono', name: 'Space Mono', category: 'maquina', weight: 700, hint: 'Código y retro' },
  { id: 'jetbrains-mono', name: 'JetBrains Mono', category: 'maquina', weight: 800, hint: 'Código' },
  { id: 'ibm-plex-mono', name: 'IBM Plex Mono', category: 'maquina', weight: 700, hint: 'Terminal' },
  { id: 'roboto-mono', name: 'Roboto Mono', category: 'maquina', weight: 700, hint: 'Monoespaciada neutra' },
  { id: 'special-elite', name: 'Special Elite', category: 'maquina', weight: 400, hint: 'Máquina de escribir', license: 'Apache-2.0' },
  { id: 'fredoka', name: 'Fredoka', category: 'divertidas', weight: 700, hint: 'Redonda e infantil' },
  { id: 'baloo-2', name: 'Baloo 2', category: 'divertidas', weight: 800, hint: 'Gordita y alegre' },
  { id: 'comfortaa', name: 'Comfortaa', category: 'divertidas', weight: 700, hint: 'Redonda y fina' },
  { id: 'nunito', name: 'Nunito', category: 'divertidas', weight: 900, hint: 'Redonda y legible' },
  { id: 'varela-round', name: 'Varela Round', category: 'divertidas', weight: 400, hint: 'Suave' },
  { id: 'bubblegum-sans', name: 'Bubblegum Sans', category: 'divertidas', weight: 400, hint: 'Chicle' },
  { id: 'sniglet', name: 'Sniglet', category: 'divertidas', weight: 800, hint: 'Burbuja' },
  { id: 'bangers', name: 'Bangers', category: 'comic', weight: 400, hint: 'Cómic' },
  { id: 'luckiest', name: 'Luckiest Guy', category: 'comic', weight: 400, hint: 'Divertida y gruesa', license: 'Apache-2.0' },
  { id: 'titan-one', name: 'Titan One', category: 'comic', weight: 400, hint: 'Muy gruesa' },
  { id: 'lilita-one', name: 'Lilita One', category: 'comic', weight: 400, hint: 'Juegos y dibujos' },
  { id: 'chewy', name: 'Chewy', category: 'comic', weight: 400, hint: 'Caricatura', license: 'Apache-2.0' },
  { id: 'comic-neue', name: 'Comic Neue', category: 'comic', weight: 700, hint: 'Cómic clásica' },
  { id: 'boogaloo', name: 'Boogaloo', category: 'comic', weight: 400, hint: 'Fiesta' },
  { id: 'monoton', name: 'Monoton', category: 'decorativas', weight: 400, hint: 'Neón de líneas' },
  { id: 'press-start-2p', name: 'Press Start 2P', category: 'decorativas', weight: 400, hint: 'Videojuego de 8 bits' },
  { id: 'black-ops-one', name: 'Black Ops One', category: 'decorativas', weight: 400, hint: 'Militar' },
  { id: 'faster-one', name: 'Faster One', category: 'decorativas', weight: 400, hint: 'Velocidad' },
  { id: 'cinzel-decorative', name: 'Cinzel Decorative', category: 'decorativas', weight: 700, hint: 'Medieval' },
  { id: 'creepster', name: 'Creepster', category: 'decorativas', weight: 400, hint: 'Terror' },
  { id: 'nosifer', name: 'Nosifer', category: 'decorativas', weight: 400, hint: 'Terror que gotea' },
  { id: 'eater', name: 'Eater', category: 'decorativas', weight: 400, hint: 'Halloween' },
  { id: 'metal-mania', name: 'Metal Mania', category: 'decorativas', weight: 400, hint: 'Rock y metal' },
  { id: 'cinzel', name: 'Cinzel', category: 'elegantes', weight: 700, hint: 'Lujo, estilo romano' },
  { id: 'marcellus', name: 'Marcellus', category: 'elegantes', weight: 400, hint: 'Clásica y sobria' },
  { id: 'italiana', name: 'Italiana', category: 'elegantes', weight: 400, hint: 'Moda fina' },
  { id: 'forum', name: 'Forum', category: 'elegantes', weight: 400, hint: 'Antigua y noble' },
  { id: 'tenor-sans', name: 'Tenor Sans', category: 'elegantes', weight: 400, hint: 'Boutique' },
  { id: 'belleza', name: 'Belleza', category: 'elegantes', weight: 400, hint: 'Belleza y cosmética' },
];

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';

/** CSS font-family list: the font, then a similar system font while it downloads. */
export const fontFamily = (f: FontDef) =>
  `"${f.name}", ${f.category === 'serif' || f.category === 'elegantes' ? SERIF : f.category === 'maquina' ? MONO : SANS}`;

const byId = new Map(FONTS.map((f) => [f.id, f]));
export const getFont = (id: string | undefined) => (id ? byId.get(id) : undefined);

/** Fonts of a picker tab. */
export function fontsIn(cat: FontCategory | 'populares') {
  return cat === 'populares' ? POPULAR_FONTS.map((id) => byId.get(id)!) : FONTS.filter((f) => f.category === cat);
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const CAT_NAME = new Map(FONT_CATEGORIES.map((c) => [c.id, c.name]));

/** Search by name, use ("bodas", "terror") or category, ignoring accents and case. */
export function searchFonts(q: string) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const has = (s: string) => words.every((w) => fold(s).includes(w));
  // Name or use first ("terror" → Creepster), then the rest of the category.
  const direct = FONTS.filter((f) => has(`${f.name} ${f.hint}`));
  const byCategory = FONTS.filter((f) => !direct.includes(f) && has(`${f.name} ${f.hint} ${CAT_NAME.get(f.category) ?? ''}`));
  return [...direct, ...byCategory];
}

/** CSS font shorthand for drawing a text item with a bundled font. */
export const fontCss = (f: FontDef, px: number, italic = false) => `${italic ? 'italic ' : ''}${f.weight} ${px}px ${fontFamily(f)}`;

// Same ranges Fontsource and Google Fonts use, so each file covers its own characters.
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

const loading = new Map<string, Promise<void>>();

/**
 * Register a font and download its main file. Safe to call every frame: after the first call it
 * only returns the same promise. The latin-ext file downloads by itself if a text needs it.
 */
export function ensureFont(id: string | undefined): Promise<void> {
  const f = getFont(id);
  const files = f && FONT_FILES[f.id];
  if (!f || !files || typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve();
  let p = loading.get(f.id);
  if (!p) {
    const faces = files.map(
      (url, i) => new FontFace(f.name, `url(${JSON.stringify(url)}) format("woff2")`, { weight: String(f.weight), unicodeRange: i ? LATIN_EXT : LATIN, display: 'swap' }),
    );
    faces.forEach((ff) => document.fonts.add(ff));
    p = faces[0]!.load().then(
      () => undefined,
      () => {
        // Offline the first time: forget it so the next use tries again.
        faces.forEach((ff) => document.fonts.delete(ff));
        loading.delete(f.id);
      },
    );
    loading.set(f.id, p);
  }
  return p;
}

/**
 * Make sure every bundled font used by the project is downloaded before drawing it, so the
 * export never falls back to the system font for its first frames.
 */
export async function loadProjectFonts(p: Project) {
  const ids = new Set(p.texts.map((t) => t.font).filter(Boolean) as string[]);
  await Promise.all(
    [...ids].map(async (id) => {
      const f = getFont(id);
      if (!f) return;
      await ensureFont(id);
      // Also fetch latin-ext when a text has characters from it.
      const sample = p.texts.filter((t) => t.font === id).map((t) => t.text).join(' ');
      await document.fonts.load(fontCss(f, 48), sample || 'A').catch(() => []);
    }),
  );
}

/** Start loading a font as soon as the user picks it, so the preview shows it right away. */
export function warmFont(id: string) {
  void ensureFont(id);
}
