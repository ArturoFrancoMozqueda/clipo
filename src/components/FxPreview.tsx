// Animated thumbnails for the transition and effect pickers. They call the same drawing code as the
// preview and the export, on the clip's own thumbnail, so what the tile shows is what you get.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Clip, Direction, EffectId, TransitionId } from '../types';
import { applyEffectOverlay, applyEffectTransform, drawTransition, effectCss } from '../visuals';
import { supportsCanvasFilter } from '../filters';
import { clamp } from '../model';
import { applyLutToPixels, lutBytes } from '../lut';
import type { LutData } from '../types';

/** Pixel size of a tile canvas (shown at about 100 CSS px). */
export const TILE = 160;

// One animation loop for every visible tile, at about 30 fps.
const subs = new Set<(t: number) => void>();
let raf = 0;
let last = 0;
const slow = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function loop(now: number) {
  raf = requestAnimationFrame(loop);
  if (now - last < 32) return;
  last = now;
  const t = (now / 1000) * (slow ? 0.4 : 1);
  subs.forEach((f) => f(t));
}
function subscribe(f: (t: number) => void) {
  subs.add(f);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => {
    subs.delete(f);
    if (!subs.size) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

/** Square frame of a thumbnail (cover), or a colored card with a letter while there is none. */
function makeFrame(img: HTMLImageElement | null, color: string, letter: string) {
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  const g = c.getContext('2d')!;
  if (img && img.naturalWidth) {
    const k = Math.max(TILE / img.naturalWidth, TILE / img.naturalHeight);
    const w = img.naturalWidth * k;
    const h = img.naturalHeight * k;
    g.drawImage(img, (TILE - w) / 2, (TILE - h) / 2, w, h);
  } else {
    const grad = g.createLinearGradient(0, 0, TILE, TILE);
    grad.addColorStop(0, color);
    grad.addColorStop(1, '#e9a46b');
    g.fillStyle = grad;
    g.fillRect(0, 0, TILE, TILE);
    g.fillStyle = '#fff';
    g.font = `900 ${TILE * 0.4}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, TILE / 2, TILE / 2);
  }
  return c;
}

/** Frame canvas for a thumbnail URL; redraws once the image has loaded. */
export function useFrame(url: string | undefined, color: string, letter: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImg(null);
    if (!url) return;
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => void (i.onload = null);
  }, [url]);
  return useMemo(() => makeFrame(img, color, letter), [img, color, letter]);
}

function AnimatedCanvas({ draw }: { draw: (ctx: CanvasRenderingContext2D, t: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fn = useRef(draw);
  fn.current = draw;
  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    return subscribe((t) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      fn.current(ctx, t);
    });
  }, []);
  return <canvas ref={ref} width={TILE} height={TILE} className="fx-canvas" aria-hidden="true" />;
}

const CYCLE = 2.6;

export function TransitionThumb({ type, dir, a, b }: { type: TransitionId; dir?: Direction; a: HTMLCanvasElement; b: HTMLCanvasElement }) {
  return (
    <AnimatedCanvas
      draw={(ctx, t) => {
        // Hold A, transition, hold B.
        const raw = clamp(((t % CYCLE) / CYCLE - 0.25) / 0.45, 0, 1);
        const k = type === 'none' ? (raw < 0.5 ? 0 : 1) : raw * raw * (3 - 2 * raw);
        drawTransition(ctx, type, a, b, k, TILE, TILE, dir);
      }}
    />
  );
}

export function EffectThumb({ id, intensity, pic }: { id: EffectId; intensity: number; pic: HTMLCanvasElement }) {
  const clip = useMemo(
    () => ({ id: 'preview', assetId: '', in: 0, out: 3, speed: 1, volume: 0, filter: 'none', fit: 'fill', effect: { id, intensity } }) as Clip,
    [id, intensity],
  );
  return (
    <AnimatedCanvas
      draw={(ctx, t) => {
        const local = t % 3;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, TILE, TILE);
        ctx.save();
        applyEffectTransform(ctx, clip, local, TILE, TILE);
        const css = effectCss(clip, TILE);
        if (css && supportsCanvasFilter) ctx.filter = css;
        ctx.drawImage(pic, 0, 0, TILE, TILE);
        ctx.filter = 'none';
        ctx.restore();
        applyEffectOverlay(ctx, clip, local, TILE, TILE);
      }}
    />
  );
}

/** Still thumbnail with a LUT applied (CPU, drawn once). */
export function LutThumb({ lut, pic }: { lut?: LutData; pic: HTMLCanvasElement }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current!.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(pic, 0, 0, TILE, TILE);
    if (!lut) return;
    const img = ctx.getImageData(0, 0, TILE, TILE);
    applyLutToPixels(img.data, lutBytes(lut), lut.size, 1);
    ctx.putImageData(img, 0, 0);
  }, [lut, pic]);
  return <canvas ref={ref} width={TILE} height={TILE} className="fx-canvas" aria-hidden="true" />;
}
