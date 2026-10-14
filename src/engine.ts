import { useStore } from './store';
import type { Asset, Clip, FitMode, Project, Selection } from './types';
import { activeClip, audioDur, canvasSize, clamp, layout, totalDuration, type Placed } from './model';
import { applyFallback, getFilter, supportsCanvasFilter } from './filters';
import { drawText, type Box } from './textStyles';

interface MediaRec<E extends HTMLMediaElement> {
  el: E;
  gain: GainNode | null;
}

/** Ordered by preference; MP4 is the most widely shareable result. */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Plays the project by driving hidden media elements from one master clock
 * and compositing every frame onto the preview canvas. Export records that
 * same canvas plus the mixed audio.
 */
class Engine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private host: HTMLDivElement;
  private videos = new Map<string, MediaRec<HTMLVideoElement>>(); // by clip id
  private audios = new Map<string, MediaRec<HTMLAudioElement>>(); // by audio item id
  private images = new Map<string, HTMLImageElement>(); // by asset id
  private actx: AudioContext | null = null;
  private master: GainNode | null = null;
  private monitor: GainNode | null = null;
  private recDest: MediaStreamAudioDestinationNode | null = null;
  private playWall = 0;
  private playT = 0;
  private lastNow = 0;
  private onEnded: (() => void) | null = null;
  private abortExport: (() => void) | null = null;
  /** Bounding boxes of the visible texts, for tapping and dragging in the preview. */
  textBoxes: Box[] = [];
  exporting = false;
  /** Set by the fast exporter so the preview stops redrawing and leaves it the processor. */
  holdPreview = false;

  constructor() {
    this.host = document.createElement('div');
    this.host.className = 'media-host';
    document.body.appendChild(this.host);
    useStore.subscribe((s, prev) => {
      if (s.project !== prev.project || s.urls !== prev.urls) this.sync(s.project, s.urls);
    });
    const loop = (now: number) => {
      this.tick(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  detach(canvas: HTMLCanvasElement) {
    if (this.canvas === canvas) {
      this.pause();
      this.canvas = null;
      this.ctx = null;
    }
  }

  // ---------- media elements ----------

  private sync(p: Project | null, urls: Record<string, string>) {
    const keepV = new Set<string>();
    const keepA = new Set<string>();
    const keepI = new Set<string>();
    if (p) {
      for (const c of p.clips) {
        const a = p.assets[c.assetId];
        const url = urls[c.assetId];
        if (!a || !url) continue;
        if (a.kind === 'video') {
          keepV.add(c.id);
          if (!this.videos.has(c.id)) this.videos.set(c.id, this.make('video', url));
        } else if (a.kind === 'image') {
          keepI.add(c.assetId);
          if (!this.images.has(c.assetId)) {
            const img = new Image();
            img.src = url;
            this.images.set(c.assetId, img);
          }
        }
      }
      for (const au of p.audios) {
        const url = urls[au.assetId];
        if (!url) continue;
        keepA.add(au.id);
        if (!this.audios.has(au.id)) this.audios.set(au.id, this.make('audio', url));
      }
    }
    for (const [id, r] of this.videos) if (!keepV.has(id)) { this.dispose(r.el); this.videos.delete(id); }
    for (const [id, r] of this.audios) if (!keepA.has(id)) { this.dispose(r.el); this.audios.delete(id); }
    for (const id of [...this.images.keys()]) if (!keepI.has(id)) this.images.delete(id);
  }

  private make<K extends 'video' | 'audio'>(kind: K, url: string): MediaRec<HTMLElementTagNameMap[K]> {
    const el = document.createElement(kind);
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
    el.src = url;
    this.host.appendChild(el);
    return { el, gain: this.connect(el) };
  }

  private dispose(el: HTMLMediaElement) {
    el.pause();
    el.removeAttribute('src');
    el.load();
    el.remove();
  }

  /** Audio graph: element -> gain -> master -> (speakers via monitor, recorder). */
  private ensureAudio() {
    if (!this.actx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const actx = new AC();
      this.actx = actx;
      this.master = actx.createGain();
      this.monitor = actx.createGain();
      this.recDest = actx.createMediaStreamDestination();
      this.master.connect(this.monitor);
      this.monitor.connect(actx.destination);
      this.master.connect(this.recDest);
      for (const r of [...this.videos.values(), ...this.audios.values()]) r.gain = this.connect(r.el);
    }
    if (this.actx.state === 'suspended') this.actx.resume().catch(() => {});
  }

  private connect(el: HTMLMediaElement): GainNode | null {
    if (!this.actx || !this.master) return null;
    try {
      const src = this.actx.createMediaElementSource(el);
      const g = this.actx.createGain();
      src.connect(g);
      g.connect(this.master);
      return g;
    } catch {
      return null;
    }
  }

  private setVolume(r: MediaRec<HTMLMediaElement>, v: number) {
    if (r.gain) r.gain.gain.value = v;
    else r.el.volume = clamp(v, 0, 1);
  }

  private pauseAll() {
    for (const r of this.videos.values()) if (!r.el.paused) r.el.pause();
    for (const r of this.audios.values()) if (!r.el.paused) r.el.pause();
  }

  // ---------- transport ----------

  play() {
    const s = useStore.getState();
    const p = s.project;
    if (!p) return;
    const d = totalDuration(p);
    if (d <= 0) {
      s.notify('Primero agrega un video o una foto');
      return;
    }
    this.ensureAudio();
    let t = s.time;
    if (t >= d - 0.05) {
      t = 0;
      s.setTime(0);
    }
    this.playT = t;
    this.playWall = performance.now();
    s.setPlaying(true);
  }

  pause() {
    const s = useStore.getState();
    if (s.playing) s.setPlaying(false);
    this.pauseAll();
  }

  toggle() {
    if (useStore.getState().playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    const s = useStore.getState();
    if (!s.project || this.exporting) return;
    this.pause();
    s.setTime(clamp(t, 0, totalDuration(s.project)));
  }

  // ---------- frame loop ----------

  private tick(now: number) {
    const s = useStore.getState();
    const p = s.project;
    const dt = now - this.lastNow;
    this.lastNow = now;
    if (!p || !this.ctx || !this.canvas || this.holdPreview) return;

    const placed = layout(p);
    let t = s.time;
    if (s.playing) {
      // Hold the clock while the current video is still buffering so audio and picture stay together.
      const cur = activeClip(p, t, placed);
      const rec = cur && this.videos.get(cur.clip.id);
      if (rec && (rec.el.readyState < 3 || rec.el.seeking)) this.playWall += dt;

      const d = totalDuration(p);
      t = this.playT + (now - this.playWall) / 1000;
      if (t >= d) {
        t = d;
        s.setTime(t);
        s.setPlaying(false);
        this.pauseAll();
        const cb = this.onEnded;
        this.onEnded = null;
        cb?.();
      } else s.setTime(t);
    }
    const playing = useStore.getState().playing;
    this.updateMedia(p, t, playing, placed);
    this.render(p, t, s.selection, placed);
  }

  private updateMedia(p: Project, t: number, playing: boolean, placed: ReturnType<typeof layout>) {
    const cur = activeClip(p, t, placed);
    for (const l of placed) {
      const r = this.videos.get(l.clip.id);
      if (!r) continue;
      const el = r.el;
      if (cur && l.index === cur.index) {
        const src = clamp(l.clip.in + (t - l.start) * l.clip.speed, l.clip.in, l.clip.out);
        this.setVolume(r, l.clip.volume);
        if (playing) {
          if (el.playbackRate !== l.clip.speed) el.playbackRate = l.clip.speed;
          if (Math.abs(el.currentTime - src) > 0.3 && !el.seeking) el.currentTime = src;
          if (el.paused) el.play().catch(() => {});
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - src) > 0.02 && !el.seeking) el.currentTime = src;
        }
      } else {
        if (!el.paused) el.pause();
        // Pre-roll the next clip so the cut is seamless.
        if (cur && l.index === cur.index + 1 && Math.abs(el.currentTime - l.clip.in) > 0.05 && !el.seeking) el.currentTime = l.clip.in;
      }
    }

    for (const a of p.audios) {
      const r = this.audios.get(a.id);
      if (!r) continue;
      const end = a.start + audioDur(a);
      const el = r.el;
      if (t >= a.start && t < end) {
        const src = a.in + (t - a.start);
        let fade = 1;
        if (a.fadeIn > 0) fade = Math.min(fade, (t - a.start) / a.fadeIn);
        if (a.fadeOut > 0) fade = Math.min(fade, (end - t) / a.fadeOut);
        this.setVolume(r, a.volume * clamp(fade, 0, 1));
        if (playing) {
          if (Math.abs(el.currentTime - src) > 0.3 && !el.seeking) el.currentTime = src;
          if (el.paused) el.play().catch(() => {});
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - src) > 0.05 && !el.seeking) el.currentTime = src;
        }
      } else {
        if (!el.paused) el.pause();
        if (t < a.start && Math.abs(el.currentTime - a.in) > 0.05 && !el.seeking) el.currentTime = a.in;
      }
    }
  }

  private render(p: Project, t: number, selection: Selection, placed: ReturnType<typeof layout>) {
    const ctx = this.ctx!;
    const W = this.canvas!.width;
    const H = this.canvas!.height;
    // The preview's media elements are already seeked by updateMedia, so the source time is not needed here.
    const boxes = renderFrame(ctx, p, t, W, H, (clip, asset) => this.frameOf(clip, asset), placed);
    if (!boxes) return; // keep the previous frame until this one is decoded

    if (!this.exporting && selection?.kind === 'text') {
      const i = p.texts.filter((x) => t >= x.start && t < x.start + x.duration && x.text.trim()).findIndex((x) => x.id === selection.id);
      const box = boxes[i];
      if (box) {
        ctx.save();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(2, W / 360);
        ctx.setLineDash([10, 8]);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.restore();
      }
    }
    this.textBoxes = boxes;
  }

  private frameOf(clip: Clip, asset: Asset): FrameImage | null {
    if (asset.kind === 'video') {
      const el = this.videos.get(clip.id)?.el;
      return el && el.readyState >= 2 ? { src: el, w: el.videoWidth, h: el.videoHeight } : null;
    }
    const img = this.images.get(asset.id);
    return img && img.complete && img.naturalWidth ? { src: img, w: img.naturalWidth, h: img.naturalHeight } : null;
  }

  // ---------- export ----------

  static pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  }

  /** Record the project in real time. Resolves with the finished file. */
  async exportVideo(short: number): Promise<{ blob: Blob; ext: string }> {
    const s = useStore.getState();
    const p = s.project;
    const canvas = this.canvas;
    const mime = Engine.pickMime();
    if (!p || !canvas) throw new Error('No hay proyecto abierto');
    if (mime === null || !('captureStream' in canvas)) throw new Error('unsupported');

    this.pause();
    this.ensureAudio();
    const prevW = canvas.width;
    const prevH = canvas.height;
    const [w, h] = canvasSize(p.aspect, short);
    canvas.width = w;
    canvas.height = h;
    this.exporting = true;
    s.setExporting(true);
    if (this.monitor) this.monitor.gain.value = 0; // don't blast the export through the speakers
    s.setTime(0);

    const stream = canvas.captureStream(30);
    this.recDest?.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: short >= 1080 ? 8_000_000 : 5_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));

    try {
      await sleep(500); // let the first frame seek and draw
      rec.start(1000);
      await new Promise<void>((resolve, reject) => {
        this.onEnded = resolve;
        this.abortExport = () => reject(new Error('cancelled'));
        this.play();
      });
      await sleep(300); // flush the last frames
      rec.stop();
      await stopped;
      const type = rec.mimeType || mime || 'video/webm';
      return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
    } catch (e) {
      if (rec.state !== 'inactive') rec.stop();
      throw e;
    } finally {
      stream.getVideoTracks().forEach((tr) => tr.stop());
      this.onEnded = null;
      this.abortExport = null;
      this.pauseAll();
      canvas.width = prevW;
      canvas.height = prevH;
      if (this.monitor) this.monitor.gain.value = 1;
      this.exporting = false;
      useStore.getState().setPlaying(false);
      useStore.getState().setExporting(false);
    }
  }

  cancelExport() {
    this.pauseAll();
    useStore.getState().setPlaying(false);
    this.abortExport?.();
  }
}

/** A decoded picture of a clip, ready to draw. */
export interface FrameImage {
  src: CanvasImageSource;
  w: number;
  h: number;
}

/** Returns the picture of `clip` at source time `srcTime` (seconds), or null while it isn't ready. */
export type FrameLookup = (clip: Clip, asset: Asset, srcTime: number) => FrameImage | null;

/** Position inside the source file that the main track shows at time t. */
export const sourceTime = (l: Placed, t: number) => clamp(l.clip.in + (t - l.start) * l.clip.speed, l.clip.in, l.clip.out);

const small = document.createElement('canvas');

/**
 * Draws the whole project at time t: picture, filter and texts. Shared by the live preview and the
 * fast export so both look identical. Returns the text boxes, or null (nothing drawn) when a
 * picture it needs isn't ready yet.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  p: Project,
  t: number,
  W: number,
  H: number,
  lookup: FrameLookup,
  placed = layout(p),
): Box[] | null {
  const cur = activeClip(p, t, placed);
  let frame: FrameImage | null = null;
  if (cur) {
    const asset = p.assets[cur.clip.assetId];
    if (asset?.kind === 'video' || asset?.kind === 'image') {
      frame = lookup(cur.clip, asset, sourceTime(cur, t));
      if (!frame) return null;
    }
  }

  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (cur && frame && frame.w && frame.h) drawFrame(ctx, frame.src, frame.w, frame.h, W, H, cur.clip.fit, cur.clip.filter);
  ctx.restore();

  const boxes: Box[] = [];
  for (const item of p.texts) {
    if (t < item.start || t >= item.start + item.duration || !item.text.trim()) continue;
    boxes.push(drawText(ctx, item, W, H));
  }
  return boxes;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  W: number,
  H: number,
  fit: FitMode,
  filterId: string,
) {
  if (fit === 'fit') {
    // Blurred, darkened copy behind the picture instead of black bars.
    const bw = Math.max(8, Math.round(W / 24));
    const bh = Math.max(8, Math.round(H / 24));
    if (small.width !== bw || small.height !== bh) {
      small.width = bw;
      small.height = bh;
    }
    const sc = small.getContext('2d')!;
    const k = Math.max(bw / sw, bh / sh);
    sc.drawImage(src, (bw - sw * k) / 2, (bh - sh * k) / 2, sw * k, sh * k);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, W, H);
  }
  const k = fit === 'fit' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
  const dw = sw * k;
  const dh = sh * k;
  const dx = (W - dw) / 2;
  const dy = (H - dh) / 2;
  const f = getFilter(filterId);
  if (f.id !== 'none' && supportsCanvasFilter) ctx.filter = f.css;
  ctx.drawImage(src, dx, dy, dw, dh);
  ctx.filter = 'none';
  if (f.id !== 'none' && !supportsCanvasFilter) applyFallback(ctx, f, src, dx, dy, dw, dh);
}

export const engine = new Engine();
export const canExport = () => Engine.pickMime() !== null;
