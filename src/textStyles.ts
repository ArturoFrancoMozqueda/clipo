import type { CSSProperties } from 'react';
import type { TextItem } from './types';
import type { TextPose } from './visuals';
import { ensureFont, fontCss, getFont } from './fonts';
import { activeWord, wordTimings } from './subtitles';

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

/** Draw a text item and return its (resting) bounding box in canvas pixels. */
export function drawText(ctx: CanvasRenderingContext2D, item: TextItem, W: number, H: number, pose?: TextPose, local?: number): Box {
  const st = getTextStyle(item.styleId);
  const fs = Math.max(8, item.size * Math.min(W, H));
  ctx.save();
  const face = getFont(item.font);
  if (face) void ensureFont(face.id); // first use registers and downloads it
  ctx.font = face ? fontCss(face, fs, st.italic) : `${st.italic ? 'italic ' : ''}${st.weight} ${fs}px ${st.font}`;
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
  if (pose) {
    if (pose.alpha <= 0.001 || pose.scale <= 0.001) {
      ctx.restore();
      return box;
    }
    ctx.globalAlpha *= Math.min(1, pose.alpha);
    ctx.translate(cx, cy + pose.dy * H);
    ctx.scale(pose.scale, pose.scale);
    ctx.translate(-cx, -cy);
  }
  // Typewriter: reveal characters one by one, keeping each line where it will end up.
  let budget = pose?.chars ?? Infinity;
  const fill = item.fill ?? st.fill;
  const paint = (s: string, x: number, y: number, color: string) => {
    if (st.shadow) {
      ctx.shadowColor = st.shadow;
      ctx.shadowBlur = (st.shadowBlur ?? 0.2) * fs;
    }
    if (st.stroke) {
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = (st.strokeW ?? 0.14) * fs;
      ctx.strokeText(s, x, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
    ctx.shadowColor = 'transparent';
  };

  if (st.bg && budget > 0) {
    ctx.fillStyle = st.bg;
    roundRect(ctx, box.x, box.y, box.w, box.h, fs * 0.25);
    ctx.fill();
  }
  // Karaoke: the word being said gets a color, a box or grows a little.
  const kara = item.karaoke && local !== undefined && budget === Infinity ? item.karaoke : undefined;
  const active = kara ? activeWord(wordTimings(raw, item.words, item.duration), local!) : -1;
  let k = 0;
  lines.forEach((full, i) => {
    if (budget <= 0) return;
    const y = cy - th / 2 + lh * (i + 0.5);
    if (kara) {
      const toks = full.split(/\s+/).filter(Boolean);
      const space = ctx.measureText(' ').width;
      const widths = toks.map((t) => ctx.measureText(t).width);
      let x = cx - (widths.reduce((a, b) => a + b, 0) + space * Math.max(0, toks.length - 1)) / 2;
      toks.forEach((tok, j) => {
        const on = k++ === active;
        const wx = x + widths[j] / 2;
        x += widths[j] + space;
        if (!on) return paint(tok, wx, y, fill);
        ctx.save();
        if (kara.mode === 'box') {
          ctx.fillStyle = kara.color;
          roundRect(ctx, wx - widths[j] / 2 - fs * 0.14, y - fs * 0.6, widths[j] + fs * 0.28, fs * 1.2, fs * 0.22);
          ctx.fill();
        } else if (kara.mode === 'scale') {
          ctx.translate(wx, y);
          ctx.scale(1.2, 1.2);
          ctx.translate(-wx, -y);
        }
        paint(tok, wx, y, kara.mode === 'box' ? fill : kara.color);
        ctx.restore();
      });
      return;
    }
    let line = full;
    let x = cx;
    if (budget < Infinity) {
      line = full.slice(0, budget);
      budget -= full.length + 1;
      ctx.textAlign = 'left';
      x = cx - ctx.measureText(full).width / 2;
    }
    paint(line, x, y, fill);
  });
  ctx.restore();
  return box;
}
