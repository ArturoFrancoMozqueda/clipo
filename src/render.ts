// The frame compositor: draws the whole project at one moment onto a 2D canvas. Pure drawing (no
// playback, audio or store), shared by the live preview and the fast export so both look identical.
// Scratch canvases are made on first use, so importing this module never touches the DOM.
import type { Asset, Clip, ColorAdjust, OverlayItem, Project } from './types';
import { activeClip, clamp, layout, overlayDur, overlaysOf, type Placed } from './model';
import { applyFallback, getFilter, supportsCanvasFilter, type Filter } from './filters';
import { drawText, type Box } from './textStyles';
import {
  applyEffectOverlay, applyEffectTransform, drawSticker, drawTransition, effectCss, sourceTime, stickersOf, textPose,
  transitionAt, type StickerBox,
} from './visuals';
import { colorCss, drawVignette, isNeutral } from './color';
import { poseAt, type Pose } from './keyframes';
import { maskFor, maskImageOf, type Mask } from './segmentation';
import { colorOnGpu, gradeCanvas } from './grade';
import { framed, hasFraming, pointInFrame } from './framing';
import { coverRect, trackAt } from './reframe';

/** A decoded picture of a clip, ready to draw. A zero size means "nothing to show" (drawn black). */
export interface FrameImage {
  src: CanvasImageSource;
  w: number;
  h: number;
}

/** What a frame lookup needs to know about a main-track clip or an overlay. */
export type MediaRef = Pick<Clip, 'id' | 'assetId'>;

/** Returns the picture of `clip` (or an overlay) at source time `srcTime` (seconds), or null while it isn't ready. */
export type FrameLookup = (clip: MediaRef, asset: Asset, srcTime: number) => FrameImage | null;

export interface RenderOptions {
  /** Image for a sticker made from a picture. */
  stickerImage?: (assetId: string) => HTMLImageElement | undefined;
  /**
   * Fail (return null) when the other clip of a transition isn't ready, instead of showing the
   * current clip alone. The export uses it so every transition frame is complete.
   */
  waitForAll?: boolean;
  /** Smooth playback matters more than detail (cheaper background removal). */
  live?: boolean;
}

export interface RenderResult {
  texts: Box[];
  stickers: StickerBox[];
  overlays: StickerBox[];
}

// Offscreen canvases, one per role so alternating sizes never reallocate them every frame.
const C_FIT_BG = 0; // blurred copy behind a "fit" picture
const C_BLUR_BG = 1; // blurred background of a cut-out person
const C_SOFT = 2; // blur without canvas filters
const C_CUT = 3; // the cut-out person of a clip with "Quitar fondo", before it goes over the new background
const C_OVERLAY = 4; // one overlay, colored before it is blended onto the frame
const C_LAYER = 5; // 5 and 6: the outgoing and incoming clip during a transition
const scratch: HTMLCanvasElement[] = [];

function canvasFor(role: number, w: number, h: number) {
  let c = scratch[role];
  if (!c) c = scratch[role] = document.createElement('canvas');
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/**
 * Draws the whole project at time t: pictures with filters, effects and transitions, then stickers
 * and texts. Shared by the live preview and the fast export so both look identical. Returns the
 * on-screen boxes, or null (nothing drawn) when a picture it needs isn't ready yet.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  p: Project,
  t: number,
  W: number,
  H: number,
  lookup: FrameLookup,
  placed: Placed[] = layout(p),
  opts: RenderOptions = {},
): RenderResult | null {
  const frameAt = (l: Placed): FrameImage | null | undefined => {
    const asset = p.assets[l.clip.assetId];
    if (asset?.kind !== 'video' && asset?.kind !== 'image') return undefined; // missing file: draw black
    const f = lookup(l.clip, asset, sourceTime(l, t, asset.duration));
    return f && framed(l.clip, f); // crop and flip
  };

  /** Mask and background of a clip with "Quitar fondo"; null when the export must wait for them. */
  const cutoutOf = (l: Placed, f: FrameImage): Cutout | null | undefined => {
    const bgr = l.clip.bgRemoval;
    const asset = p.assets[l.clip.assetId];
    if (!bgr || !asset) return undefined;
    const st = sourceTime(l, t, asset.duration);
    const framing = hasFraming(l.clip) ? `#${JSON.stringify([l.clip.crop, l.clip.flipH, l.clip.flipV])}` : ''; // cropped/flipped pictures get their own masks
    const key = (asset.kind === 'image' ? `${asset.id}@img` : `${asset.id}@${Math.round(st * 30)}`) + framing;
    // The export waits for the exact mask; the preview never blocks on the model.
    const mask = maskFor(key, asset.id, f.src, f.w, f.h, !!opts.live, !!opts.waitForAll);
    if (!mask && opts.waitForAll) return null;
    let bgFrame: FrameImage | null = null;
    const bg = bgClip(p, l);
    if (bg) {
      bgFrame = lookup(bg.clip, bg.asset, bgTime(bg.asset, l, t));
      if (!bgFrame && opts.waitForAll) return null;
    }
    return { bg: bgr, mask, bgFrame };
  };

  const cur = activeClip(p, t, placed);
  const tr = cur ? transitionAt(placed, t) : null;
  const source = cur ? frameAt(cur) : undefined;
  if (source === null) return null;

  if (tr && cur) {
    const partner = tr.out.index === cur.index ? tr.in : tr.out;
    const other = frameAt(partner);
    if (other === null && opts.waitForAll) return null;
    // Render both clips offscreen, then mix them. If the other clip isn't decoded yet, show the current one alone.
    const fa = tr.out.index === cur.index ? source : other;
    const fb = tr.in.index === cur.index ? source : other;
    const pa = fa && fa.w && fa.h ? { l: tr.out, f: fa, cut: cutoutOf(tr.out, fa) } : null;
    const pb = fb && fb.w && fb.h ? { l: tr.in, f: fb, cut: cutoutOf(tr.in, fb) } : null;
    if (pa?.cut === null || pb?.cut === null) return null;
    const draw = (x: typeof pa, i: number) => {
      if (!x) return null;
      const c = canvasFor(C_LAYER + i, W, H);
      drawClip(c.getContext('2d')!, x.l, x.f, t, W, H, x.cut ?? undefined, lutOf(p, x.l.clip));
      return c;
    };
    const a = draw(pa, 0);
    const b = draw(pb, 1);
    drawTransition(ctx, tr.type, a ?? b, b ?? a, tr.k, W, H, tr.dir);
  } else if (cur && source && source.w && source.h) {
    const cut = cutoutOf(cur, source);
    if (cut === null) return null;
    drawClip(ctx, cur, source, t, W, H, cut, lutOf(p, cur.clip));
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
  }

  // Picture-in-picture track, above the main one.
  const overlays: StickerBox[] = [];
  for (const ov of overlaysOf(p)) {
    const local = t - ov.start;
    if (local < 0 || local >= overlayDur(ov)) continue;
    const asset = p.assets[ov.assetId];
    if (asset?.kind !== 'video' && asset?.kind !== 'image') continue;
    const f = lookup(ov, asset, clamp(ov.in + local, 0, Math.max(0, asset.duration - 0.05)));
    if (f === null && opts.waitForAll) return null;
    if (!f || !f.w || !f.h) continue; // not decoded yet in the preview: skip it this frame
    overlays.push(drawOverlay(ctx, ov, poseAt(ov, local), f, W, H));
  }

  const stickers: StickerBox[] = [];
  for (const st of stickersOf(p)) {
    if (t < st.start || t >= st.start + st.duration) continue;
    const pose = poseAt(st, t - st.start);
    ctx.save();
    ctx.globalAlpha = clamp(pose.opacity, 0, 1);
    const b = drawSticker(ctx, st, st.assetId ? opts.stickerImage?.(st.assetId) : undefined, W, H, pose);
    ctx.restore();
    if (b) stickers.push(b);
  }

  const texts: Box[] = [];
  for (const item of p.texts) {
    if (t < item.start || t >= item.start + item.duration || !item.text.trim()) continue;
    const pose = poseAt(item, t - item.start);
    ctx.save();
    ctx.globalAlpha = clamp(pose.opacity, 0, 1);
    if (pose.rotation) {
      ctx.translate(pose.x * W, pose.y * H);
      ctx.rotate(pose.rotation);
      ctx.translate(-pose.x * W, -pose.y * H);
    }
    texts.push(drawText(ctx, item, W, H, item.anim ? textPose(item, t - item.start) : undefined, t - item.start, pose));
    ctx.restore();
  }
  return { texts, stickers, overlays };
}

const BLEND_OPS: Record<OverlayItem['blend'], GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'soft-light': 'soft-light',
  difference: 'difference',
};

/** Paint one overlay: colored on its own layer, then placed with its pose, opacity and blend mode. */
function drawOverlay(ctx: CanvasRenderingContext2D, ov: OverlayItem, pose: Pose, f: FrameImage, W: number, H: number): StickerBox {
  const w = Math.max(1, pose.size * W);
  const h = (w * f.h) / f.w;
  const cx = pose.x * W;
  const cy = pose.y * H;
  // The layer never needs many more pixels than the output frame has.
  const k = Math.min(1, (2 * Math.max(W, H)) / Math.max(w, h));
  const lw = Math.max(1, Math.round(w * k));
  const lh = Math.max(1, Math.round(h * k));
  const layer = canvasFor(C_OVERLAY, lw, lh);
  const lc = layer.getContext('2d')!;
  lc.clearRect(0, 0, lw, lh);
  drawFrame(lc, f.src, f.w, f.h, lw, lh, 'fill', ov.filter ?? 'none', ov.color, '');
  gradeCanvas(lc, colorPass(ov.color), undefined, 0);
  drawVignette(lc, ov.color, lw, lh);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(pose.rotation);
  ctx.globalAlpha = clamp(pose.opacity, 0, 1);
  ctx.globalCompositeOperation = BLEND_OPS[ov.blend] ?? 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(layer, -w / 2, -h / 2, w, h);
  ctx.restore();
  return { id: ov.id, cx, cy, w, h, rot: pose.rotation };
}

/** "Quitar fondo" data for one frame of a clip. Without a mask (model still loading) the clip draws as usual. */
interface Cutout {
  bg: NonNullable<Clip['bgRemoval']>;
  mask: Mask | null;
  /** Picture for the 'media' background, null while not decoded. */
  bgFrame: FrameImage | null;
}

/** Id under which the background video of a clip is decoded (preview element / export reader). */
export const bgClipId = (clipId: string) => `${clipId}~bg`;

/** The background photo/video of a clip as a pseudo-clip the frame lookups understand. */
export function bgClip(p: Project, l: Placed): { clip: Clip; asset: Asset } | null {
  const b = l.clip.bgRemoval;
  const asset = b?.mode === 'media' && b.assetId ? p.assets[b.assetId] : undefined;
  if (!asset || (asset.kind !== 'video' && asset.kind !== 'image')) return null;
  return { clip: { ...l.clip, id: bgClipId(l.clip.id), assetId: asset.id, in: 0, out: asset.duration, speed: 1, bgRemoval: undefined }, asset };
}

/** Background videos start with the clip and loop. */
export function bgTime(asset: Asset, l: Placed, t: number) {
  if (asset.kind !== 'video' || asset.duration <= 0) return 0;
  const d = Math.max(0.1, asset.duration - 0.05);
  return Math.max(0, t - l.start) % d;
}

/** The imported LUT of a clip and how strongly it applies. */
function lutOf(p: Project, c: Clip) {
  const l = c.lut && p.luts?.[c.lut.id];
  return l ? { data: l, amount: c.lut!.amount } : undefined;
}

/**
 * The color correction left for the pixel pass (gradeCanvas): all of it with WebGL2 or without
 * canvas filters; nothing when the canvas filter already applied it.
 */
const colorPass = (c: ColorAdjust | undefined) => (!c || isNeutral(c, true) ? undefined : colorOnGpu() || !supportsCanvasFilter ? c : undefined);
/** The correction as a canvas filter, when that is the path that applies it. Projects without color never start WebGL. */
const colorFilter = (c: ColorAdjust | undefined) => (!c || isNeutral(c, true) || colorOnGpu() ? '' : colorCss(c));

/** Paint one main-track clip (picture, color filter, LUT and effect) filling the whole frame. */
function drawClip(
  ctx: CanvasRenderingContext2D, l: Placed, f: FrameImage, t: number, W: number, H: number, cut?: Cutout,
  lut?: ReturnType<typeof lutOf>,
) {
  const local = t - l.start;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  applyEffectTransform(ctx, l.clip, local, W, H);
  // "Reencuadre automático": the saved path of the person, at this moment of the source.
  const at = l.clip.freeze ?? l.clip.in + local * l.clip.speed;
  const focus = l.clip.reframe?.points.length ? pointInFrame(l.clip, trackAt(l.clip.reframe.points, at)) : undefined;
  const masked = cut?.mask ? cut : undefined;
  drawFrame(ctx, f.src, f.w, f.h, W, H, l.clip.fit, l.clip.filter, l.clip.color, effectCss(l.clip, W), masked, focus);
  ctx.restore();
  // Color correction and LUT in one pass over the frame (the cut-out person was already corrected on its layer).
  gradeCanvas(ctx, masked ? undefined : colorPass(l.clip.color), lut?.data, lut?.amount ?? 0);
  applyEffectOverlay(ctx, l.clip, local, W, H);
  drawVignette(ctx, l.clip.color, W, H);
}

/** Cover the frame with `src`; with `blurDiv`, blurred by stretching a tiny copy (works without canvas filters). */
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, blurDiv = 0) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (!blurDiv) {
    const k = Math.max(W / sw, H / sh);
    ctx.drawImage(src, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
    return;
  }
  const bw = Math.max(8, Math.round(W / blurDiv));
  const bh = Math.max(8, Math.round(H / blurDiv));
  const small = canvasFor(C_BLUR_BG, bw, bh);
  const k = Math.max(bw / sw, bh / sh);
  small.getContext('2d')!.drawImage(src, (bw - sw * k) / 2, (bh - sh * k) / 2, sw * k, sh * k);
  ctx.drawImage(small, 0, 0, W, H);
}

/** New background behind a cut-out person. */
function drawBackground(ctx: CanvasRenderingContext2D, cut: Cutout, src: CanvasImageSource, sw: number, sh: number, W: number, H: number) {
  const { bg, bgFrame } = cut;
  if (bg.mode === 'blur') drawCover(ctx, src, sw, sh, W, H, 20);
  else if (bg.mode === 'media' && bgFrame && bgFrame.w && bgFrame.h) drawCover(ctx, bgFrame.src, bgFrame.w, bgFrame.h, W, H);
  else {
    ctx.fillStyle = bg.mode === 'color' ? bg.color : '#000';
    ctx.fillRect(-W * 0.1, -H * 0.1, W * 1.2, H * 1.2); // margin for shake / zoom effects
  }
}

/** Space-separated canvas filter from its parts, without allocating when there is at most one. */
function joinCss(a: string, b: string, c: string) {
  if (!a) return !b ? c : !c ? b : `${b} ${c}`;
  if (!b && !c) return a;
  return !b ? `${a} ${c}` : !c ? `${a} ${b}` : `${a} ${b} ${c}`;
}

/**
 * Draw the picture into a W×H area (fit or fill) with its filter preset and, where the canvas filter
 * is the path for it, its color correction. Callers run gradeCanvas afterwards for the other paths.
 */
function drawFrame(
  ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number,
  fit: Clip['fit'], filter: string, color: ColorAdjust | undefined, extraCss: string, cut?: Cutout, focus?: { x: number; y: number },
) {
  const cc = colorFilter(color);
  if (cut) drawBackground(ctx, cut, src, sw, sh, W, H);
  else if (fit === 'fit') {
    // Blurred, darkened copy behind the picture instead of black bars.
    const bw = Math.max(8, Math.round(W / 24));
    const bh = Math.max(8, Math.round(H / 24));
    const small = canvasFor(C_FIT_BG, bw, bh);
    const sc = small.getContext('2d')!;
    const k = Math.max(bw / sw, bh / sh);
    sc.drawImage(src, (bw - sw * k) / 2, (bh - sh * k) / 2, sw * k, sh * k);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (cc && supportsCanvasFilter) ctx.filter = cc;
    ctx.drawImage(small, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, W, H);
  }
  const k = Math.min(W / sw, H / sh);
  const { dx, dy, dw, dh } =
    fit === 'fit' ? { dx: (W - sw * k) / 2, dy: (H - sh * k) / 2, dw: sw * k, dh: sh * k } : coverRect(sw, sh, W, H, focus);
  const f = getFilter(filter);
  const css = joinCss(f.id !== 'none' ? f.css : '', cc, extraCss);
  if (cut?.mask) {
    drawCutout(ctx, src, dx, dy, dw, dh, sw, sh, W, H, css, extraCss, f, cut.mask, cut.bg.smooth, color);
    return;
  }
  if (css && supportsCanvasFilter) ctx.filter = css;
  ctx.drawImage(src, dx, dy, dw, dh);
  if (extraCss && !supportsCanvasFilter) softBlur(ctx, src, dx, dy, dw, dh, sw, sh);
  ctx.filter = 'none';
  if (f.id !== 'none' && !supportsCanvasFilter) applyFallback(ctx, f, src, dx, dy, dw, dh);
}

/** Draws only the person: the picture on its own layer, keeps the masked part, then lays it on `ctx`. */
function drawCutout(
  ctx: CanvasRenderingContext2D, src: CanvasImageSource, dx: number, dy: number, dw: number, dh: number, sw: number, sh: number,
  W: number, H: number, css: string, extraCss: string, f: Filter, mask: Mask, smooth: number, color: ColorAdjust | undefined,
) {
  const cutLayer = canvasFor(C_CUT, W, H);
  const c = cutLayer.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, W, H);
  c.setTransform(ctx.getTransform()); // same effect transform (shake, zoom) as the clip
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  if (css && supportsCanvasFilter) c.filter = css;
  c.drawImage(src, dx, dy, dw, dh);
  if (extraCss && !supportsCanvasFilter) softBlur(c, src, dx, dy, dw, dh, sw, sh);
  c.filter = 'none';
  if (f.id !== 'none' && !supportsCanvasFilter) applyFallback(c, f, src, dx, dy, dw, dh);
  // Color the person only, not the new background.
  gradeCanvas(c, colorPass(color), undefined, 0);
  // Keep the person. Smoothing blurs the mask, relative to the picture size so preview and export match.
  c.globalCompositeOperation = 'destination-in';
  const px = smooth * Math.max(dw, dh) * 0.012;
  if (px > 0.3 && supportsCanvasFilter) c.filter = `blur(${px.toFixed(2)}px)`;
  c.drawImage(maskImageOf(mask), dx, dy, dw, dh);
  c.filter = 'none';
  c.globalCompositeOperation = 'source-over';
  c.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(cutLayer, 0, 0);
  ctx.restore();
}

/** Blur without canvas filter support (older Safari): stretch a tiny copy. */
function softBlur(ctx: CanvasRenderingContext2D, src: CanvasImageSource, dx: number, dy: number, dw: number, dh: number, sw: number, sh: number) {
  const tw = Math.max(4, Math.round(dw / 14));
  const th = Math.max(4, Math.round((tw * sh) / sw));
  const small = canvasFor(C_SOFT, tw, th);
  small.getContext('2d')!.drawImage(src, 0, 0, tw, th);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, dx, dy, dw, dh);
}
