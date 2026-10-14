// Catalogs and math for transitions, clip effects, text animations and stickers.
// Everything here is pure drawing/timing logic so the engine (preview and export) shares it.
import type { Clip, EffectId, Project, StickerItem, TextAnim, TextInAnim, TextItem, TextLoopAnim, TextOutAnim, TransitionId } from './types';
import { clamp, clipDur, type Placed } from './model';
import { emojiImage } from './stickers';

// ---------- transitions ----------

export const TRANSITIONS: { id: TransitionId; name: string }[] = [
  { id: 'none', name: 'Corte' },
  { id: 'fade', name: 'Fundido' },
  { id: 'slide', name: 'Deslizar' },
  { id: 'zoom', name: 'Zoom' },
  { id: 'wipe', name: 'Barrido' },
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
}

/** The transition happening at time t, if any. It is centered on the cut between two clips. */
export function transitionAt(placed: Placed[], t: number): ActiveTransition | null {
  for (let i = 0; i < placed.length - 1; i++) {
    const a = placed[i];
    const b = placed[i + 1];
    const d = transitionLength(a.clip, b.clip);
    if (!d) continue;
    const from = a.end - d / 2;
    if (t >= from && t < a.end + d / 2) {
      const raw = (t - from) / d;
      return { type: a.clip.transition!.type, out: a, in: b, k: raw * raw * (3 - 2 * raw) };
    }
  }
  return null;
}

/**
 * Source time to show for a clip at timeline time t. Outside the clip's own range (during a
 * transition) it keeps going into the media's spare footage, or holds the first/last frame.
 */
export function sourceTime(l: Placed, t: number, assetDuration: number) {
  const c = l.clip;
  const raw = c.in + (t - l.start) * c.speed;
  return clamp(raw, 0, Math.max(0, assetDuration - 0.05));
}

/** Composite two already-rendered frames for a transition. */
export function drawTransition(ctx: CanvasRenderingContext2D, type: TransitionId, from: CanvasImageSource | null, to: CanvasImageSource | null, k: number, W: number, H: number) {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const draw = (src: CanvasImageSource | null) => src && ctx.drawImage(src, 0, 0, W, H);
  if (type === 'slide') {
    ctx.translate(-k * W, 0);
    draw(from);
    ctx.translate(W, 0);
    draw(to);
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
  } else {
    draw(from);
    ctx.globalAlpha = k;
    draw(to);
  }
  ctx.restore();
}

// ---------- clip effects ----------

export const EFFECTS: { id: EffectId; name: string }[] = [
  { id: 'none', name: 'Ninguno' },
  { id: 'kenburns', name: 'Acercamiento' },
  { id: 'shake', name: 'Temblor' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'blur', name: 'Desenfoque' },
  { id: 'vignette', name: 'Viñeta' },
];
export const EFFECT_DEFAULT_INTENSITY = 0.5;
export const effectName = (id: EffectId | undefined) => EFFECTS.find((e) => e.id === id)?.name ?? 'Ninguno';

/** Cheap deterministic noise so effects look the same in preview and export. */
function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function smoothNoise(t: number, seed: number) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return hash(i + seed * 101) * (1 - u) + hash(i + 1 + seed * 101) * u - 0.5;
}

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
  }
}

/** Extra CSS filter for the effect (blur), combined with the color filter. */
export function effectCss(clip: Clip, W: number) {
  const e = clip.effect;
  if (e?.id !== 'blur') return '';
  return `blur(${(1 + 11 * clamp(e.intensity, 0, 1)) * (W / 720)}px)`;
}

/** Overlays drawn after the picture (vignette, glitch). `ctx.canvas` holds the frame so far. */
export function applyEffectOverlay(ctx: CanvasRenderingContext2D, clip: Clip, local: number, W: number, H: number) {
  const e = clip.effect;
  if (!e || e.id === 'none') return;
  const amt = clamp(e.intensity, 0, 1);
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
    const canvas = ctx.canvas;
    ctx.save();
    const shift = W * (0.01 + 0.025 * amt);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(canvas, shift, 0, W, H);
    ctx.fillStyle = 'rgba(255,0,90,0.18)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const bands = 3 + Math.floor(hash(step + 7) * 5 * (0.5 + amt));
    for (let i = 0; i < bands; i++) {
      const y = hash(step * 13 + i) * H;
      const h = H * (0.01 + hash(step * 17 + i) * 0.07);
      const dx = (hash(step * 19 + i) - 0.5) * W * 0.18 * (0.4 + amt);
      ctx.drawImage(canvas, 0, y, W, h, dx, y, W, h);
    }
    ctx.restore();
  }
}

// ---------- text animations ----------

export const TEXT_IN: { id: TextInAnim; name: string }[] = [
  { id: 'none', name: 'Ninguna' },
  { id: 'fade', name: 'Aparecer' },
  { id: 'pop', name: 'Rebote' },
  { id: 'slideUp', name: 'Subir' },
  { id: 'typewriter', name: 'Máquina de escribir' },
];
export const TEXT_OUT: { id: TextOutAnim; name: string }[] = [
  { id: 'none', name: 'Ninguna' },
  { id: 'fade', name: 'Desvanecer' },
  { id: 'pop', name: 'Encoger' },
];
export const TEXT_LOOP: { id: TextLoopAnim; name: string }[] = [
  { id: 'none', name: 'Ninguna' },
  { id: 'bounce', name: 'Saltar' },
  { id: 'pulse', name: 'Latido' },
];
export const NO_ANIM: TextAnim = { in: 'none', out: 'none', loop: 'none' };

export interface TextPose {
  alpha: number;
  scale: number;
  /** Vertical offset as a fraction of the frame height. */
  dy: number;
  /** Characters to show (typewriter); undefined = all. */
  chars?: number;
}

const backOut = (x: number) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);

/** How a text looks `local` seconds after it appears. */
export function textPose(item: TextItem, local: number): TextPose {
  const a = item.anim ?? NO_ANIM;
  const pose: TextPose = { alpha: 1, scale: 1, dy: 0 };
  const d = item.duration;
  const inLen = Math.min(0.45, d / 3);
  const outLen = Math.min(0.4, d / 3);
  if (a.in !== 'none') {
    if (a.in === 'typewriter') {
      const n = item.text.length;
      const len = Math.min(d * 0.6, Math.max(0.4, n * 0.055));
      pose.chars = Math.floor(clamp(local / len, 0, 1) * n);
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
      }
    }
  }
  const left = d - local;
  if (a.out !== 'none' && left < outLen) {
    const k = clamp(left / outLen, 0, 1);
    pose.alpha *= k;
    if (a.out === 'pop') pose.scale *= 0.4 + 0.6 * k;
  }
  if (a.loop === 'bounce') pose.dy -= Math.abs(Math.sin(Math.PI * local * 1.6)) * 0.025;
  else if (a.loop === 'pulse') pose.scale *= 1 + 0.07 * Math.sin(2 * Math.PI * local * 1.3);
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
export function drawSticker(ctx: CanvasRenderingContext2D, st: StickerItem, img: HTMLImageElement | undefined, W: number, H: number): StickerBox | null {
  const short = Math.min(W, H);
  const w = st.size * short;
  let h = w;
  const art = st.assetId ? undefined : emojiImage(st.emoji);
  const cx = st.x * W;
  const cy = st.y * H;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(st.rotation);
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
  return { id: st.id, cx, cy, w, h, rot: st.rotation };
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
