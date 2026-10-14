import { useEffect, useMemo, useRef } from 'react';
import { ASPECTS } from '../model';
import { drawText } from '../textStyles';
import type { Motif, Template } from './types';
import { placeTexts } from './build';

// Animated mock-up of a template drawn only with solid colors and simple shapes.

const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function drawMotif(ctx: CanvasRenderingContext2D, m: Motif, W: number, H: number, t: number, colors: string[], slot: number) {
  const c = (i: number) => colors[(i + slot + 1) % colors.length];
  const S = Math.min(W, H);
  ctx.save();
  ctx.globalAlpha = 0.85;
  switch (m) {
    case 'confetti':
      for (let i = 0; i < 26; i++) {
        const x = rnd(i) * W + Math.sin(t * 2 + i) * S * 0.03;
        const y = ((rnd(i + 50) + t * (0.12 + rnd(i + 9) * 0.15)) % 1.1) * H - S * 0.05;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 3 + i);
        ctx.fillStyle = c(i);
        ctx.fillRect(-S * 0.02, -S * 0.01, S * 0.04, S * 0.02);
        ctx.restore();
      }
      break;
    case 'stripes': {
      ctx.globalAlpha = 0.25;
      const w = S * 0.12;
      const shift = (t * S * 0.15) % (w * 2);
      ctx.fillStyle = c(0);
      for (let x = -H - w * 2 + shift; x < W + H; x += w * 2) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + w, 0);
        ctx.lineTo(x + w + H, H);
        ctx.lineTo(x + H, H);
        ctx.fill();
      }
      break;
    }
    case 'waves':
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = c(k);
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 4) ctx.lineTo(x, H * (0.8 + k * 0.06) + Math.sin(x / (S * 0.12) + t * 2 + k) * S * 0.03);
        ctx.lineTo(W, H);
        ctx.fill();
      }
      break;
    case 'grid': {
      const step = S * 0.14;
      for (let y = step / 2, i = 0; y < H; y += step)
        for (let x = step / 2; x < W; x += step, i++) {
          ctx.fillStyle = c(i);
          ctx.globalAlpha = 0.3 + 0.3 * Math.sin(t * 3 + i * 0.7);
          ctx.beginPath();
          ctx.arc(x, y, S * 0.018, 0, Math.PI * 2);
          ctx.fill();
        }
      break;
    }
    case 'bubbles':
      for (let i = 0; i < 12; i++) {
        const r = S * (0.04 + rnd(i) * 0.08);
        const y = H + r - ((rnd(i + 3) + t * (0.05 + rnd(i + 7) * 0.08)) % 1) * (H + r * 2);
        ctx.fillStyle = c(i);
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(rnd(i + 20) * W, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'split': {
      const x = W * (0.5 + 0.35 * Math.sin(t * 1.5));
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, x, H);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - S * 0.008, 0, S * 0.016, H);
      ctx.beginPath();
      ctx.arc(x, H / 2, S * 0.05, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'stars':
      for (let i = 0; i < 14; i++) {
        const r = S * (0.015 + rnd(i) * 0.03) * (0.6 + 0.4 * Math.sin(t * 3 + i));
        ctx.save();
        ctx.translate(rnd(i + 5) * W, rnd(i + 15) * H);
        ctx.fillStyle = c(i);
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          const rr = k % 2 ? r * 0.3 : r;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.fill();
        ctx.restore();
      }
      break;
    case 'bars': {
      const n = 5;
      const bw = W / (n * 2 + 1);
      for (let i = 0; i < n; i++) {
        const h = H * 0.25 * (0.3 + 0.7 * rnd(i + slot)) * Math.min(1, (t % 3) * 1.5);
        ctx.fillStyle = c(i);
        ctx.globalAlpha = 0.6;
        ctx.fillRect(bw * (1 + i * 2), H - h, bw, h);
      }
      break;
    }
  }
  ctx.restore();
}

/** Generic "put your photo here" frame: a landscape pictogram and the slot number. */
function drawSlotFrame(ctx: CanvasRenderingContext2D, W: number, H: number, n: number) {
  const S = Math.min(W, H);
  const w = S * 0.36;
  const h = w * 0.75;
  const x = (W - w) / 2;
  const y = (H - h) / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = Math.max(1, S * 0.008);
  ctx.setLineDash([S * 0.02, S * 0.015]);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, S * 0.03);
  else ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.12, y + h * 0.85);
  ctx.lineTo(x + w * 0.4, y + h * 0.42);
  ctx.lineTo(x + w * 0.6, y + h * 0.7);
  ctx.lineTo(x + w * 0.72, y + h * 0.55);
  ctx.lineTo(x + w * 0.88, y + h * 0.85);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + w * 0.72, y + h * 0.28, h * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `800 ${S * 0.07}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x + w * 0.15, y + h * 0.2);
  ctx.restore();
}

export function TemplatePreview({ template, width = 200, values = {} }: { template: Template; width?: number; values?: Record<string, string> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const a = ASPECTS[template.aspect];
  const height = Math.round((width * a.h) / a.w);
  const lengths = useMemo(() => template.slots.map((s) => s.duration), [template]);
  const texts = useMemo(() => placeTexts(template, values, lengths), [template, values, lengths]);

  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    const ctx = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    const total = lengths.reduce((s, x) => s + x, 0) || 1;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let visible = true;
    let raf = 0;
    let last = 0;
    const t0 = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || now - last < 33) return;
      last = now;
      const time = still ? Math.min(1, total / 2) : ((now - t0) / 1000) % total;
      let i = 0;
      let start = 0;
      while (i < lengths.length - 1 && time >= start + lengths[i]) start += lengths[i++];
      const local = time - start;
      const colors = template.look.colors;
      // Slide the new slot in over the previous one.
      const slide = i > 0 && local < 0.35 ? 1 - local / 0.35 : 0;
      ctx.fillStyle = colors[(i - 1 + colors.length) % colors.length];
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(slide * slide * W, 0);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(0, 0, W, H);
      drawMotif(ctx, template.look.motif, W, H, time, colors, i);
      drawSlotFrame(ctx, W, H, i + 1);
      ctx.restore();
      for (const x of texts) if (time >= x.start && time < x.start + x.duration) drawText(ctx, x, W, H);
      if (still) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(frame);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(cv);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [template, texts, lengths, width, height]);

  return <canvas ref={ref} className="tpl-canvas" style={{ width, aspectRatio: `${a.w} / ${a.h}` }} aria-hidden="true" />;
}
