import type { CSSProperties } from 'react';
import type { TextItem } from './types';
import type { TextPose } from './visuals';
import { ensureFont, fontCss, getFont } from './fonts';
import { activeWord, wordTimings } from './subtitles';
import { requestRedraw } from './redraw';
import { supportsCanvasFilter } from './filters';

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
  /** Copies of the letters drawn behind, offset by (dx, dy) font sizes: 3D shadows, glitch edges. */
  echo?: [color: string, dx: number, dy: number][];
  /** Top-to-bottom colors filling the letters (instead of `fill`). */
  gradient?: string[];
  /** Shown first, with a badge, in the style picker. */
  trend?: true;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

export const TEXT_STYLES: [TextStyle, ...TextStyle[]] = [
  { id: 'clasico', name: 'Clásico', font: SANS, weight: 800, fill: '#ffffff', stroke: '#000000', strokeW: 0.14 },
  { id: 'amarillo', name: 'Subtítulo', font: SANS, weight: 900, fill: '#ffe500', stroke: '#000000', strokeW: 0.16 },
  { id: 'caja', name: 'Caja', font: SANS, weight: 700, fill: '#ffffff', bg: 'rgba(0,0,0,0.72)' },
  { id: 'etiqueta', name: 'Etiqueta', font: SANS, weight: 800, fill: '#111111', bg: '#ffffff' },
  { id: 'rojo', name: 'Destacado', font: SANS, weight: 900, fill: '#ffffff', bg: '#e11d48', upper: true },
  { id: 'neon', name: 'Neón', font: SANS, weight: 800, fill: '#ffe6fa', shadow: '#ff2bd6', shadowBlur: 0.45 },
  { id: 'titulo', name: 'Título', font: SANS, weight: 900, fill: '#ffffff', shadow: 'rgba(0,0,0,0.8)', shadowBlur: 0.25, upper: true },
  { id: 'elegante', name: 'Elegante', font: SERIF, weight: 700, fill: '#ffffff', italic: true, shadow: 'rgba(0,0,0,0.7)', shadowBlur: 0.2 },
  // In fashion on short-form video right now.
  { id: 'verde', name: 'Verde viral', font: SANS, weight: 900, fill: '#2bff6b', stroke: '#000000', strokeW: 0.16, upper: true, trend: true },
  { id: 'sombra3d', name: 'Sombra 3D', font: SANS, weight: 900, fill: '#ffffff', stroke: '#000000', strokeW: 0.1, echo: [['#000000', 0.03, 0.03], ['#000000', 0.06, 0.06], ['#000000', 0.09, 0.09]], trend: true },
  { id: 'burbuja', name: 'Burbuja', font: SANS, weight: 900, fill: '#ffffff', stroke: '#7c3aed', strokeW: 0.24, trend: true },
  { id: 'glitch', name: 'Glitch', font: SANS, weight: 900, fill: '#ffffff', echo: [['#00f0ff', -0.06, 0.01], ['#ff2d55', 0.06, -0.01]], upper: true, trend: true },
  { id: 'degradado', name: 'Atardecer', font: SANS, weight: 900, fill: '#ff5e7e', gradient: ['#ffd23f', '#ff5e7e', '#a34bff'], stroke: '#1a0b2e', strokeW: 0.1, trend: true },
  { id: 'cromo', name: 'Cromo Y2K', font: SANS, weight: 900, fill: '#dfe6f2', gradient: ['#ffffff', '#c9d2e3', '#6b7891', '#e8eef8'], stroke: '#1d2333', strokeW: 0.08, shadow: 'rgba(120,180,255,0.6)', shadowBlur: 0.3, trend: true },
  { id: 'contorno', name: 'Contorno', font: SANS, weight: 900, fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeW: 0.05, upper: true, trend: true },
];

export const getTextStyle = (id: string) => TEXT_STYLES.find((s) => s.id === id) ?? TEXT_STYLES[0];

/** Approximate the style in HTML for the style picker. */
export function styleToCss(st: TextStyle): CSSProperties {
  // Preview text is about 16px: offsets in font sizes become pixels.
  const shadows = [
    ...(st.echo ?? []).map(([c, dx, dy]) => `${(dx * 16).toFixed(1)}px ${(dy * 16).toFixed(1)}px 0 ${c}`),
    ...(st.shadow ? [`0 0 8px ${st.shadow}`] : []),
  ];
  return {
    color: st.gradient ? 'transparent' : st.fill,
    background: st.gradient ? `linear-gradient(180deg, ${st.gradient.join(', ')}) text` : (st.bg ?? 'transparent'),
    WebkitBackgroundClip: st.gradient ? 'text' : undefined,
    fontFamily: st.font,
    fontWeight: st.weight,
    fontStyle: st.italic ? 'italic' : 'normal',
    textTransform: st.upper ? 'uppercase' : 'none',
    WebkitTextStroke: st.stroke ? `${Math.max(1, Math.round((st.strokeW ?? 0.14) * (st.gradient ? 8 : 16)))}px ${st.stroke}` : undefined,
    paintOrder: 'stroke fill',
    textShadow: shadows.length && !st.gradient ? shadows.join(', ') : undefined,
    filter: st.gradient && st.shadow ? `drop-shadow(0 0 4px ${st.shadow})` : undefined,
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

// Text measuring is the slow part of drawing a caption, and a text looks the same every frame:
// widths are cached per font and string. A font that finishes loading changes them, so the cache
// is emptied then.
const widthCache = new Map<string, number>();
const WIDTHS_MAX = 2000;

function measure(ctx: CanvasRenderingContext2D, s: string) {
  const key = `${ctx.font}\u0000${s}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    w = ctx.measureText(s).width;
    if (widthCache.size >= WIDTHS_MAX) widthCache.clear();
    widthCache.set(key, w);
  }
  return w;
}

const fontReady = () => {
  widthCache.clear();
  requestRedraw();
};
if (typeof document !== 'undefined' && document.fonts?.addEventListener) document.fonts.addEventListener('loadingdone', fontReady);
/** Fonts whose first download is already being watched. */
const watchedFonts = new Set<string>();

/** Lines and casing of an item, reused while its text and style stay the same. */
const shaped = new WeakMap<TextItem, { text: string; upper: boolean; raw: string; lines: string[] }>();
function linesOf(item: TextItem, upper: boolean) {
  let s = shaped.get(item);
  if (!s || s.text !== item.text || s.upper !== upper) {
    const raw = upper ? item.text.toUpperCase() : item.text;
    s = { text: item.text, upper, raw, lines: raw.split('\n') };
    shaped.set(item, s);
  }
  return s;
}

const timings = new WeakMap<TextItem, { raw: string; words: TextItem['words']; dur: number; list: ReturnType<typeof wordTimings> }>();
function timingsOf(item: TextItem, raw: string) {
  let s = timings.get(item);
  if (!s || s.raw !== raw || s.words !== item.words || s.dur !== item.duration) {
    s = { raw, words: item.words, dur: item.duration, list: wordTimings(raw, item.words, item.duration) };
    timings.set(item, s);
  }
  return s.list;
}

/**
 * Draw a text item and return its (resting) bounding box in canvas pixels. `place` overrides the
 * item's position and size (its animated pose) without copying the item.
 */
export function drawText(
  ctx: CanvasRenderingContext2D, item: TextItem, W: number, H: number, pose?: TextPose, local?: number,
  place?: { x: number; y: number; size: number },
): Box {
  const st = getTextStyle(item.styleId);
  const fs = Math.max(8, (place?.size ?? item.size) * Math.min(W, H));
  ctx.save();
  const face = getFont(item.font);
  if (face) {
    // First use registers and downloads it; draw again with the real font once it's there.
    const loading = ensureFont(face.id);
    if (!watchedFonts.has(face.id)) {
      watchedFonts.add(face.id);
      loading.then(fontReady, () => {});
    }
  }
  ctx.font = face ? fontCss(face, fs, st.italic) : `${st.italic ? 'italic ' : ''}${st.weight} ${fs}px ${st.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const { raw, lines } = linesOf(item, !!st.upper);
  const lh = fs * 1.22;
  let tw = fs * 0.5;
  for (const l of lines) tw = Math.max(tw, measure(ctx, l || ' '));
  const th = lh * lines.length;
  const cx = (place?.x ?? item.x) * W;
  const cy = (place?.y ?? item.y) * H;
  const padX = fs * 0.45;
  const padY = fs * 0.2;
  const box = { id: item.id, x: cx - tw / 2 - padX, y: cy - th / 2 - padY, w: tw + padX * 2, h: th + padY * 2 };
  if (pose) {
    if (pose.alpha <= 0.001 || pose.scale <= 0.001) {
      ctx.restore();
      return box;
    }
    ctx.globalAlpha *= Math.min(1, pose.alpha);
    ctx.translate(cx + (pose.dx ?? 0) * W, cy + pose.dy * H);
    if (pose.rot) ctx.rotate(pose.rot);
    ctx.scale(pose.scale, pose.scale);
    ctx.translate(-cx, -cy);
    if (pose.blur && supportsCanvasFilter) ctx.filter = `blur(${(pose.blur * fs).toFixed(2)}px)`;
  }
  // Typewriter: reveal characters one by one, keeping each line where it will end up.
  let budget = pose?.chars ?? Infinity;
  const fill = item.fill ?? st.fill;
  const paint = (s: string, x: number, y: number, color: string) => {
    if (st.echo) {
      for (const [c, dx, dy] of st.echo) {
        ctx.fillStyle = c;
        if (st.stroke) {
          ctx.strokeStyle = c;
          ctx.lineWidth = (st.strokeW ?? 0.14) * fs;
          ctx.strokeText(s, x + dx * fs, y + dy * fs);
        }
        ctx.fillText(s, x + dx * fs, y + dy * fs);
      }
    }
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
    if (st.gradient && color === st.fill) {
      // Spans one line of letters (textBaseline is "middle").
      const g = ctx.createLinearGradient(0, y - fs * 0.5, 0, y + fs * 0.5);
      st.gradient.forEach((c, i) => g.addColorStop(i / Math.max(1, st.gradient!.length - 1), c));
      ctx.fillStyle = g;
    } else ctx.fillStyle = color;
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
  const active = kara ? activeWord(timingsOf(item, raw), local!) : -1;
  let k = 0;
  lines.forEach((full, i) => {
    if (budget <= 0) return;
    const y = cy - th / 2 + lh * (i + 0.5);
    if (kara) {
      const toks = full.split(/\s+/).filter(Boolean);
      const space = measure(ctx, ' ');
      const widths = toks.map((t) => measure(ctx, t));
      let x = cx - (widths.reduce((a, b) => a + b, 0) + space * Math.max(0, toks.length - 1)) / 2;
      toks.forEach((tok, j) => {
        const on = k++ === active;
        const tw = widths[j]!;
        const wx = x + tw / 2;
        x += tw + space;
        if (!on) return paint(tok, wx, y, fill);
        ctx.save();
        if (kara.mode === 'box') {
          ctx.fillStyle = kara.color;
          roundRect(ctx, wx - tw / 2 - fs * 0.14, y - fs * 0.6, tw + fs * 0.28, fs * 1.2, fs * 0.22);
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
      x = cx - measure(ctx, full) / 2;
    }
    paint(line, x, y, fill);
  });
  ctx.restore();
  return box;
}
