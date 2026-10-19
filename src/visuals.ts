// Catalogs and math for transitions, clip effects, text animations and stickers.
// Everything here is pure drawing/timing logic so the engine (preview and export) shares it.
import type {
  Clip, Direction, EffectId, Project, StickerItem, TextAnim, TextInAnim, TextItem, TextLoopAnim, TextOutAnim, TransitionId,
} from './types';
import { clamp, clipDur, type Placed } from './model';
import { supportsCanvasFilter } from './filters';
import {
  beatPulse, coverScale, grainValues, hash, irisRadius, letterboxBar, peak, pixelBlock, pushOffsets, recTimecode, smoothNoise,
} from './fxmath';
import { emojiImage } from './stickers';
import { redrawWhenLoaded } from './redraw';

// ---------- transitions ----------

/** `trend`: in fashion on TikTok/Reels right now; the pickers list these first with a badge. */
export const TRANSITIONS: { id: TransitionId; name: string; trend?: true }[] = [
  { id: 'none', name: 'Corte' },
  { id: 'whip', name: 'Barrido rápido', trend: true },
  { id: 'zoomBlur', name: 'Zoom rápido', trend: true },
  { id: 'filmBurn', name: 'Quemado de película', trend: true },
  { id: 'shake', name: 'Sacudida', trend: true },
  { id: 'pixelate', name: 'Píxeles', trend: true },
  { id: 'fade', name: 'Fundido' },
  { id: 'fadeBlack', name: 'A negro' },
  { id: 'fadeWhite', name: 'A blanco' },
  { id: 'slide', name: 'Deslizar' },
  { id: 'push', name: 'Empujar' },
  { id: 'zoom', name: 'Zoom' },
  { id: 'wipe', name: 'Barrido' },
  { id: 'iris', name: 'Círculo' },
  { id: 'flash', name: 'Flash' },
  { id: 'spin', name: 'Giro' },
  { id: 'blur', name: 'Desenfoque' },
  { id: 'glitch', name: 'Glitch' },
];
export const DIRECTIONS: { id: Direction; name: string }[] = [
  { id: 'left', name: 'Hacia la izquierda' },
  { id: 'right', name: 'Hacia la derecha' },
  { id: 'up', name: 'Hacia arriba' },
  { id: 'down', name: 'Hacia abajo' },
];
export const TRANSITION_MIN = 0.2;
export const TRANSITION_MAX = 1.5;
export const TRANSITION_DEFAULT = 0.6;

export const transitionName = (id: TransitionId | undefined) => TRANSITIONS.find((t) => t.id === id)?.name ?? 'Corte';

/** Length actually used for the transition after clip `a`: never longer than either clip. */
export function transitionLength(a: Clip, b: Clip | undefined) {
  const tr = a.transition;
  if (!b || !tr || tr.type === 'none') return 0;
  return Math.min(clamp(tr.duration, TRANSITION_MIN, TRANSITION_MAX), clipDur(a), clipDur(b));
}

export interface ActiveTransition {
  type: TransitionId;
  out: Placed;
  in: Placed;
  /** 0..1 through the transition (eased). */
  k: number;
  dir?: Direction;
}

/** The transition happening at time t, if any. It is centered on the cut between two clips. */
export function transitionAt(placed: Placed[], t: number): ActiveTransition | null {
  for (let i = 0; i < placed.length - 1; i++) {
    const a = placed[i]!;
    const b = placed[i + 1]!;
    const d = transitionLength(a.clip, b.clip);
    if (!d) continue;
    const from = a.end - d / 2;
    if (t >= from && t < a.end + d / 2) {
      const raw = (t - from) / d;
      const tr = a.clip.transition!;
      return { type: tr.type, out: a, in: b, k: raw * raw * (3 - 2 * raw), dir: tr.dir };
    }
  }
  return null;
}

/**
 * Source time to show for a clip at timeline time t. Outside the clip's own range (during a
 * transition) it keeps going into the media's spare footage, or holds the first/last frame.
 * A freeze frame always shows its one picture.
 */
export function sourceTime(l: Placed, t: number, assetDuration: number) {
  const c = l.clip;
  const raw = c.freeze ?? c.in + (t - l.start) * c.speed;
  return clamp(raw, 0, Math.max(0, assetDuration - 0.05));
}

// Offscreen canvases reused by transitions and effects, by role and size: the preview, the export and
// the panel thumbnails draw at different sizes and would otherwise keep reallocating them.
const scratchPool = new Map<string, HTMLCanvasElement>();
function scratch(role: number, w: number, h: number) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const key = `${role}:${w}x${h}`;
  let c = scratchPool.get(key);
  if (c) scratchPool.delete(key);
  else {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
  }
  scratchPool.set(key, c); // most recently used last
  if (scratchPool.size > 24) scratchPool.delete(scratchPool.keys().next().value!);
  return c;
}
const S_COPY = 0;
const S_CHANNEL = 1;
const S_SMALL = 2;
const S_SMALL2 = 3;

/** Draw `src` blurred by about `px` pixels (canvas filter, or shrink-and-stretch where there is none). */
function drawBlurred(ctx: CanvasRenderingContext2D, src: CanvasImageSource, W: number, H: number, px: number) {
  if (px < 0.5) {
    ctx.drawImage(src, 0, 0, W, H);
    return;
  }
  if (supportsCanvasFilter) {
    // Slightly enlarged so the blur doesn't pull dark edges in from outside the picture.
    const m = px * 2;
    ctx.save();
    ctx.filter = `blur(${px.toFixed(2)}px)`;
    ctx.drawImage(src, -m, -m, W + 2 * m, H + 2 * m);
    ctx.restore();
    return;
  }
  const div = Math.max(1.5, px / 1.5);
  const a = scratch(S_SMALL, W / Math.sqrt(div), H / Math.sqrt(div));
  const b = scratch(S_SMALL2, W / div, H / div);
  const ac = a.getContext('2d')!;
  ac.imageSmoothingEnabled = true;
  ac.imageSmoothingQuality = 'high';
  ac.drawImage(src, 0, 0, a.width, a.height);
  const bc = b.getContext('2d')!;
  bc.imageSmoothingEnabled = true;
  bc.imageSmoothingQuality = 'high';
  bc.drawImage(a, 0, 0, b.width, b.height);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(b, 0, 0, W, H);
  ctx.restore();
}

/**
 * Paint `src` with its red and blue channels pushed apart by (dx, dy) pixels (RGB split).
 * `src` may be `ctx.canvas` itself.
 */
function drawRgbSplit(ctx: CanvasRenderingContext2D, src: CanvasImageSource, W: number, H: number, dx: number, dy: number) {
  if (src === ctx.canvas) {
    const copy = scratch(S_COPY, W, H);
    const cc = copy.getContext('2d')!;
    cc.globalCompositeOperation = 'copy';
    cc.drawImage(src, 0, 0, W, H);
    src = copy;
  }
  const ch = scratch(S_CHANNEL, W, H);
  const c = ch.getContext('2d')!;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  for (const [color, ox, oy] of [['#f00', -dx, -dy], ['#0f0', 0, 0], ['#00f', dx, dy]] as const) {
    c.globalCompositeOperation = 'copy';
    c.drawImage(src, 0, 0, W, H);
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = color;
    c.fillRect(0, 0, W, H);
    ctx.drawImage(ch, ox, oy, W, H);
  }
  ctx.restore();
}

/** Horizontal bands of the picture shifted sideways (digital tearing). */
function drawTearBands(ctx: CanvasRenderingContext2D, src: CanvasImageSource, W: number, H: number, step: number, amt: number) {
  const bands = 3 + Math.floor(hash(step + 7) * 5 * (0.5 + amt));
  for (let i = 0; i < bands; i++) {
    const y = hash(step * 13 + i) * H;
    const h = H * (0.01 + hash(step * 17 + i) * 0.07);
    const dx = (hash(step * 19 + i) - 0.5) * W * 0.18 * (0.4 + amt);
    ctx.drawImage(src, 0, y, W, h, dx, y, W, h);
  }
}

/** Composite two already-rendered frames for a transition. */
export function drawTransition(
  ctx: CanvasRenderingContext2D, type: TransitionId, from: CanvasImageSource | null, to: CanvasImageSource | null, k: number, W: number, H: number,
  dir?: Direction,
) {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const draw = (src: CanvasImageSource | null) => src && ctx.drawImage(src, 0, 0, W, H);
  if (type === 'slide') {
    ctx.translate(-k * W, 0);
    draw(from);
    ctx.translate(W, 0);
    draw(to);
  } else if (type === 'push') {
    // Both pictures move together, with a small dip in size for a sense of speed.
    const o = pushOffsets(dir, k);
    const s = 1 - 0.08 * Math.sin(Math.PI * k);
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
    if (from) ctx.drawImage(from, o.from[0] * W, o.from[1] * H, W, H);
    if (to) ctx.drawImage(to, o.to[0] * W, o.to[1] * H, W, H);
  } else if (type === 'zoom') {
    // The outgoing frame rushes toward the viewer and fades, revealing the next one settling in.
    const s2 = 1.25 - 0.25 * k;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(s2, s2);
    ctx.translate(-W / 2, -H / 2);
    draw(to);
    ctx.restore();
    const s1 = 1 + 0.8 * k;
    ctx.globalAlpha = 1 - k;
    ctx.translate(W / 2, H / 2);
    ctx.scale(s1, s1);
    ctx.translate(-W / 2, -H / 2);
    draw(from);
  } else if (type === 'wipe') {
    draw(from);
    const x = k * W * 1.1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(x, 0);
    ctx.lineTo(x - W * 0.1, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.clip();
    draw(to);
  } else if (type === 'fadeBlack' || type === 'fadeWhite') {
    draw(k < 0.5 ? from : to);
    ctx.globalAlpha = peak(k);
    ctx.fillStyle = type === 'fadeBlack' ? '#000' : '#fff';
    ctx.fillRect(0, 0, W, H);
  } else if (type === 'iris') {
    draw(from);
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.max(0.01, irisRadius(k, W, H)), 0, Math.PI * 2);
    ctx.clip();
    draw(to);
  } else if (type === 'flash') {
    // Overexposed burst at the cut: the picture is added to itself, then washed to white.
    const e = Math.pow(1 - Math.abs(2 * k - 1), 1.6);
    const src = k < 0.5 ? from : to;
    draw(src);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, e * 1.4);
    draw(src);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = e;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
  } else if (type === 'spin') {
    // Half a turn out, half a turn in, with faint trailing copies for motion blur.
    const speed = Math.sin(Math.PI * k);
    const turn = (src: CanvasImageSource | null, theta: number, alpha: number) => {
      if (!src || alpha <= 0) return;
      for (let i = 2; i >= 0; i--) {
        const th = theta - i * 0.07 * speed * Math.sign(theta || 1);
        const s = coverScale(th, W, H);
        ctx.save();
        ctx.globalAlpha = alpha * (i ? 0.28 : 1);
        ctx.translate(W / 2, H / 2);
        ctx.rotate(th);
        ctx.scale(s, s);
        ctx.translate(-W / 2, -H / 2);
        ctx.drawImage(src, 0, 0, W, H);
        ctx.restore();
      }
    };
    const mix = clamp((k - 0.42) / 0.16, 0, 1);
    turn(from, k * Math.PI, 1);
    turn(to, (k - 1) * Math.PI, mix);
  } else if (type === 'blur') {
    const px = Math.sin(Math.PI * k) * Math.min(W, H) * 0.04;
    if (from) drawBlurred(ctx, from, W, H, px);
    ctx.globalAlpha = k;
    if (to) drawBlurred(ctx, to, W, H, px);
  } else if (type === 'glitch') {
    const e = 1 - Math.abs(2 * k - 1);
    const step = Math.floor(k * 18);
    // Near the cut it flickers between both clips.
    const src = (e > 0.5 && hash(step + 3) < 0.3 ? k >= 0.5 : k < 0.5) ? from : to;
    const other = src === from ? to : from;
    const shift = Math.min(W, H) * 0.045 * e;
    if (src) drawRgbSplit(ctx, src, W, H, shift, shift * 0.2 * (hash(step) - 0.5));
    if (other && e > 0.3) drawTearBands(ctx, other, W, H, step, e);
    if (e > 0.15) drawTearBands(ctx, ctx.canvas, W, H, step + 50, e);
  } else if (type === 'whip') {
    // Fast pan: both pictures slide together, smeared along the move (running average of copies).
    const smear = Math.sin(Math.PI * k) * W * 0.14;
    const n = 6;
    for (let j = 0; j < n; j++) {
      const x = k * W + (j / (n - 1) - 0.5) * smear;
      ctx.globalAlpha = 1 / (j + 1);
      if (from) ctx.drawImage(from, -x, 0, W, H);
      if (to) ctx.drawImage(to, W - x, 0, W, H);
    }
  } else if (type === 'zoomBlur') {
    // Rush into the outgoing picture and back out of the incoming one, blurred by the speed.
    const px = Math.sin(Math.PI * k) * Math.min(W, H) * 0.035;
    const src = k < 0.5 ? from : to;
    const s = 1 + 0.9 * Math.pow(k < 0.5 ? k * 2 : (1 - k) * 2, 2);
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
    if (src) drawBlurred(ctx, src, W, H, px);
  } else if (type === 'filmBurn') {
    // Warm light burns through the film around the cut.
    const e = peak(k);
    draw(from);
    ctx.globalAlpha = k;
    draw(to);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'screen';
    const r = Math.hypot(W, H);
    for (const [seed, rgb] of [[3, '255,120,30'], [9, '255,200,80'], [15, '255,60,40']] as const) {
      const x = (0.5 + smoothNoise(k * 2, seed) * 1.6) * W;
      const y = (0.5 + smoothNoise(k * 2, seed + 1) * 1.6) * H;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * (0.25 + 0.45 * e));
      g.addColorStop(0, `rgba(${rgb},${e.toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.max(0, e - 0.6) * 2;
    ctx.fillStyle = '#fff8e0';
    ctx.fillRect(0, 0, W, H);
  } else if (type === 'shake') {
    // Camera hit at the cut: a hard jolt that settles, with a touch of color split.
    const e = 1 - Math.abs(2 * k - 1);
    const src = k < 0.5 ? from : to;
    const f = k * 40;
    const a = 0.05 * e;
    const s = 1 + a * 2.5;
    ctx.translate(W / 2 + smoothNoise(f, 1) * W * a * 2, H / 2 + smoothNoise(f, 2) * H * a * 2);
    ctx.rotate(smoothNoise(f, 3) * a);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
    if (src) drawRgbSplit(ctx, src, W, H, Math.min(W, H) * 0.02 * e, 0);
  } else if (type === 'pixelate') {
    // Blocks grow until the cut, then the next clip sharpens out of them.
    const e = 1 - Math.abs(2 * k - 1);
    const src = k < 0.5 ? from : to;
    const b = e * e * Math.min(W, H) * 0.09;
    if (src && b > 1.5) {
      const s = scratch(S_SMALL, Math.ceil(W / b), Math.ceil(H / b));
      const sc = s.getContext('2d')!;
      sc.imageSmoothingEnabled = true;
      sc.drawImage(src, 0, 0, s.width, s.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(s, 0, 0, s.width * b, s.height * b);
    } else draw(src);
  } else {
    draw(from);
    ctx.globalAlpha = k;
    draw(to);
  }
  ctx.restore();
}

// ---------- clip effects ----------

export const EFFECTS: { id: EffectId; name: string; /** No intensity slider. */ fixed?: boolean; trend?: true }[] = [
  { id: 'none', name: 'Ninguno' },
  { id: 'beatzoom', name: 'Zoom al ritmo', trend: true },
  { id: 'cinematic', name: 'Cine panorámico', trend: true },
  { id: 'camcorder', name: 'Cámara REC', trend: true },
  { id: 'dreamy', name: 'Ensueño', trend: true },
  { id: 'y2k', name: 'Y2K', trend: true },
  { id: 'sparkle', name: 'Brillitos', trend: true },
  { id: 'strobe', name: 'Destellos', trend: true },
  { id: 'duotone', name: 'Duotono', trend: true },
  { id: 'zoomout', name: 'Alejamiento', trend: true },
  { id: 'kenburns', name: 'Acercamiento' },
  { id: 'shake', name: 'Temblor' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'blur', name: 'Desenfoque' },
  { id: 'vignette', name: 'Viñeta' },
  { id: 'grain', name: 'Grano de película' },
  { id: 'vhs', name: 'VHS' },
  { id: 'rgb', name: 'Separar colores' },
  { id: 'pixelate', name: 'Pixelado' },
  { id: 'mirror', name: 'Espejo', fixed: true },
  { id: 'glow', name: 'Brillo suave' },
  { id: 'lightleak', name: 'Destello de luz' },
  { id: 'bwdrama', name: 'B/N dramático' },
];
export const EFFECT_DEFAULT_INTENSITY = 0.5;
export const effectName = (id: EffectId | undefined) => EFFECTS.find((e) => e.id === id)?.name ?? 'Ninguno';

/** Transform applied before drawing the picture (zoom/pan or shake). */
export function applyEffectTransform(ctx: CanvasRenderingContext2D, clip: Clip, local: number, W: number, H: number) {
  const e = clip.effect;
  if (!e || e.id === 'none') return;
  const amt = clamp(e.intensity, 0, 1);
  if (e.id === 'kenburns') {
    const k = clamp(local / Math.max(0.1, clipDur(clip)), 0, 1);
    const s = 1 + (0.06 + 0.24 * amt) * k;
    // Gentle diagonal drift; the direction is picked from the clip id so consecutive photos differ.
    const dir = clip.id.charCodeAt(0) % 2 ? 1 : -1;
    ctx.translate(W / 2 + dir * W * 0.03 * amt * k, H / 2 - H * 0.02 * amt * k);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
  } else if (e.id === 'zoomout') {
    const k = clamp(local / Math.max(0.1, clipDur(clip)), 0, 1);
    const s = 1 + (0.06 + 0.24 * amt) * (1 - k);
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
  } else if (e.id === 'beatzoom') {
    // A quick zoom punch on every beat.
    const s = 1 + (0.03 + 0.1 * amt) * beatPulse(local);
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
  } else if (e.id === 'blur') {
    // Enlarge a little so the blur doesn't pull dark edges in from outside the picture.
    const s = 1 + 0.03 + 0.07 * amt;
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
  } else if (e.id === 'shake') {
    const f = local * 9;
    const a = 0.035 * amt;
    const s = 1 + a * 2.4;
    ctx.translate(W / 2 + smoothNoise(f, 1) * W * a * 2, H / 2 + smoothNoise(f, 2) * H * a * 2);
    ctx.rotate(smoothNoise(f, 3) * a * 0.6);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
  } else if (e.id === 'rgb' || e.id === 'vhs') {
    // A touch bigger so the shifted color channels don't leave colored edges.
    const s = 1.02 + 0.03 * amt;
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
  }
}

/** Extra CSS filter for the effect (blur), combined with the color filter. */
export function effectCss(clip: Clip, W: number) {
  const e = clip.effect;
  if (e?.id !== 'blur') return '';
  return `blur(${(1 + 11 * clamp(e.intensity, 0, 1)) * (W / 720)}px)`;
}

/** Film grain tiles, made once from the deterministic noise (4 variants that alternate). */
const GRAIN_SIZE = 192;
const grainTiles: HTMLCanvasElement[] = [];
function grainTile(i: number) {
  let c = grainTiles[i];
  if (!c) {
    c = grainTiles[i] = document.createElement('canvas');
    c.width = c.height = GRAIN_SIZE;
    const g = c.getContext('2d')!;
    const img = g.createImageData(GRAIN_SIZE, GRAIN_SIZE);
    const v = grainValues(i + 1, GRAIN_SIZE * GRAIN_SIZE);
    for (let p = 0; p < v.length; p++) {
      img.data[p * 4] = img.data[p * 4 + 1] = img.data[p * 4 + 2] = v[p]!;
      img.data[p * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  return c;
}

/** Fill the frame with a tile repeated at `scale`, starting at (ox, oy). */
function fillTiled(ctx: CanvasRenderingContext2D, tile: HTMLCanvasElement, W: number, H: number, scale: number, ox: number, oy: number) {
  const pat = ctx.createPattern(tile, 'repeat');
  if (!pat) return;
  pat.setTransform(new DOMMatrix().translateSelf(ox, oy).scaleSelf(scale, scale));
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, W, H);
}

let scanTile: HTMLCanvasElement | null = null;

/** Soft bloom: a very blurred copy where bright areas dominate, added back with "screen". */
function bloom(ctx: CanvasRenderingContext2D, W: number, H: number, strength: number, radius: number) {
  const b = scratch(S_COPY, W / 4, H / 4);
  const bc = b.getContext('2d')!;
  bc.globalCompositeOperation = 'copy';
  bc.drawImage(ctx.canvas, 0, 0, b.width, b.height);
  bc.globalCompositeOperation = 'multiply';
  bc.drawImage(b, 0, 0); // squares the values: dark parts drop out
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = Math.min(1, strength);
  drawBlurred(ctx, b, W, H, radius);
  ctx.restore();
}

/** A four-point twinkle star. */
function star4(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const k = r * 0.18;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + k, y - k, x + r, y);
  ctx.quadraticCurveTo(x + k, y + k, x, y + r);
  ctx.quadraticCurveTo(x - k, y + k, x - r, y);
  ctx.quadraticCurveTo(x - k, y - k, x, y - r);
  ctx.fill();
}

/** Stars that twinkle in and out at fixed places (picked from `seed`). */
function drawSparkles(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, count: number, seed: number) {
  const short = Math.min(W, H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(255,240,200,0.9)';
  for (let i = 0; i < count; i++) {
    const tw = Math.sin(t * (2 + hash(i + seed) * 3) + i * 1.7);
    if (tw <= 0) continue;
    const r = short * (0.012 + 0.03 * hash(i * 5 + seed + 1)) * tw;
    ctx.globalAlpha = tw;
    ctx.shadowBlur = r * 1.5;
    star4(ctx, hash(i * 7 + seed) * W, hash(i * 13 + seed + 3) * H, r);
  }
  ctx.restore();
}

/** Overlays drawn after the picture. `ctx.canvas` holds the frame so far (W×H, nothing else). */
export function applyEffectOverlay(ctx: CanvasRenderingContext2D, clip: Clip, local: number, W: number, H: number) {
  const e = clip.effect;
  if (!e || e.id === 'none') return;
  const amt = clamp(e.intensity, 0, 1);
  const short = Math.min(W, H);
  const canvas = ctx.canvas;
  if (e.id === 'vignette') {
    const r = Math.hypot(W, H) / 2;
    const g = ctx.createRadialGradient(W / 2, H / 2, r * (0.55 - 0.3 * amt), W / 2, H / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${0.45 + 0.5 * amt})`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  } else if (e.id === 'glitch') {
    const step = Math.floor(local * 14);
    // Glitches come in short bursts; stronger intensity = more often and bigger.
    if (hash(step) > 0.25 + 0.55 * amt) return;
    ctx.save();
    const shift = W * (0.01 + 0.025 * amt);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(canvas, shift, 0, W, H);
    ctx.fillStyle = 'rgba(255,0,90,0.18)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    drawTearBands(ctx, canvas, W, H, step, amt);
    ctx.restore();
  } else if (e.id === 'grain') {
    const step = Math.floor(local * 24);
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.12 + 0.43 * amt;
    fillTiled(ctx, grainTile(step % 4), W, H, Math.max(1, short / 720), hash(step) * GRAIN_SIZE, hash(step + 1) * GRAIN_SIZE);
    ctx.restore();
  } else if (e.id === 'rgb') {
    const f = local * 1.5;
    const d = short * (0.004 + 0.016 * amt) * (0.75 + smoothNoise(f, 5) * 0.7);
    drawRgbSplit(ctx, canvas, W, H, d, d * 0.35 * smoothNoise(f, 6));
  } else if (e.id === 'vhs') {
    const step = Math.floor(local * 30);
    drawRgbSplit(ctx, canvas, W, H, short * (0.003 + 0.004 * amt), 0);
    ctx.save();
    // Washed-out tape colors.
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.25 + 0.2 * amt;
    ctx.fillStyle = '#5a3c8c';
    ctx.fillRect(0, 0, W, H);
    // Tracking band rolling down the screen.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const bh = H * (0.03 + 0.05 * amt);
    const by = (((local * 0.22 + hash(clip.id.length)) % 1.3) - 0.15) * H;
    ctx.drawImage(canvas, 0, by, W, bh, short * 0.02 * (0.5 + amt), by, W, bh);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.18 + 0.2 * amt;
    fillTiled(ctx, grainTile(step % 4), W, bh, Math.max(1, short / 360), 0, by);
    // A few jittered lines.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    for (let i = 0; i < 3; i++) {
      if (hash(step * 7 + i) > 0.35 + 0.4 * amt) continue;
      const y = hash(step * 11 + i) * H;
      const h = Math.max(1, H * 0.004);
      ctx.drawImage(canvas, 0, y, W, h, (hash(step * 3 + i) - 0.5) * short * 0.03, y, W, h);
    }
    // Scanlines: a dark line every few pixels (about every 3 px at 720p).
    if (!scanTile) {
      scanTile = document.createElement('canvas');
      scanTile.width = 1;
      scanTile.height = 3;
      const s = scanTile.getContext('2d')!;
      s.fillStyle = '#000';
      s.fillRect(0, 2, 1, 1);
    }
    ctx.globalAlpha = 0.25 + 0.35 * amt;
    fillTiled(ctx, scanTile, W, H, Math.max(1, short / 720), 0, 0);
    ctx.restore();
  } else if (e.id === 'pixelate') {
    const b = pixelBlock(amt, W, H);
    const s = scratch(S_SMALL, Math.ceil(W / b), Math.ceil(H / b));
    const sc = s.getContext('2d')!;
    sc.imageSmoothingEnabled = true;
    sc.imageSmoothingQuality = 'medium';
    sc.drawImage(canvas, 0, 0, s.width, s.height);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(s, 0, 0, s.width * b, s.height * b);
    ctx.restore();
  } else if (e.id === 'mirror') {
    // The left half reflected onto the right half.
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(canvas, 0, 0, W / 2, H, 0, 0, W / 2, H);
    ctx.restore();
  } else if (e.id === 'glow') {
    bloom(ctx, W, H, 0.5 + 0.6 * amt, short * (0.015 + 0.025 * amt));
  } else if (e.id === 'strobe') {
    // Overexposed flash on every beat.
    const a = beatPulse(local) * (0.25 + 0.55 * amt);
    if (a < 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.drawImage(canvas, 0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a * 0.6;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  } else if (e.id === 'dreamy') {
    bloom(ctx, W, H, 0.55 + 0.45 * amt, short * (0.03 + 0.03 * amt));
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.25 + 0.3 * amt;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#ffb6e1');
    g.addColorStop(1, '#b8c6ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Lifted blacks, like a faded print.
    ctx.globalCompositeOperation = 'lighten';
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgb(${Math.round(30 + 30 * amt)},${Math.round(22 + 25 * amt)},${Math.round(40 + 30 * amt)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  } else if (e.id === 'y2k') {
    drawRgbSplit(ctx, canvas, W, H, short * (0.004 + 0.006 * amt), 0);
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.35 + 0.35 * amt;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#ff4fd8');
    g.addColorStop(0.5, '#7b6cff');
    g.addColorStop(1, '#3ff2ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    bloom(ctx, W, H, 0.35 + 0.4 * amt, short * 0.02);
    drawSparkles(ctx, W, H, local, 4 + Math.round(6 * amt), clip.id.length);
  } else if (e.id === 'cinematic') {
    ctx.save();
    // Teal shadows and warm highlights, then widescreen bars.
    ctx.globalCompositeOperation = 'lighten';
    ctx.globalAlpha = 0.5 + 0.4 * amt;
    ctx.fillStyle = '#0a2e36';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.35 + 0.4 * amt;
    ctx.fillStyle = '#ffd6a8';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    const bar = H * letterboxBar(W, H);
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
    ctx.restore();
  } else if (e.id === 'camcorder') {
    ctx.save();
    // Slightly noisy home-video picture under a viewfinder.
    const step = Math.floor(local * 24);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.1 + 0.25 * amt;
    fillTiled(ctx, grainTile(step % 4), W, H, Math.max(1, short / 720), hash(step) * GRAIN_SIZE, hash(step + 1) * GRAIN_SIZE);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const m = short * 0.06;
    const L = short * 0.07;
    const lw = Math.max(1, short * 0.005);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = lw;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = lw * 2;
    ctx.beginPath();
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
      ctx.moveTo(x, y + sy * L);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * L, y);
    }
    ctx.stroke();
    const fs = short * 0.045;
    const ty = m + L * 0.6;
    ctx.font = `700 ${fs}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('REC', m + L * 0.5 + fs * 0.6, ty);
    ctx.textAlign = 'right';
    ctx.fillText(recTimecode(local), W - m - L * 0.3, H - m - L * 0.6);
    // Battery, top right.
    const bw = fs * 1.5;
    const bh = fs * 0.75;
    const bx = W - m - L * 0.3 - bw;
    ctx.strokeRect(bx, ty - bh / 2, bw, bh);
    ctx.fillRect(bx + bw, ty - bh / 4, lw * 1.5, bh / 2);
    for (let i = 0; i < 3; i++) ctx.fillRect(bx + lw * 1.5 + i * (bw - lw * 3) / 3, ty - bh / 2 + lw * 1.5, (bw - lw * 3) / 3 - lw, bh - lw * 3);
    // Blinking red dot.
    if (Math.floor(local * 1.6) % 2 === 0) {
      ctx.shadowColor = 'rgba(255,59,48,0.8)';
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.arc(m + L * 0.5, ty, fs * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (e.id === 'duotone') {
    // Purple shadows and peach highlights; lower intensity lets the original colors through.
    const orig = scratch(S_COPY, W, H);
    const oc = orig.getContext('2d')!;
    oc.globalCompositeOperation = 'copy';
    oc.drawImage(canvas, 0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = '#2a0b5e';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#ffb27a';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = (1 - amt) * 0.7;
    ctx.drawImage(orig, 0, 0, W, H);
    ctx.restore();
  } else if (e.id === 'sparkle') {
    drawSparkles(ctx, W, H, local, 6 + Math.round(12 * amt), 0);
  } else if (e.id === 'lightleak') {
    // Warm light drifting in from the edges, like film exposed to light.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const r = Math.hypot(W, H);
    const spots: [number, string][] = [[11, '255,150,50'], [23, '255,70,110']];
    for (const [seed, rgb] of spots) {
      const x = (0.5 + smoothNoise(local * 0.4, seed) * 2.2) * W;
      const y = (0.5 + smoothNoise(local * 0.35, seed + 1) * 2.2) * H;
      const a = (0.3 + 0.55 * amt) * (0.65 + smoothNoise(local * 0.8, seed + 2) * 0.7);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * (0.35 + 0.2 * amt));
      g.addColorStop(0, `rgba(${rgb},${a.toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  } else if (e.id === 'bwdrama') {
    ctx.save();
    // Remove the color, then add contrast by blending the picture with itself.
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.45 + 0.55 * amt;
    ctx.drawImage(canvas, 0, 0, W, H);
    const r = Math.hypot(W, H) / 2;
    const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.45, W / 2, H / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${(0.3 + 0.4 * amt).toFixed(3)})`);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

// ---------- text animations ----------

export const TEXT_IN: { id: TextInAnim; name: string; trend?: true }[] = [
  { id: 'none', name: 'Ninguna' },
  { id: 'slam', name: 'Golpe', trend: true },
  { id: 'words', name: 'Palabra a palabra', trend: true },
  { id: 'blurIn', name: 'Enfocar', trend: true },
  { id: 'drop', name: 'Caer', trend: true },
  { id: 'slideLeft', name: 'Entrar de lado', trend: true },
  { id: 'fade', name: 'Aparecer' },
  { id: 'pop', name: 'Rebote' },
  { id: 'slideUp', name: 'Subir' },
  { id: 'typewriter', name: 'Máquina de escribir' },
];
export const TEXT_OUT: { id: TextOutAnim; name: string; trend?: true }[] = [
  { id: 'none', name: 'Ninguna' },
  { id: 'blurOut', name: 'Desenfocar', trend: true },
  { id: 'up', name: 'Salir hacia arriba', trend: true },
  { id: 'fade', name: 'Desvanecer' },
  { id: 'pop', name: 'Encoger' },
];
export const TEXT_LOOP: { id: TextLoopAnim; name: string; trend?: true }[] = [
  { id: 'none', name: 'Ninguna' },
  { id: 'wiggle', name: 'Bailar', trend: true },
  { id: 'float', name: 'Flotar', trend: true },
  { id: 'shake', name: 'Temblar', trend: true },
  { id: 'bounce', name: 'Saltar' },
  { id: 'pulse', name: 'Latido' },
];
export const NO_ANIM: TextAnim = { in: 'none', out: 'none', loop: 'none' };

export interface TextPose {
  alpha: number;
  scale: number;
  /** Vertical offset as a fraction of the frame height. */
  dy: number;
  /** Characters to show (typewriter, word by word); undefined = all. */
  chars?: number;
  /** Horizontal offset as a fraction of the frame width. */
  dx?: number;
  /** Rotation in radians around the text's center. */
  rot?: number;
  /** Blur as a fraction of the font size. */
  blur?: number;
}

const backOut = (x: number) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);
/** Falls and bounces twice before resting at 1. */
function bounceOut(x: number) {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}

/** Characters of `text` to show `local` seconds in when it appears word by word (always at least one word). */
export function wordRevealChars(text: string, local: number, duration: number) {
  const ends = [...text.matchAll(/\S+/g)].map((m) => m.index! + m[0].length);
  if (!ends.length) return 0;
  const len = Math.min(duration * 0.6, Math.max(0.4, ends.length * 0.3));
  const n = Math.min(ends.length, Math.floor(clamp(local / len, 0, 1) * ends.length) + 1);
  return ends[n - 1]!;
}

/** How a text looks `local` seconds after it appears. */
export function textPose(item: TextItem, local: number): TextPose {
  const a = item.anim ?? NO_ANIM;
  const pose: TextPose = { alpha: 1, scale: 1, dy: 0 };
  const d = item.duration;
  const inLen = Math.min(a.in === 'drop' ? 0.7 : 0.45, d / 3);
  const outLen = Math.min(0.4, d / 3);
  if (a.in !== 'none') {
    if (a.in === 'typewriter') {
      const n = item.text.length;
      const len = Math.min(d * 0.6, Math.max(0.4, n * 0.055));
      pose.chars = Math.floor(clamp(local / len, 0, 1) * n);
    } else if (a.in === 'words') {
      pose.chars = wordRevealChars(item.text, local, d);
    } else if (local < inLen) {
      const k = clamp(local / inLen, 0, 1);
      if (a.in === 'fade') pose.alpha = k;
      else if (a.in === 'pop') {
        pose.scale = 0.3 + 0.7 * backOut(k);
        pose.alpha = Math.min(1, k * 3);
      } else if (a.in === 'slideUp') {
        const e = 1 - Math.pow(1 - k, 3);
        pose.dy = (1 - e) * 0.08;
        pose.alpha = e;
      } else if (a.in === 'slam') {
        // Hits the screen from very big.
        const e = 1 - Math.pow(1 - k, 3);
        pose.scale = 1 + 1.6 * (1 - e);
        pose.alpha = Math.min(1, k * 4);
      } else if (a.in === 'blurIn') {
        const e = 1 - Math.pow(1 - k, 2);
        pose.alpha = e;
        pose.blur = (1 - e) * 0.35;
        pose.scale = 1.12 - 0.12 * e;
      } else if (a.in === 'drop') {
        pose.dy = -(1 - bounceOut(k)) * 0.15;
        pose.alpha = Math.min(1, k * 4);
      } else if (a.in === 'slideLeft') {
        const e = 1 - Math.pow(1 - k, 3);
        pose.dx = (1 - e) * 0.3;
        pose.alpha = e;
      }
    }
  }
  const left = d - local;
  if (a.out !== 'none' && left < outLen) {
    const k = clamp(left / outLen, 0, 1);
    pose.alpha *= k;
    if (a.out === 'pop') pose.scale *= 0.4 + 0.6 * k;
    else if (a.out === 'blurOut') pose.blur = (pose.blur ?? 0) + (1 - k) * 0.35;
    else if (a.out === 'up') pose.dy -= (1 - k) * 0.06;
  }
  if (a.loop === 'bounce') pose.dy -= Math.abs(Math.sin(Math.PI * local * 1.6)) * 0.025;
  else if (a.loop === 'pulse') pose.scale *= 1 + 0.07 * Math.sin(2 * Math.PI * local * 1.3);
  else if (a.loop === 'wiggle') pose.rot = Math.sin(2 * Math.PI * local * 1.2) * 0.07;
  else if (a.loop === 'float') pose.dy -= Math.sin(2 * Math.PI * local * 0.45) * 0.012;
  else if (a.loop === 'shake') {
    pose.dx = (pose.dx ?? 0) + smoothNoise(local * 16, 1) * 0.012;
    pose.dy += smoothNoise(local * 16, 2) * 0.008;
  }
  return pose;
}

// ---------- stickers ----------

export const EMOJI_GROUPS: { name: string; list: string[] }[] = [
  { name: 'Caras', list: ['😀', '😂', '🤣', '😍', '🥰', '😎', '🤩', '😜', '🤔', '😮', '😱', '😭', '😡', '🥳', '😴', '🤯', '🙄', '😇', '🤗', '🤫'] },
  { name: 'Gestos', list: ['👍', '👎', '👏', '🙌', '🙏', '💪', '👋', '✌️', '🤞', '👌', '👉', '👈', '👆', '👇', '🫶', '🤝'] },
  { name: 'Símbolos', list: ['❤️', '🔥', '✨', '⭐', '💯', '✅', '❌', '⚠️', '❓', '❗', '💥', '💫', '🎉', '🎊', '💡', '🔔', '📍', '➡️', '⬅️', '⬆️', '⬇️', '🆕', '🆗'] },
  { name: 'Cosas', list: ['🎵', '🎬', '📸', '🎁', '🏆', '💰', '🛒', '📱', '💻', '🍕', '🍔', '☕', '🍰', '🌮', '🎂', '⚽', '🏀', '🚗', '✈️', '🏠'] },
  { name: 'Naturaleza', list: ['☀️', '🌙', '🌈', '⛄', '🌸', '🌻', '🌴', '🍀', '🐶', '🐱', '🦄', '🐻', '🦋', '🐟', '🌊', '❄️'] },
];
export const STICKER_DEFAULT_SIZE = 0.25;

export interface StickerBox {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

/** Draw a sticker; returns its (unrotated) box around the center for hit testing. */
export function drawSticker(
  ctx: CanvasRenderingContext2D, st: StickerItem, img: HTMLImageElement | undefined, W: number, H: number,
  pose?: { x: number; y: number; size: number; rotation: number },
): StickerBox | null {
  const { x, y, size, rotation } = pose ?? st;
  const short = Math.min(W, H);
  const w = size * short;
  let h = w;
  const art = st.assetId ? undefined : emojiImage(st.emoji);
  const cx = x * W;
  const cy = y * H;
  if (art) redrawWhenLoaded(art);
  if (img) redrawWhenLoaded(img);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  if (st.assetId) {
    if (!img || !img.complete || !img.naturalWidth) {
      ctx.restore();
      return null;
    }
    h = (w * img.naturalHeight) / img.naturalWidth;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  } else if (art && art.complete && art.naturalWidth) {
    ctx.drawImage(art, -w / 2, -h / 2, w, h);
  } else {
    ctx.font = `${w * 0.86}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.emoji ?? '⭐', 0, w * 0.04);
  }
  ctx.restore();
  return { id: st.id, cx, cy, w, h, rot: rotation };
}

/** Is canvas point (x, y) inside a rotated sticker box (with some slack for fingers)? */
export function hitSticker(b: StickerBox, x: number, y: number, slack = 0) {
  const dx = x - b.cx;
  const dy = y - b.cy;
  const c = Math.cos(-b.rot);
  const s = Math.sin(-b.rot);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) <= b.w / 2 + slack && Math.abs(ly) <= b.h / 2 + slack;
}

/** Canvas position of the rotate/resize handle (bottom-right corner) of a sticker box. */
export function stickerHandle(b: StickerBox) {
  const lx = b.w / 2;
  const ly = b.h / 2;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return { x: b.cx + lx * c - ly * s, y: b.cy + lx * s + ly * c };
}

export const stickersOf = (p: Project) => p.stickers ?? [];

/** Radius of the sticker's corner handle in canvas pixels. */
export const stickerHandleRadius = (W: number) => Math.max(12, W / 40);
