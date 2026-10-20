// Run with: npm test. Timing helpers that keep the saved video's sound in sync with the picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackOrigin, mp3StartDelay } from '../src/gapless.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

/** First frame of an MP3 as LAME writes it: frame header, side info, Xing/Info tag, LAME tag. */
function lameFrame(opts: { mpeg1?: boolean; mono?: boolean; rateIdx?: number; tag?: string; encoder?: string; delay: number; padding?: number; flags?: number; id3?: number }) {
  const { mpeg1 = true, mono = false, rateIdx = 1, tag = 'Info', encoder = 'LAME3.100', delay, padding = 0, flags = 0xf, id3 = 0 } = opts;
  const bytes: number[] = [];
  if (id3) {
    const s = id3;
    bytes.push(0x49, 0x44, 0x33, 4, 0, 0, (s >> 21) & 0x7f, (s >> 14) & 0x7f, (s >> 7) & 0x7f, s & 0x7f, ...new Array(s).fill(0));
  }
  bytes.push(0xff, mpeg1 ? 0xfb : 0xf3, (9 << 4) | (rateIdx << 2), mono ? 0xc0 : 0x00);
  bytes.push(...new Array(mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17).fill(0));
  bytes.push(...[...tag].map((c) => c.charCodeAt(0)), 0, 0, 0, flags);
  bytes.push(...new Array((flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0)).fill(0));
  const lame = [...encoder.padEnd(9, ' ')].map((c) => c.charCodeAt(0));
  bytes.push(...lame, ...new Array(12).fill(0), delay >> 4, ((delay & 0xf) << 4) | (padding >> 8), padding & 0xff, ...new Array(12).fill(0));
  return Uint8Array.from(bytes);
}

test('MP3 start delay: LAME encoder delay plus the 529-sample decoder delay', () => {
  near(mp3StartDelay(lameFrame({ delay: 576, padding: 1234 })), (576 + 529) / 48000);
  near(mp3StartDelay(lameFrame({ delay: 576, rateIdx: 0 })), (576 + 529) / 44100);
  near(mp3StartDelay(lameFrame({ delay: 1105, mono: true, tag: 'Xing', encoder: 'Lavc61.3' })), (1105 + 529) / 48000);
});

test('MP3 start delay: MPEG-2, optional Xing fields and an ID3v2 tag before the first frame', () => {
  near(mp3StartDelay(lameFrame({ delay: 576, mpeg1: false, rateIdx: 1 })), (576 + 529) / 24000);
  near(mp3StartDelay(lameFrame({ delay: 576, flags: 0x1 })), (576 + 529) / 48000);
  near(mp3StartDelay(lameFrame({ delay: 576, flags: 0x0 })), (576 + 529) / 48000);
  near(mp3StartDelay(lameFrame({ delay: 576, id3: 300 })), (576 + 529) / 48000);
});

test('MP3 start delay: nothing is skipped when the file has no gapless info', () => {
  assert.equal(mp3StartDelay(lameFrame({ delay: 576, encoder: 'Xyz' })), 0);
  assert.equal(mp3StartDelay(lameFrame({ delay: 576, tag: 'Nope' })), 0);
  assert.equal(mp3StartDelay(new Uint8Array(0)), 0);
  assert.equal(mp3StartDelay(Uint8Array.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3])), 0);
  assert.equal(mp3StartDelay(new Uint8Array(4000)), 0);
});

test('decodeAudioData fallback starts at the track start only when it starts late', () => {
  assert.equal(fallbackOrigin(0.278), 0.278);
  assert.equal(fallbackOrigin(-0.0213), 0); // AAC priming: dropped by the decoder
  assert.equal(fallbackOrigin(0), 0);
  assert.equal(fallbackOrigin(null), 0);
  assert.equal(fallbackOrigin(NaN), 0);
});
