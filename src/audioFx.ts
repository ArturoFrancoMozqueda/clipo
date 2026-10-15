// Web Audio side of the smart audio tools: voice effects as node chains (live preview and offline
// export build the very same graph) and on-device analysis of the media's sound.
import type { AudioMix, Project, VoiceFxId } from './types';
import { FRAME, duckCurve, frameLevels, timelineVoice, voiceActivity, type ActivityByAsset } from './audioDsp';

export const VOICE_FX: { id: VoiceFxId; name: string; hint: string }[] = [
  { id: 'none', name: 'Normal', hint: 'Sin efecto' },
  { id: 'robot', name: 'Robot', hint: 'Voz metálica de máquina' },
  { id: 'deep', name: 'Grave', hint: 'Más gruesa, como un gigante' },
  { id: 'high', name: 'Aguda', hint: 'Más fina, como una ardilla' },
  { id: 'phone', name: 'Teléfono', hint: 'Como una llamada' },
  { id: 'radio', name: 'Megáfono', hint: 'Radio vieja o altavoz' },
  { id: 'echo', name: 'Eco', hint: 'Se repite a lo lejos' },
  { id: 'room', name: 'Habitación', hint: 'Suena dentro de un cuarto' },
];

export const DEFAULT_MIX: AudioMix = { duck: 0, normalize: false };
export const mixOf = (p: Project): AudioMix => ({ ...DEFAULT_MIX, ...p.audioMix });
/** Default "how much the music goes down" when the user turns ducking on, in dB. */
export const DUCK_DEFAULT = 12;
export const LOUDNESS_TARGET = -14;

export interface FxChain {
  input: AudioNode;
  output: AudioNode;
  /** Stop the oscillators/loops inside and disconnect everything. */
  dispose(): void;
}

/**
 * Builds the node chain of a voice effect. Time-based parts (oscillators, loops) start at `when`
 * (context time) and, in the export, stop at `until`.
 */
export function buildVoiceFx(ctx: BaseAudioContext, id: VoiceFxId, when = ctx.currentTime, until?: number): FxChain | null {
  if (id === 'none') return null;
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const node = <T extends AudioNode>(n: T) => (nodes.push(n), n);
  const run = <T extends AudioScheduledSourceNode>(n: T, at = when) => {
    sources.push(n);
    n.start(Math.max(ctx.currentTime, at));
    if (until !== undefined) n.stop(until);
    return n;
  };
  const input = node(ctx.createGain());
  const output = node(ctx.createGain());
  const biquad = (type: BiquadFilterType, f: number, q = 0.7, gain = 0) => {
    const b = node(ctx.createBiquadFilter());
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    b.gain.value = gain;
    return b;
  };
  const shaper = (drive: number) => {
    const s = node(ctx.createWaveShaper());
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
    }
    s.curve = curve;
    s.oversample = '2x';
    return s;
  };
  const gain = (v: number) => {
    const g = node(ctx.createGain());
    g.gain.value = v;
    return g;
  };

  switch (id) {
    case 'robot': {
      // Ring modulation (voice × low tone) plus a short metallic resonance.
      const ring = gain(0);
      const osc = run(ctx.createOscillator());
      osc.type = 'sine';
      osc.frequency.value = 55;
      osc.connect(ring.gain);
      const delay = node(ctx.createDelay(0.1));
      delay.delayTime.value = 0.012;
      const fb = gain(0.55);
      input.connect(ring);
      ring.connect(delay).connect(fb).connect(delay);
      ring.connect(gain(1.4)).connect(output);
      delay.connect(gain(0.6)).connect(output);
      break;
    }
    case 'deep':
    case 'high': {
      const shifter = pitchShifter(ctx, id === 'deep' ? 0.75 : 1.45, when, node, run);
      input.connect(shifter.input);
      // Keep the body of a low voice, take the hiss off a high one.
      shifter.output.connect(id === 'deep' ? biquad('lowshelf', 200, 0.7, 3) : biquad('highshelf', 6000, 0.7, -4)).connect(output);
      break;
    }
    case 'phone': {
      const comp = node(ctx.createDynamicsCompressor());
      comp.threshold.value = -24;
      comp.ratio.value = 6;
      input
        .connect(biquad('highpass', 400, 0.9))
        .connect(biquad('highpass', 400, 0.9))
        .connect(biquad('lowpass', 3200, 0.9))
        .connect(biquad('lowpass', 3200, 0.9))
        .connect(shaper(2))
        .connect(comp)
        .connect(gain(1.6))
        .connect(output);
      break;
    }
    case 'radio': {
      input
        .connect(biquad('highpass', 600, 1))
        .connect(biquad('lowpass', 4000, 1))
        .connect(biquad('peaking', 1800, 1.2, 9))
        .connect(shaper(6))
        .connect(gain(0.6))
        .connect(output);
      break;
    }
    case 'echo': {
      const delay = node(ctx.createDelay(1));
      delay.delayTime.value = 0.32;
      const fb = gain(0.42);
      const tone = biquad('lowpass', 3000);
      input.connect(output);
      input.connect(delay).connect(tone).connect(fb).connect(delay);
      tone.connect(gain(0.6)).connect(output);
      break;
    }
    case 'room': {
      const conv = node(ctx.createConvolver());
      conv.normalize = false; // the impulse is already scaled to unit energy
      conv.buffer = roomImpulse(ctx);
      input.connect(gain(0.8)).connect(output);
      input.connect(conv).connect(gain(0.55)).connect(output);
      break;
    }
  }
  return {
    input,
    output,
    dispose() {
      for (const s of sources) {
        try { s.stop(); } catch { /* not started or already stopped */ }
      }
      for (const n of nodes) n.disconnect();
    },
  };
}

/**
 * Pitch shifter made only of standard nodes: two delay lines whose delay time ramps continuously
 * (which bends the pitch), crossfaded so the jump back of each ramp is never heard.
 * `ratio` < 1 lowers the voice, > 1 raises it.
 */
function pitchShifter(
  ctx: BaseAudioContext,
  ratio: number,
  when: number,
  node: <T extends AudioNode>(n: T) => T,
  run: <T extends AudioScheduledSourceNode>(n: T, at?: number) => T,
) {
  const cycle = 0.1; // seconds per ramp
  const fade = 0.05;
  const sr = ctx.sampleRate;
  const len = Math.round(cycle * sr);
  const fadeLen = Math.round(fade * sr);
  const up = ratio > 1;
  // Delay goes 0 → maxDelay (lower pitch) or maxDelay → 0 (higher pitch) during each cycle.
  const ramp = ctx.createBuffer(1, len, sr);
  const r = ramp.getChannelData(0);
  for (let i = 0; i < len; i++) r[i] = up ? 1 - i / len : i / len;
  const window = ctx.createBuffer(1, len, sr);
  const w = window.getChannelData(0);
  for (let i = 0; i < len; i++) w[i] = i < fadeLen ? Math.sqrt(i / fadeLen) : i >= len - fadeLen ? Math.sqrt((len - i) / fadeLen) : 1;
  const maxDelay = Math.abs(1 - ratio) * cycle;
  const input = node(ctx.createGain());
  const output = node(ctx.createGain());
  for (const offset of [0, cycle - fade]) {
    const delay = node(ctx.createDelay(1));
    delay.delayTime.value = 0;
    const mod = node(ctx.createBufferSource());
    mod.buffer = ramp;
    mod.loop = true;
    const depth = node(ctx.createGain());
    depth.gain.value = maxDelay;
    mod.connect(depth).connect(delay.delayTime);
    const env = node(ctx.createBufferSource());
    env.buffer = window;
    env.loop = true;
    const vca = node(ctx.createGain());
    vca.gain.value = 0;
    env.connect(vca.gain);
    input.connect(delay).connect(vca).connect(output);
    // Both loops of a line start together; the second line runs half a cycle later.
    run(mod, when + offset);
    run(env, when + offset);
  }
  return { input, output };
}

const impulses = new WeakMap<BaseAudioContext, AudioBuffer>();
/** Short, soft room reverb: decaying noise, slightly different per side for width. */
function roomImpulse(ctx: BaseAudioContext) {
  let b = impulses.get(ctx);
  if (b) return b;
  const sr = ctx.sampleRate;
  const len = Math.round(0.7 * sr);
  b = ctx.createBuffer(2, len, sr);
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      // Low-passed noise: walls absorb the highs.
      lp += (rand() - lp) * 0.35;
      d[i] = lp * Math.exp((-6 * i) / len);
    }
  }
  // Unit energy per side, so the wet level below means the same at any sample rate.
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let e = 0;
    for (let i = 0; i < len; i++) e += d[i]! * d[i]!;
    const k = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < len; i++) d[i]! *= k;
  }
  impulses.set(ctx, b);
  return b;
}

// ---------- analysis ----------

export interface Analysis {
  /** dBFS per FRAME of source time. */
  levels: Float32Array;
  /** Talking (1) or not (0) per FRAME. */
  activity: Uint8Array;
}

/** Mono mix of a decoded buffer. */
export function monoOf(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < out.length; i++) out[i]! += d[i]! / buf.numberOfChannels;
  }
  return out;
}

export function analyzeBuffer(buf: AudioBuffer): Analysis {
  const levels = frameLevels(monoOf(buf), buf.sampleRate, FRAME);
  return { levels, activity: voiceActivity(levels) };
}

const ANALYSIS_RATE = 22050;
const analyses = new Map<string, Promise<Analysis | null>>();

/**
 * Decodes and analyzes the sound of a media file once (null when it has no sound). The levels are
 * computed while decoding, chunk by chunk, so the whole sound is never held in memory.
 */
export function analyzeAsset(assetId: string, url: string): Promise<Analysis | null> {
  let a = analyses.get(assetId);
  if (!a) {
    a = fetch(url)
      .then((r) => r.blob())
      .then((b) => import('./audioExtract').then((m) => m.extractLevels(b, FRAME, ANALYSIS_RATE)))
      .then((r) => (r ? { levels: r.levels, activity: voiceActivity(r.levels) } : null))
      .catch(() => null);
    analyses.set(assetId, a);
  }
  return a;
}

/** Assets whose sound can carry a voice: main-track videos and voice/narration items. */
export function voiceAssets(p: Project): string[] {
  const ids = new Set<string>();
  for (const c of p.clips) if (p.assets[c.assetId]?.kind === 'video') ids.add(c.assetId);
  for (const a of p.audios) ids.add(a.assetId); // timelineVoice() keeps only the voice ones
  return [...ids];
}

/** Gain curve for the background music of a whole project (per FRAME), or null when ducking is off. */
export function projectDuckCurve(p: Project, activity: ActivityByAsset, duration: number): Float32Array | null {
  const { duck } = mixOf(p);
  if (duck <= 0) return null;
  return duckCurve(timelineVoice(p, activity, duration), { depth: duck });
}
