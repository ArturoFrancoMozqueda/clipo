// One-tap text looks: a font, a color style, a size and an animation chosen together,
// so beginners get a finished look without tuning four settings. All combinations are original.
import type { TextAnim } from './types';

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
  /** In fashion right now: listed first, with a badge. */
  trend?: true;
}

export const TEXT_PRESETS: TextPreset[] = [
  { id: 'gancho', name: 'Gancho', use: 'Los primeros 3 segundos', font: 'archivo-black', styleId: 'sombra3d', size: 0.1, anim: { in: 'slam', out: 'fade', loop: 'none' }, y: 0.35, trend: true },
  { id: 'palabra', name: 'Podcast', use: 'Palabra a palabra', font: 'montserrat', styleId: 'verde', size: 0.075, anim: { in: 'words', out: 'fade', loop: 'none' }, y: 0.72, trend: true },
  { id: 'editorial', name: 'Editorial', use: 'Vlogs y estética', font: 'instrument-serif', styleId: 'elegante', size: 0.11, anim: { in: 'blurIn', out: 'blurOut', loop: 'none' }, trend: true },
  { id: 'y2k', name: 'Y2K', use: 'Estética 2000', font: 'rubik-mono-one', styleId: 'cromo', size: 0.085, anim: { in: 'blurIn', out: 'fade', loop: 'float' }, trend: true },
  { id: 'glitch', name: 'Glitch', use: 'Gaming y tecnología', font: 'unbounded', styleId: 'glitch', size: 0.08, anim: { in: 'slam', out: 'fade', loop: 'shake' }, trend: true },
  { id: 'atardecer', name: 'Atardecer', use: 'Viajes y música', font: 'shrikhand', styleId: 'degradado', size: 0.1, anim: { in: 'drop', out: 'fade', loop: 'wiggle' }, trend: true },
  { id: 'burbuja', name: 'Burbuja', use: 'Divertido y tierno', font: 'bagel-fat-one', styleId: 'burbuja', size: 0.1, anim: { in: 'pop', out: 'pop', loop: 'float' }, trend: true },
  { id: 'contorno', name: 'Contorno', use: 'Minimalista', font: 'big-shoulders-display', styleId: 'contorno', size: 0.13, anim: { in: 'slideLeft', out: 'up', loop: 'none' }, y: 0.4, trend: true },
  { id: 'viral', name: 'Viral', use: 'Frases que enganchan', font: 'anton', styleId: 'clasico', size: 0.1, anim: { in: 'pop', out: 'fade', loop: 'none' } },
  { id: 'subtitulo', name: 'Subtítulo', use: 'Lo que dices, abajo', font: 'montserrat', styleId: 'amarillo', size: 0.065, anim: { in: 'fade', out: 'fade', loop: 'none' }, y: 0.8 },
  { id: 'titular', name: 'Titular', use: 'Inicio de video', font: 'bebas', styleId: 'titulo', size: 0.14, anim: { in: 'slideUp', out: 'fade', loop: 'none' }, y: 0.4 },
  { id: 'oferta', name: 'Oferta', use: 'Precios y promos', font: 'oswald', styleId: 'rojo', size: 0.085, anim: { in: 'pop', out: 'pop', loop: 'pulse' } },
  { id: 'comic', name: 'Cómic', use: 'Humor y reacciones', font: 'bangers', styleId: 'amarillo', size: 0.11, anim: { in: 'pop', out: 'pop', loop: 'bounce' } },
  { id: 'nota', name: 'Nota a mano', use: 'Toque personal', font: 'caveat', styleId: 'etiqueta', size: 0.08, anim: { in: 'typewriter', out: 'fade', loop: 'none' } },
  { id: 'elegante', name: 'Elegante', use: 'Bodas, eventos', font: 'dancing', styleId: 'elegante', size: 0.1, anim: { in: 'fade', out: 'fade', loop: 'none' } },
  { id: 'neon', name: 'Neón', use: 'Noche y música', font: 'righteous', styleId: 'neon', size: 0.095, anim: { in: 'fade', out: 'fade', loop: 'pulse' } },
  { id: 'noticia', name: 'Noticia', use: 'Datos y avisos', font: 'oswald', styleId: 'caja', size: 0.065, anim: { in: 'slideUp', out: 'fade', loop: 'none' }, y: 0.82 },
  { id: 'verano', name: 'Verano', use: 'Viajes y playa', font: 'pacifico', styleId: 'clasico', size: 0.095, anim: { in: 'pop', out: 'fade', loop: 'bounce' } },
  { id: 'marcador', name: 'Marcador', use: 'Tutoriales', font: 'marker', styleId: 'etiqueta', size: 0.075, anim: { in: 'typewriter', out: 'none', loop: 'none' } },
  { id: 'clasica', name: 'Revista', use: 'Moda y estilo', font: 'playfair', styleId: 'caja', size: 0.08, anim: { in: 'fade', out: 'fade', loop: 'none' } },
];
