// Reads only the part of a media file's sound that is needed (a clip's in/out), chunk by chunk,
// instead of loading the whole file into memory and decoding all of it with decodeAudioData.
// mediabunny drives WebCodecs' AudioDecoder (which decodes off the main thread); when it can't
// read the container or decode the codec, the old decodeAudioData path takes over.
import { firstDecodable } from './convertVideo';
import { fallbackOrigin, mp3StartDelay } from './gapless';

/** Decoded sound of [start, start + length / sampleRate) seconds of the source. */
export interface Pcm {
  sampleRate: number;
  /** One array per channel (always at least one), all the same length. */
  channels: Float32Array[];
  /** Source time of the first sample, in seconds. */
  start: number;
}

interface Opts {
  /** 1 = mono mix, 2 = keep up to two channels. */
  maxChannels?: number;
  /** Called between chunks; throw from it to stop (cancel). */
  check?: () => void;
  /** Sample rate of the decodeAudioData fallback (the browser resamples to it). */
  fallbackRate?: number;
}

/** mediabunny can't read this file: use decodeAudioData instead. `origin`: source time of its first sample. */
class Fallback extends Error {
  constructor(
    message: string,
    readonly origin = 0,
  ) {
    super(message);
  }
}

/** Where decodeAudioData's output starts for this track (it ignores a late start of the sound). */
const originOf = async (track: { getFirstTimestamp(): Promise<number> } | null) => fallbackOrigin(await track?.getFirstTimestamp().catch(() => 0));

/**
 * Seconds the decoded timestamps run ahead of the real sound: an MP3's encoder + decoder delay,
 * which players (and the preview) skip. Without it a song or voice-over plays ~25 ms late.
 */
async function leadOf(blob: Blob, codec: string | null): Promise<number> {
  if (codec !== 'mp3') return 0;
  try {
    const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
    // Skip an ID3v2 tag (it can hold a big cover picture) so only the first frame is read.
    const id3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33
      ? 10 + (((head[6]! & 0x7f) << 21) | ((head[7]! & 0x7f) << 14) | ((head[8]! & 0x7f) << 7) | (head[9]! & 0x7f)) + (head[5]! & 0x10 ? 10 : 0)
      : 0;
    return mp3StartDelay(new Uint8Array(await blob.slice(id3, id3 + 8192).arrayBuffer()));
  } catch {
    return 0;
  }
}

const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));

type Mb = typeof import('mediabunny');
let mbLoad: Promise<Mb> | null = null;
const loadMb = () => (mbLoad ??= import('mediabunny'));

async function openTrack(blob: Blob) {
  const mb = await loadMb();
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  try {
    // iPhone videos can carry several sound tracks, spatial audio first: use the first one this device decodes.
    const all = await input.getAudioTracks();
    if (!all.length) return { mb, input, track: null, lead: 0 };
    const primary = await input.getPrimaryAudioTrack();
    const track = await firstDecodable(all, primary);
    if (!track) throw new Fallback('cannot decode', await originOf(primary ?? all[0]!));
    return { mb, input, track, lead: await leadOf(blob, track.codec) };
  } catch (e) {
    input.dispose();
    throw e instanceof Fallback ? e : new Fallback(String(e));
  }
}

/** Planar float data of one decoded chunk, mixed down to `outCh` channels. */
function planes(smp: { numberOfChannels: number; numberOfFrames: number; copyTo(d: Float32Array, o: { planeIndex: number; format: 'f32-planar' }): void }, outCh: number) {
  const n = smp.numberOfFrames;
  const src = smp.numberOfChannels;
  const out: Float32Array[] = [];
  if (outCh === 1 && src > 1) {
    const mono = new Float32Array(n);
    const tmp = new Float32Array(n);
    for (let ch = 0; ch < src; ch++) {
      smp.copyTo(tmp, { planeIndex: ch, format: 'f32-planar' });
      for (let i = 0; i < n; i++) mono[i]! += tmp[i]! / src;
    }
    out.push(mono);
  } else {
    for (let ch = 0; ch < outCh; ch++) {
      const d = new Float32Array(n);
      // Mono sources fill every output channel.
      smp.copyTo(d, { planeIndex: Math.min(ch, src - 1), format: 'f32-planar' });
      out.push(d);
    }
  }
  return out;
}

/**
 * Sound of [from, to) seconds of a media file at its own sample rate. Null when the file has no
 * sound or it can't be decoded at all.
 */
export async function extractAudio(blob: Blob, from: number, to: number, opts: Opts = {}): Promise<Pcm | null> {
  from = Math.max(0, from);
  if (!(to > from)) return null;
  const maxCh = opts.maxChannels ?? 2;
  let opened;
  try {
    opened = await openTrack(blob);
  } catch (e) {
    return fallbackRange(blob, from, to, maxCh, opts.fallbackRate ?? 48000, (e as Fallback).origin ?? 0);
  }
  const { mb, input, track, lead } = opened;
  if (!track) {
    input.dispose();
    return null;
  }
  try {
    const sink = new mb.AudioSampleSink(track);
    const outCh = Math.max(1, Math.min(maxCh, track.numberOfChannels));
    let sr = 0;
    let chans: Float32Array[] = [];
    let k = 0;
    // Decoded timestamps are `lead` ahead of source time: read that much further and shift back.
    for await (const smp of sink.samples(from + lead, to + lead)) {
      try {
        if (!sr) {
          // The decoder's rate (HE-AAC can differ from the container's).
          sr = smp.sampleRate;
          const len = Math.max(1, Math.ceil((to - from) * sr));
          chans = Array.from({ length: outCh }, () => new Float32Array(len));
        }
        const at = Math.round((smp.timestamp - lead - from) * sr);
        const data = planes(smp, outCh);
        const len = chans[0]!.length;
        const a = Math.max(0, -at);
        const b = Math.min(smp.numberOfFrames, len - at);
        if (b > a) for (let ch = 0; ch < outCh; ch++) chans[ch]!.set(data[ch]!.subarray(a, b), at + a);
      } finally {
        smp.close();
      }
      if (++k % 64 === 0) {
        opts.check?.();
        await yieldNow();
      }
    }
    opts.check?.();
    if (!sr) return null;
    return { sampleRate: sr, channels: chans, start: from };
  } catch (e) {
    if ((e as Error)?.message === 'cancelled') throw e;
    console.warn('mediabunny could not decode the sound, using decodeAudioData', e);
    return fallbackRange(blob, from, to, maxCh, opts.fallbackRate ?? 48000, await originOf(track));
  } finally {
    input.dispose();
  }
}

/**
 * Loudness of every `frame` seconds of the whole file (dBFS, -200 for silence), computed while
 * decoding so the samples are never all held in memory. Null when there's no sound.
 */
export async function extractLevels(blob: Blob, frame: number, fallbackRate = 22050): Promise<{ levels: Float32Array } | null> {
  let opened;
  try {
    opened = await openTrack(blob);
  } catch (e) {
    const pcm = await fallbackRange(blob, 0, Infinity, 1, fallbackRate, (e as Fallback).origin ?? 0);
    return pcm ? { levels: levelsOf(pcm.channels[0]!, pcm.sampleRate, frame) } : null;
  }
  const { mb, input, track, lead } = opened;
  if (!track) {
    input.dispose();
    return null;
  }
  try {
    const sink = new mb.AudioSampleSink(track);
    const out: number[] = [];
    let n = 0; // samples per frame
    let sr = 0;
    let pos = 0; // source sample the next one belongs at, from time 0
    let sum = 0;
    let count = 0;
    let k = 0;
    const flush = () => {
      out.push(toDb(Math.sqrt(sum / Math.max(1, count))));
      sum = 0;
      count = 0;
    };
    for await (const smp of sink.samples()) {
      try {
        if (!n) {
          sr = smp.sampleRate;
          n = Math.max(1, Math.round(frame * sr));
        }
        const mono = planes(smp, 1)[0]!;
        // Frames are in source time like the clips: priming before 0 is dropped, a late start is silence.
        const at = Math.round((smp.timestamp - lead) * sr);
        for (; pos < at; pos++) if (++count === n) flush();
        for (let i = Math.max(0, pos - at); i < mono.length; i++, pos++) {
          sum += mono[i]! * mono[i]!;
          if (++count === n) flush();
        }
      } finally {
        smp.close();
      }
      if (++k % 64 === 0) await yieldNow();
    }
    if (count) flush();
    if (!n) return null;
    return { levels: Float32Array.from(out) };
  } catch (e) {
    console.warn('mediabunny could not decode the sound, using decodeAudioData', e);
    const pcm = await fallbackRange(blob, 0, Infinity, 1, fallbackRate, await originOf(track));
    return pcm ? { levels: levelsOf(pcm.channels[0]!, pcm.sampleRate, frame) } : null;
  } finally {
    input.dispose();
  }
}

const toDb = (x: number) => (x > 1e-10 ? 20 * Math.log10(x) : -200);

function levelsOf(samples: Float32Array, sampleRate: number, frame: number) {
  const n = Math.max(1, Math.round(frame * sampleRate));
  const out = new Float32Array(Math.ceil(samples.length / n));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    const a = f * n;
    const b = Math.min(samples.length, a + n);
    for (let i = a; i < b; i++) sum += samples[i]! * samples[i]!;
    out[f] = toDb(Math.sqrt(sum / Math.max(1, b - a)));
  }
  return out;
}

// The fallback decodes the whole file, so keep the last one: callers ask for several ranges of a file in a row.
let lastFallback: { blob: Blob; rate: number; buf: Promise<AudioBuffer | null> } | null = null;

/** [from, to) of the decodeAudioData output, whose first sample is at source time `origin`. */
async function fallbackRange(blob: Blob, from: number, to: number, maxCh: number, rate: number, origin = 0): Promise<Pcm | null> {
  if (lastFallback?.blob !== blob || lastFallback.rate !== rate) {
    const buf = blob
      .arrayBuffer()
      .then((ab) => new OfflineAudioContext(1, 1, rate).decodeAudioData(ab))
      .catch(() => null); // no sound, or a codec the browser can't decode
    lastFallback = { blob, rate, buf };
  }
  const buf = await lastFallback.buf;
  if (!buf) return null;
  const sr = buf.sampleRate;
  // Buffer index of the first wanted sample; negative when the sound starts after `from` (silence before it).
  const shift = Math.round((from - origin) * sr);
  const len = Number.isFinite(to) ? Math.max(1, Math.ceil((to - from) * sr)) : Math.max(1, buf.length - shift);
  const a = Math.min(buf.length, Math.max(0, shift));
  const dst = a - shift;
  const b = Math.max(a, Math.min(buf.length, a + len - dst));
  const outCh = Math.max(1, Math.min(maxCh, buf.numberOfChannels));
  const chans = Array.from({ length: outCh }, () => new Float32Array(len));
  if (outCh === 1 && buf.numberOfChannels > 1) {
    const mono = chans[0]!;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch).subarray(a, b);
      for (let i = 0; i < d.length; i++) mono[dst + i]! += d[i]! / buf.numberOfChannels;
    }
  } else if (dst < len) {
    for (let ch = 0; ch < outCh; ch++) chans[ch]!.set(buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1)).subarray(a, b), dst);
  }
  return { sampleRate: sr, channels: chans, start: from };
}

/** Forget the cached fallback decode (call when a long job is over). */
export function releaseAudioCache() {
  lastFallback = null;
}

/** The samples as an AudioBuffer of the given context (Web Audio resamples it while playing). */
export function toAudioBuffer(ctx: BaseAudioContext, pcm: Pcm): AudioBuffer {
  const buf = ctx.createBuffer(pcm.channels.length, pcm.channels[0]!.length, pcm.sampleRate);
  pcm.channels.forEach((d, ch) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, ch));
  return buf;
}

/** Mono samples at `rate`, resampled by the browser (with proper filtering). */
export async function resampleMono(pcm: Pcm, rate: number): Promise<Float32Array> {
  const mono = pcm.channels[0]!;
  if (pcm.sampleRate === rate && pcm.channels.length === 1) return mono;
  const len = Math.max(1, Math.round((mono.length * rate) / pcm.sampleRate));
  const ctx = new OfflineAudioContext(1, len, rate);
  const src = ctx.createBufferSource();
  src.buffer = toAudioBuffer(ctx, pcm);
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}
