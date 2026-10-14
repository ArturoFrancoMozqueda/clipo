import type { CSSProperties } from 'react';
import type { TextItem } from './types';

export interface TextStyle {
  id: string;
  name: string;
  font: string;
  weight: number;
  fill: string;
  stroke?: string;
  /** Outline width as a fraction of the font size. */
  strokeW?: number;
  bg?: string;
  shadow?: string;
  shadowBlur?: number;
  upper?: boolean;
  italic?: boolean;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

export const TEXT_STYLES: TextStyle[] = [
  { id: 'clasico', name: 'Clásico', font: SANS, weight: 800, fill: '#ffffff', stroke: '#000000', strokeW: 0.14 },
  { id: 'amarillo', name: 'Subtítulo', font: SANS, weight: 900, fill: '#ffe500', stroke: '#000000', strokeW: 0.16 },
  { id: 'caja', name: 'Caja', font: SANS, weight: 700, fill: '#ffffff', bg: 'rgba(0,0,0,0.72)' },
  { id: 'etiqueta', name: 'Etiqueta', font: SANS, weight: 800, fill: '#111111', bg: '#ffffff' },
  { id: 'rojo', name: 'Destacado', font: SANS, weight: 900, fill: '#ffffff', bg: '#e11d48', upper: true },
  { id: 'neon', name: 'Neón', font: SANS, weight: 800, fill: '#ffe6fa', shadow: '#ff2bd6', shadowBlur: 0.45 },
  { id: 'titulo', name: 'Título', font: SANS, weight: 900, fill: '#ffffff', shadow: 'rgba(0,0,0,0.8)', shadowBlur: 0.25, upper: true },
  { id: 'elegante', name: 'Elegante', font: SERIF, weight: 700, fill: '#ffffff', italic: true, shadow: 'rgba(0,0,0,0.7)', shadowBlur: 0.2 },
];

export const getTextStyle = (id: string) => TEXT_STYLES.find((s) => s.id === id) ?? TEXT_STYLES[0];

/** Approximate the style in HTML for the style picker. */
export function styleToCss(st: TextStyle): CSSProperties {
  return {
    color: st.fill,
    background: st.bg ?? 'transparent',
    fontFamily: st.font,
    fontWeight: st.weight,
    fontStyle: st.italic ? 'italic' : 'normal',
    textTransform: st.upper ? 'uppercase' : 'none',
    WebkitTextStroke: st.stroke ? `3px ${st.stroke}` : undefined,
    paintOrder: 'stroke fill',
    textShadow: st.shadow ? `0 0 8px ${st.shadow}` : undefined,
  };
}

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw a text item and return its bounding box in canvas pixels. */
export function drawText(ctx: CanvasRenderingContext2D, item: TextItem, W: number, H: number): Box {
  const st = getTextStyle(item.styleId);
  const fs = Math.max(8, item.size * Math.min(W, H));
  ctx.save();
  ctx.font = `${st.italic ? 'italic ' : ''}${st.weight} ${fs}px ${st.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const raw = st.upper ? item.text.toUpperCase() : item.text;
  const lines = raw.split('\n');
  const lh = fs * 1.22;
  const tw = Math.max(fs * 0.5, ...lines.map((l) => ctx.measureText(l || ' ').width));
  const th = lh * lines.length;
  const cx = item.x * W;
  const cy = item.y * H;
  const padX = fs * 0.45;
  const padY = fs * 0.2;
  const box = { id: item.id, x: cx - tw / 2 - padX, y: cy - th / 2 - padY, w: tw + padX * 2, h: th + padY * 2 };

  if (st.bg) {
    ctx.fillStyle = st.bg;
    roundRect(ctx, box.x, box.y, box.w, box.h, fs * 0.25);
    ctx.fill();
  }
  lines.forEach((line, i) => {
    const y = cy - th / 2 + lh * (i + 0.5);
    if (st.shadow) {
      ctx.shadowColor = st.shadow;
      ctx.shadowBlur = (st.shadowBlur ?? 0.2) * fs;
    }
    if (st.stroke) {
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = (st.strokeW ?? 0.14) * fs;
      ctx.strokeText(line, cx, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = st.fill;
    ctx.fillText(line, cx, y);
    ctx.shadowColor = 'transparent';
  });
  ctx.restore();
  return box;
}
