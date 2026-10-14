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
}

export const TEXT_PRESETS: TextPreset[] = [
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
