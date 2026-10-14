import { useStore } from './store';
import type { Clip, Project, Selection } from './types';
import { activeClip, audioDur, canvasSize, clamp, layout, totalDuration, type Placed } from './model';
import { applyFallback, getFilter, supportsCanvasFilter } from './filters';
import { drawText, type Box } from './textStyles';
import {
  applyEffectOverlay, applyEffectTransform, drawSticker, drawTransition, effectCss, sourceTime, stickerHandle,
  stickerHandleRadius, stickersOf, textPose, transitionAt, transitionLength, type StickerBox,
} from './visuals';

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
  private small = document.createElement('canvas');
  /** Offscreen frames of the outgoing and incoming clip during a transition. */
  private layers = [document.createElement('canvas'), document.createElement('canvas')];
  private playWall = 0;
  private playT = 0;
  private lastNow = 0;
  private onEnded: (() => void) | null = null;
  private abortExport: (() => void) | null = null;
  /** Bounding boxes of the visible texts, for tapping and dragging in the preview. */
  textBoxes: Box[] = [];
  /** Boxes of the visible stickers, topmost last. */
  stickerBoxes: StickerBox[] = [];
  exporting = false;

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
      for (const st of stickersOf(p)) {
        const url = st.assetId && urls[st.assetId];
        if (!url) continue;
        keepI.add(st.assetId!);
        if (!this.images.has(st.assetId!)) {
          const img = new Image();
          img.src = url;
          this.images.set(st.assetId!, img);
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
    if (!p || !this.ctx || !this.canvas) return;

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

  private updateMedia(p: Project, t: number, playing: boolean, placed: Placed[]) {
    const cur = activeClip(p, t, placed);
    const tr = transitionAt(placed, t);
    // During a transition the other clip is visible too: it plays muted alongside the current one.
    const partner = tr ? (tr.out.index === cur?.index ? tr.in : tr.out) : null;
    for (const l of placed) {
      const r = this.videos.get(l.clip.id);
      if (!r) continue;
      const el = r.el;
      const dur = p.assets[l.clip.assetId]?.duration ?? l.clip.out;
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
      } else if (partner && l.index === partner.index) {
        const raw = l.clip.in + (t - l.start) * l.clip.speed;
        const src = sourceTime(l, t, dur);
        const held = Math.abs(raw - src) > 0.01; // ran out of footage: hold the edge frame
        this.setVolume(r, 0);
        if (playing && !held) {
          if (el.playbackRate !== l.clip.speed) el.playbackRate = l.clip.speed;
          if (Math.abs(el.currentTime - src) > 0.3 && !el.seeking) el.currentTime = src;
          if (el.paused) el.play().catch(() => {});
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - src) > (playing ? 0.1 : 0.02) && !el.seeking) el.currentTime = src;
        }
      } else {
        if (!el.paused) el.pause();
        // Pre-roll the next clip (to where its transition starts) so the cut is seamless.
        if (cur && l.index === cur.index + 1) {
          const lead = transitionLength(cur.clip, l.clip) / 2;
          const src = sourceTime(l, l.start - lead, dur);
          if (Math.abs(el.currentTime - src) > 0.05 && !el.seeking) el.currentTime = src;
        }
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

  /** The decoded picture of a clip, or null if it is not ready yet. */
  private sourceOf(p: Project, clip: Clip): { src: CanvasImageSource; w: number; h: number } | null {
    const asset = p.assets[clip.assetId];
    if (asset?.kind === 'video') {
      const el = this.videos.get(clip.id)?.el;
      if (!el || el.readyState < 2 || !el.videoWidth) return null;
      return { src: el, w: el.videoWidth, h: el.videoHeight };
    }
    if (asset?.kind === 'image') {
      const img = this.images.get(asset.id);
      if (!img || !img.complete || !img.naturalWidth) return null;
      return { src: img, w: img.naturalWidth, h: img.naturalHeight };
    }
    return null;
  }

  /** Paint one main-track clip (picture, color filter and effect) filling the whole frame. */
  private drawClip(ctx: CanvasRenderingContext2D, l: Placed, source: { src: CanvasImageSource; w: number; h: number }, t: number, W: number, H: number) {
    const local = t - l.start;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    applyEffectTransform(ctx, l.clip, local, W, H);
    this.drawFrame(ctx, source.src, source.w, source.h, W, H, l.clip, effectCss(l.clip, W));
    ctx.restore();
    applyEffectOverlay(ctx, l.clip, local, W, H);
  }

  private layer(i: number, W: number, H: number) {
    const c = this.layers[i];
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    return c;
  }

  private render(p: Project, t: number, selection: Selection, placed: Placed[]) {
    const ctx = this.ctx!;
    const W = this.canvas!.width;
    const H = this.canvas!.height;
    const cur = activeClip(p, t, placed);
    const tr = cur ? transitionAt(placed, t) : null;

    const source = cur ? this.sourceOf(p, cur.clip) : null;
    if (cur && !source) return; // keep the previous frame until this one is decoded

    if (tr && cur) {
      // Render both clips offscreen, then mix them. If the other clip isn't decoded yet, show the current one alone.
      const [a, b] = [tr.out, tr.in].map((l, i) => {
        const s = l.index === cur.index ? source : this.sourceOf(p, l.clip);
        if (!s) return null;
        const c = this.layer(i, W, H);
        this.drawClip(c.getContext('2d')!, l, s, t, W, H);
        return c;
      });
      drawTransition(ctx, tr.type, a ?? b, b ?? a, tr.k, W, H);
    } else if (cur && source) {
      this.drawClip(ctx, cur, source, t, W, H);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }

    const showSel = !this.exporting;
    const sboxes: StickerBox[] = [];
    for (const st of stickersOf(p)) {
      if (t < st.start || t >= st.start + st.duration) continue;
      const b = drawSticker(ctx, st, st.assetId ? this.images.get(st.assetId) : undefined, W, H);
      if (!b) continue;
      sboxes.push(b);
      if (showSel && selection?.kind === 'sticker' && selection.id === st.id) this.drawStickerSelection(ctx, b, W);
    }
    this.stickerBoxes = sboxes;

    const boxes: Box[] = [];
    for (const item of p.texts) {
      if (t < item.start || t >= item.start + item.duration || !item.text.trim()) continue;
      const box = drawText(ctx, item, W, H, item.anim ? textPose(item, t - item.start) : undefined);
      boxes.push(box);
      if (showSel && selection?.kind === 'text' && selection.id === item.id) {
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

  private drawStickerSelection(ctx: CanvasRenderingContext2D, b: StickerBox, W: number) {
    ctx.save();
    ctx.translate(b.cx, b.cy);
    ctx.rotate(b.rot);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, W / 360);
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.restore();
    // Corner handle: drag it to resize and rotate.
    const hp = stickerHandle(b);
    const r = stickerHandleRadius(W);
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#7c6cff';
    ctx.lineWidth = Math.max(2, W / 300);
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, r * 0.5, -Math.PI * 0.9, Math.PI * 0.4);
    ctx.stroke();
    ctx.restore();
  }

  private drawFrame(
    ctx: CanvasRenderingContext2D,
    src: CanvasImageSource,
    sw: number,
    sh: number,
    W: number,
    H: number,
    clip: Clip,
    extraCss: string,
  ) {
    const fit = clip.fit;
    if (fit === 'fit') {
      // Blurred, darkened copy behind the picture instead of black bars.
      const bw = Math.max(8, Math.round(W / 24));
      const bh = Math.max(8, Math.round(H / 24));
      if (this.small.width !== bw || this.small.height !== bh) {
        this.small.width = bw;
        this.small.height = bh;
      }
      const sc = this.small.getContext('2d')!;
      const k = Math.max(bw / sw, bh / sh);
      sc.drawImage(src, (bw - sw * k) / 2, (bh - sh * k) / 2, sw * k, sh * k);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.small, 0, 0, W, H);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, 0, W, H);
    }
    const k = fit === 'fit' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
    const dw = sw * k;
    const dh = sh * k;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    const f = getFilter(clip.filter);
    const css = [f.id !== 'none' ? f.css : '', extraCss].filter(Boolean).join(' ');
    if (css && supportsCanvasFilter) ctx.filter = css;
    ctx.drawImage(src, dx, dy, dw, dh);
    if (extraCss && !supportsCanvasFilter) this.softBlur(ctx, src, dx, dy, dw, dh, sw, sh);
    ctx.filter = 'none';
    if (f.id !== 'none' && !supportsCanvasFilter) applyFallback(ctx, f, src, dx, dy, dw, dh);
  }

  /** Blur without canvas filter support (older Safari): stretch a tiny copy. */
  private softBlur(ctx: CanvasRenderingContext2D, src: CanvasImageSource, dx: number, dy: number, dw: number, dh: number, sw: number, sh: number) {
    const tw = Math.max(4, Math.round(dw / 14));
    const th = Math.max(4, Math.round((tw * sh) / sw));
    const tmp = this.small;
    tmp.width = tw;
    tmp.height = th;
    tmp.getContext('2d')!.drawImage(src, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, dx, dy, dw, dh);
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

export const engine = new Engine();
export const canExport = () => Engine.pickMime() !== null;
