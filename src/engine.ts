import { useStore } from './store';
import type { Asset, Clip, Project, Selection } from './types';
import { activeClip, audioDur, canvasSize, clamp, layout, totalDuration, type Placed } from './model';
import { applyFallback, getFilter, supportsCanvasFilter } from './filters';
import { drawText, type Box } from './textStyles';
import {
  applyEffectOverlay, applyEffectTransform, drawSticker, drawTransition, effectCss, sourceTime, stickerHandle,
  stickerHandleRadius, stickersOf, textPose, transitionAt, transitionLength, type StickerBox,
} from './visuals';
import { maskFor, maskImageOf, type Mask } from './segmentation';

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
  /** Boxes of the visible stickers, topmost last. */
  stickerBoxes: StickerBox[] = [];
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
        // Photo or video shown behind a cut-out person.
        const bgId = c.bgRemoval?.mode === 'media' ? c.bgRemoval.assetId : undefined;
        const bg = bgId ? p.assets[bgId] : undefined;
        const bgUrl = bgId && urls[bgId];
        if (bg && bgUrl) {
          if (bg.kind === 'video') {
            const id = bgClipId(c.id);
            keepV.add(id);
            if (!this.videos.has(id)) this.videos.set(id, this.make('video', bgUrl));
          } else if (bg.kind === 'image') {
            keepI.add(bg.id);
            if (!this.images.has(bg.id)) {
              const img = new Image();
              img.src = bgUrl;
              this.images.set(bg.id, img);
            }
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

    // Background videos of "Quitar fondo" play silently behind their visible clip.
    for (const l of placed) {
      const r = this.videos.get(bgClipId(l.clip.id));
      if (!r) continue;
      const el = r.el;
      const bg = bgClip(p, l);
      const visible = bg && ((cur && l.index === cur.index) || (partner && l.index === partner.index));
      if (!visible) {
        if (!el.paused) el.pause();
        continue;
      }
      const src = bgTime(bg.asset, l, t);
      this.setVolume(r, 0);
      if (playing) {
        if (el.playbackRate !== 1) el.playbackRate = 1;
        if (Math.abs(el.currentTime - src) > 0.3 && !el.seeking) el.currentTime = src;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - src) > 0.02 && !el.seeking) el.currentTime = src;
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

  /** The decoded picture a preview media element is showing, or null if it is not ready yet. */
  private frameOf(clip: Clip, asset: Asset): FrameImage | null {
    if (asset.kind === 'video') {
      const el = this.videos.get(clip.id)?.el;
      return el && el.readyState >= 2 && el.videoWidth ? { src: el, w: el.videoWidth, h: el.videoHeight } : null;
    }
    const img = this.images.get(asset.id);
    return img && img.complete && img.naturalWidth ? { src: img, w: img.naturalWidth, h: img.naturalHeight } : null;
  }

  private render(p: Project, t: number, selection: Selection, placed: Placed[]) {
    const ctx = this.ctx!;
    const W = this.canvas!.width;
    const H = this.canvas!.height;
    // The preview's media elements are already seeked by updateMedia, so the source time is not needed here.
    const r = renderFrame(ctx, p, t, W, H, (clip, asset) => this.frameOf(clip, asset), placed, {
      stickerImage: (id) => this.images.get(id),
      live: useStore.getState().playing && !this.exporting,
    });
    if (!r) return; // keep the previous frame until this one is decoded

    if (!this.exporting && selection?.kind === 'sticker') {
      const b = r.stickers.find((x) => x.id === selection.id);
      if (b) this.drawStickerSelection(ctx, b, W);
    }
    if (!this.exporting && selection?.kind === 'text') {
      const box = r.texts.find((x) => x.id === selection.id);
      if (box) {
        ctx.save();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(2, W / 360);
        ctx.setLineDash([10, 8]);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.restore();
      }
    }
    this.stickerBoxes = r.stickers;
    this.textBoxes = r.texts;
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

/** A decoded picture of a clip, ready to draw. A zero size means "nothing to show" (drawn black). */
export interface FrameImage {
  src: CanvasImageSource;
  w: number;
  h: number;
}

/** Returns the picture of `clip` at source time `srcTime` (seconds), or null while it isn't ready. */
export type FrameLookup = (clip: Clip, asset: Asset, srcTime: number) => FrameImage | null;

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
}

const small = document.createElement('canvas');
/** The cut-out person of a clip with "Quitar fondo", before it goes over the new background. */
const cutLayer = document.createElement('canvas');
/** Offscreen frames of the outgoing and incoming clip during a transition. */
const layers = [document.createElement('canvas'), document.createElement('canvas')];

function layer(i: number, W: number, H: number) {
  const c = layers[i];
  if (c.width !== W || c.height !== H) {
    c.width = W;
    c.height = H;
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
    return lookup(l.clip, asset, sourceTime(l, t, asset.duration));
  };

  /** Mask and background of a clip with "Quitar fondo"; null when the export must wait for them. */
  const cutoutOf = (l: Placed, f: FrameImage): Cutout | null | undefined => {
    const bgr = l.clip.bgRemoval;
    const asset = p.assets[l.clip.assetId];
    if (!bgr || !asset) return undefined;
    const st = sourceTime(l, t, asset.duration);
    const key = asset.kind === 'image' ? `${asset.id}@img` : `${asset.id}@${Math.round(st * 30)}`;
    const mask = maskFor(key, asset.id, f.src, f.w, f.h, !!opts.live);
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
    const parts = [tr.out, tr.in].map((l) => {
      const f = l.index === cur.index ? source : other;
      return f && f.w && f.h ? { l, f, cut: cutoutOf(l, f) } : null;
    });
    if (parts.some((x) => x?.cut === null)) return null;
    const [a, b] = parts.map((x, i) => {
      if (!x) return null;
      const c = layer(i, W, H);
      drawClip(c.getContext('2d')!, x.l, x.f, t, W, H, x.cut ?? undefined);
      return c;
    });
    drawTransition(ctx, tr.type, a ?? b, b ?? a, tr.k, W, H);
  } else if (cur && source && source.w && source.h) {
    const cut = cutoutOf(cur, source);
    if (cut === null) return null;
    drawClip(ctx, cur, source, t, W, H, cut);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
  }

  const stickers: StickerBox[] = [];
  for (const st of stickersOf(p)) {
    if (t < st.start || t >= st.start + st.duration) continue;
    const b = drawSticker(ctx, st, st.assetId ? opts.stickerImage?.(st.assetId) : undefined, W, H);
    if (b) stickers.push(b);
  }

  const texts: Box[] = [];
  for (const item of p.texts) {
    if (t < item.start || t >= item.start + item.duration || !item.text.trim()) continue;
    texts.push(drawText(ctx, item, W, H, item.anim ? textPose(item, t - item.start) : undefined));
  }
  return { texts, stickers };
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
function bgClip(p: Project, l: Placed): { clip: Clip; asset: Asset } | null {
  const b = l.clip.bgRemoval;
  const asset = b?.mode === 'media' && b.assetId ? p.assets[b.assetId] : undefined;
  if (!asset || (asset.kind !== 'video' && asset.kind !== 'image')) return null;
  return { clip: { ...l.clip, id: bgClipId(l.clip.id), assetId: asset.id, in: 0, out: asset.duration, speed: 1, bgRemoval: undefined }, asset };
}

/** Background videos start with the clip and loop. */
function bgTime(asset: Asset, l: Placed, t: number) {
  if (asset.kind !== 'video' || asset.duration <= 0) return 0;
  const d = Math.max(0.1, asset.duration - 0.05);
  return Math.max(0, t - l.start) % d;
}

/** Paint one main-track clip (picture, color filter and effect) filling the whole frame. */
function drawClip(ctx: CanvasRenderingContext2D, l: Placed, f: FrameImage, t: number, W: number, H: number, cut?: Cutout) {
  const local = t - l.start;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  applyEffectTransform(ctx, l.clip, local, W, H);
  drawFrame(ctx, f.src, f.w, f.h, W, H, l.clip, effectCss(l.clip, W), cut?.mask ? cut : undefined);
  ctx.restore();
  applyEffectOverlay(ctx, l.clip, local, W, H);
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
  if (small.width !== bw || small.height !== bh) {
    small.width = bw;
    small.height = bh;
  }
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

function drawFrame(
  ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, clip: Clip, extraCss: string,
  cut?: Cutout,
) {
  const fit = clip.fit;
  if (cut) drawBackground(ctx, cut, src, sw, sh, W, H);
  else if (fit === 'fit') {
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
  const f = getFilter(clip.filter);
  const css = [f.id !== 'none' ? f.css : '', extraCss].filter(Boolean).join(' ');
  if (cut?.mask) {
    drawCutout(ctx, src, dx, dy, dw, dh, sw, sh, W, H, css, extraCss, f, cut.mask, cut.bg.smooth);
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
  W: number, H: number, css: string, extraCss: string, f: ReturnType<typeof getFilter>, mask: Mask, smooth: number,
) {
  if (cutLayer.width !== W || cutLayer.height !== H) {
    cutLayer.width = W;
    cutLayer.height = H;
  }
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
  small.width = tw;
  small.height = th;
  small.getContext('2d')!.drawImage(src, 0, 0, tw, th);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, dx, dy, dw, dh);
}

export const engine = new Engine();
export const canExport = () => Engine.pickMime() !== null;
