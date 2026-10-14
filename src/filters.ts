export interface FallbackStep {
  op: GlobalCompositeOperation;
  alpha: number;
  color?: string;
  /** Blend the frame with itself instead of a solid color. */
  self?: boolean;
}

export interface Filter {
  id: string;
  name: string;
  /** CSS filter used for canvas drawing (where supported) and thumbnails. */
  css: string;
  /** Approximation for browsers without canvas `filter` support (older Safari). */
  fallback: FallbackStep[];
}

export const FILTERS: Filter[] = [
  { id: 'none', name: 'Original', css: 'none', fallback: [] },
  { id: 'vivid', name: 'Vívido', css: 'saturate(1.45) contrast(1.08)', fallback: [{ op: 'overlay', self: true, alpha: 0.25 }] },
  { id: 'warm', name: 'Cálido', css: 'sepia(0.25) saturate(1.25) brightness(1.03)', fallback: [{ op: 'soft-light', color: '#ff9a3c', alpha: 0.45 }] },
  { id: 'cool', name: 'Frío', css: 'saturate(0.9) hue-rotate(12deg) brightness(1.04)', fallback: [{ op: 'soft-light', color: '#3c8cff', alpha: 0.45 }] },
  { id: 'bw', name: 'Blanco y negro', css: 'grayscale(1) contrast(1.1)', fallback: [{ op: 'saturation', color: '#000', alpha: 1 }] },
  { id: 'retro', name: 'Retro', css: 'sepia(0.55) contrast(1.05) saturate(1.1)', fallback: [{ op: 'color', color: '#a0784a', alpha: 0.45 }] },
  { id: 'bright', name: 'Luminoso', css: 'brightness(1.15) contrast(0.95)', fallback: [{ op: 'screen', color: '#ffffff', alpha: 0.15 }] },
  { id: 'drama', name: 'Dramático', css: 'contrast(1.35) saturate(0.85) brightness(0.95)', fallback: [{ op: 'overlay', self: true, alpha: 0.5 }] },
  { id: 'soft', name: 'Suave', css: 'contrast(0.9) brightness(1.06) saturate(0.9)', fallback: [{ op: 'screen', color: '#ffffff', alpha: 0.08 }] },
  { id: 'cine', name: 'Cine', css: 'contrast(1.15) saturate(0.8) sepia(0.15) hue-rotate(-8deg)', fallback: [{ op: 'soft-light', color: '#2a6f7a', alpha: 0.35 }] },
  // Extra looks for common video themes. Values are our own; tune freely.
  { id: 'sunset', name: 'Atardecer', css: 'sepia(0.35) saturate(1.5) hue-rotate(-15deg) contrast(1.05)', fallback: [{ op: 'soft-light', color: '#ff6a3d', alpha: 0.5 }] },
  { id: 'summer', name: 'Verano', css: 'saturate(1.35) brightness(1.08) contrast(1.05) sepia(0.12)', fallback: [{ op: 'soft-light', color: '#ffcf5a', alpha: 0.35 }] },
  { id: 'autumn', name: 'Otoño', css: 'sepia(0.45) saturate(1.3) hue-rotate(-20deg) brightness(0.98)', fallback: [{ op: 'color', color: '#b5652b', alpha: 0.35 }] },
  { id: 'winter', name: 'Invierno', css: 'saturate(0.7) hue-rotate(15deg) brightness(1.1) contrast(0.95)', fallback: [{ op: 'soft-light', color: '#9cc8ff', alpha: 0.5 }] },
  { id: 'food', name: 'Comida', css: 'saturate(1.4) contrast(1.1) brightness(1.05) sepia(0.08)', fallback: [{ op: 'overlay', self: true, alpha: 0.2 }] },
  { id: 'portrait', name: 'Piel suave', css: 'brightness(1.06) contrast(0.92) saturate(1.05) sepia(0.1)', fallback: [{ op: 'screen', color: '#ffd9c2', alpha: 0.12 }] },
  { id: 'pastel', name: 'Pastel', css: 'saturate(0.75) brightness(1.15) contrast(0.85)', fallback: [{ op: 'screen', color: '#f6d6ff', alpha: 0.2 }] },
  { id: 'matte', name: 'Mate', css: 'contrast(0.82) brightness(1.05) saturate(0.85)', fallback: [{ op: 'screen', color: '#2b2b2b', alpha: 0.35 }] },
  { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.5) brightness(0.9)', fallback: [{ op: 'saturation', color: '#000', alpha: 1 }, { op: 'overlay', self: true, alpha: 0.5 }] },
  { id: 'seventies', name: 'Años 70', css: 'sepia(0.5) saturate(1.4) hue-rotate(-25deg) contrast(0.9) brightness(1.05)', fallback: [{ op: 'color', color: '#c98a3a', alpha: 0.4 }] },
  { id: 'pop', name: 'Pop', css: 'saturate(1.9) contrast(1.15)', fallback: [{ op: 'overlay', self: true, alpha: 0.4 }] },
  { id: 'night', name: 'Noche', css: 'hue-rotate(20deg) saturate(0.8) brightness(0.85) contrast(1.15)', fallback: [{ op: 'multiply', color: '#3a4f9a', alpha: 0.35 }] },
];

export const getFilter = (id: string) => FILTERS.find((f) => f.id === id) ?? FILTERS[0];

export const supportsCanvasFilter =
  typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

export function applyFallback(
  ctx: CanvasRenderingContext2D,
  f: Filter,
  src: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  for (const step of f.fallback) {
    ctx.save();
    ctx.globalCompositeOperation = step.op;
    ctx.globalAlpha = step.alpha;
    if (step.self) ctx.drawImage(src, x, y, w, h);
    else {
      ctx.fillStyle = step.color ?? '#000';
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }
}
