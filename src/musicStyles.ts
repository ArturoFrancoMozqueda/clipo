// Music in the styles creators use now (phonk, lo-fi hip hop, dembow, afrobeats, amapiano, house,
// drill, synthwave, corrido tumbado, acoustic), composed on the device. Each style has its own
// groove (swing, kick pattern, fills), instruments and mix. Every song gets an intro that builds,
// a fill at the end of each 4 bars, a "pump" (the harmony ducks under each kick, like sidechain)
// and a final mix with a little saturation and the same room for every instrument.
import { bus, clap, filt, hz, noiseLayer, oscLayer, pluck, type Build } from './synth';

type Ctx = BaseAudioContext;

export type StyleId = 'phonk' | 'lofihop' | 'dembow' | 'afrobeats' | 'amapiano' | 'house' | 'drill' | 'synthwave' | 'corrido' | 'acoustic';

/** What a style gets to play with, bar after bar. */
interface Env {
  c: Ctx;
  drums: AudioNode;
  bass: AudioNode;
  harm: AudioNode;
  lead: AudioNode;
  r: () => number;
  beat: number;
  /** One 16th note. */
  step: number;
  swing: number;
  /** Bar number, its start time, and the chord (root first, then the notes above it). */
  b: number;
  t0: number;
  chord: number[];
  /** Past the intro, and the last bar of every four (time for a fill). */
  main: boolean;
  fill: boolean;
  /** Time of 16th note `i` of this bar, with the swing on the off-beats. */
  at(i: number): number;
  kick(t: number, v?: number): void;
  melody: number[];
}

export interface Style {
  bpm: number;
  chords: number[][];
  swing: number;
  verb: number;
  wet: number;
  /** How far the harmony dips under each kick (0 = none, 1 = silent). */
  pump: number;
  /** Warmth of the master: lowpass cutoff in Hz. */
  tone: number;
  drive: number;
  intro: number;
  bar(e: Env): void;
  /** A scale (semitones from the chord root) the melody picks notes from. */
  scale: number[];
}

// ---------- instruments ----------

const click = (c: Ctx, o: AudioNode, t: number, p: number, f: number) =>
  noiseLayer(c, o, t, [[0, 0], [0.001, p], [0.015, 0]], { type: 'bandpass', freq: [[0, f], [0.015, f]], q: 0.9 });

function kickDrum(c: Ctx, o: AudioNode, t: number, v = 1, deep = false) {
  oscLayer(c, o, t, 'sine', [[0, 160], [0.04, 60], [0.3, deep ? 38 : 46]], [[0, 0], [0.002, 0.9 * v], [deep ? 0.4 : 0.28, 0]]);
  click(c, o, t, 0.25 * v, 2800);
}
function snareDrum(c: Ctx, o: AudioNode, t: number, v = 1, tight = false) {
  const len = tight ? 0.11 : 0.19;
  noiseLayer(c, o, t, [[0, 0], [0.002, 0.45 * v], [len, 0]], { type: 'bandpass', freq: [[0, 1900], [len, 1400]], q: 0.8 });
  oscLayer(c, o, t, 'triangle', [[0, 240], [0.07, 170]], [[0, 0], [0.002, 0.3 * v], [0.09, 0]]);
}
function hatC(c: Ctx, o: AudioNode, t: number, v = 1) {
  noiseLayer(c, o, t, [[0, 0], [0.001, 0.13 * v], [0.035, 0]], { type: 'highpass', freq: [[0, 7500], [0.035, 7500]], q: 0.7 });
}
function hatO(c: Ctx, o: AudioNode, t: number, v = 1, len = 0.2) {
  noiseLayer(c, o, t, [[0, 0], [0.002, 0.12 * v], [len, 0]], { type: 'highpass', freq: [[0, 6500], [len, 6000]], q: 0.7 });
}
function shaker(c: Ctx, o: AudioNode, t: number, v = 1) {
  noiseLayer(c, o, t, [[0, 0], [0.012, 0.11 * v], [0.06, 0]], { type: 'bandpass', freq: [[0, 7000], [0.06, 6000]], q: 1.2 });
}
function rim(c: Ctx, o: AudioNode, t: number, v = 1) {
  oscLayer(c, o, t, 'triangle', [[0, 1700], [0.02, 1100]], [[0, 0], [0.001, 0.3 * v], [0.03, 0]]);
  click(c, o, t, 0.2 * v, 3500);
}
function conga(c: Ctx, o: AudioNode, t: number, f: number, v = 1) {
  oscLayer(c, o, t, 'sine', [[0, f * 1.35], [0.03, f]], [[0, 0], [0.002, 0.4 * v], [0.14, 0]]);
  click(c, o, t, 0.1 * v, 1800);
}
function cowbell(c: Ctx, o: AudioNode, t: number, p: number, ratio = 1, len = 0.3) {
  const f = filt(c, o, 'bandpass', 780 * ratio, 1.1);
  for (const x of [540, 800]) oscLayer(c, f, t, 'square', [[0, x * ratio], [len, x * ratio]], [[0, 0], [0.002, p * 0.5], [0.05, p * 0.25], [len, 0]]);
}
function sub(c: Ctx, o: AudioNode, t: number, m: number, len: number, p = 0.6, slideTo = 0) {
  oscLayer(c, o, t, 'sine', [[0, hz(m)], [len * 0.2, hz(m)], [len, hz(m + slideTo)]], [[0, 0], [0.006, p], [len * 0.7, p * 0.75], [len, 0]]);
}
/** Round bass note with a little bite, for house, synthwave and funk lines. */
function bassNote(c: Ctx, o: AudioNode, t: number, m: number, len: number, p = 0.45, wave: OscillatorType = 'sawtooth') {
  oscLayer(c, o, t, wave, [[0, hz(m)], [len, hz(m)]], [[0, 0], [0.008, p], [len * 0.6, p * 0.6], [len, 0]], { lowpass: [[0, 900], [0.05, 500], [len, 250]], q: 1.4 });
  oscLayer(c, o, t, 'sine', [[0, hz(m)], [len, hz(m)]], [[0, 0], [0.008, p * 0.8], [len, 0]]);
}
/** Electric-piano: a soft sine, a bell-like tine that dies fast, and a bit of body. */
function keys(c: Ctx, o: AudioNode, t: number, m: number, len: number, p = 0.2, tremolo = 0) {
  const f = hz(m);
  oscLayer(c, o, t, 'sine', [[0, f], [len, f]], [[0, 0], [0.006, p], [len * 0.35, p * 0.5], [len, 0]], tremolo ? { vib: { rate: tremolo, depth: [[0, 0.6], [len, 0.6]] } } : {});
  oscLayer(c, o, t, 'sine', [[0, f * 2], [len, f * 2]], [[0, 0], [0.004, p * 0.3], [len * 0.4, 0]]);
  oscLayer(c, o, t, 'sine', [[0, f * 5.4], [0.3, f * 5.4]], [[0, 0], [0.002, p * 0.18], [0.12, 0]]);
}
function piano(c: Ctx, o: AudioNode, t: number, m: number, len: number, p = 0.2) {
  oscLayer(c, o, t, 'triangle', [[0, hz(m)], [len, hz(m)]], [[0, 0], [0.004, p], [len * 0.3, p * 0.4], [len, 0]], { lowpass: [[0, hz(m) * 6], [len * 0.5, hz(m) * 2], [len, hz(m)]] });
  oscLayer(c, o, t, 'sine', [[0, hz(m) * 2], [0.4, hz(m) * 2]], [[0, 0], [0.003, p * 0.35], [0.4, 0]]);
}
function padChord(c: Ctx, o: AudioNode, t: number, notes: number[], len: number, p = 0.07, wave: OscillatorType = 'sawtooth', cutoff = 1400) {
  for (const m of notes) {
    oscLayer(c, o, t, wave, [[0, hz(m)], [len, hz(m)]], [[0, 0], [Math.min(0.5, len * 0.3), p], [len * 0.85, p * 0.85], [len, 0]], { voices: 3, spread: 12, lowpass: [[0, cutoff * 0.6], [len * 0.4, cutoff], [len, cutoff * 0.6]] });
  }
}
/** A strummed guitar chord: plucks spread a few milliseconds apart, down or up. */
function strum(c: Ctx, o: AudioNode, t: number, notes: number[], len: number, p = 0.16, up = false, gap = 0.012) {
  const list = up ? [...notes].reverse() : notes;
  list.forEach((m, i) => pluck(c, o, t + i * gap, hz(m), len, p * (up ? 0.8 : 1) * (1 - i * 0.04), 0.8));
}
function stab(c: Ctx, o: AudioNode, t: number, notes: number[], len: number, p = 0.1) {
  for (const m of notes) oscLayer(c, o, t, 'sawtooth', [[0, hz(m)], [len, hz(m)]], [[0, 0], [0.004, p], [len, 0]], { voices: 2, spread: 10, lowpass: [[0, 4000], [len, 700]] });
}
/** Amapiano "log drum": a pitched, saturated thump that bends down. */
function logDrum(c: Ctx, o: AudioNode, t: number, m: number, p = 0.5, len = 0.35) {
  oscLayer(c, o, t, 'sine', [[0, hz(m) * 1.6], [0.04, hz(m)], [len, hz(m) * 0.8]], [[0, 0], [0.003, p], [len * 0.4, p * 0.5], [len, 0]]);
  oscLayer(c, o, t, 'triangle', [[0, hz(m + 12)], [0.1, hz(m + 12) * 0.9]], [[0, 0], [0.002, p * 0.3], [0.12, 0]]);
}
function lead(c: Ctx, o: AudioNode, t: number, m: number, len: number, wave: OscillatorType, p: number, cutoff = 3000) {
  oscLayer(c, o, t, wave, [[0, hz(m)], [len, hz(m)]], [[0, 0], [0.01, p], [len * 0.6, p * 0.7], [len, 0]], { voices: wave === 'sawtooth' ? 3 : 1, spread: 10, lowpass: [[0, cutoff], [len, cutoff * 0.5]] });
}

// ---------- the styles ----------

/** A melody for this version of the song: scale steps, with rests, that repeat every 2 bars. */
const pick = (e: Env, i: number) => e.melody[i % e.melody.length]!;

export const STYLES: Record<StyleId, Style> = {
  phonk: {
    bpm: 132, swing: 0, verb: 1.6, wet: 0.2, pump: 0.45, tone: 9000, drive: 2.2, intro: 2, scale: [0, 3, 5, 7, 10],
    chords: [[36, 51, 55, 58], [32, 51, 56, 60], [34, 50, 53, 58], [31, 50, 55, 59]],
    bar(e) {
      const { c, t0, beat, step } = e;
      padChord(c, e.harm, t0, e.chord.slice(1), beat * 4, 0.06, 'sawtooth', 900);
      // Heavy, distorted 808 on the root with a slide into the next bar.
      sub(c, e.bass, t0, e.chord[0]!, beat * 1.4, 0.7);
      sub(c, e.bass, t0 + beat * 2.5, e.chord[0]!, beat * 1.2, 0.65, e.fill ? -5 : 0);
      if (e.b >= 1) {
        // Cowbell riff: the signature of the style.
        for (let i = 0; i < 16; i++) {
          const rhythm = [1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0][i]!;
          if (rhythm) cowbell(c, e.lead, e.at(i), 0.42, 2 ** (pick(e, i >> 1) / 12) * 0.9, 0.3);
        }
      }
      e.kick(t0, 1.1);
      e.kick(t0 + beat * 1.5, 0.9);
      e.kick(t0 + beat * 2, 1.1);
      e.kick(t0 + beat * 3.25, 0.8);
      clap(c, e.drums, t0 + beat, 0.5);
      clap(c, e.drums, t0 + beat * 3, 0.5);
      for (let i = 0; i < 16; i++) hatC(c, e.drums, e.at(i), i % 2 ? 0.5 : 0.85);
      if (e.fill) for (let i = 0; i < 8; i++) hatC(c, e.drums, t0 + beat * 3.5 + (i * beat) / 16, 0.4 + i * 0.07);
      void step;
    },
  },
  lofihop: {
    bpm: 78, swing: 0.2, verb: 2, wet: 0.3, pump: 0, tone: 3400, drive: 1.1, intro: 2, scale: [0, 2, 4, 7, 9],
    chords: [[38, 57, 60, 65, 69], [43, 53, 59, 62, 65], [36, 55, 59, 64, 67], [33, 55, 60, 64, 67]],
    bar(e) {
      const { c, t0, beat } = e;
      // Rhodes chords, slightly late, like someone playing them by hand.
      e.chord.slice(1).forEach((m, i) => keys(c, e.harm, t0 + 0.012 * i + e.r() * 0.01, m, beat * 3.6, 0.1, 4.5));
      if (e.b % 2) e.chord.slice(1, 4).forEach((m, i) => keys(c, e.harm, e.at(10) + i * 0.01, m, beat * 1.2, 0.06, 4.5));
      bassNote(c, e.bass, t0, e.chord[0]! + 12, beat * 1.6, 0.4, 'sine');
      bassNote(c, e.bass, e.at(10), e.chord[0]! + 12, beat * 1.2, 0.32, 'sine');
      // Dusty drums: soft kick, snare with some "air", loose hats.
      e.kick(t0, 0.7);
      e.kick(e.at(7), 0.5);
      e.kick(e.at(10), 0.6);
      snareDrum(c, e.drums, t0 + beat, 0.55);
      snareDrum(c, e.drums, t0 + beat * 3, 0.55);
      for (let i = 0; i < 8; i++) hatC(c, e.drums, e.at(i * 2), (i % 2 ? 0.35 : 0.6) * (0.8 + e.r() * 0.4));
      if (e.b >= 2 && e.b % 2 === 0) {
        for (let i = 0; i < 6; i++) if (e.melody[i]! >= 0) keys(c, e.lead, e.at(i * 2 + 1), e.chord[2]! + 12 + e.melody[i]!, beat * 0.9, 0.09, 4.5);
      }
    },
  },
  dembow: {
    bpm: 94, swing: 0, verb: 1.4, wet: 0.18, pump: 0.3, tone: 10000, drive: 1.5, intro: 1, scale: [0, 3, 5, 7, 10],
    chords: [[33, 57, 60, 64], [29, 57, 60, 65], [36, 55, 60, 64], [31, 55, 59, 62]],
    bar(e) {
      const { c, t0, beat } = e;
      // Tresillo bass (3 + 3 + 2) under the chord.
      for (const [i, len] of [[0, 3], [3, 3], [6, 2]] as const) sub(c, e.bass, e.at(i * 2), e.chord[0]! + 12, e.step * len * 1.6, 0.55);
      // The dembow: kick on every beat, snare/rim pattern that makes people move.
      for (let k = 0; k < 4; k++) e.kick(t0 + k * beat, k % 2 ? 0.8 : 1);
      for (const i of [3, 6, 11, 14]) {
        snareDrum(c, e.drums, e.at(i), 0.6, true);
        rim(c, e.drums, e.at(i), 0.5);
      }
      for (let i = 0; i < 16; i += 2) hatC(c, e.drums, e.at(i), i % 4 ? 0.4 : 0.6);
      hatO(c, e.drums, e.at(14), 0.5, 0.15);
      // Plucked chords on the off-beats and a bell melody.
      if (e.main) {
        for (const i of [2, 5, 10, 13]) strum(c, e.harm, e.at(i), e.chord.slice(1), 0.5, 0.1, i > 5);
        for (let i = 0; i < 8; i++) if (e.melody[i]! >= 0) pluck(c, e.lead, e.at(i * 2 + 1), hz(e.chord[2]! + 12 + e.melody[i]!), 0.5, 0.14, 1.2);
      } else padChord(c, e.harm, t0, e.chord.slice(1), beat * 4, 0.05, 'triangle', 2500);
      if (e.fill) for (let i = 0; i < 4; i++) snareDrum(c, e.drums, t0 + beat * 3 + (i * beat) / 4, 0.4 + i * 0.12, true);
    },
  },
  afrobeats: {
    bpm: 104, swing: 0.1, verb: 1.6, wet: 0.2, pump: 0.25, tone: 9500, drive: 1.3, intro: 1, scale: [0, 2, 4, 7, 9],
    chords: [[36, 55, 60, 64, 67], [33, 57, 60, 64, 69], [29, 57, 60, 65, 69], [31, 55, 59, 62, 67]],
    bar(e) {
      const { c, t0, beat } = e;
      // Kick with a bounce, claps on 2 and 4 plus a ghost, shaker and congas running underneath.
      for (const i of [0, 6, 10]) e.kick(e.at(i), i ? 0.75 : 1);
      clap(c, e.drums, e.at(4), 0.45, 1500);
      clap(c, e.drums, e.at(12), 0.45, 1500);
      if (e.main) clap(c, e.drums, e.at(15), 0.18, 1500);
      for (let i = 0; i < 16; i++) shaker(c, e.drums, e.at(i), i % 4 === 2 ? 1 : 0.55);
      if (e.main) for (const [i, f] of [[3, 220], [7, 165], [8, 220], [11, 165], [14, 196]] as const) conga(c, e.drums, e.at(i), f, 0.7);
      // Round, bouncy bass and a clean guitar-like skank.
      for (const [i, n] of [[0, 0], [3, 0], [6, 7], [10, 0], [12, 5]] as const) bassNote(c, e.bass, e.at(i), e.chord[0]! + 12 + n, beat * 0.45, 0.4, 'triangle');
      for (const i of [2, 6, 10, 14]) strum(c, e.harm, e.at(i), e.chord.slice(1, 4), 0.35, 0.09, i % 4 === 2);
      if (e.main) {
        for (let i = 0; i < 8; i++) if (e.melody[i]! >= 0) lead(c, e.lead, e.at(i * 2), e.chord[1]! + 12 + e.melody[i]!, beat * 0.4, 'triangle', 0.12, 3500);
      } else padChord(c, e.harm, t0, e.chord.slice(1), beat * 4, 0.05, 'triangle', 2200);
    },
  },
  amapiano: {
    bpm: 112, swing: 0.08, verb: 2.4, wet: 0.3, pump: 0.2, tone: 9000, drive: 1.6, intro: 2, scale: [0, 2, 3, 7, 10],
    chords: [[38, 57, 60, 65, 69], [34, 58, 62, 65, 69], [31, 58, 62, 65, 70], [33, 55, 61, 64, 67]],
    bar(e) {
      const { c, t0, beat } = e;
      for (let k = 0; k < 4; k++) e.kick(t0 + k * beat, 0.65);
      for (let i = 0; i < 16; i++) shaker(c, e.drums, e.at(i), i % 2 ? 0.9 : 0.5);
      hatO(c, e.drums, e.at(6), 0.5, 0.1);
      hatO(c, e.drums, e.at(14), 0.5, 0.1);
      clap(c, e.drums, e.at(4), 0.3, 1600);
      clap(c, e.drums, e.at(12), 0.3, 1600);
      // The log drum: the sound of the genre, a pitched bass line with a swung rhythm.
      if (e.main) {
        for (const [i, n, p] of [[0, 0, 1], [3, 7, 0.7], [6, 0, 0.9], [8, 5, 0.8], [11, 0, 0.9], [14, 7, 0.7]] as const) logDrum(c, e.bass, e.at(i), e.chord[0]! + 12 + n, p * 0.55);
      } else sub(c, e.bass, t0, e.chord[0]! + 12, beat * 3, 0.5);
      // Soft pads and short piano stabs.
      padChord(c, e.harm, t0, e.chord.slice(1), beat * 4, 0.05, 'triangle', 2000);
      if (e.b >= 1) for (const i of [2, 5, 9, 13]) e.chord.slice(1, 5).forEach((m, k) => piano(c, e.lead, e.at(i) + k * 0.006, m + 12, 0.5, 0.07));
    },
  },
  house: {
    bpm: 124, swing: 0.04, verb: 1.6, wet: 0.2, pump: 0.6, tone: 11000, drive: 1.8, intro: 2, scale: [0, 3, 5, 7, 10],
    chords: [[36, 60, 63, 67, 70], [32, 60, 63, 68, 72], [27, 58, 63, 67, 70], [34, 58, 62, 65, 70]],
    bar(e) {
      const { c, t0, beat } = e;
      // Four on the floor, off-beat open hat, clap on 2 and 4 (the build starts with kick and hat only).
      for (let k = 0; k < 4; k++) e.kick(t0 + k * beat, 1);
      for (let k = 0; k < 4; k++) hatO(c, e.drums, t0 + k * beat + beat / 2, 0.9, 0.12);
      if (e.b >= 1) {
        clap(c, e.drums, t0 + beat, 0.5);
        clap(c, e.drums, t0 + beat * 3, 0.5);
        for (let i = 0; i < 16; i += 2) hatC(c, e.drums, e.at(i + 1), 0.4);
      }
      // Rolling bass on the off-beat 16ths, pumped by the kick.
      if (e.main) for (const i of [2, 3, 6, 7, 10, 11, 14, 15]) bassNote(c, e.bass, e.at(i), e.chord[0]! + 12 + (i % 4 === 3 ? 12 : 0), e.step * 0.9, 0.4);
      // Chord stabs with a bit of swing and a long pad underneath.
      padChord(c, e.harm, t0, e.chord.slice(1), beat * 4, 0.05, 'sawtooth', 1600);
      if (e.main) for (const i of [3, 6, 10, 13]) stab(c, e.lead, e.at(i), e.chord.slice(1, 4), e.step * 1.6, 0.07);
      if (e.fill) noiseLayer(c, e.drums, t0 + beat * 2, [[0, 0], [beat * 1.9, 0.18], [beat * 2, 0]], { type: 'highpass', freq: [[0, 1500], [beat * 2, 9000]], q: 0.8 });
    },
  },
  drill: {
    bpm: 142, swing: 0, verb: 1.8, wet: 0.2, pump: 0.3, tone: 8000, drive: 2.4, intro: 2, scale: [0, 2, 3, 7, 8],
    chords: [[31, 55, 58, 62], [27, 55, 58, 63], [36, 55, 60, 63], [26, 54, 57, 62]],
    bar(e) {
      const { c, t0, beat } = e;
      // The sliding 808 that defines the style: notes bend toward the next one.
      sub(c, e.bass, t0, e.chord[0]!, beat * 1.8, 0.75, 0);
      sub(c, e.bass, e.at(6), e.chord[0]!, beat * 1.0, 0.7, -5);
      sub(c, e.bass, e.at(10), e.chord[0]! + 5, beat * 1.4, 0.7, -5);
      e.kick(t0, 1);
      e.kick(e.at(10), 0.9);
      snareDrum(c, e.drums, t0 + beat * 2, 1, true);
      rim(c, e.drums, e.at(14), 0.5);
      // Hi-hats with triplet rolls: skittering, never straight.
      for (let i = 0; i < 16; i++) hatC(c, e.drums, e.at(i), i % 2 ? 0.45 : 0.8);
      for (const start of [5, 13]) for (let k = 0; k < 3; k++) hatC(c, e.drums, e.at(start) + (k * beat) / 6, 0.55);
      if (e.fill) for (let k = 0; k < 8; k++) hatC(c, e.drums, t0 + beat * 3.5 + (k * beat) / 16, 0.35 + k * 0.08);
      // Dark piano and strings.
      if (e.main) for (let i = 0; i < 8; i++) if (e.melody[i]! >= 0) piano(c, e.lead, e.at(i * 2), e.chord[1]! + 12 + e.melody[i]!, 0.7, 0.12);
      padChord(c, e.harm, t0, e.chord.slice(1), beat * 4, 0.05, 'sawtooth', 1000);
    },
  },
  synthwave: {
    bpm: 100, swing: 0, verb: 2.6, wet: 0.32, pump: 0.25, tone: 7500, drive: 1.5, intro: 2, scale: [0, 2, 3, 7, 8],
    chords: [[29, 56, 60, 65], [37, 56, 61, 65], [32, 56, 60, 63], [27, 55, 58, 63]],
    bar(e) {
      const { c, t0, beat } = e;
      // Driving 8th-note saw bass, big gated snare and a kick on each beat (the 80s sound).
      for (let i = 0; i < 8; i++) bassNote(c, e.bass, e.at(i * 2), e.chord[0]! + 12 + (i % 4 === 3 ? 12 : 0), beat * 0.45, 0.38);
      for (let k = 0; k < 4; k++) e.kick(t0 + k * beat, k % 2 ? 0.7 : 1);
      snareDrum(c, e.drums, t0 + beat, 0.9);
      snareDrum(c, e.drums, t0 + beat * 3, 0.9);
      clap(c, e.drums, t0 + beat, 0.35);
      clap(c, e.drums, t0 + beat * 3, 0.35);
      for (let i = 0; i < 8; i++) hatC(c, e.drums, e.at(i * 2 + 1) - e.step, 0.6);
      // Wide pad and an arpeggio that climbs; the lead enters after the intro.
      padChord(c, e.harm, t0, e.chord.slice(1), beat * 4, 0.07, 'sawtooth', 2200);
      if (e.b >= 1) for (let i = 0; i < 16; i++) lead(c, e.lead, e.at(i), e.chord[1 + (i % 3)]! + 12 + (i % 4 === 3 ? 12 : 0), e.step * 0.9, 'sawtooth', 0.05, 3500);
      if (e.main && e.b % 2 === 0) for (let i = 0; i < 4; i++) if (e.melody[i]! >= 0) lead(c, e.lead, e.at(i * 4), e.chord[1]! + 24 + e.melody[i]!, beat * 0.9, 'square', 0.07, 3000);
    },
  },
  corrido: {
    bpm: 98, swing: 0.05, verb: 1.5, wet: 0.2, pump: 0, tone: 8500, drive: 1.2, intro: 1, scale: [0, 2, 3, 5, 7],
    chords: [[33, 52, 57, 60, 64], [31, 50, 55, 59, 62], [29, 53, 57, 60, 65], [28, 52, 56, 59, 64]],
    bar(e) {
      const { c, t0, beat } = e;
      // Nylon guitar strummed in a steady pattern: down, down-up, up-down-up.
      const hits: [number, boolean][] = [[0, false], [4, false], [6, true], [10, true], [12, false], [14, true]];
      for (const [i, up] of hits) if (e.main || i === 0 || i === 8) strum(c, e.harm, e.at(i), e.chord.slice(1), 1, up ? 0.1 : 0.15, up, 0.016);
      // Tololoche-style plucked bass: root and fifth, and a soft 808 for the modern touch.
      pluck(c, e.bass, t0, hz(e.chord[0]! + 12), beat * 1.6, 0.35, 0.5);
      pluck(c, e.bass, t0 + beat * 2, hz(e.chord[0]! + 19), beat * 1.4, 0.3, 0.5);
      if (e.main) sub(c, e.bass, t0, e.chord[0]! + 12, beat * 3.5, 0.3);
      // Minimal trap hats and a snare for the groove.
      if (e.main) {
        snareDrum(c, e.drums, t0 + beat * 2, 0.7, true);
        for (let i = 0; i < 8; i++) hatC(c, e.drums, e.at(i * 2), i % 2 ? 0.4 : 0.65);
        if (e.b % 2) for (let k = 0; k < 4; k++) hatC(c, e.drums, t0 + beat * 3.5 + (k * beat) / 8, 0.45);
      }
      // A plucked melody of simple, singable notes.
      if (e.main) for (let i = 0; i < 8; i++) if (e.melody[i]! >= 0) pluck(c, e.lead, e.at(i * 2), hz(e.chord[1]! + 24 + e.melody[i]!), beat * 0.9, 0.16, 1.1);
    },
  },
  acoustic: {
    bpm: 88, swing: 0.04, verb: 1.8, wet: 0.22, pump: 0, tone: 9000, drive: 1.05, intro: 1, scale: [0, 2, 4, 7, 9],
    chords: [[31, 55, 59, 62, 67], [26, 57, 62, 66], [28, 55, 59, 64], [36, 55, 60, 64]],
    bar(e) {
      const { c, t0, beat } = e;
      // Fingerpicked guitar: bass note, then the strings rolling up and down.
      const order = [0, 2, 3, 2, 1, 2, 3, 2];
      const notes = e.chord.slice(1);
      for (let i = 0; i < 8; i++) {
        const idx = order[i]!;
        pluck(c, e.harm, e.at(i * 2) + e.r() * 0.004, hz(notes[idx % notes.length]! + (idx === 0 ? 0 : 12)), 0.9, i ? 0.1 : 0.15, 0.7);
      }
      pluck(c, e.bass, t0, hz(e.chord[0]! + 12), beat * 2, 0.3, 0.4);
      // Cajón-like pulse and a shaker for the feel, from the second bar on.
      if (e.b >= 1) {
        oscLayer(c, e.drums, t0, 'sine', [[0, 120], [0.1, 70]], [[0, 0], [0.003, 0.35], [0.14, 0]]);
        oscLayer(c, e.drums, t0 + beat * 2, 'sine', [[0, 120], [0.1, 70]], [[0, 0], [0.003, 0.3], [0.14, 0]]);
        noiseLayer(c, e.drums, t0 + beat, [[0, 0], [0.002, 0.25], [0.09, 0]], { type: 'bandpass', freq: [[0, 2200], [0.09, 1500]], q: 0.9 });
        noiseLayer(c, e.drums, t0 + beat * 3, [[0, 0], [0.002, 0.25], [0.09, 0]], { type: 'bandpass', freq: [[0, 2200], [0.09, 1500]], q: 0.9 });
        for (let i = 0; i < 8; i++) shaker(c, e.drums, e.at(i * 2 + 1), 0.5);
      }
      padChord(c, e.harm, t0, notes, beat * 4, 0.025, 'triangle', 1800);
      if (e.main && e.b % 2 === 0) for (let i = 0; i < 6; i++) if (e.melody[i]! >= 0) lead(c, e.lead, e.at(i * 2 + 4), notes[1]! + 12 + e.melody[i]!, beat * 0.9, 'triangle', 0.1, 3000);
    },
  },
};

/** The beat of a style, for a `seconds`-long song, as a Build for synth.render. */
export function buildStyleSong(style: StyleId, seconds: number): Build {
  const S = STYLES[style];
  return (c, o, r) => {
    const beat = 60 / S.bpm;
    const step = beat / 4;
    const bar = beat * 4;
    const bars = Math.ceil(seconds / bar);

    // Master chain: soft saturation and a room shared by everything, a warm top, fades at both ends.
    const fade = c.createGain();
    fade.gain.setValueAtTime(0.0001, 0);
    fade.gain.linearRampToValueAtTime(0.9, Math.min(2, seconds * 0.15));
    fade.gain.setValueAtTime(0.9, Math.max(1.5, seconds - 2.5));
    fade.gain.linearRampToValueAtTime(0.0001, seconds);
    fade.connect(o);
    const warm = filt(c, fade, 'lowpass', S.tone, 0.6);
    const room = bus(c, warm, { verb: S.verb, wet: S.wet, drive: S.drive, tone: 5500 });
    if (style === 'lofihop') {
      // Dust: a faint crackle under everything.
      noiseLayer(c, fade, 0, [[0, 0], [1, 0.012], [Math.max(1.1, seconds - 1), 0.012], [seconds, 0]], { type: 'highpass', freq: [[0, 4000], [seconds, 4000]] });
    }
    // Each family of instruments has its own bus so the harmony can duck under the kick.
    const mk = (g: number) => {
      const n = c.createGain();
      n.gain.value = g;
      n.connect(room);
      return n;
    };
    const drums = mk(1);
    const bass = mk(1);
    const harm = mk(1);
    const lead_ = mk(0.9);
    const pumpTargets = [bass, harm];

    // This version's melody: scale steps (or -1 for a rest), the same every two bars.
    const melody = Array.from({ length: 8 }, () => (r() < 0.28 ? -1 : S.scale[Math.floor(r() * S.scale.length)]!));
    const kicks: number[] = [];
    for (let b = 0; b < bars; b++) {
      const t0 = b * bar;
      const e: Env = {
        c, drums, bass, harm, lead: lead_, r, beat, step, swing: S.swing, b, t0,
        chord: S.chords[b % S.chords.length]!,
        main: b >= S.intro,
        fill: (b + 1) % 4 === 0,
        at: (i) => t0 + i * step + (i % 2 ? S.swing * step : 0),
        kick: (t, v = 1) => {
          kickDrum(c, drums, t, v, style === 'phonk' || style === 'drill');
          kicks.push(t);
        },
        melody: melody.map((m, i) => (b % 2 === 1 ? melody[(i + 3) % 8]! : m)),
      };
      S.bar(e);
    }
    // Sidechain feel: the bass and harmony dip right at each kick and swell back before the next.
    if (S.pump > 0) {
      const lo = 1 - S.pump;
      for (const n of pumpTargets) {
        n.gain.setValueAtTime(1, 0);
        for (const t of kicks) {
          // A few milliseconds down (no click), then back up before the next beat.
          n.gain.setValueAtTime(1, Math.max(0, t - 0.004));
          n.gain.linearRampToValueAtTime(lo, t);
          n.gain.linearRampToValueAtTime(1, t + beat * 0.42);
        }
      }
    }
  };
}
