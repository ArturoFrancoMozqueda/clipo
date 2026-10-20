// Where a decoded sound really starts. Players skip an MP3's encoder + decoder delay (written by
// LAME/FFmpeg in the first frame) and start a track at its first timestamp; decoding without these
// puts every sound a little late (an MP3 ~25 ms) or early, so voice and picture drift apart.

/** Samples every MP3 decoder outputs before the real sound (the "528 + 1" players add to the encoder delay). */
const MP3_DECODER_DELAY = 529;

const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
};

/**
 * Seconds of silence at the start of an MP3 that players skip, read from the LAME/Lavc tag of its
 * first frame (`head` = the first few KB of the file). 0 when the file doesn't say (nothing is skipped then).
 */
export function mp3StartDelay(head: Uint8Array): number {
  let pos = 0;
  // ID3v2 tag: "ID3", version, flags, syncsafe size.
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33 && head.length >= 10) {
    const size = ((head[6]! & 0x7f) << 21) | ((head[7]! & 0x7f) << 14) | ((head[8]! & 0x7f) << 7) | (head[9]! & 0x7f);
    pos = 10 + size + (head[5]! & 0x10 ? 10 : 0);
  }
  // First frame header.
  while (pos + 4 <= head.length && !(head[pos] === 0xff && (head[pos + 1]! & 0xe0) === 0xe0)) pos++;
  if (pos + 4 > head.length) return 0;
  const version = (head[pos + 1]! >> 3) & 3;
  const layer = (head[pos + 1]! >> 1) & 3;
  const rate = SAMPLE_RATES[version]?.[(head[pos + 2]! >> 2) & 3];
  if (layer !== 1 || !rate) return 0; // only Layer III carries this tag
  const mono = (head[pos + 3]! >> 6) === 3;
  const sideInfo = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
  let p = pos + 4 + sideInfo;
  const tag = String.fromCharCode(...head.subarray(p, p + 4));
  if (tag !== 'Xing' && tag !== 'Info') return 0;
  if (p + 8 > head.length) return 0;
  const flags = ((head[p + 4]! << 24) | (head[p + 5]! << 16) | (head[p + 6]! << 8) | head[p + 7]!) >>> 0;
  p += 8 + (flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
  const encoder = String.fromCharCode(...head.subarray(p, p + 4));
  if (encoder !== 'LAME' && encoder !== 'Lavf' && encoder !== 'Lavc') return 0;
  if (p + 24 > head.length) return 0;
  // 9 bytes version, 12 more of tag fields, then 12 bits of encoder delay and 12 of padding.
  const delay = (head[p + 21]! << 4) | (head[p + 22]! >> 4);
  return (delay + MP3_DECODER_DELAY) / rate;
}

/**
 * Source time of the first sample decodeAudioData returns for a track whose first timestamp
 * (edit list applied) is `first`: it ignores a late start (an empty edit or a timestamp offset)
 * but does drop the leading priming when the track starts at 0.
 */
export const fallbackOrigin = (first: number | null | undefined) => (first != null && Number.isFinite(first) && first > 0 ? first : 0);
