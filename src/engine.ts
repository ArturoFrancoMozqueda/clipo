import { useStore } from './store';
import type { Asset, Project, Selection } from './types';
import {
  activeClip, audioDur, canvasSize, clamp, layout, overlayDur, overlaysOf, PREVIEW_SHORT, PREVIEW_SHORT_LOW, totalDuration, type Placed,
} from './model';
import { sourceTime, stickerHandle, stickerHandleRadius, stickersOf, transitionAt, transitionLength, type StickerBox } from './visuals';
import { analyzeAsset, buildVoiceFx, mixOf, projectDuckCurve, voiceAssets, type FxChain } from './audioFx';
import { audioRole, curveAt, type ActivityByAsset } from './audioDsp';
import type { VoiceFxId } from './types';
import type { Box } from './textStyles';
import { bgClip, bgClipId, bgTime, renderFrame, type FrameImage, type MediaRef } from './render';
import { onRedraw } from './redraw';
import { setBgRemovalInUse, usesBgRemoval } from './segmentation';

// The drawing pipeline lives in render.ts; these re-exports keep the old import paths working.
export { bgClipId, renderFrame } from './render';
export type { FrameImage, FrameLookup, MediaRef, RenderOptions, RenderResult } from './render';

interface MediaRec<E extends HTMLMediaElement> {
  el: E;
  /** File it plays. It is the element's src only while the element is live (see the pool below). */
  url: string;
  live: boolean;
  /** Frame stamp of the last tick that needed it, for evicting the least recently used. */
  used: number;
  gain: GainNode | null;
  /** Web Audio source of the element, once the audio graph exists (made once per element). */
  src?: MediaElementAudioSourceNode | null;
  /** Voice effect currently wired between src and gain. */
  fx?: { id: VoiceFxId; chain: FxChain | null };
  /** As the clock: last currentTime seen and when it last moved (0 = not since it started). */
  lastCt?: number;
  movedAt?: number;
  /** When it was last hard-seeked while playing (those are rate-limited). */
  seekAt?: number;
  /** As a follower: its drift from the timeline (s), averaged over recent frames. */
  drift?: number;
}

/**
 * Media pool: every clip keeps its own element (and its Web Audio wiring, which can only be made
 * once per element), but only the ones near the playhead hold a file. Phones run out of video
 * decoders fast (a video split in 20 parts used to open 20 of them), so beyond these counts the
 * least recently needed elements drop their file and load it again when they are needed.
 */
const MAX_LIVE_VIDEOS = 4;
const MAX_LIVE_AUDIOS = 8;

/** Ordered by preference; MP4 is the most widely shareable result. */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** The real-time export gives up when the clock hasn't moved for this long (a stuck decoder). */
const EXPORT_STALL_MS = 20_000;
/** Average drawing time (ms) above which playback switches to the lighter preview size. */
const SLOW_FRAME_MS = 12;

// Playback sync. The active clip's element is the clock while it plays: its picture and its voice
// come out of one decoder, so they can't drift apart. The timeline follows that element, and every
// other element (music, voice-overs, overlays, the other clip of a transition) follows the timeline
// through small playbackRate changes. A hard seek stalls the picture and skips the sound of a playing
// element, so it is kept for large drift only.
// requestVideoFrameCallback is deliberately not used: in Chrome, armed on these hidden elements it
// froze 4K HEVC (iPhone) decoding mid-clip.
/** The timeline jumps to the clock element when they disagree by more than this (s)... */
const CLOCK_SNAP = 0.25;
/** ...and otherwise takes this share of the gap each frame (smooths out currentTime's jitter). */
const CLOCK_PULL = 0.2;
/** The clock element counts as running for this long (ms) after its time last moved. */
const CLOCK_FRESH_MS = 120;
/** "Playing" but its time hasn't moved for this long (ms): it stopped being a usable clock. */
const CLOCK_STUCK_MS = 600;
/** Waiting this long (ms) for the clock element to start, seek to where it is to unstick its decoder... */
const CLOCK_KICK_MS = 2500;
/** ...and after this long give up on it: the wall clock runs the clip and the element follows. */
const CLOCK_GIVE_UP_MS = 6000;
/** Followers further off than this (s) are hard-seeked, at most every FOLLOW_SEEK_MS unless very far. */
const FOLLOW_SEEK = 0.35;
const FOLLOW_SEEK_MS = 2000;
/** While the clock waits for buffering longer than this (ms), followers pause instead of running ahead. */
const FOLLOW_HOLD_MS = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seek a media element unless it's already there (or still busy / without metadata). */
function seekTo(el: HTMLMediaElement, t: number, tolerance: number) {
  if (el.readyState >= 1 && !el.seeking && Math.abs(el.currentTime - t) > tolerance) el.currentTime = t;
}

/** At the end of its footage. play() would restart it from 0, so it must never be "resumed". */
function atEnd(el: HTMLMediaElement) {
  return el.ended || (Number.isFinite(el.duration) && el.duration > 0 && el.currentTime >= el.duration - 0.05);
}

function setRate(el: HTMLMediaElement, rate: number) {
  // Only real changes: every write makes the decoder re-time its sound.
  if (Math.abs(el.playbackRate - rate) > 1e-3) el.playbackRate = rate;
}

/**
 * Rate change that pulls a follower `drift` seconds off (positive = ahead) back in line: a few coarse
 * steps, so the rate rarely changes while it converges, and a dead band so it settles.
 */
function nudge(drift: number) {
  const a = Math.abs(drift);
  const k = a < 0.015 ? 0 : a < 0.04 ? 0.015 : a < 0.12 ? 0.03 : 0.05;
  return drift > 0 ? -k : k;
}

/**
 * Plays the project by driving hidden media elements from one master clock and compositing frames
 * onto the preview canvas. It only draws when something changed (or while playing), so a paused
 * editor costs nothing. Export records that same canvas plus the mixed audio.
 */
class Engine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private hostEl: HTMLDivElement | null = null;
  private videos = new Map<string, MediaRec<HTMLVideoElement>>(); // by clip or overlay id
  private audios = new Map<string, MediaRec<HTMLAudioElement>>(); // by audio item id
  private images = new Map<string, HTMLImageElement>(); // by asset id
  private actx: AudioContext | null = null;
  private master: GainNode | null = null;
  private monitor: GainNode | null = null;
  private recDest: MediaStreamAudioDestinationNode | null = null;
  /** Timeline time at clockWall (performance.now); playback moves on from there. */
  private clockT = 0;
  private clockWall = 0;
  /** Time the clock last wrote: anything else in the store while playing is a jump (re-place everything). */
  private lastT = -1;
  /** Since when the clock has been waiting for the clock element (0 = running). */
  private holdSince = 0;
  /** Which clip's element the clock is waiting for, since when, and whether it was kicked already. */
  private wait = { id: '', since: 0, kicked: false };
  /** Clip whose element couldn't drive the clock (won't start, froze): the wall clock runs it. */
  private wallOnly: string | null = null;
  /** The real-time export waits for another visible video: everything holds still. */
  private exportHold = false;
  private onEnded: (() => void) | null = null;
  private abortExport: (() => void) | null = null;
  /** Voice activity of each media file (for ducking), filled in as files are analyzed. */
  private voiceActivity: ActivityByAsset = {};
  private activityVersion = 0;
  private duck: { project: Project; version: number; curve: Float32Array | null } | null = null;
  /** Pending animation frame (0 = the loop is idle). */
  private raf = 0;
  /** Something visible changed since the last drawn frame. */
  private dirty = true;
  /** True while a frame runs: the time it writes to the store is already being drawn. */
  private ticking = false;
  /** Frames in a row that couldn't be drawn because a picture wasn't decoded yet. */
  private misses = 0;
  private stamp = 0;
  private resizeWatch: MutationObserver | null = null;
  /** Average drawing time while playing, and whether this device needs the lighter preview. */
  private cost = 0;
  private costFrames = 0;
  private slow = false;
  /** Set while playback draws at the lighter size: the sizes to go back to. */
  private lowered: { w: number; h: number; fullW: number; fullH: number } | null = null;
  private hold = false;
  /** Bounding boxes of the visible texts, for tapping and dragging in the preview. */
  textBoxes: Box[] = [];
  /** Boxes of the visible stickers, topmost last. */
  stickerBoxes: StickerBox[] = [];
  /** Boxes of the visible overlays (picture-in-picture), topmost last. */
  overlayBoxes: StickerBox[] = [];
  exporting = false;

  /** Set by the fast exporter so the preview stops redrawing and leaves it the processor. */
  get holdPreview() {
    return this.hold;
  }
  set holdPreview(v: boolean) {
    this.hold = v;
    if (!v) this.markDirty();
  }

  constructor() {
    useStore.subscribe((s, prev) => {
      if (s.project !== prev.project || s.urls !== prev.urls) this.sync(s.project, s.urls);
      // Time and play state written by the frame loop itself are drawn by that same frame.
      const own = this.ticking && s.project === prev.project && s.selection === prev.selection;
      if (!own) this.markDirty();
    });
    const s = useStore.getState();
    this.sync(s.project, s.urls);
    onRedraw(this.markDirty);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.resumeAudio();
          this.markDirty();
        }
      });
    }
  }

  /** Draw again on the next animation frame (cheap to call often; the loop idles otherwise). */
  markDirty = () => {
    this.dirty = true;
    if (!this.raf && typeof requestAnimationFrame !== 'undefined') this.raf = requestAnimationFrame(this.frame);
  };

  private frame = (now: number) => {
    this.raf = 0;
    this.dirty = false;
    this.ticking = true;
    try {
      this.tick(now);
    } finally {
      this.ticking = false;
    }
    // Keep going while playing (the clock moves) or when this frame asked for another one.
    if ((useStore.getState().playing || this.dirty) && !this.raf && typeof requestAnimationFrame !== 'undefined') {
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    // Resizing a canvas clears it (a new format, the export size): draw again.
    this.resizeWatch?.disconnect();
    if (typeof MutationObserver !== 'undefined') {
      this.resizeWatch = new MutationObserver(this.markDirty);
      this.resizeWatch.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
    }
    this.markDirty();
  }

  detach(canvas: HTMLCanvasElement) {
    if (this.canvas === canvas) {
      this.pause();
      this.resizeWatch?.disconnect();
      this.resizeWatch = null;
      this.canvas = null;
      this.ctx = null;
    }
  }

  // ---------- media elements ----------

  private get host() {
    if (!this.hostEl) {
      this.hostEl = document.createElement('div');
      this.hostEl.className = 'media-host';
      document.body.appendChild(this.hostEl);
    }
    return this.hostEl;
  }

  private image(id: string, url: string) {
    let img = this.images.get(id);
    if (!img) {
      img = new Image();
      img.addEventListener('load', this.markDirty);
      img.src = url;
      this.images.set(id, img);
    }
  }

  private video(id: string, url: string) {
    const r = this.videos.get(id);
    if (!r) this.videos.set(id, this.make('video', url));
    else this.relink(r, url);
  }

  private sync(p: Project | null, urls: Record<string, string>) {
    if (typeof document === 'undefined') return;
    // "Quitar fondo" frees its models when no clip uses it any more, and right away when the project closes.
    setBgRemovalInUse(!!p && usesBgRemoval(p), !p);
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
          this.video(c.id, url);
        } else if (a.kind === 'image') {
          keepI.add(c.assetId);
          this.image(c.assetId, url);
        }
        // Photo or video shown behind a cut-out person.
        const bgId = c.bgRemoval?.mode === 'media' ? c.bgRemoval.assetId : undefined;
        const bg = bgId ? p.assets[bgId] : undefined;
        const bgUrl = bgId && urls[bgId];
        if (bg && bgUrl) {
          if (bg.kind === 'video') {
            const id = bgClipId(c.id);
            keepV.add(id);
            this.video(id, bgUrl);
          } else if (bg.kind === 'image') {
            keepI.add(bg.id);
            this.image(bg.id, bgUrl);
          }
        }
      }
      for (const st of stickersOf(p)) {
        const url = st.assetId && urls[st.assetId];
        if (!url) continue;
        keepI.add(st.assetId!);
        this.image(st.assetId!, url);
      }
      for (const ov of overlaysOf(p)) {
        const a = p.assets[ov.assetId];
        const url = urls[ov.assetId];
        if (!a || !url) continue;
        if (a.kind === 'video') {
          keepV.add(ov.id);
          this.video(ov.id, url);
        } else if (a.kind === 'image') {
          keepI.add(ov.assetId);
          this.image(ov.assetId, url);
        }
      }
      for (const au of p.audios) {
        const url = urls[au.assetId];
        if (!url) continue;
        keepA.add(au.id);
        const r = this.audios.get(au.id);
        if (!r) this.audios.set(au.id, this.make('audio', url));
        else this.relink(r, url);
      }
      // Ducking needs to know when people talk: analyze the sound of the clips and voice items once.
      if (mixOf(p).duck > 0) {
        for (const id of voiceAssets(p)) {
          if (id in this.voiceActivity || !urls[id]) continue;
          this.voiceActivity[id] = undefined;
          analyzeAsset(id, urls[id]).then((a) => {
            this.voiceActivity[id] = a?.activity;
            this.activityVersion++;
          });
        }
      }
    }
    for (const [id, r] of this.videos) if (!keepV.has(id)) { this.dispose(r); this.videos.delete(id); }
    for (const [id, r] of this.audios) if (!keepA.has(id)) { this.dispose(r); this.audios.delete(id); }
    for (const id of [...this.images.keys()]) if (!keepI.has(id)) this.images.delete(id);
  }

  /** A pooled element for a file. It gets the file (src) only when the playhead needs it. */
  private make<K extends 'video' | 'audio'>(kind: K, url: string): MediaRec<HTMLElementTagNameMap[K]> {
    const el = document.createElement(kind);
    el.preload = 'none';
    el.setAttribute('playsinline', '');
    // A new picture (or the metadata needed to seek) arrived: draw again.
    for (const ev of ['loadedmetadata', 'loadeddata', 'canplay', 'seeked', 'resize']) el.addEventListener(ev, this.markDirty);
    this.host.appendChild(el);
    const r: MediaRec<HTMLElementTagNameMap[K]> = { el, url, live: false, used: 0, gain: null };
    this.connect(r);
    return r;
  }

  /** The file behind an item changed (e.g. relinked): load the new one if it is live. */
  private relink(r: MediaRec<HTMLMediaElement>, url: string) {
    if (r.url === url) return;
    r.url = url;
    if (r.live) {
      r.el.src = url;
      this.markDirty();
    }
  }

  /** This element is needed now: give it its file. */
  private need(r: MediaRec<HTMLMediaElement>) {
    r.used = this.stamp;
    if (r.live) return;
    r.live = true;
    r.el.preload = 'auto';
    r.el.src = r.url;
  }

  /** Give the file back (frees the decoder and its buffers); the element and its audio wiring stay. */
  private release(r: MediaRec<HTMLMediaElement>) {
    if (!r.live) return;
    r.live = false;
    r.el.pause();
    r.el.preload = 'none';
    r.el.removeAttribute('src');
    r.el.load();
  }

  /** Keep at most `max` live elements, releasing the ones not needed this frame, oldest first. */
  private trim(pool: Map<string, MediaRec<HTMLMediaElement>>, max: number) {
    let live = 0;
    for (const r of pool.values()) if (r.live) live++;
    if (live <= max) return;
    const idle = [...pool.values()].filter((r) => r.live && r.used !== this.stamp).sort((a, b) => a.used - b.used);
    for (const r of idle) {
      if (live <= max) break;
      this.release(r);
      live--;
    }
  }

  private dispose(r: MediaRec<HTMLMediaElement>) {
    r.fx?.chain?.dispose();
    r.src?.disconnect();
    r.gain?.disconnect();
    r.src = null;
    r.gain = null;
    for (const ev of ['loadedmetadata', 'loadeddata', 'canplay', 'seeked', 'resize']) r.el.removeEventListener(ev, this.markDirty);
    r.el.pause();
    r.el.removeAttribute('src');
    r.el.load();
    r.el.remove();
  }

  /** Audio graph: element -> gain -> master -> (speakers via monitor, recorder). */
  private ensureAudio() {
    if (!this.actx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      // iOS: Web Audio follows the silent switch unless the page declares itself a media player.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) {
        try {
          nav.audioSession.type = 'playback';
        } catch {
          /* older WebKit: read-only */
        }
      }
      const actx = new AC();
      this.actx = actx;
      this.master = actx.createGain();
      this.monitor = actx.createGain();
      this.recDest = actx.createMediaStreamDestination();
      this.master.connect(this.monitor);
      this.monitor.connect(actx.destination);
      this.master.connect(this.recDest);
      for (const r of [...this.videos.values(), ...this.audios.values()]) this.connect(r);
      // iOS suspends ("interrupted") the context on calls, Siri or the lock screen; the next touch brings it back.
      document.addEventListener('pointerdown', () => this.resumeAudio(), { capture: true, passive: true });
    }
    this.resumeAudio();
  }

  private resumeAudio() {
    const st = this.actx?.state as string | undefined;
    if (st === 'suspended' || st === 'interrupted') this.actx!.resume().catch(() => {});
  }

  private connect(r: MediaRec<HTMLMediaElement>) {
    if (!this.actx || !this.master || r.src) return;
    try {
      const src = this.actx.createMediaElementSource(r.el);
      const g = this.actx.createGain();
      src.connect(g);
      g.connect(this.master);
      r.src = src;
      r.gain = g;
    } catch {
      /* already connected or unsupported: plain element volume is used */
    }
  }

  /** Put the right voice effect between the element and its volume (rewired only when it changes). */
  private setFx(r: MediaRec<HTMLMediaElement>, id: VoiceFxId = 'none') {
    if (!this.actx || !r.src || !r.gain || (r.fx?.id ?? 'none') === id) return;
    r.fx?.chain?.dispose();
    r.src.disconnect();
    const chain = buildVoiceFx(this.actx, id);
    if (chain) {
      r.src.connect(chain.input);
      chain.output.connect(r.gain);
    } else r.src.connect(r.gain);
    r.fx = { id, chain };
  }

  /** How loud the background music may be at time t (1 = untouched), following the voices. */
  private duckAt(p: Project, t: number) {
    if (mixOf(p).duck <= 0) return 1;
    if (!this.duck || this.duck.project !== p || this.duck.version !== this.activityVersion) {
      this.duck = { project: p, version: this.activityVersion, curve: projectDuckCurve(p, this.voiceActivity, totalDuration(p)) };
    }
    return this.duck.curve ? curveAt(this.duck.curve, t) : 1;
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
    this.restart(t, performance.now());
    this.wallOnly = null;
    s.setPlaying(true);
    this.markDirty();
  }

  /** Start the clock at t: every element is placed there and started again (no element is trusted to be in step). */
  private restart(t: number, now: number) {
    this.clockT = this.lastT = t;
    this.clockWall = now;
    this.holdSince = 0;
    this.wait.since = 0;
    this.pauseAll();
  }

  pause() {
    const s = useStore.getState();
    if (s.playing) s.setPlaying(false);
    this.pauseAll();
    this.holdSince = 0;
    this.exportHold = false;
    this.fitResolution(false);
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
    if (!p || !this.ctx || !this.canvas || this.hold) return;
    this.stamp++;

    const placed = layout(p);
    let t = s.time;
    if (s.playing) {
      // Someone moved the playhead while playing: start over from there.
      if (t !== this.lastT) this.restart(t, now);
      t = this.advance(now, p, placed, t);
      const d = totalDuration(p);
      if (t >= d) {
        t = d;
        s.setTime(t);
        s.setPlaying(false);
        this.pauseAll();
        const cb = this.onEnded;
        this.onEnded = null;
        cb?.();
      } else s.setTime(t);
      this.lastT = t;
    }
    const playing = useStore.getState().playing;
    this.fitResolution(playing, p);
    const t0 = performance.now();
    this.updateMedia(p, t, playing, placed, now);
    const drawn = this.render(p, t, s.selection, placed);
    if (playing && !this.exporting && !this.lowered && drawn) this.measure(performance.now() - t0);
    // A picture isn't decoded yet: media events wake the loop, but retry for a moment anyway.
    if (drawn) this.misses = 0;
    else if (this.misses++ < 30) this.dirty = true;
  }

  /**
   * Where the timeline is now. It runs on the wall clock, locked to the active clip's element
   * whenever that one plays; it waits (never runs backwards) while that element buffers or starts.
   */
  private advance(now: number, p: Project, placed: Placed[], prevT: number) {
    // The loop sleeps while nothing changes, and a long gap (a background tab) isn't playback time.
    let t = this.clockT + clamp(now - this.clockWall, 0, 250) / 1000;
    const cur = activeClip(p, prevT, placed);
    const m = cur && this.masterOf(p, cur);
    // The real-time export also waits for overlays and the other clip of a transition, or they'd be missing from the file.
    this.exportHold = this.exporting && this.othersBusy(p, placed, prevT, cur);
    let hold = this.exportHold;
    if (cur && m && !hold) {
      const el = m.el;
      const ct = el.currentTime;
      const going = !el.paused && !el.seeking;
      const moved = going && ct !== m.lastCt;
      if (moved) {
        m.lastCt = ct;
        m.movedAt = now;
      }
      if (moved) {
        this.wait.since = 0;
        const mt = cur.start + (ct - cur.clip.in) / cur.clip.speed;
        const err = mt - t;
        t = Math.abs(err) > CLOCK_SNAP ? mt : t + err * CLOCK_PULL;
      } else if (going && m.movedAt && now - m.movedAt < CLOCK_FRESH_MS) {
        // currentTime didn't tick this frame; the wall clock bridges it.
      } else {
        hold = true;
        this.waitFor(cur.clip.id, m, now);
      }
    }
    if (hold) {
      t = prevT;
      this.holdSince ||= now;
    } else this.holdSince = 0;
    // Never backwards while playing: it would flip back to the previous clip at a cut.
    t = Math.max(t, prevT);
    this.clockT = t;
    this.clockWall = now;
    return t;
  }

  /** The clock waits for this element to start or to get over a stall, but not forever. */
  private waitFor(id: string, r: MediaRec<HTMLMediaElement>, now: number) {
    const w = this.wait;
    if (w.id !== id || !w.since) Object.assign(w, { id, since: now, kicked: false });
    const el = r.el;
    const waited = now - w.since;
    // "Playing", fully loaded and still frozen: it isn't going to start.
    const stuck = !el.paused && !el.seeking && el.readyState >= 3 && !!r.movedAt && now - r.movedAt > CLOCK_STUCK_MS;
    if (stuck || waited > CLOCK_GIVE_UP_MS) {
      this.wallOnly = id;
    } else if (waited > CLOCK_KICK_MS && !w.kicked && el.readyState >= 1 && !el.seeking) {
      // Decoders sometimes stall without an error: seeking to where it is gets them going again.
      w.kicked = true;
      el.currentTime = el.currentTime;
    }
  }

  /** The element that drives the clock for the active clip, or null (photo, freeze frame, no footage left). */
  private masterOf(p: Project, l: Placed) {
    if (l.clip.freeze != null || this.wallOnly === l.clip.id || p.assets[l.clip.assetId]?.kind !== 'video') return null;
    const r = this.videos.get(l.clip.id);
    // Files are often a hair shorter than their metadata: past its last frame the wall clock ends the clip.
    if (!r || (r.live && atEnd(r.el))) return null;
    return r;
  }

  /** Some visible video besides the active one has no picture yet (only the export waits for these). */
  private othersBusy(p: Project, placed: Placed[], t: number, cur: Placed | null) {
    // HAVE_CURRENT_DATA is enough: a clip holding its last frame never gets more.
    const busy = (r: MediaRec<HTMLVideoElement> | undefined) => !!r && r.live && (r.el.readyState < 2 || r.el.seeking);
    if (overlaysOf(p).some((o) => t >= o.start && t < o.start + overlayDur(o) && busy(this.videos.get(o.id)))) return true;
    const tr = cur && transitionAt(placed, t);
    const partner = tr && cur ? (tr.out.index === cur.index ? tr.in : tr.out) : null;
    return !!partner && busy(this.videos.get(partner.clip.id));
  }

  /** Track how long drawing takes while playing; a device that keeps missing the frame budget gets the lighter preview. */
  private measure(ms: number) {
    this.cost = this.costFrames ? this.cost * 0.9 + ms * 0.1 : ms;
    if (++this.costFrames > 45 && this.cost > SLOW_FRAME_MS) this.slow = true;
  }

  /**
   * While playing on a slow device, draw the preview at PREVIEW_SHORT_LOW (CSS keeps its on-screen
   * size); back to full size when paused, so editing and snapshots stay sharp. Export sizes are untouched.
   */
  private fitResolution(playing: boolean, p = useStore.getState().project) {
    const c = this.canvas;
    if (!c) return;
    if (playing && this.slow && !this.exporting && p) {
      if (this.lowered) return;
      const [fw, fh] = canvasSize(p.aspect, PREVIEW_SHORT);
      if (c.width !== fw || c.height !== fh) return; // not the regular preview size: leave it
      const [w, h] = canvasSize(p.aspect, PREVIEW_SHORT_LOW);
      this.lowered = { w, h, fullW: fw, fullH: fh };
      c.width = w;
      c.height = h;
    } else if (this.lowered) {
      const r = this.lowered;
      this.lowered = null;
      // Someone else resized it meanwhile (a new format): keep their size.
      if (c.width === r.w && c.height === r.h) {
        c.width = r.fullW;
        c.height = r.fullH;
      }
      this.markDirty();
    }
  }

  /** Start a paused element at `target` (placed precisely first: it isn't playing, so seeking costs nothing audible). */
  private start(r: MediaRec<HTMLMediaElement>, target: number, rate: number) {
    const el = r.el;
    if (el.readyState < 1 || el.seeking) return; // play() once it knows where it is
    if (Math.abs(el.currentTime - target) > 0.04) el.currentTime = target;
    // At the end of its footage play() would restart it from 0: it holds its last frame instead.
    else if (atEnd(el)) return;
    setRate(el, rate);
    r.lastCt = el.currentTime;
    r.movedAt = 0;
    r.drift = undefined;
    el.play().catch(() => {});
  }

  /** The active clip's element while it is the clock: started where it belongs, then left alone. */
  private drive(r: MediaRec<HTMLMediaElement>, target: number, rate: number) {
    const el = r.el;
    if (this.exportHold) {
      if (!el.paused) el.pause();
    } else if (el.paused) this.start(r, target, rate);
    else {
      setRate(el, rate);
      // Only a gross mismatch is corrected (the clock waits for it otherwise).
      if (!el.seeking && el.readyState >= 1 && Math.abs(el.currentTime - target) > 1) el.currentTime = target;
    }
  }

  /**
   * Keep a playing element in step with the timeline: start it where it belongs, then steer it with
   * small playbackRate changes. Only a large drift gets a hard seek, and not over and over (a decoder
   * that can't keep up would otherwise stall on every frame).
   */
  private follow(r: MediaRec<HTMLMediaElement>, target: number, rate: number, run: boolean) {
    const el = r.el;
    // The clock waits for buffering: don't run ahead meanwhile.
    if (!run) return void (el.paused || el.pause());
    if (el.paused) return this.start(r, target, rate);
    if (el.readyState < 1 || el.seeking) return;
    const drift = el.currentTime - target;
    const now = performance.now();
    if (Math.abs(drift) > FOLLOW_SEEK && (Math.abs(drift) > 1 || now - (r.seekAt ?? 0) > FOLLOW_SEEK_MS)) {
      r.seekAt = now;
      r.drift = 0;
      el.currentTime = target;
      setRate(el, rate);
      return;
    }
    // Steered by the averaged drift: currentTime jitters by a few ms per read, and reacting to that
    // would flip the rate back and forth.
    r.drift = (r.drift ?? drift) * 0.9 + drift * 0.1;
    setRate(el, rate * (1 + nudge(r.drift)));
  }

  /** Shows the frame at `src` while paused or scrubbing (precise), or while its footage holds still. */
  private still(el: HTMLMediaElement, src: number, tolerance: number) {
    if (!el.paused) el.pause();
    seekTo(el, src, tolerance);
  }

  private updateMedia(p: Project, t: number, playing: boolean, placed: Placed[], now = performance.now()) {
    const cur = activeClip(p, t, placed);
    const tr = transitionAt(placed, t);
    // During a transition the other clip is visible too: it plays muted alongside the current one.
    const partner = tr ? (tr.out.index === cur?.index ? tr.in : tr.out) : null;
    // Followers run unless the clock has been waiting a while (buffering) or the export is holding.
    const run = playing && !this.exportHold && !(this.holdSince && now - this.holdSince > FOLLOW_HOLD_MS);
    for (const l of placed) {
      const r = this.videos.get(l.clip.id);
      if (!r) continue;
      const el = r.el;
      const dur = p.assets[l.clip.assetId]?.duration ?? l.clip.out;
      this.setFx(r, l.clip.voiceFx);
      if (cur && l.index === cur.index) {
        this.need(r);
        const frozen = l.clip.freeze != null;
        const src = frozen ? sourceTime(l, t, dur) : clamp(l.clip.in + (t - l.start) * l.clip.speed, l.clip.in, l.clip.out);
        this.setVolume(r, frozen ? 0 : l.clip.volume);
        if (!playing || frozen) this.still(el, src, 0.02);
        else if (this.wallOnly === l.clip.id) this.follow(r, src, l.clip.speed, run);
        else if (r.live && atEnd(el)) el.pause(); // out of footage: it holds its last frame
        else this.drive(r, src, l.clip.speed);
      } else if (partner && l.index === partner.index) {
        this.need(r);
        const raw = l.clip.in + (t - l.start) * l.clip.speed;
        const src = sourceTime(l, t, dur);
        const held = Math.abs(raw - src) > 0.01; // ran out of footage: hold the edge frame
        this.setVolume(r, 0);
        if (playing && !held) this.follow(r, src, l.clip.speed, run);
        else this.still(el, src, playing ? 0.1 : 0.02);
      } else {
        if (!el.paused) el.pause();
        // Pre-roll the next clip (to where its transition starts) so the cut is seamless. While
        // playing also the one after when it starts soon: a very short clip leaves no time to load it.
        const ahead = cur ? l.index - cur.index : 0;
        if (cur && (ahead === 1 || (ahead === 2 && playing && l.start - t < 3))) {
          this.need(r);
          const prev = placed[l.index - 1]!.clip;
          const lead = transitionLength(prev, l.clip) / 2;
          // Precise: it starts from here without another seek.
          seekTo(el, sourceTime(l, l.start - lead, dur), 0.02);
        }
      }
    }

    for (const ov of overlaysOf(p)) {
      const r = this.videos.get(ov.id);
      if (!r) continue;
      const el = r.el;
      const local = t - ov.start;
      if (local >= 0 && local < overlayDur(ov)) {
        this.need(r);
        const src = ov.in + local;
        this.setVolume(r, ov.volume);
        if (playing) this.follow(r, src, 1, run);
        else this.still(el, src, 0.02);
      } else {
        if (!el.paused) el.pause();
        // Pre-roll so the overlay appears on time.
        if (local < 0 && local > -3) {
          this.need(r);
          seekTo(el, ov.in, 0.02);
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
        if (bg && cur && l.index === cur.index + 1) this.need(r); // load it before its clip starts
        continue;
      }
      this.need(r);
      const src = bgTime(bg.asset, l, t);
      this.setVolume(r, 0);
      if (playing) this.follow(r, src, 1, run);
      else this.still(el, src, 0.02);
    }

    for (const a of p.audios) {
      const r = this.audios.get(a.id);
      if (!r) continue;
      const end = a.start + audioDur(a);
      const el = r.el;
      if (t >= a.start && t < end) {
        this.need(r);
        const src = a.in + (t - a.start);
        let fade = 1;
        if (a.fadeIn > 0) fade = Math.min(fade, (t - a.start) / a.fadeIn);
        if (a.fadeOut > 0) fade = Math.min(fade, (end - t) / a.fadeOut);
        const duck = audioRole(a, p.assets[a.assetId]?.name) === 'music' ? this.duckAt(p, t) : 1;
        this.setFx(r, a.voiceFx);
        this.setVolume(r, a.volume * clamp(fade, 0, 1) * duck);
        if (playing) this.follow(r, src, 1, run);
        else this.still(el, src, 0.05);
      } else {
        if (!el.paused) el.pause();
        if (t < a.start && t > a.start - 5) {
          this.need(r);
          seekTo(el, a.in, 0.02);
        }
      }
    }

    this.trim(this.videos, MAX_LIVE_VIDEOS);
    this.trim(this.audios, MAX_LIVE_AUDIOS);
  }

  /** The decoded picture a preview media element is showing, or null if it is not ready yet. */
  private frameOf(clip: MediaRef, asset: Asset): FrameImage | null {
    if (asset.kind === 'video') {
      const el = this.videos.get(clip.id)?.el;
      return el && el.readyState >= 2 && el.videoWidth ? { src: el, w: el.videoWidth, h: el.videoHeight } : null;
    }
    const img = this.images.get(asset.id);
    return img && img.complete && img.naturalWidth ? { src: img, w: img.naturalWidth, h: img.naturalHeight } : null;
  }

  private lookup = (clip: MediaRef, asset: Asset) => this.frameOf(clip, asset);
  private stickerImage = (id: string) => this.images.get(id);

  /** Draws the frame; false when a picture wasn't ready (the previous frame stays on screen). */
  private render(p: Project, t: number, selection: Selection, placed: Placed[]) {
    const ctx = this.ctx!;
    const W = this.canvas!.width;
    const H = this.canvas!.height;
    // The preview's media elements are already seeked by updateMedia, so the source time is not needed here.
    const r = renderFrame(ctx, p, t, W, H, this.lookup, placed, {
      stickerImage: this.stickerImage,
      live: useStore.getState().playing && !this.exporting,
    });
    if (!r) return false; // keep the previous frame until this one is decoded

    if (!this.exporting && (selection?.kind === 'sticker' || selection?.kind === 'overlay')) {
      const b = (selection.kind === 'sticker' ? r.stickers : r.overlays).find((x) => x.id === selection.id);
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
    this.overlayBoxes = r.overlays;
    this.textBoxes = r.texts;
    return true;
  }

  /** A small RGBA sample of what a clip or overlay shows right now (for automatic color). */
  samplePixels(ref: MediaRef): Uint8ClampedArray | null {
    const p = useStore.getState().project;
    const asset = p?.assets[ref.assetId];
    if (!asset) return null;
    const f = this.frameOf(ref, asset);
    if (!f) return null;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = Math.max(8, Math.round((64 * f.h) / f.w));
    const cx = c.getContext('2d', { willReadFrequently: true })!;
    cx.drawImage(f.src, 0, 0, c.width, c.height);
    try {
      return cx.getImageData(0, 0, c.width, c.height).data;
    } catch {
      return null;
    }
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

  /**
   * Record the project in real time. Resolves with the finished file. Rejects with Error('cancelled')
   * when `signal` aborts or cancelExport() is called (at any point, also while it is starting), and
   * with a message for the user if the app goes to the background or playback stops advancing.
   */
  async exportVideo(short: number, signal?: AbortSignal): Promise<{ blob: Blob; ext: string }> {
    const s = useStore.getState();
    const p = s.project;
    const canvas = this.canvas;
    const mime = Engine.pickMime();
    if (!p || !canvas) throw new Error('No hay proyecto abierto');
    if (mime === null || !('captureStream' in canvas)) throw new Error('unsupported');
    if (signal?.aborted) throw new Error('cancelled');

    // Every way of stopping ends up here, so a cancel during the first await isn't lost.
    let fail: (e: Error) => void = () => {};
    let stopped = false;
    const failed = new Promise<never>((_, reject) => (fail = reject));
    failed.catch(() => {});
    const stop = (e: Error) => {
      if (stopped) return;
      stopped = true;
      fail(e);
    };
    /** Wait for `x`, but give up as soon as the export is stopped. */
    const guard = <T,>(x: Promise<T>) => Promise.race([x, failed]);
    this.abortExport = () => stop(new Error('cancelled'));
    const onAbort = () => stop(new Error('cancelled'));
    signal?.addEventListener('abort', onAbort);
    // A background tab stops drawing frames, so the recording would hang or come out frozen.
    const onHidden = () => {
      if (document.visibilityState === 'hidden') {
        stop(new Error('La exportación se detuvo porque la app pasó a segundo plano. Mantén Clipo abierto en pantalla mientras exporta.'));
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    // Watchdog: the clock waits for buffering, but not forever.
    let lastT = -1;
    let lastMove = performance.now();
    const watchdog = setInterval(() => {
      const st = useStore.getState();
      if (!st.playing) return;
      if (st.time !== lastT) {
        lastT = st.time;
        lastMove = performance.now();
      } else if (performance.now() - lastMove > EXPORT_STALL_MS) {
        stop(new Error('La exportación se quedó detenida (el video no avanzaba). Vuelve a intentarlo.'));
      }
    }, 1000);

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
    this.markDirty();

    const stream = canvas.captureStream(30);
    this.recDest?.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: short >= 1080 ? 8_000_000 : 5_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const recorded = new Promise<void>((r) => (rec.onstop = () => r()));

    try {
      await guard(sleep(500)); // let the first frame seek and draw
      rec.start(1000);
      await guard(
        new Promise<void>((resolve) => {
          this.onEnded = resolve;
          this.play();
        }),
      );
      await guard(sleep(300)); // flush the last frames
      rec.stop();
      await guard(recorded);
      const type = rec.mimeType || mime || 'video/webm';
      return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
    } catch (e) {
      if (rec.state !== 'inactive') rec.stop();
      throw e;
    } finally {
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onHidden);
      signal?.removeEventListener('abort', onAbort);
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
      this.markDirty();
    }
  }

  cancelExport() {
    this.pauseAll();
    useStore.getState().setPlaying(false);
    this.abortExport?.();
  }
}

let instance: Engine | null = null;
const getEngine = () => (instance ??= new Engine());

/**
 * The app's engine, created on first use (importing this module touches no DOM, so modules that
 * import it stay loadable in Node tests).
 */
export const engine: Engine = new Proxy({} as Engine, {
  get(_, key) {
    const e = getEngine();
    const v = Reflect.get(e, key, e);
    return typeof v === 'function' ? v.bind(e) : v;
  },
  set(_, key, value) {
    return Reflect.set(getEngine(), key, value);
  },
  has(_, key) {
    return key in getEngine();
  },
});

export const canExport = () => Engine.pickMime() !== null;
