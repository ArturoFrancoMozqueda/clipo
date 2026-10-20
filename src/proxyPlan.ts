// Pure part of the preview proxies (see proxies.ts): which videos are too heavy to play live in the
// editor, and the light copy made of them. No DOM or mediabunny here, so it runs in Node tests.

/** What the decision needs to know about a video's picture track. */
export interface VideoTraits {
  /** Display size (after rotation). */
  width: number;
  height: number;
  /** mediabunny codec id: 'avc', 'hevc', 'vp9', 'av1', 'prores'… (null when unknown). */
  codec: string | null;
  /** Average frames per second. */
  fps: number;
  /** Highest sustained frame rate (screen recordings only reach it while something moves). */
  peakFps: number;
  /** Bits per second of the picture. */
  bitrate: number;
  /** Seconds. */
  duration: number;
}

/** Longest side of a proxy: plenty for the preview canvas (at most 1080 px on its short side, usually far less). */
export const PROXY_SIDE = 1280;
/** Highest frame rate of a proxy: the editor's preview and export clock run at 30. */
export const PROXY_FPS = 30;
/** A key frame every second makes scrubbing and jumping to a cut fast. */
export const PROXY_KEYFRAME_S = 1;

/** Codecs that cost much more to decode than H.264, on many computers in software. */
const HEAVY_CODECS = new Set(['hevc', 'av1', 'prores', 'vp9']);

/** Why a video gets a proxy, or null when the original plays fine. */
export function proxyReason(t: VideoTraits): string | null {
  if (!(t.width > 0 && t.height > 0) || !(t.duration > 1)) return null; // nothing to win on a blip
  const side = Math.max(t.width, t.height);
  const fps = Math.max(t.fps || 0, t.peakFps || 0);
  if (side > 1920) return 'size'; // 4K and screen recordings of big displays
  if (fps > 61) return 'fps'; // 120/240 fps (slow motion, ProMotion screen recordings)
  if (side > PROXY_SIDE && fps > 31) return 'fps'; // 1080p60
  if (side > PROXY_SIDE && t.codec && HEAVY_CODECS.has(t.codec)) return 'codec'; // iPhone HEVC at 1080p
  if (t.bitrate > 30_000_000) return 'bitrate'; // ProRes-like data rates choke the reader
  return null;
}

export const needsProxy = (t: VideoTraits) => proxyReason(t) !== null;

export interface ProxyTarget {
  /** Display size of the copy (even numbers, same aspect ratio). */
  width: number;
  height: number;
  /** Most frames per second kept (extra frames are dropped); undefined keeps every frame (already ≤ 30 fps). */
  maxFps?: number;
  /** Bits per second. */
  bitrate: number;
}

/** Size, frame rate and bitrate of the proxy of a video that needs one. */
export function proxyTarget(t: VideoTraits): ProxyTarget {
  const scale = Math.min(1, PROXY_SIDE / Math.max(t.width, t.height));
  // Even sizes: H.264 encoders want them.
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const width = even(t.width * scale);
  const height = even(t.height * scale);
  const fps = Math.max(t.fps || 0, t.peakFps || 0);
  const maxFps = fps > PROXY_FPS + 0.5 ? PROXY_FPS : undefined;
  // ~0.1 bit per pixel and frame keeps an editing preview clean without making the copy big.
  const bitrate = Math.round(Math.min(5_000_000, Math.max(1_000_000, width * height * (maxFps ?? (fps || PROXY_FPS)) * 0.1)));
  return { width, height, maxFps, bitrate };
}

/**
 * Frame rates of a track from presentation timestamps (seconds, any order): the average, and the
 * peak sustained rate (10th percentile of the frame gaps, so a few doubled frames don't count).
 */
export function frameRates(timestamps: number[]): { fps: number; peakFps: number } {
  const ts = [...timestamps].filter(Number.isFinite).sort((a, b) => a - b);
  if (ts.length < 2) return { fps: 0, peakFps: 0 };
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    const g = ts[i]! - ts[i - 1]!;
    if (g > 1e-4) gaps.push(g);
  }
  if (!gaps.length) return { fps: 0, peakFps: 0 };
  const span = ts[ts.length - 1]! - ts[0]!;
  const fps = span > 0 ? (ts.length - 1) / span : 0;
  gaps.sort((a, b) => a - b);
  const p10 = gaps[Math.floor((gaps.length - 1) * 0.1)]!;
  return { fps, peakFps: 1 / p10 };
}
