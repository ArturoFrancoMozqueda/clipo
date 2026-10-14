// Typefaces bundled with the app (self-hosted via Fontsource, so they work offline).
// All are SIL Open Font License 1.1 or Apache 2.0; see RECURSOS.md.
import '@fontsource/bebas-neue/400.css';
import '@fontsource/anton/400.css';
import '@fontsource/montserrat/800.css';
import '@fontsource/poppins/700.css';
import '@fontsource/bangers/400.css';
import '@fontsource/pacifico/400.css';
import '@fontsource/lobster/400.css';
import '@fontsource/permanent-marker/400.css';
import '@fontsource/oswald/700.css';
import '@fontsource/caveat/700.css';
import '@fontsource/righteous/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/luckiest-guy/400.css';
import '@fontsource/dancing-script/700.css';
import type { Project } from './types';

export interface FontDef {
  id: string;
  /** Name shown to the user. */
  name: string;
  family: string;
  weight: number;
  /** What the font is good for, in plain words. */
  hint: string;
}

const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

export const FONTS: FontDef[] = [
  { id: 'montserrat', name: 'Montserrat', family: `"Montserrat", ${SYSTEM}`, weight: 800, hint: 'Moderna y clara' },
  { id: 'poppins', name: 'Poppins', family: `"Poppins", ${SYSTEM}`, weight: 700, hint: 'Redonda y amigable' },
  { id: 'bebas', name: 'Bebas Neue', family: `"Bebas Neue", ${SYSTEM}`, weight: 400, hint: 'Títulos altos' },
  { id: 'anton', name: 'Anton', family: `"Anton", ${SYSTEM}`, weight: 400, hint: 'Impacto, estilo viral' },
  { id: 'oswald', name: 'Oswald', family: `"Oswald", ${SYSTEM}`, weight: 700, hint: 'Condensada, noticias' },
  { id: 'bangers', name: 'Bangers', family: `"Bangers", ${SYSTEM}`, weight: 400, hint: 'Cómic' },
  { id: 'luckiest', name: 'Luckiest Guy', family: `"Luckiest Guy", ${SYSTEM}`, weight: 400, hint: 'Divertida y gruesa' },
  { id: 'righteous', name: 'Righteous', family: `"Righteous", ${SYSTEM}`, weight: 400, hint: 'Retro' },
  { id: 'marker', name: 'Permanent Marker', family: `"Permanent Marker", ${SYSTEM}`, weight: 400, hint: 'Rotulador' },
  { id: 'caveat', name: 'Caveat', family: `"Caveat", ${SYSTEM}`, weight: 700, hint: 'Escrita a mano' },
  { id: 'pacifico', name: 'Pacifico', family: `"Pacifico", ${SYSTEM}`, weight: 400, hint: 'Playera' },
  { id: 'lobster', name: 'Lobster', family: `"Lobster", ${SYSTEM}`, weight: 400, hint: 'Cursiva llamativa' },
  { id: 'dancing', name: 'Dancing Script', family: `"Dancing Script", ${SYSTEM}`, weight: 700, hint: 'Elegante, invitaciones' },
  { id: 'playfair', name: 'Playfair Display', family: `"Playfair Display", Georgia, serif`, weight: 700, hint: 'Clásica, con serifa' },
];

export const getFont = (id: string | undefined) => (id ? FONTS.find((f) => f.id === id) : undefined);

/** CSS font shorthand for drawing a text item with a bundled font. */
export const fontCss = (f: FontDef, px: number, italic = false) => `${italic ? 'italic ' : ''}${f.weight} ${px}px ${f.family}`;

/**
 * Make sure every bundled font used by the project is downloaded before drawing it, so the
 * export never falls back to the system font for its first frames.
 */
export async function loadProjectFonts(p: Project) {
  const ids = new Set(p.texts.map((t) => t.font).filter(Boolean) as string[]);
  await Promise.all(
    [...ids].map((id) => {
      const f = getFont(id);
      return f ? document.fonts.load(fontCss(f, 48)).catch(() => []) : null;
    }),
  );
}

/** Start loading a font as soon as the user picks it, so the preview shows it right away. */
export function warmFont(id: string) {
  const f = getFont(id);
  if (f) document.fonts.load(fontCss(f, 48)).catch(() => {});
}
