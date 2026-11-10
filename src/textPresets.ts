// One-tap text looks: a font, a color style, a size and an animation chosen together,
// so beginners get a finished look without tuning four settings. All combinations are original.
import type { Karaoke, TextAnim, TextItem } from './types';

export type PresetCategory = 'titulos' | 'subtitulos' | 'redes' | 'negocio' | 'estetica' | 'diversion';

export interface TextPreset {
  id: string;
  name: string;
  /** What it is for, in plain words. */
  use: string;
  font: string;
  styleId: string;
  size: number;
  anim: TextAnim;
  /** Where it usually goes (fraction of the frame height). */
  y?: number;
  /** Where it usually goes sideways (fraction of the frame width); centered when missing. */
  x?: number;
  /** In fashion right now: listed first, with a badge. */
  trend?: true;
  category: PresetCategory;
  /** Highlights each word in turn while the text is on screen. */
  karaoke?: Karaoke;
  /** Words written for the user when the text is still the placeholder (or another preset's words). */
  sample?: string;
}

export const PRESET_CATEGORIES: { id: PresetCategory; name: string }[] = [
  { id: 'titulos', name: 'Títulos' },
  { id: 'subtitulos', name: 'Subtítulos' },
  { id: 'redes', name: 'Redes' },
  { id: 'negocio', name: 'Negocio' },
  { id: 'estetica', name: 'Estética' },
  { id: 'diversion', name: 'Diversión' },
];

const A = (i: TextAnim['in'], o: TextAnim['out'] = 'fade', loop: TextAnim['loop'] = 'none'): TextAnim => ({ in: i, out: o, loop });

// Ids are saved nowhere (a preset only writes its settings into the text), but favorites and
// recents remember them: don't rename.
export const TEXT_PRESETS: TextPreset[] = [
  { id: 'gancho', name: 'Gancho', use: 'Los primeros 3 segundos', font: 'archivo-black', styleId: 'sombra3d', size: 0.1, anim: A('slam'), y: 0.35, trend: true, category: 'titulos', sample: 'Nadie te cuenta\nesto…' },
  { id: 'karaoke', name: 'Karaoke', use: 'Resalta cada palabra', font: 'montserrat', styleId: 'clasico', size: 0.075, anim: A('pop'), y: 0.7, trend: true, category: 'subtitulos', karaoke: { mode: 'color', color: '#ffe500' } },
  { id: 'karaoke-caja', name: 'Caja viva', use: 'Palabra en una caja', font: 'poppins', styleId: 'clasico', size: 0.07, anim: A('pop'), y: 0.7, trend: true, category: 'subtitulos', karaoke: { mode: 'box', color: '#7c5cff' } },
  { id: 'palabra', name: 'Podcast', use: 'Palabra a palabra', font: 'montserrat', styleId: 'verde', size: 0.075, anim: A('words'), y: 0.72, trend: true, category: 'subtitulos' },
  { id: 'meme', name: 'Meme', use: 'Texto arriba o abajo', font: 'anton', styleId: 'meme', size: 0.1, anim: A('none', 'none'), y: 0.12, trend: true, category: 'diversion', sample: 'Yo a las 3 am' },
  { id: 'editorial', name: 'Editorial', use: 'Vlogs y estética', font: 'instrument-serif', styleId: 'elegante', size: 0.11, anim: A('blurIn', 'blurOut'), trend: true, category: 'estetica' },
  { id: 'minimal', name: 'minimal', use: 'Minúsculas y calma', font: 'space-grotesk', styleId: 'minimal', size: 0.06, anim: A('fade'), trend: true, category: 'estetica', sample: 'un día cualquiera' },
  { id: 'sigueme', name: 'Sígueme', use: 'Cierre del video', font: 'poppins', styleId: 'cta', size: 0.065, anim: A('pop', 'pop', 'pulse'), y: 0.82, trend: true, category: 'redes', sample: 'Sígueme para más' },
  { id: 'y2k', name: 'Y2K', use: 'Estética 2000', font: 'rubik-mono-one', styleId: 'cromo', size: 0.085, anim: A('blurIn', 'fade', 'float'), trend: true, category: 'estetica' },
  { id: 'glitch', name: 'Glitch', use: 'Gaming y tecnología', font: 'unbounded', styleId: 'glitch', size: 0.08, anim: A('slam', 'fade', 'shake'), trend: true, category: 'diversion' },
  { id: 'atardecer', name: 'Atardecer', use: 'Viajes y música', font: 'shrikhand', styleId: 'degradado', size: 0.1, anim: A('drop', 'fade', 'wiggle'), trend: true, category: 'estetica' },
  { id: 'burbuja', name: 'Burbuja', use: 'Divertido y tierno', font: 'bagel-fat-one', styleId: 'burbuja', size: 0.1, anim: A('pop', 'pop', 'float'), trend: true, category: 'diversion' },
  { id: 'contorno', name: 'Contorno', use: 'Minimalista', font: 'big-shoulders-display', styleId: 'contorno', size: 0.13, anim: A('slideLeft', 'up'), y: 0.4, trend: true, category: 'titulos' },
  { id: 'pop', name: 'Sombra pop', use: 'Títulos con color', font: 'archivo-black', styleId: 'popRosa', size: 0.095, anim: A('slam'), y: 0.3, trend: true, category: 'titulos' },

  // Titles
  { id: 'viral', name: 'Viral', use: 'Frases que enganchan', font: 'anton', styleId: 'clasico', size: 0.1, anim: A('pop'), category: 'titulos' },
  { id: 'titular', name: 'Titular', use: 'Inicio de video', font: 'bebas', styleId: 'titulo', size: 0.14, anim: A('slideUp'), y: 0.4, category: 'titulos' },
  { id: 'top', name: 'Top 5', use: 'Listas y rankings', font: 'anton', styleId: 'oro', size: 0.15, anim: A('slam'), y: 0.3, category: 'titulos', sample: 'TOP 5' },
  { id: 'numero', name: 'Número', use: 'Paso o puesto', font: 'archivo-black', styleId: 'precio', size: 0.11, anim: A('pop', 'pop'), x: 0.16, y: 0.14, category: 'titulos', sample: '1' },
  { id: 'parte', name: 'Parte 1', use: 'Videos en partes', font: 'oswald', styleId: 'etiqueta', size: 0.06, anim: A('slideLeft'), x: 0.22, y: 0.1, category: 'titulos', sample: 'Parte 1' },
  { id: 'cuenta', name: '3, 2, 1', use: 'Cuenta regresiva', font: 'bebas', styleId: 'titulo', size: 0.2, anim: A('slam', 'pop'), y: 0.45, category: 'titulos', sample: '3' },
  { id: 'fuego', name: 'Fuego', use: 'Retos y deporte', font: 'anton', styleId: 'fuego', size: 0.11, anim: A('slam', 'fade', 'shake'), category: 'titulos' },
  { id: 'cine', name: 'Cine', use: 'Título de película', font: 'cinzel', styleId: 'titulo', size: 0.085, anim: A('blurIn', 'blurOut'), y: 0.5, category: 'titulos' },

  // Captions typed by hand
  { id: 'subtitulo', name: 'Subtítulo', use: 'Lo que dices, abajo', font: 'montserrat', styleId: 'amarillo', size: 0.065, anim: A('fade'), y: 0.8, category: 'subtitulos' },
  { id: 'sub-fondo', name: 'Con fondo', use: 'Se lee sobre todo', font: 'poppins', styleId: 'caja', size: 0.058, anim: A('fade'), y: 0.8, category: 'subtitulos' },
  { id: 'karaoke-grande', name: 'Crece', use: 'La palabra crece', font: 'anton', styleId: 'clasico', size: 0.08, anim: A('pop'), y: 0.7, category: 'subtitulos', karaoke: { mode: 'scale', color: '#2bff6b' } },
  { id: 'traduccion', name: 'Traducción', use: 'Segunda línea', font: 'atkinson-hyperlegible', styleId: 'minimal', size: 0.045, anim: A('fade'), y: 0.88, category: 'subtitulos' },

  // Social calls to action
  { id: 'link-bio', name: 'Link en bio', use: 'Lleva a tu enlace', font: 'poppins', styleId: 'etiqueta', size: 0.06, anim: A('slideUp', 'fade', 'bounce'), y: 0.84, category: 'redes', sample: 'Link en mi bio 👆' },
  { id: 'comenta', name: 'Comenta', use: 'Pide comentarios', font: 'montserrat', styleId: 'popRosa', size: 0.07, anim: A('pop', 'pop', 'wiggle'), y: 0.8, category: 'redes', sample: '¿Tú qué opinas? 👇' },
  { id: 'guarda', name: 'Guárdalo', use: 'Para que lo guarden', font: 'poppins', styleId: 'ubicacion', size: 0.055, anim: A('slideUp'), y: 0.86, category: 'redes', sample: 'Guárdalo para después 📌' },
  { id: 'espera', name: 'Espera…', use: 'Que vean hasta el final', font: 'archivo-black', styleId: 'alerta', size: 0.08, anim: A('slam', 'fade', 'pulse'), y: 0.18, category: 'redes', sample: 'Espera al final' },
  { id: 'usuario', name: '@usuario', use: 'Tu nombre de cuenta', font: 'space-grotesk', styleId: 'ubicacion', size: 0.045, anim: A('fade'), y: 0.93, category: 'redes', sample: '@tucuenta' },
  { id: 'ubicacion', name: 'Ubicación', use: 'Dónde estás', font: 'poppins', styleId: 'ubicacion', size: 0.05, anim: A('slideLeft'), x: 0.3, y: 0.1, category: 'redes', sample: '📍 Ciudad de México' },

  // Business
  { id: 'oferta', name: 'Oferta', use: 'Precios y promos', font: 'oswald', styleId: 'rojo', size: 0.085, anim: A('pop', 'pop', 'pulse'), category: 'negocio', sample: '-20% hoy' },
  { id: 'precio', name: 'Precio', use: 'Etiqueta de precio', font: 'archivo-black', styleId: 'precio', size: 0.09, anim: A('pop', 'pop'), x: 0.72, y: 0.24, category: 'negocio', sample: '$199' },
  { id: 'noticia', name: 'Noticia', use: 'Datos y avisos', font: 'oswald', styleId: 'caja', size: 0.065, anim: A('slideUp'), y: 0.82, category: 'negocio' },
  { id: 'ultima-hora', name: 'Última hora', use: 'Franja de noticias', font: 'oswald', styleId: 'noticia', size: 0.06, anim: A('slideLeft'), y: 0.84, category: 'negocio', sample: 'Última hora' },
  { id: 'nuevo', name: 'Nuevo', use: 'Lanzamientos', font: 'bebas', styleId: 'cta', size: 0.08, anim: A('pop', 'pop', 'pulse'), x: 0.24, y: 0.14, category: 'negocio', sample: 'NUEVO' },
  { id: 'horario', name: 'Horario', use: 'Fecha, hora, dirección', font: 'poppins', styleId: 'etiqueta', size: 0.05, anim: A('slideUp'), y: 0.85, category: 'negocio', sample: 'Lun a sáb · 9 a 18 h' },
  { id: 'opinion', name: 'Opinión', use: 'Lo que dicen clientes', font: 'playfair', styleId: 'elegante', size: 0.07, anim: A('fade'), category: 'negocio', sample: '“Me encantó,\nvolveré seguro”' },

  // Aesthetic
  { id: 'elegante', name: 'Elegante', use: 'Bodas, eventos', font: 'dancing', styleId: 'elegante', size: 0.1, anim: A('fade'), category: 'estetica' },
  { id: 'cita', name: 'Cita', use: 'Frases y reflexiones', font: 'fraunces', styleId: 'elegante', size: 0.075, anim: A('blurIn', 'blurOut'), y: 0.45, category: 'estetica', sample: '“Paso a paso\ntambién se llega lejos”' },
  { id: 'nota', name: 'Nota a mano', use: 'Toque personal', font: 'caveat', styleId: 'etiqueta', size: 0.08, anim: A('typewriter'), category: 'estetica' },
  { id: 'post-it', name: 'Papelito', use: 'Recordatorios', font: 'caveat', styleId: 'nota', size: 0.085, anim: A('drop', 'fade', 'wiggle'), category: 'estetica', sample: 'no olvidar ✏️' },
  { id: 'neon', name: 'Neón', use: 'Noche y música', font: 'righteous', styleId: 'neon', size: 0.095, anim: A('fade', 'fade', 'pulse'), category: 'estetica' },
  { id: 'neon-azul', name: 'Neón azul', use: 'Ciudad de noche', font: 'audiowide', styleId: 'neonAzul', size: 0.08, anim: A('blurIn', 'fade', 'pulse'), category: 'estetica' },
  { id: 'clasica', name: 'Revista', use: 'Moda y estilo', font: 'playfair', styleId: 'caja', size: 0.08, anim: A('fade'), category: 'estetica' },
  { id: 'verano', name: 'Verano', use: 'Viajes y playa', font: 'pacifico', styleId: 'clasico', size: 0.095, anim: A('pop', 'fade', 'bounce'), category: 'estetica' },
  { id: 'pastel', name: 'Pastel', use: 'Tierno y suave', font: 'comfortaa', styleId: 'pastel', size: 0.06, anim: A('pop', 'fade', 'float'), category: 'estetica' },
  { id: 'fecha', name: 'Fecha', use: 'Día y lugar, tipo diario', font: 'space-grotesk', styleId: 'minimal', size: 0.042, anim: A('typewriter'), x: 0.28, y: 0.92, category: 'estetica', sample: '12 · 08 · 2026' },

  // Fun
  { id: 'comic', name: 'Cómic', use: 'Humor y reacciones', font: 'bangers', styleId: 'amarillo', size: 0.11, anim: A('pop', 'pop', 'bounce'), category: 'diversion' },
  { id: 'marcador', name: 'Marcador', use: 'Tutoriales', font: 'marker', styleId: 'etiqueta', size: 0.075, anim: A('typewriter', 'none'), category: 'diversion' },
  { id: 'retro', name: 'Retro', use: 'Años 70', font: 'shrikhand', styleId: 'retro70', size: 0.1, anim: A('drop', 'fade', 'wiggle'), category: 'diversion' },
  { id: 'hielo', name: 'Hielo', use: 'Invierno y frío', font: 'anton', styleId: 'hielo', size: 0.11, anim: A('blurIn'), category: 'diversion' },
  { id: 'pov', name: 'POV', use: 'Ponte en mi lugar', font: 'montserrat', styleId: 'clasico', size: 0.06, anim: A('fade'), y: 0.16, category: 'diversion', sample: 'POV: es lunes otra vez' },
  { id: 'reaccion', name: '¡¿Qué?!', use: 'Sorpresa y susto', font: 'bangers', styleId: 'alerta', size: 0.16, anim: A('slam', 'pop', 'shake'), category: 'diversion', sample: '¡¿QUÉ?!' },
];

/** The text every new text starts with (ops.addText). */
export const PLACEHOLDER_TEXT = 'Tu texto aquí';
const SAMPLES = new Set(TEXT_PRESETS.map((p) => p.sample).filter(Boolean));

/** Put a preset on a text. The user's own words are never replaced, only the placeholder ones. */
export function applyPreset(t: TextItem, pr: TextPreset) {
  t.font = pr.font;
  t.styleId = pr.styleId;
  t.size = pr.size;
  t.anim = { ...pr.anim };
  delete t.fill;
  if (pr.karaoke) t.karaoke = { ...pr.karaoke };
  else if (!t.caption) delete t.karaoke;
  if (pr.y !== undefined || pr.x !== undefined) {
    t.x = pr.x ?? 0.5;
    t.y = pr.y ?? t.y;
  }
  const words = t.text.trim();
  if (pr.sample && (!words || words === PLACEHOLDER_TEXT || SAMPLES.has(words))) t.text = pr.sample;
}

/** Presets matching what the user typed in the search box (name, use or category). */
export function searchPresets(q: string) {
  const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = n(q).split(/\s+/).filter(Boolean);
  if (!words.length) return TEXT_PRESETS;
  return TEXT_PRESETS.filter((p) => {
    const hay = n(`${p.name} ${p.use} ${PRESET_CATEGORIES.find((c) => c.id === p.category)?.name ?? ''} ${p.sample ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
}
