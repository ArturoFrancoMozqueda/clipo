import type { VideoCodec, VideoSample, VideoSampleSink } from 'mediabunny';
import { engine, renderFrame, type FrameImage } from './engine';
import { audioDur, canvasSize, clamp, clipDur, layout, totalDuration } from './model';
import { useStore } from './store';
import type { Clip, Project } from './types';

export interface ExportProgress {
  /** 0..100 */
  pct: number;
  /** Estimated seconds left, or null while it can't be estimated yet. */
  eta: number | null;
  /** True for the faster-than-real-time path, false for the real-time recorder fallback. */
  fast: boolean;
}

export interface ExportResult {
  blob: Blob;
  ext: string;
}

const FPS = 30;
const SAMPLE_RATE = 48000;
/** Share of the progress bar spent mixing the audio before the first frame is encoded. */
const AUDIO_SHARE = 5;

const hasRecorder = () => typeof MediaRecorder !== 'undefined';
/** WebCodecs + offline audio: everything the fast path needs (missing on older iOS Safari). */
export const canFastExport = () =>
  typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof OfflineAudioContext !== 'undefined';
export const canExport = () => canFastExport() || hasRecorder();

/** Thrown when the fast path can't run on this device; the recorder takes over. */
class Unsupported extends Error {}

const cancelled = () => new Error('cancelled');

/**
 * Saves the project as a video file. Uses WebCodecs to render faster than real time and falls back
 * to recording the preview in real time when that isn't available or fails.
 */
export async function exportVideo(short: number, onProgress: (p: ExportProgress) => void, signal: AbortSignal): Promise<ExportResult> {
  const s = useStore.getState();
  const p = s.project;
  if (!p) throw new Error('No hay proyecto abierto');

  if (canFastExport()) {
    engine.pause();
    s.setExporting(true);
    try {
      return await fastExport(p, s.urls, short, onProgress, signal);
    } catch (e) {
      if (signal.aborted) throw cancelled();
      console.warn('Fast export unavailable, recording in real time instead.', e);
    } finally {
      useStore.getState().setExporting(false);
    }
  }
  if (!hasRecorder()) throw new Error('unsupported');
  return recordExport(p, short, onProgress, signal);
}

/** Real-time fallback: the engine plays the project and records the preview canvas. */
async function recordExport(p: Project, short: number, onProgress: (p: ExportProgress) => void, signal: AbortSignal) {
  const dur = totalDuration(p);
  onProgress({ pct: 0, eta: dur, fast: false });
  const unsub = useStore.subscribe((st) => {
    if (st.exporting && dur) onProgress({ pct: clamp((st.time / dur) * 100, 0, 100), eta: Math.max(0, dur - st.time), fast: false });
  });
  const abort = () => engine.cancelExport();
  signal.addEventListener('abort', abort);
  try {
    return await engine.exportVideo(short);
  } finally {
    unsub();
    signal.removeEventListener('abort', abort);
  }
}

// ---------- fast path ----------

async function fastExport(
  p: Project,
  urls: Record<string, string>,
  short: number,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  const mb = await import('mediabunny');
  const [W, H] = canvasSize(p.aspect, short);
  const dur = totalDuration(p);
  const frames = Math.max(1, Math.ceil(dur * FPS - 1e-6));
  const check = () => {
    if (signal.aborted) throw cancelled();
  };
  onProgress({ pct: 0, eta: null, fast: true });

  const videoCodec = await pickVideoCodec(mb, W, H);
  if (!videoCodec) throw new Unsupported('no working video encoder');
  const audioCodec = await mb.getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE });

  const blobs = new Map<string, Promise<Blob>>();
  const blobOf = (assetId: string) => {
    let b = blobs.get(assetId);
    if (!b) {
      const url = urls[assetId];
      b = url ? fetch(url).then((r) => r.blob()) : Promise.reject(new Error('missing media'));
      blobs.set(assetId, b);
    }
    return b;
  };

  // Audio first: it's quick and lets the encoder interleave both tracks.
  const mix = audioCodec ? await mixAudio(p, dur, blobOf, check) : null;
  check();
  onProgress({ pct: AUDIO_SHARE, eta: null, fast: true });

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
  // Explicit bitrates: `quality` maps to a quantizer mode that some hardware H.264 encoders never answer.
  const video = new mb.CanvasSource(canvas, { codec: videoCodec, bitrate: short >= 1080 ? 8_000_000 : 5_000_000 });
  output.addVideoTrack(video, { frameRate: FPS });
  const audio = mix && audioCodec ? new mb.AudioBufferSource({ codec: audioCodec, bitrate: 160_000 }) : null;
  if (audio) output.addAudioTrack(audio);

  // Picture sources.
  const images = new Map<string, FrameImage>();
  const readers = new Map<string, ClipReader>();
  const blank: FrameImage = { src: canvas, w: 0, h: 0 };
  const getReader = async (clip: Clip) => {
    let r = readers.get(clip.id);
    if (!r) {
      const input = new mb.Input({ source: new mb.BlobSource(await blobOf(clip.assetId)), formats: mb.ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) throw new Unsupported('cannot decode a video');
      r = new ClipReader(new mb.VideoSampleSink(track), input);
      readers.set(clip.id, r);
    }
    return r;
  };
  for (const c of p.clips) {
    const a = p.assets[c.assetId];
    if (a?.kind === 'image' && !images.has(a.id)) {
      const img = new Image();
      img.src = urls[a.id];
      await img.decode().catch(() => {});
      images.set(a.id, img.naturalWidth ? { src: img, w: img.naturalWidth, h: img.naturalHeight } : blank);
    }
  }

  const placed = layout(p);
  let audioSent = 0; // seconds of audio already handed to the encoder
  const sendAudio = async (until: number) => {
    if (!audio || !mix) return;
    while (audioSent < until && audioSent < mix.duration) {
      const end = Math.min(mix.duration, audioSent + 1);
      await watchdog(audio.add(slice(mix, audioSent, end)));
      audioSent = end;
    }
  };

  engine.holdPreview = true;
  try {
    await output.start();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      check();
      const t = i / FPS;
      // Whatever renderFrame asks for that isn't decoded yet gets fetched, then it draws again.
      const wanted: [Clip, number][] = [];
      const lookup = (clip: Clip, asset: Project['assets'][string], srcTime: number): FrameImage | null => {
        if (asset.kind === 'image') return images.get(asset.id) ?? blank;
        const r = readers.get(clip.id);
        if (r && r.at === srcTime) return r.frame() ?? blank;
        wanted.push([clip, srcTime]);
        return null;
      };
      let drawn = renderFrame(ctx, p, t, W, H, lookup, placed);
      for (let tries = 0; !drawn && tries < 4; tries++) {
        for (const [clip, srcTime] of wanted.splice(0)) await (await getReader(clip)).seek(srcTime);
        drawn = renderFrame(ctx, p, t, W, H, lookup, placed);
      }
      if (!drawn) throw new Error('frame not available');

      await sendAudio(t + 1);
      await watchdog(video.add(t, 1 / FPS));

      // Free decoders of clips that are over.
      for (const l of placed) {
        const r = readers.get(l.clip.id);
        if (r && l.end < t) {
          r.close();
          readers.delete(l.clip.id);
        }
      }

      const done = i + 1;
      const elapsed = (performance.now() - t0) / 1000;
      onProgress({
        pct: AUDIO_SHARE + ((100 - AUDIO_SHARE) * done) / frames,
        eta: done >= 5 ? ((frames - done) * elapsed) / done : null,
        fast: true,
      });
    }
    await sendAudio(Infinity);
    check();
    await watchdog(output.finalize(), 60_000);
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    engine.holdPreview = false;
    for (const r of readers.values()) r.close();
  }

  const buf = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
  if (!buf) throw new Error('empty output');
  return { blob: new Blob([buf], { type: 'video/mp4' }), ext: 'mp4' };
}

/** Rejects if the encoder stops making progress, so a stuck encoder falls back instead of hanging forever. */
function watchdog<T>(p: Promise<T>, ms = 15_000): Promise<T> {
  let timer = 0;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => (timer = window.setTimeout(() => reject(new Unsupported('encoder stalled')), ms))),
  ]);
}

const PROBE_CODECS: Record<string, string> = {
  avc: 'avc1.640028',
  hevc: 'hvc1.1.6.L120.B0',
  vp9: 'vp09.00.40.08',
  av1: 'av01.0.08M.08',
};

/**
 * First codec that really encodes at this size. Some browsers report H.264 as supported but the
 * encoder never outputs anything, so each candidate encodes a few frames before it's trusted.
 */
function pickVideoCodec(mb: typeof import('mediabunny'), W: number, H: number) {
  const key = `${W}x${H}`;
  let found = probed.get(key);
  if (!found) {
    found = (async () => {
      const codecs = await mb.getEncodableVideoCodecs(['avc', 'hevc', 'vp9', 'av1'], { width: W, height: H });
      for (const codec of codecs) if (await probeEncoder(PROBE_CODECS[codec], W, H)) return codec;
      return null;
    })();
    probed.set(key, found);
  }
  return found;
}
const probed = new Map<string, Promise<VideoCodec | null>>();

async function probeEncoder(codec: string, W: number, H: number) {
  let out = 0;
  let enc: VideoEncoder | null = null;
  try {
    enc = new VideoEncoder({ output: () => out++, error: () => {} });
    enc.configure({ codec, width: W, height: H, framerate: FPS, bitrate: 5_000_000 });
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    for (let i = 0; i < 3; i++) {
      const f = new VideoFrame(c, { timestamp: (i * 1e6) / FPS });
      enc.encode(f, { keyFrame: i === 0 });
      f.close();
    }
    await watchdog(enc.flush(), 8000);
    return out > 0;
  } catch {
    return false;
  } finally {
    try {
      enc?.close();
    } catch {
      /* already closed */
    }
  }
}

/** Sequential frame access to one clip's video, decoding each frame at most once while time moves forward. */
class ClipReader {
  /** Source time of the last seek. */
  at = -1;
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private cur: VideoSample | null = null;
  private next: VideoSample | null = null;
  /** Upright copy of a rotated or flipped frame. */
  private upright: HTMLCanvasElement | null = null;
  private uprightOf: VideoSample | null = null;

  constructor(
    private sink: VideoSampleSink,
    private input: { dispose(): void },
  ) {}

  async seek(s: number) {
    const ahead = this.cur ? s - this.cur.timestamp : -1;
    if (!this.iter || ahead < -1e-4 || ahead > 2) {
      // Jumping backwards or far ahead: restart decoding from the nearest key frame.
      this.release();
      this.iter = this.sink.samples(s);
      this.next = (await this.iter.next()).value ?? null;
    }
    while (this.next && this.next.timestamp <= s + 1e-4) {
      this.cur?.close();
      this.cur = this.next;
      this.next = (await this.iter!.next()).value ?? null;
    }
    this.at = s;
  }

  /** The frame at the last seek; draw it right away, the underlying VideoFrame is short-lived. */
  frame(): FrameImage | null {
    const smp = this.cur ?? this.next;
    if (!smp) return null;
    const w = smp.displayWidth;
    const h = smp.displayHeight;
    if (!smp.rotation && !smp.flip) return { src: smp.toCanvasImageSource(), w, h };
    if (this.uprightOf !== smp) {
      this.upright ??= document.createElement('canvas');
      if (this.upright.width !== w || this.upright.height !== h) {
        this.upright.width = w;
        this.upright.height = h;
      }
      smp.draw(this.upright.getContext('2d')!, 0, 0, w, h);
      this.uprightOf = smp;
    }
    return { src: this.upright!, w, h };
  }

  private release() {
    void this.iter?.return();
    this.iter = null;
    this.cur?.close();
    this.next?.close();
    this.cur = this.next = this.uprightOf = null;
  }

  close() {
    this.release();
    this.input.dispose();
  }
}

// ---------- audio ----------

interface Mix {
  buffer: AudioBuffer;
  duration: number;
}

/** Mixes every clip's own sound and the music/sound items exactly as the preview plays them. */
async function mixAudio(p: Project, dur: number, blobOf: (id: string) => Promise<Blob>, check: () => void): Promise<Mix> {
  const length = Math.max(1, Math.ceil(dur * SAMPLE_RATE));
  const octx = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const decoded = new Map<string, Promise<AudioBuffer | null>>();
  const decode = (assetId: string) => {
    let d = decoded.get(assetId);
    if (!d) {
      // Files without sound (or that can't be decoded) simply stay silent.
      d = blobOf(assetId)
        .then((b) => b.arrayBuffer())
        .then((ab) => octx.decodeAudioData(ab))
        .catch(() => null);
      decoded.set(assetId, d);
    }
    return d;
  };

  for (const l of layout(p)) {
    const c = l.clip;
    if (p.assets[c.assetId]?.kind !== 'video' || c.volume <= 0) continue;
    const buf = await decode(c.assetId);
    check();
    if (!buf) continue;
    const src = octx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = c.speed;
    const g = octx.createGain();
    g.gain.value = c.volume;
    src.connect(g).connect(octx.destination);
    src.start(l.start, c.in);
    src.stop(l.start + clipDur(c));
  }

  for (const a of p.audios) {
    if (a.volume <= 0) continue;
    const buf = await decode(a.assetId);
    check();
    if (!buf) continue;
    const d = audioDur(a);
    if (d <= 0) continue;
    const src = octx.createBufferSource();
    src.buffer = buf;
    const g = octx.createGain();
    // Same linear fade-in/out as the preview.
    const steps = Math.max(2, Math.min(4096, Math.ceil(d * 50)));
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const x = (i / (steps - 1)) * d;
      let fade = 1;
      if (a.fadeIn > 0) fade = Math.min(fade, x / a.fadeIn);
      if (a.fadeOut > 0) fade = Math.min(fade, (d - x) / a.fadeOut);
      curve[i] = a.volume * clamp(fade, 0, 1);
    }
    g.gain.setValueCurveAtTime(curve, a.start, d);
    src.connect(g).connect(octx.destination);
    src.start(a.start, a.in);
    src.stop(a.start + d);
  }

  return { buffer: await octx.startRendering(), duration: dur };
}

/** Copy of [from, to) seconds of a buffer. */
function slice(m: Mix, from: number, to: number): AudioBuffer {
  const a = Math.floor(from * SAMPLE_RATE);
  const b = Math.min(m.buffer.length, Math.floor(to * SAMPLE_RATE));
  const out = new AudioBuffer({ length: Math.max(1, b - a), numberOfChannels: m.buffer.numberOfChannels, sampleRate: SAMPLE_RATE });
  for (let ch = 0; ch < out.numberOfChannels; ch++) out.copyToChannel(m.buffer.getChannelData(ch).subarray(a, b), ch);
  return out;
}
