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
