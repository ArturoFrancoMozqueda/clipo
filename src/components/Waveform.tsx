import { memo, useLayoutEffect, useRef } from 'react';
import { FRAME } from '../audioDsp';
import { peakBins } from '../timelineMath';

/** Bar pitch in CSS px (2px bar + 1px gap). */
const PITCH = 3;
/** Items have a 2px border; children are placed from inside it. */
const BORDER = 2;

interface Props {
  levels: Float32Array;
  /** Source time at the item's left edge, and source seconds per timeline second. */
  src0: number;
  speed: number;
  pps: number;
  /** Drawn part, in seconds from the item's start (the part of it inside the rendered window). */
  a: number;
  b: number;
  height: number;
  /** 'mid': mirrored around the middle (audio items); 'bottom': grows up from the bottom (clips). */
  align: 'mid' | 'bottom';
}

/** Canvas waveform covering only the rendered part of an item, so long items stay cheap. */
export const Waveform = memo(function Waveform({ levels, src0, speed, pps, a, b, height, align }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = Math.max(0, Math.round((b - a) * pps));
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || !w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, height);
    const bins = Math.floor(w / PITCH);
    const t0 = src0 + a * speed;
    const peaks = peakBins(levels, FRAME, t0, t0 + ((bins * PITCH) / pps) * speed, bins);
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < bins; i++) {
      const h = Math.max(1, peaks[i]! * (align === 'mid' ? height - 2 : height));
      g.fillRect(i * PITCH, align === 'mid' ? (height - h) / 2 : height - h, PITCH - 1, h);
    }
  }, [levels, src0, speed, pps, a, w, height, align]);
  if (!w) return null;
  return (
    <canvas
      ref={ref}
      className={`tl-wave ${align}`}
      style={{ left: a * pps - BORDER, width: w, height }}
      aria-hidden
    />
  );
});
