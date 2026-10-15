import type { VideoCodec, VideoSample, VideoSampleSink } from 'mediabunny';
import { bgClipId, engine, renderFrame, type FrameImage, type MediaRef } from './engine';
import { loadSegmenter, usesBgRemoval } from './segmentation';
import { loadProjectFonts } from './fonts';
import { preloadEmojis } from './stickers';
import { audioDur, canvasSize, clamp, clipDur, layout, overlayDur, overlaysOf, totalDuration } from './model';
import { useStore } from './store';
import type { AspectId, Project, VoiceFxId } from './types';
import { FRAME, audioRole, integratedLoudness, normalizeLoudness, peak, type ActivityByAsset } from './audioDsp';
import { LOUDNESS_TARGET, analyzeAsset, buildVoiceFx, mixOf, projectDuckCurve, voiceAssets } from './audioFx';
import { AUDIO_BITRATE, audioLevels, exportBitrate, type AudioLevels } from './platforms';
import { canFastExport, hasRecorder, UnsupportedAspectError } from './exportSupport';
import { extractAudio, releaseAudioCache, toAudioBuffer } from './audioExtract';

export { canExport, canFastExport, UnsupportedAspectError } from './exportSupport';

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

/**
 * Thrown when the fast path can't run on this device; the recorder takes over. `reason` tells a
 * file it can't read ('decode') from an encoder that doesn't work here ('encoder').
 */
class Unsupported extends Error {
  constructor(
    message: string,
    readonly reason: 'decode' | 'encoder',
  ) {
    super(message);
  }
}

/** The fast export failed for a reason the real-time recorder wouldn't fix. `message` is for the user. */
export class ExportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

const isQuota = (e: unknown) => (e as DOMException)?.name === 'QuotaExceededError';

const cancelled = () => new Error('cancelled');

/**
 * Saves the project as a video file. Uses WebCodecs to render faster than real time and falls back
 * to recording the preview in real time when that isn't available or fails.
 */
export async function exportVideo(
  short: number,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
  opts: { aspect?: AspectId } = {},
): Promise<ExportResult> {
  const s = useStore.getState();
  const open = s.project;
  if (!open) throw new Error('No hay proyecto abierto');
  // Another format ("varias versiones") renders a copy; the open project doesn't change.
  const p = opts.aspect && opts.aspect !== open.aspect ? { ...open, aspect: opts.aspect } : open;
  // "Quitar fondo" must be ready before the first frame, or the export would show the original background.
  if (usesBgRemoval(p)) await loadSegmenter();
  await loadProjectFonts(p);
  await preloadEmojis(p);

  if (canFastExport()) {
    engine.pause();
    s.setExporting(true);
    let reason: Unsupported['reason'] = 'encoder';
    try {
      return await fastExport(p, s.urls, short, onProgress, signal);
    } catch (e) {
      if (signal.aborted) throw cancelled();
      // Only "this device/file can't do the fast path" falls back; any other error is a real failure.
      if (!(e instanceof Unsupported)) {
        console.error('Fast export failed', e);
        throw new ExportError(
          isQuota(e)
            ? 'No hay espacio suficiente en el dispositivo para guardar el video. Libera espacio e intenta otra vez.'
            : 'Algo salió mal al guardar. Intenta otra vez con calidad 720p.',
          { cause: e },
        );
      }
      console.warn('Fast export unavailable, recording in real time instead.', e);
      reason = e.reason;
    } finally {
      useStore.getState().setExporting(false);
    }
    // The real-time recorder films the preview, which only shows the project's own format.
    if (p !== open && hasRecorder()) throw new UnsupportedAspectError(reason);
  }
  if (!hasRecorder()) throw new Error('unsupported');
  if (p !== open) throw new UnsupportedAspectError('encoder');
  return recordExport(p, short, onProgress, signal);
}

/** Real-time fallback: the engine plays the project and records the preview canvas. */
async function recordExport(p: Project, short: number, onProgress: (p: ExportProgress) => void, signal: AbortSignal) {
  const dur = totalDuration(p);
  onProgress({ pct: 0, eta: dur, fast: false });
  const unsub = useStore.subscribe((st) => {
    if (st.exporting && dur) onProgress({ pct: clamp((st.time / dur) * 100, 0, 100), eta: Math.max(0, dur - st.time), fast: false });
  });
  try {
    return await engine.exportVideo(short, signal);
  } finally {
    unsub();
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
  if (!videoCodec) throw new Unsupported('no working video encoder', 'encoder');
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

  // Straight to a file in the browser's private storage when possible: the video is never all in memory.
  const disk = await opfsTarget(mb);
  const output = disk
    ? new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: false }), target: disk.target })
    : new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
  // Explicit bitrates: `quality` maps to a quantizer mode that some hardware H.264 encoders never answer.
  const video = new mb.CanvasSource(canvas, { codec: videoCodec, bitrate: exportBitrate(short) });
  output.addVideoTrack(video, { frameRate: FPS });
  const audio = mix && audioCodec ? new mb.AudioBufferSource({ codec: audioCodec, bitrate: AUDIO_BITRATE }) : null;
  if (audio) output.addAudioTrack(audio);

  // Picture sources.
  const images = new Map<string, FrameImage>();
  const readers = new Map<string, ClipReader>();
  const blank: FrameImage = { src: canvas, w: 0, h: 0 };
  const getReader = async (clip: MediaRef) => {
    let r = readers.get(clip.id);
    if (!r) {
      const input = new mb.Input({ source: new mb.BlobSource(await blobOf(clip.assetId)), formats: mb.ALL_FORMATS });
      let track;
      try {
        track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) throw new Unsupported('cannot decode a video', 'decode');
      } catch (e) {
        input.dispose();
        // A container mediabunny can't read may still play in the preview, which the recorder films.
        throw e instanceof Unsupported ? e : new Unsupported(`cannot read a video: ${(e as Error)?.message ?? e}`, 'decode');
      }
      r = new ClipReader(new mb.VideoSampleSink(track), input);
      readers.set(clip.id, r);
    }
    return r;
  };
  // Photos on the main track, on the overlay track, and behind "Quitar fondo".
  const pictureIds = [...p.clips, ...overlaysOf(p)].flatMap((c) => [
    c.assetId,
    ...('bgRemoval' in c && c.bgRemoval?.mode === 'media' && c.bgRemoval.assetId ? [c.bgRemoval.assetId] : []),
  ]);
  for (const id of pictureIds) {
    const a = p.assets[id];
    if (a?.kind === 'image' && !images.has(a.id)) {
      const img = new Image();
      const url = urls[a.id];
      if (url) {
        img.src = url;
        await img.decode().catch(() => {});
      }
      images.set(a.id, img.naturalWidth ? { src: img, w: img.naturalWidth, h: img.naturalHeight } : blank);
    }
  }
  // Pictures used as stickers.
  const stickerImgs = new Map<string, HTMLImageElement>();
  for (const st of p.stickers ?? []) {
    const url = st.assetId ? urls[st.assetId] : undefined;
    if (!st.assetId || stickerImgs.has(st.assetId) || !url) continue;
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {});
    if (img.naturalWidth) stickerImgs.set(st.assetId, img);
  }
  const renderOpts = { stickerImage: (id: string) => stickerImgs.get(id), waitForAll: true };

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
      const wanted: [MediaRef, number][] = [];
      const lookup = (clip: MediaRef, asset: Project['assets'][string], srcTime: number): FrameImage | null => {
        if (asset.kind === 'image') return images.get(asset.id) ?? blank;
        const r = readers.get(clip.id);
        if (r && r.at === srcTime) return r.frame() ?? blank;
        wanted.push([clip, srcTime]);
        return null;
      };
      let drawn = renderFrame(ctx, p, t, W, H, lookup, placed, renderOpts);
      for (let tries = 0; !drawn && tries < 4; tries++) {
        for (const [clip, srcTime] of wanted.splice(0)) await (await getReader(clip)).seek(srcTime);
        drawn = renderFrame(ctx, p, t, W, H, lookup, placed, renderOpts);
      }
      if (!drawn) throw new Unsupported('frame not available', 'decode');

      await sendAudio(t + 1);
      await watchdog(video.add(t, 1 / FPS));

      // Free decoders of clips that are over.
      for (const l of placed) {
        if (l.end >= t) continue;
        for (const id of [l.clip.id, bgClipId(l.clip.id)]) {
          readers.get(id)?.close();
          readers.delete(id);
        }
      }
      for (const o of overlaysOf(p)) {
        const r = readers.get(o.id);
        if (r && o.start + overlayDur(o) < t) {
          r.close();
          readers.delete(o.id);
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
    await disk?.discard();
    throw e;
  } finally {
    engine.holdPreview = false;
    for (const r of readers.values()) r.close();
  }

  if (disk) {
    const file = await disk.file();
    if (!file.size) throw new Error('empty output');
    // The OPFS file has no type of its own; this wraps it without copying the data.
    return { blob: file.slice(0, file.size, 'video/mp4'), ext: 'mp4' };
  }
  const target = output.target as InstanceType<typeof mb.BufferTarget>;
  const buf = target.buffer;
  if (!buf) throw new Error('empty output');
  const blob = new Blob([buf], { type: 'video/mp4' });
  // Let the ArrayBuffer go right away so only the Blob's copy stays alive.
  (target as unknown as { buffer: ArrayBuffer | null }).buffer = null;
  return { blob, ext: 'mp4' };
}

// ---------- saving to the private storage (OPFS) ----------

const EXPORT_DIR = 'clipo-exports';
/** Files of this session still in use (shown, shared, waiting to publish); older ones get deleted. */
const KEEP = 8;
const madeThisSession: string[] = [];
let cleanedOld = false;

/**
 * A StreamTarget writing to a new file in the origin-private file system, or null when this browser
 * can't (then the export is kept in memory as before).
 */
async function opfsTarget(mb: typeof import('mediabunny')) {
  if (typeof FileSystemFileHandle === 'undefined' || !('createWritable' in FileSystemFileHandle.prototype) || !navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(EXPORT_DIR, { create: true });
    await cleanExports(dir);
    const name = `video-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.mp4`;
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    madeThisSession.push(name);
    return {
      target: new mb.StreamTarget(writable as unknown as WritableStream<import('mediabunny').StreamTargetChunk>, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
      file: () => handle.getFile(),
      discard: async () => {
        await writable.abort().catch(() => {});
        await dir.removeEntry(name).catch(() => {});
        madeThisSession.splice(madeThisSession.indexOf(name), 1);
      },
    };
  } catch (e) {
    console.warn('No private storage for the export, keeping it in memory', e);
    return null;
  }
}

/** Deletes exports left by earlier sessions, and this session's oldest beyond KEEP. */
async function cleanExports(dir: FileSystemDirectoryHandle) {
  const doomed: string[] = madeThisSession.length >= KEEP ? madeThisSession.splice(0, madeThisSession.length - KEEP + 1) : [];
  if (!cleanedOld) {
    cleanedOld = true;
    const iter = (dir as unknown as { keys(): AsyncIterable<string> }).keys();
    for await (const name of iter) if (!madeThisSession.includes(name)) doomed.push(name);
  }
  for (const name of doomed) await dir.removeEntry(name).catch(() => {});
}

/**
 * Level of the final sound, mixed exactly like the export does ("Revisar antes de publicar").
 * Null when the device can't mix offline.
 */
export async function measureAudio(p: Project, signal?: AbortSignal): Promise<AudioLevels | null> {
  if (typeof OfflineAudioContext === 'undefined') return null;
  const dur = totalDuration(p);
  if (dur <= 0) return null;
  const urls = useStore.getState().urls;
  const blobs = new Map<string, Promise<Blob>>();
  const blobOf = (id: string) => {
    let b = blobs.get(id);
    if (!b) blobs.set(id, (b = urls[id] ? fetch(urls[id]).then((r) => r.blob()) : Promise.reject(new Error('missing media'))));
    return b;
  };
  const mix = await mixAudio(p, dur, blobOf, () => {
    if (signal?.aborted) throw cancelled();
  });
  const chans = Array.from({ length: mix.buffer.numberOfChannels }, (_, i) => mix.buffer.getChannelData(i));
  return audioLevels(chans);
}

/** Rejects if the encoder stops making progress, so a stuck encoder falls back instead of hanging forever. */
function watchdog<T>(p: Promise<T>, ms = 15_000): Promise<T> {
  let timer = 0;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => (timer = window.setTimeout(() => reject(new Unsupported('encoder stalled', 'encoder')), ms))),
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
      for (const codec of codecs) {
        const probe = PROBE_CODECS[codec];
        if (probe && (await probeEncoder(probe, W, H))) return codec;
      }
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

/** Seconds an effect (echo, reverb) keeps sounding after its source ends. */
const FX_TAIL = 3;

/**
 * Mixes every clip's own sound and the music/sound items exactly as the preview plays them:
 * voice effects, music that ducks under voices, and (when asked) loudness normalization.
 */
async function mixAudio(
  p: Project,
  dur: number,
  blobOf: (id: string) => Promise<Blob>,
  check: () => void,
  opts: { normalize?: boolean } = {},
): Promise<Mix> {
  const length = Math.max(1, Math.ceil(dur * SAMPLE_RATE));
  const octx = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const mixSettings = mixOf(p);

  // Only the parts of each file that are heard get decoded: the clips' in/out, merged per file.
  const ranges = new Map<string, [number, number][]>();
  const need = (assetId: string, from: number, to: number) => {
    if (!(to > from)) return;
    const list = ranges.get(assetId) ?? [];
    list.push([from, to]);
    ranges.set(assetId, list);
  };
  const speaks = (c: Project['clips'][number]) => p.assets[c.assetId]?.kind === 'video' && c.volume > 0 && c.freeze == null;
  for (const c of p.clips) if (speaks(c)) need(c.assetId, c.in, c.out);
  for (const o of overlaysOf(p)) if (p.assets[o.assetId]?.kind === 'video' && o.volume > 0) need(o.assetId, o.in, o.out);
  for (const a of p.audios) if (a.volume > 0) need(a.assetId, a.in, a.out);

  interface Segment {
    from: number;
    to: number;
    buf?: Promise<AudioBuffer | null>;
  }
  const segments = new Map<string, Segment[]>();
  /** Gaps shorter than this between two ranges of a file are decoded too, so it's read in one go. */
  const MERGE_GAP = 2;
  for (const [assetId, list] of ranges) {
    list.sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const [f, t] of list) {
      const last = merged[merged.length - 1];
      if (last && f <= last[1] + MERGE_GAP) last[1] = Math.max(last[1], t);
      else merged.push([f, t]);
    }
    segments.set(
      assetId,
      merged.map(([f, t]): Segment => ({ from: f, to: t + 0.05 })),
    );
  }
  /** Decoded sound around source time `at` of a file, and the source time its first sample is at. */
  const decode = async (assetId: string, at: number): Promise<{ buf: AudioBuffer; from: number } | null> => {
    const seg = segments.get(assetId)?.find((g) => at >= g.from - 1e-6 && at < g.to);
    if (!seg) return null;
    // Files without sound (or that can't be decoded) simply stay silent.
    seg.buf ??= blobOf(assetId)
      .then((b) => extractAudio(b, seg.from, seg.to, { maxChannels: 2, check, fallbackRate: SAMPLE_RATE }))
      .then((pcm) => (pcm ? toAudioBuffer(octx, pcm) : null))
      .catch((e) => {
        if ((e as Error)?.message === 'cancelled') throw e;
        return null;
      });
    const buf = await seg.buf;
    return buf ? { buf, from: seg.from } : null;
  };

  // Talking detection for the ducking, from the same whole-file analysis the preview uses.
  const activity: ActivityByAsset = {};
  if (mixSettings.duck > 0) {
    const urls = useStore.getState().urls;
    for (const id of voiceAssets(p)) {
      if (!urls[id]) continue;
      activity[id] = (await analyzeAsset(id, urls[id]))?.activity;
      check();
    }
  }
  // Background music goes through its own bus so it can dip under voices.
  const musicBus = octx.createGain();
  musicBus.connect(octx.destination);
  /** Source → (voice effect) → gain → destination. */
  const route = (src: AudioNode, g: GainNode, fx: VoiceFxId | undefined, start: number, end: number, dest: AudioNode = octx.destination) => {
    const chain = fx ? buildVoiceFx(octx, fx, start, end + FX_TAIL) : null;
    if (chain) {
      src.connect(chain.input);
      chain.output.connect(g);
    } else src.connect(g);
    g.connect(dest);
  };

  for (const l of layout(p)) {
    const c = l.clip;
    // Freeze frames are silent, like in the preview.
    if (!speaks(c)) continue;
    const d = await decode(c.assetId, c.in);
    check();
    if (!d) continue;
    const src = octx.createBufferSource();
    src.buffer = d.buf;
    src.playbackRate.value = c.speed;
    const g = octx.createGain();
    g.gain.value = c.volume;
    route(src, g, c.voiceFx, l.start, l.start + clipDur(c));
    src.start(l.start, c.in - d.from);
    src.stop(l.start + clipDur(c));
  }

  // Sound of overlay videos (picture-in-picture), like the preview plays it.
  for (const o of overlaysOf(p)) {
    if (p.assets[o.assetId]?.kind !== 'video' || o.volume <= 0) continue;
    const d = overlayDur(o);
    if (d <= 0) continue;
    const dec = await decode(o.assetId, o.in);
    check();
    if (!dec) continue;
    const src = octx.createBufferSource();
    src.buffer = dec.buf;
    const g = octx.createGain();
    g.gain.value = o.volume;
    src.connect(g).connect(octx.destination);
    src.start(o.start, o.in - dec.from);
    src.stop(o.start + d);
  }

  for (const a of p.audios) {
    if (a.volume <= 0) continue;

    const d = audioDur(a);
    if (d <= 0) continue;
    const dec = await decode(a.assetId, a.in);
    check();
    if (!dec) continue;
    const src = octx.createBufferSource();
    src.buffer = dec.buf;
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
    const music = audioRole(a, p.assets[a.assetId]?.name) === 'music';
    route(src, g, a.voiceFx, a.start, a.start + d, music ? musicBus : octx.destination);
    src.start(a.start, a.in - dec.from);
    src.stop(a.start + d);
  }

  // Every voice is decoded by now, so the ducking curve covers the whole video.
  const duck = projectDuckCurve(p, activity, dur);
  if (duck && duck.length > 1) musicBus.gain.setValueCurveAtTime(duck, 0, duck.length * FRAME);

  segments.clear();
  releaseAudioCache();
  const buffer = await octx.startRendering();
  check();
  if (opts.normalize ?? mixSettings.normalize) {
    const chans = Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch).slice());
    normalizeLoudness(chans, SAMPLE_RATE, LOUDNESS_TARGET);
    chans.forEach((c, ch) => buffer.copyToChannel(c, ch));
  }
  return { buffer, duration: dur };
}

export interface LoudnessReport {
  /** Integrated loudness of the mix as it is now, in LUFS (-Infinity when silent). */
  lufs: number;
  /** Highest sample, in dBFS. */
  peakDb: number;
  /** Change "Normalizar" would make, in dB. */
  gainDb: number;
}

/** Mixes the project's sound like the export does (without normalizing) and measures it. */
export async function measureLoudness(p: Project, signal?: AbortSignal): Promise<LoudnessReport> {
  const urls = useStore.getState().urls;
  const blobOf = (id: string) => (urls[id] ? fetch(urls[id]).then((r) => r.blob()) : Promise.reject(new Error('missing media')));
  const m = await mixAudio(p, totalDuration(p), blobOf, () => { if (signal?.aborted) throw cancelled(); }, { normalize: false });
  const chans = Array.from({ length: m.buffer.numberOfChannels }, (_, ch) => m.buffer.getChannelData(ch));
  const lufs = integratedLoudness(chans, SAMPLE_RATE);
  const pk = peak(chans);
  return { lufs, peakDb: pk > 0 ? 20 * Math.log10(pk) : -Infinity, gainDb: Number.isFinite(lufs) ? Math.min(20, LOUDNESS_TARGET - lufs) : 0 };
}

/** Copy of [from, to) seconds of a buffer. */
function slice(m: Mix, from: number, to: number): AudioBuffer {
  const a = Math.floor(from * SAMPLE_RATE);
  const b = Math.min(m.buffer.length, Math.floor(to * SAMPLE_RATE));
  const out = new AudioBuffer({ length: Math.max(1, b - a), numberOfChannels: m.buffer.numberOfChannels, sampleRate: SAMPLE_RATE });
  for (let ch = 0; ch < out.numberOfChannels; ch++) out.copyToChannel(m.buffer.getChannelData(ch).subarray(a, b), ch);
  return out;
}
