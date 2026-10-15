// Per-clip color correction (advanced mode). The math is shared by three drawing paths that give the
// same result: a WebGL2 shader (lut.ts, together with the LUT in one pass), an SVG filter used
// through the canvas `filter` property where WebGL2 is missing, and a pixel loop as the last resort.
// Preview and export call the same code, so they match.
import type { ColorAdjust } from './types';

export const COLOR_KEYS = ['brightness', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows', 'vignette'] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const COLOR_LABELS: Record<ColorKey, string> = {
  brightness: 'Brillo',
  contrast: 'Contraste',
  saturation: 'Saturación',
  temperature: 'Temperatura',
  tint: 'Matiz',
  highlights: 'Luces',
  shadows: 'Sombras',
  vignette: 'Viñeta',
};

const cl = (v: number | undefined) => Math.max(-1, Math.min(1, v ?? 0));
const c01 = (v: number) => Math.max(0, Math.min(1, v));

/** True when the settings change nothing (no filter needed). */
export function isNeutral(c: ColorAdjust | undefined, ignoreVignette = false) {
  if (!c) return true;
  return COLOR_KEYS.every((k) => (ignoreVignette && k === 'vignette') || Math.abs(cl(c[k])) < 1e-3);
}

/** Saturation factor for the luminance-preserving saturate matrix (0 = gray, 2 = double). */
export const saturationFactor = (c: ColorAdjust) => 1 + cl(c.saturation);

/**
 * Tone curve for one channel (0 = red, 1 = green, 2 = blue), input and output 0..1.
 * Applied after the saturation step.
 */
export function tone(c: ColorAdjust, ch: 0 | 1 | 2, x: number) {
  const b = cl(c.brightness);
  const k = cl(c.contrast);
  const temp = cl(c.temperature);
  const tint = cl(c.tint);
  const hi = cl(c.highlights);
  const sh = cl(c.shadows);
  // White balance as channel gains.
  const gain = ch === 0 ? 1 + 0.18 * temp + 0.06 * tint : ch === 2 ? 1 - 0.18 * temp + 0.06 * tint : 1 - 0.12 * tint;
  x *= gain;
  // Brightness keeps black and white anchored: lift toward white or pull toward black.
  x = b >= 0 ? x + (1 - x) * b * 0.45 : x * (1 + b * 0.45);
  // Shadows act mostly on dark tones, highlights mostly on bright ones.
  const ws = (1 - c01(x)) ** 2 * c01(x * 3);
  const wh = c01(x) ** 2;
  x += sh * 0.35 * ws + hi * 0.3 * wh * (hi < 0 ? 1 : 1 - c01(x) * 0.5);
  // Contrast around middle gray.
  const f = k >= 0 ? 1 + k * 0.9 : 1 + k * 0.6;
  x = (x - 0.5) * f + 0.5;
  return c01(x);
}

/** Samples of the tone curve used for the SVG table (linear between samples). */
export const TABLE_SIZE = 33;
export function toneTable(c: ColorAdjust, ch: 0 | 1 | 2) {
  const out: number[] = [];
  for (let i = 0; i < TABLE_SIZE; i++) out.push(tone(c, ch, i / (TABLE_SIZE - 1)));
  return out;
}

type ToneLuts = [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
const lutCache = new Map<string, ToneLuts>();

/** 256-entry lookup tables built from the same samples as the SVG filter, so both paths agree. */
export function toneLuts(c: ColorAdjust): ToneLuts {
  const key = colorKey(c);
  const hit = lutCache.get(key);
  if (hit) return hit;
  const out = ([0, 1, 2] as const).map((ch) => {
    const tab = toneTable(c, ch);
    const lut = new Uint8ClampedArray(256);
    const n = TABLE_SIZE - 1;
    for (let i = 0; i < 256; i++) {
      const pos = (i / 255) * n;
      const j = Math.min(n - 1, Math.floor(pos));
      const f = pos - j;
      lut[i] = Math.round((tab[j] * (1 - f) + tab[j + 1] * f) * 255);
    }
    return lut;
  }) as ToneLuts;
  lutCache.set(key, out);
  if (lutCache.size > 32) lutCache.delete(lutCache.keys().next().value!);
  return out;
}

/** The 3×3 part of the SVG `saturate` color matrix. */
export function saturateMatrix(s: number) {
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
}

/** Apply the correction to RGBA pixels in place (the fallback path, also used by tests). */
export function applyToPixels(c: ColorAdjust, px: Uint8ClampedArray) {
  const [lr, lg, lb] = toneLuts(c);
  const m = saturateMatrix(saturationFactor(c));
  const plain = Math.abs(m[0] - 1) < 1e-6;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i];
    let g = px[i + 1];
    let b = px[i + 2];
    if (!plain) {
      const r2 = m[0] * r + m[1] * g + m[2] * b;
      const g2 = m[3] * r + m[4] * g + m[5] * b;
      const b2 = m[6] * r + m[7] * g + m[8] * b;
      r = r2 < 0 ? 0 : r2 > 255 ? 255 : r2;
      g = g2 < 0 ? 0 : g2 > 255 ? 255 : g2;
      b = b2 < 0 ? 0 : b2 > 255 ? 255 : b2;
    }
    px[i] = lr[r | 0];
    px[i + 1] = lg[g | 0];
    px[i + 2] = lb[b | 0];
  }
}

/**
 * "Auto" correction from a small sample of the picture (RGBA pixels): balances the white point
 * (gray world), centers the exposure and stretches a flat contrast.
 */
export function autoColor(px: Uint8ClampedArray): ColorAdjust {
  let n = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    sr += r;
    sg += g;
    sb += b;
    hist[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++;
    n++;
  }
  if (!n) return {};
  const pct = (q: number) => {
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= q * n) return i / 255;
    }
    return 1;
  };
  const lo = pct(0.03);
  const hi = pct(0.97);
  const mid = pct(0.5);
  const mr = sr / n;
  const mg = sg / n;
  const mb = sb / n;
  const round = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100;
  const out: ColorAdjust = {
    // Gray world: a warm cast (red > blue) gets cooled, a green cast gets magenta.
    temperature: round(((mb - mr) / Math.max(1, (mr + mb) / 2)) * 1.6),
    tint: round(((mg - (mr + mb) / 2) / Math.max(1, mg)) * 2.5),
    brightness: round((0.48 - mid) * 1.8),
    contrast: round(Math.max(0, 0.82 - (hi - lo)) * 1.4 - Math.max(0, hi - lo - 0.98)),
    shadows: round(lo > 0.12 ? -0.25 : mid < 0.3 ? 0.3 : 0),
    highlights: round(hi > 0.97 ? -0.2 : 0),
    saturation: 0.1,
  };
  return out;
}

/** Identity of the correction (without the vignette): equal keys draw the same colors. */
export const colorKey = (c: ColorAdjust) => COLOR_KEYS.filter((k) => k !== 'vignette').map((k) => cl(c[k]).toFixed(3)).join(',');

// ---------- canvas helpers (browser only) ----------

let svgRoot: SVGSVGElement | null = null;
const filterIds = new Map<string, string>();
/** colorCss per settings object: projects are replaced, not mutated, so the same object means the same answer. */
const cssOf = new WeakMap<ColorAdjust, string>();

/**
 * CSS for the canvas `filter` property that applies the correction (without the vignette), or ''
 * when nothing changes. Creates a hidden SVG filter once per distinct setting.
 */
export function colorCss(c: ColorAdjust | undefined): string {
  if (!c || typeof document === 'undefined') return '';
  let css = cssOf.get(c);
  if (css === undefined) {
    css = isNeutral(c, true) ? '' : buildCss(c);
    cssOf.set(c, css);
  }
  return css;
}

function buildCss(c: ColorAdjust): string {
  const key = colorKey(c);
  let id = filterIds.get(key);
  if (!id) {
    id = `clipo-cc-${filterIds.size}`;
    if (!svgRoot) {
      svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgRoot.setAttribute('width', '0');
      svgRoot.setAttribute('height', '0');
      svgRoot.setAttribute('aria-hidden', 'true');
      svgRoot.style.position = 'absolute';
      svgRoot.style.pointerEvents = 'none';
      document.body.appendChild(svgRoot);
    }
    const ns = 'http://www.w3.org/2000/svg';
    const f = document.createElementNS(ns, 'filter');
    f.id = id;
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.setAttribute('x', '0');
    f.setAttribute('y', '0');
    f.setAttribute('width', '1');
    f.setAttribute('height', '1');
    const s = saturationFactor(c);
    if (Math.abs(s - 1) > 1e-3) {
      const m = document.createElementNS(ns, 'feColorMatrix');
      m.setAttribute('type', 'saturate');
      m.setAttribute('values', String(s));
      f.appendChild(m);
    }
    const t = document.createElementNS(ns, 'feComponentTransfer');
    (['R', 'G', 'B'] as const).forEach((name, ch) => {
      const fn = document.createElementNS(ns, `feFunc${name}`);
      fn.setAttribute('type', 'table');
      fn.setAttribute('tableValues', toneTable(c, ch as 0 | 1 | 2).map((v) => v.toFixed(4)).join(' '));
      t.appendChild(fn);
    });
    f.appendChild(t);
    svgRoot.appendChild(f);
    filterIds.set(key, id);
  }
  return `url(#${id})`;
}

/** CPU fallback (no canvas filters and no WebGL2): correct the pixels of a drawn area. */
export function applyColorPixels(ctx: CanvasRenderingContext2D, c: ColorAdjust | undefined, x: number, y: number, w: number, h: number) {
  if (!c || isNeutral(c, true)) return;
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(x + w));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(y + h));
  if (x1 <= x0 || y1 <= y0) return;
  const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  applyToPixels(c, img.data);
  ctx.putImageData(img, x0, y0);
}

/** Darken (or lighten) the corners of a W×H area. */
export function drawVignette(ctx: CanvasRenderingContext2D, c: ColorAdjust | undefined, W: number, H: number) {
  const v = cl(c?.vignette);
  if (Math.abs(v) < 1e-3) return;
  const r = Math.hypot(W, H) / 2;
  const g = ctx.createRadialGradient(W / 2, H / 2, r * (0.6 - 0.3 * Math.abs(v)), W / 2, H / 2, r);
  const rgb = v > 0 ? '0,0,0' : '255,255,255';
  g.addColorStop(0, `rgba(${rgb},0)`);
  g.addColorStop(1, `rgba(${rgb},${(0.85 * Math.abs(v)).toFixed(3)})`);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
