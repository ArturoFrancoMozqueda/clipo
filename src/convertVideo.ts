// Videos the browser can't show by itself (HEVC on a computer without hardware support, a picture
// track it refuses for its color format, odd sound tracks…) are converted once, on the device, to a
// plain MP4 the editor can always play. Uses WebCodecs through mediabunny, so nothing is uploaded.
import type { InputAudioTrack, InputVideoTrack } from 'mediabunny';

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
