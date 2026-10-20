// Videos the browser can't show by itself (HEVC on a computer without hardware support, a picture
// track it refuses for its color format, odd sound tracks…) are converted once, on the device, to a
// plain MP4 the editor can always play. Uses WebCodecs through mediabunny, so nothing is uploaded.
import type { Conversion, InputAudioTrack, InputVideoTrack } from 'mediabunny';
import { frameRates, PROXY_KEYFRAME_S, type ProxyTarget, type VideoTraits } from './proxyPlan';

type Mb = typeof import('mediabunny');
let mbLoad: Promise<Mb> | null = null;
const loadMb = () => (mbLoad ??= import('mediabunny'));

/** Longest side of a converted video: the editor exports at most 1080p, so 1920 keeps it sharp and light. */
const MAX_SIDE = 1920;

/** The tracks of a kind, the primary one first (iPhones put their spatial-audio track before the stereo one). */
export function orderedTracks<T extends InputVideoTrack | InputAudioTrack>(all: T[], primary: T | null): T[] {
  return primary ? [primary, ...all.filter((t) => t.id !== primary.id)] : all;
}

/** First track this device can decode, primary first. */
export async function firstDecodable<T extends InputVideoTrack | InputAudioTrack>(all: T[], primary: T | null): Promise<T | null> {
  for (const t of orderedTracks(all, primary)) if (await t.canDecode()) return t;
  return null;
}

export interface VideoCheck {
  /** The file holds a picture track. */
  hasVideo: boolean;
  /** This device can decode one of its picture tracks. */
  canDecode: boolean;
  /** Codec of the primary picture track, e.g. "hevc" or "prores" (null when mediabunny doesn't know it). */
  codec: string | null;
}

/** What the file holds, or null when its container can't be read at all. */
export async function inspectVideo(file: Blob): Promise<VideoCheck | null> {
  const mb = await loadMb();
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const all = await input.getVideoTracks();
    const primary = await input.getPrimaryVideoTrack();
    return { hasVideo: all.length > 0, canDecode: !!(await firstDecodable(all, primary)), codec: primary?.codec ?? null };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

/** Plain-words name of a codec for messages. */
export function codecName(codec: string | null) {
  if (codec === 'hevc') return 'HEVC (H.265)';
  if (codec === 'prores') return 'ProRes';
  return codec ? codec.toUpperCase() : 'desconocido';
}

/**
 * Convert to MP4 with one picture track and the first sound track this device can decode,
 * at most MAX_SIDE pixels on the long side. Throws when there is nothing it can decode.
 */
export async function convertToMp4(file: File, onProgress?: (p: number) => void): Promise<File> {
  const mb = await loadMb();
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const video = await firstDecodable(await input.getVideoTracks(), await input.getPrimaryVideoTrack());
    const audio = await firstDecodable(await input.getAudioTracks(), await input.getPrimaryAudioTrack());
    if (!video) throw new Error('no decodable video track');
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const w = video.displayWidth;
    const h = video.displayHeight;
    const size = Math.max(w, h) > MAX_SIDE ? (w >= h ? { width: MAX_SIDE } : { height: MAX_SIDE }) : {};
    const conversion = await mb.Conversion.init({
      input,
      output,
      video: (t) => (t.id === video.id ? size : { discard: true }),
      audio: (t) => (t.id === audio?.id ? {} : { discard: true }),
      showWarnings: false,
    });
    if (!conversion.isValid) throw new Error(`cannot convert: ${conversion.discardedTracks.map((d) => d.reason).join(', ')}`);
    if (onProgress) conversion.onProgress = (p) => onProgress(p);
    await conversion.execute();
    const name = file.name.replace(/\.[^.]+$/, '') + '.mp4';
    return new File([target.buffer!], name, { type: 'video/mp4', lastModified: file.lastModified });
  } finally {
    input.dispose();
  }
}

// ---------- preview proxies ----------

/** What proxyPlan.ts needs to know about the picture of a file, or null when it has none it can decode. */
export async function readVideoTraits(file: Blob): Promise<VideoTraits | null> {
  const mb = await loadMb();
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await firstDecodable(await input.getVideoTracks(), await input.getPrimaryVideoTrack());
    if (!track) return null;
    // A prefix is enough: the frame rate and data rate of a camera or screen recording don't change midway.
    const stamps: number[] = [];
    for await (const pkt of new mb.EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
      stamps.push(pkt.timestamp);
      if (stamps.length >= 240) break;
    }
    const stats = await track.computePacketStats(240);
    const rates = frameRates(stamps);
    return {
      width: await track.getDisplayWidth(),
      height: await track.getDisplayHeight(),
      codec: track.codec,
      fps: rates.fps || stats.averagePacketRate,
      peakFps: rates.peakFps,
      bitrate: stats.averageBitrate,
      duration: (await track.getDurationFromMetadata()) ?? (await track.computeDuration()),
    };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

/** Codec the proxies are encoded with on this device (H.264 first: every player decodes it in hardware), or null. */
let proxyCodec: Promise<'avc' | 'vp9' | null> | null = null;
export function proxyEncoder(): Promise<'avc' | 'vp9' | null> {
  return (proxyCodec ??= (async () => {
    if (typeof VideoEncoder === 'undefined') return null;
    const mb = await loadMb();
    const ok = await mb.getEncodableVideoCodecs(['avc', 'vp9'], { width: 1280, height: 720 }).catch(() => []);
    return (ok[0] as 'avc' | 'vp9' | undefined) ?? null;
  })());
}

export interface ProxyRun {
  onProgress?: (p: number) => void;
  /** Awaited before every frame: lets the queue pause the work while the video plays. */
  gate?: () => Promise<void>;
  signal?: AbortSignal;
}

/**
 * Light copy of a video for the editor's preview: the picture at `target`'s size with at most
 * `maxFps` frames per second and a key frame every second, plus the same sound track.
 *
 * Built by hand rather than with mediabunny's Conversion, which scales every decoded frame before
 * dropping the extra ones and scales through a slow path for 10-bit HDR frames (iPhone): here
 * frames are dropped first and the rest drawn once onto a small canvas, so a 4K HEVC clip is about
 * as fast as decoding it. Frames keep their own timestamps and the sound keeps its own (copied when
 * the codec allows), so the copy stands in for the original second for second.
 */
export async function makeProxy(file: Blob, target: ProxyTarget, run: ProxyRun = {}): Promise<Blob> {
  const mb = await loadMb();
  const codec = await proxyEncoder();
  if (!codec) throw new Error('no video encoder');
  const cancelled = () => run.signal?.aborted;
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  let output: InstanceType<Mb['Output']> | null = null;
  let audioConv: Conversion | null = null;
  const abort = () => {
    void audioConv?.cancel().catch(() => {});
  };
  run.signal?.addEventListener('abort', abort);
  try {
    const video = await firstDecodable(await input.getVideoTracks(), await input.getPrimaryVideoTrack());
    const audio = await firstDecodable(await input.getAudioTracks(), await input.getPrimaryAudioTrack());
    if (!video) throw new Error('no decodable video track');
    const out = new mb.BufferTarget();
    output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: out });
    const pictures = new mb.VideoSampleSource({
      codec,
      quality: new mb.Quality({ bitrate: target.bitrate }),
      keyFrameInterval: PROXY_KEYFRAME_S,
    });
    output.addVideoTrack(pictures);
    // The sound goes through a Conversion that only adds its track to our output (copy when possible).
    if (audio) {
      audioConv = await mb.Conversion.init({
        input,
        output,
        video: { discard: true },
        audio: (t) => (t.id === audio.id ? {} : { discard: true }),
        trim: { start: 0 },
        composable: true,
        showWarnings: false,
      });
      // A preview without its sound would mislead: keep the original instead.
      if (!audioConv.utilizedTracks.length) throw new Error('cannot copy the sound');
    }
    await output.start();

    const { width: W, height: H, maxFps } = target;
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const duration = (await video.computeDuration()) || 1;
    const drawPictures = async () => {
      let slot = -Infinity;
      for await (const sample of new mb.VideoSampleSink(video).samples()) {
        try {
          if (cancelled()) break;
          if (sample.timestamp < 0) continue; // not shown (edit list lead-in)
          if (maxFps) {
            // Keep the first frame of every 1/maxFps slot, at its own timestamp.
            const s = Math.floor(sample.timestamp * maxFps + 1e-3);
            if (s <= slot) continue;
            slot = s;
          }
          await run.gate?.();
          if (cancelled()) break;
          sample.draw(ctx, 0, 0, W, H); // rotation of portrait videos is applied here
          const frame = new mb.VideoSample(canvas, { timestamp: sample.timestamp, duration: maxFps ? 1 / maxFps : sample.duration });
          try {
            await pictures.add(frame);
          } finally {
            frame.close();
          }
          run.onProgress?.(Math.min(1, sample.timestamp / duration));
        } finally {
          sample.close();
        }
      }
      pictures.close();
    };
    // Both run to their end (or stop) before the output is closed; a failed picture stops the sound too.
    const done = await Promise.allSettled([drawPictures().catch((e) => (abort(), Promise.reject(e))), audioConv?.execute()]);
    for (const r of done) if (r.status === 'rejected') throw r.reason;
    if (cancelled()) throw new Error('cancelled');
    await output.finalize();
    return new Blob([out.buffer!], { type: 'video/mp4' });
  } catch (e) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    throw cancelled() ? new Error('cancelled') : e;
  } finally {
    run.signal?.removeEventListener('abort', abort);
    input.dispose();
  }
}
