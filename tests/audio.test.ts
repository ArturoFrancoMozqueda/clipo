// Run with: npm test. Pure math of the smart audio tools: loudness, ducking and silences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME, applySilenceCuts, audioRole, curveAt, dbToGain, duckCurve, findSilences, frameLevels, integratedLoudness,
  limit, normalizeLoudness, peak, planSilenceCuts, rippleTime, timelineVoice, voiceActivity,
} from '../src/audioDsp.ts';
import type { AudioItem, Project } from '../src/types.ts';

const SR = 48000;
const near = (a: number, b: number, eps: number, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b} (±${eps})`);

/** Sine of `seconds` at `dbfs` peak level. */
function sine(seconds: number, dbfs: number, f = 1000, sr = SR) {
  const a = dbToGain(dbfs);
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = a * Math.sin((2 * Math.PI * f * i) / sr);
  return out;
}
const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const silence = (seconds: number, sr = SR) => new Float32Array(Math.round(seconds * sr));

// ---------- loudness ----------

test('EBU reference: a stereo 1 kHz sine at -23 dBFS measures -23 LUFS', () => {
  const s = sine(5, -23);
  near(integratedLoudness([s, s.slice()], SR), -23, 0.1);
});

test('loudness is 3 dB lower for the same sine on one channel, and works at 44.1 kHz', () => {
  near(integratedLoudness([sine(5, -20)], SR), -23, 0.1);
  near(integratedLoudness([sine(5, -20, 1000, 44100)], 44100), -23, 0.1);
});

test('K-weighting: low frequencies count less than 1 kHz', () => {
  assert.ok(integratedLoudness([sine(4, -20, 40)], SR) < integratedLoudness([sine(4, -20)], SR) - 3);
});

test('silence is -Infinity and gating ignores long quiet parts', () => {
  assert.equal(integratedLoudness([silence(3)], SR), -Infinity);
  const tone = sine(3, -20);
  const gated = integratedLoudness([concat(tone, silence(6))], SR);
  // Without gating 6 s of silence would pull it down by ~4.8 dB; only the edge blocks may differ.
  near(gated, integratedLoudness([tone], SR), 0.5, 'silence must be gated out');
});

test('normalize brings a quiet mix to -14 LUFS without going over -1 dBFS', () => {
  const s = sine(6, -30);
  const ch = [s, s.slice()];
  const r = normalizeLoudness(ch, SR, -14);
  near(r.before, -30, 0.1);
  near(r.gainDb, 16, 0.1);
  near(r.after, -14, 0.3);
  assert.ok(peak(ch) <= dbToGain(-1) + 1e-6);
});

test('normalize turns a loud mix down', () => {
  const s = sine(4, -2);
  const r = normalizeLoudness([s], SR, -14);
  assert.ok(r.gainDb < -8);
  near(r.after, -14, 0.3);
});

test('the limiter catches peaks and leaves quiet parts alone', () => {
  const d = sine(2, -12);
  for (let i = 30000; i < 30010; i++) d[i] = 1.5; // a click far above the ceiling
  limit([d], SR, dbToGain(-1));
  assert.ok(peak([d]) <= dbToGain(-1) + 1e-6);
  // One second away from the click, the sine is untouched.
  near(Math.max(...Array.from(d.subarray(80000, 81000), Math.abs)), dbToGain(-12), 1e-3);
});

// ---------- voice activity and ducking ----------

test('voice activity follows the loud parts and bridges gaps between words', () => {
  const lv = new Float32Array(200).fill(-80);
  lv.fill(-20, 50, 100); // 1 s – 2 s talking
  lv.fill(-80, 70, 75); // a 0.1 s gap between words
  const act = voiceActivity(lv);
  assert.equal(act[40], 0);
  assert.equal(act[60], 1);
  assert.equal(act[72], 1, 'short gap is bridged');
  assert.equal(act[150], 0);
  assert.equal(voiceActivity(new Float32Array(100).fill(-90)).reduce((s, x) => s + x, 0), 0);
});

test('duck curve: no voice, no change', () => {
  assert.ok(duckCurve(new Uint8Array(100), { depth: 12 }).every((g) => g === 1));
  assert.ok(duckCurve(new Uint8Array(100).fill(1), { depth: 0 }).every((g) => g === 1));
});

test('duck curve goes down before the voice, stays down, and comes back smoothly', () => {
  const n = Math.round(10 / FRAME);
  const act = new Uint8Array(n);
  act.fill(1, Math.round(2 / FRAME), Math.round(4 / FRAME)); // voice from 2 s to 4 s
  const o = { depth: 12, attack: 0.2, release: 0.6, hold: 0.3 };
  const c = duckCurve(act, o);
  const low = dbToGain(-12);
  near(curveAt(c, 1.5), 1, 1e-6, 'untouched well before');
  near(curveAt(c, 2), low, 1e-4, 'fully down when the voice starts');
  near(curveAt(c, 3), low, 1e-4, 'down during the voice');
  near(curveAt(c, 4.25), low, 1e-4, 'held a little after');
  const mid = curveAt(c, 4.6);
  assert.ok(mid > low && mid < 1, 'ramping back up');
  near(curveAt(c, 5.5), 1, 1e-6, 'back to normal after the release');
  // Steps are small: never more than the attack slope per frame (no clicks).
  const maxStep = (12 / 0.2) * FRAME + 1e-6;
  for (let i = 1; i < n; i++) {
    const d = Math.abs(20 * Math.log10(c[i]) - 20 * Math.log10(c[i - 1]));
    assert.ok(d <= maxStep, `step ${d} dB at frame ${i}`);
  }
});

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p', name: 'x', aspect: '9:16', clips: [], texts: [], audios: [], createdAt: 0, updatedAt: 0,
  assets: {
    v: { id: 'v', kind: 'video', name: 'video.mp4', duration: 20, width: 1, height: 1 },
    m: { id: 'm', kind: 'audio', name: 'Música: Alegre', duration: 60, width: 0, height: 0 },
    n: { id: 'n', kind: 'audio', name: 'Narración: hola', duration: 5, width: 0, height: 0 },
  },
  ...over,
});
const clip = (id: string, inn: number, out: number, extra = {}) => ({ id, assetId: 'v', in: inn, out, speed: 1, volume: 1, filter: 'none', fit: 'fit' as const, ...extra });
const audio = (id: string, assetId: string, start: number, len: number, extra: Partial<AudioItem> = {}): AudioItem => ({ id, assetId, start, in: 0, out: len, volume: 1, fadeIn: 0, fadeOut: 0, ...extra });

test('audio roles: explicit, or guessed from the name in older projects', () => {
  assert.equal(audioRole(audio('a', 'm', 0, 1)), 'music');
  assert.equal(audioRole(audio('a', 'n', 0, 1), 'Narración: hola'), 'voice');
  assert.equal(audioRole(audio('a', 'n', 0, 1), 'Voz 2'), 'voice');
  assert.equal(audioRole(audio('a', 'n', 0, 1), 'Sonido: Pop'), 'sfx');
  assert.equal(audioRole(audio('a', 'm', 0, 1, { role: 'voice' }), 'Música: Alegre'), 'voice');
});

test('timeline voice: clip sound and narration count, music does not', () => {
  const p = project({ clips: [clip('c1', 5, 7)], audios: [audio('mu', 'm', 0, 10), audio('na', 'n', 4, 2)] });
  const second = Math.round(1 / FRAME);
  const v = new Uint8Array(20 * second);
  v.fill(1, 6 * second, 7 * second); // the video talks at 6–7 s of its own time
  const act = timelineVoice(p, { v, m: new Uint8Array(60 * second).fill(1), n: new Uint8Array(5 * second).fill(1) }, 10);
  assert.equal(act[Math.round(0.5 / FRAME)], 0, 'video silent at its 5.5 s');
  assert.equal(act[Math.round(1.5 / FRAME)], 1, 'video talks at timeline 1.5 s');
  assert.equal(act[Math.round(3 / FRAME)], 0, 'music never counts');
  assert.equal(act[Math.round(5 / FRAME)], 1, 'narration counts');
});

// ---------- silences ----------

test('finds long pauses with a margin, ignores short ones', () => {
  const sr = 16000;
  const s = concat(sine(1, -20, 300, sr), silence(1.5, sr), sine(1, -20, 300, sr), silence(0.3, sr), sine(1, -20, 300, sr));
  const found = findSilences(frameLevels(s, sr), { minDuration: 0.8, margin: 0.15 });
  assert.equal(found.length, 1);
  near(found[0].start, 1.15, 0.03);
  near(found[0].end, 2.35, 0.03);
});

test('silence at the start or end is cut without a margin; silent files give nothing', () => {
  const sr = 16000;
  const s = concat(silence(1, sr), sine(1, -20, 300, sr), silence(2, sr));
  const found = findSilences(frameLevels(s, sr), { minDuration: 0.8, margin: 0.15 });
  assert.equal(found.length, 2);
  near(found[0].start, 0, 1e-6);
  near(found[0].end, 0.85, 0.03);
  near(found[1].start, 2.15, 0.03);
  near(found[1].end, 4, 0.03);
  assert.deepEqual(findSilences(frameLevels(silence(3, sr), sr)), []);
});

test('quiet background noise still counts as silence next to speech', () => {
  const sr = 16000;
  const noise = sine(1.5, -55, 120, sr);
  const s = concat(sine(1, -15, 300, sr), noise, sine(1, -15, 300, sr));
  assert.equal(findSilences(frameLevels(s, sr), { depth: 28 }).length, 1);
});

test('planned cuts map clip source time to the timeline', () => {
  const sr = 16000;
  const levels = frameLevels(concat(sine(4, -20, 300, sr), silence(2, sr), sine(14, -20, 300, sr)), sr);
  // Second clip starts at 3 s of the source and sits after a 2 s clip.
  const p = project({ clips: [clip('a', 10, 12), clip('b', 3, 10, { speed: 2 })] });
  const cuts = planSilenceCuts(p, { v: levels }, { margin: 0.1, minDuration: 0.8 });
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].clipId, 'b');
  near(cuts[0].src.start, 4.1, 0.03);
  near(cuts[0].src.end, 5.9, 0.03);
  near(cuts[0].at.start, 2 + (4.1 - 3) / 2, 0.02);
});

test('removing silences splits the clip and moves later items earlier', () => {
  const p = project({
    clips: [clip('a', 0, 10, { transition: { type: 'fade', duration: 0.5 } }), clip('b', 10, 14)],
    texts: [{ id: 't', text: 'hola', start: 6, duration: 1, x: 0.5, y: 0.5, size: 0.1, styleId: 'clasico' }],
    audios: [audio('mu', 'm', 0, 14)],
  });
  const cuts = [{ clipId: 'a', src: { start: 3, end: 5 }, at: { start: 3, end: 5 } }];
  let n = 0;
  const removed = applySilenceCuts(p, cuts, () => `new${n++}`);
  near(removed, 2, 1e-9);
  assert.deepEqual(p.clips.map((c) => [c.id, c.in, c.out]), [['a', 0, 3], ['new0', 5, 10], ['b', 10, 14]]);
  assert.equal(p.clips[0].transition, undefined, 'transition only on the last piece');
  assert.deepEqual(p.clips[1].transition, { type: 'fade', duration: 0.5 });
  near(p.texts[0].start, 4, 1e-9);
  near(p.audios[0].out - p.audios[0].in, 12, 1e-9, 'music ends with the shorter video');
});

test('ripple time', () => {
  const r = [{ start: 2, end: 3 }, { start: 5, end: 7 }];
  assert.equal(rippleTime(1, r), 1);
  assert.equal(rippleTime(2.5, r), 2);
  assert.equal(rippleTime(4, r), 3);
  assert.equal(rippleTime(8, r), 5);
});
