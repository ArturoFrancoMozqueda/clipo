// Building blocks for the sounds Clipo makes on the device with Web Audio (sound effects and music).
// Shared by the basic effects in sound.ts and the premium pack in soundPremium.ts.

export const SR = 44100;

export type Build = (ctx: OfflineAudioContext, out: AudioNode, rand: () => number) => void;

/** Small deterministic random generator, so a "version" of a song can be rebuilt exactly. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export async function render(seconds: number, build: Build, seed = 1): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.connect(ctx.destination);
  build(ctx, comp, rng(seed));
  const buf = await ctx.startRendering();
  return buf.getChannelData(0);
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
export function noise(ctx: BaseAudioContext) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, SR * 2, SR);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/** A gain node with an attack/decay envelope starting at t. */
export function env(ctx: BaseAudioContext, t: number, peak: number, attack: number, decay: number, dest: AudioNode) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.002, attack));
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(dest);
  return g;
}

export function tone(ctx: BaseAudioContext, dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, attack = 0.005) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  o.connect(env(ctx, t, peak, attack, dur, dest));
  o.start(t);
  o.stop(t + attack + dur + 0.05);
}

export function hiss(ctx: BaseAudioContext, dest: AudioNode, t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1 = f0, q = 1, attack = 0.005) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const bq = ctx.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(f1, t + attack + dur);
  src.connect(bq).connect(env(ctx, t, peak, attack, dur, dest));
  src.start(t, Math.random());
  src.stop(t + attack + dur + 0.05);
}

export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** An oscillator whose pitch wobbles (vibrato), with an attack/decay envelope. */
export function vibrato(ctx: BaseAudioContext, dest: AudioNode, t: number, type: OscillatorType, f: number, dur: number, peak: number, rate = 6, depth = 8) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const lg = ctx.createGain();
  lg.gain.value = depth;
  lfo.connect(lg).connect(o.frequency);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  o.connect(lp).connect(env(ctx, t, peak, 0.03, dur, dest));
  o.start(t);
  lfo.start(t);
  o.stop(t + dur + 0.1);
  lfo.stop(t + dur + 0.1);
  return o;
}

/** A tone switched on and off quickly (phone ring, vibration, crickets). */
export function pulsed(ctx: BaseAudioContext, dest: AudioNode, t: number, dur: number, type: OscillatorType, f: number, rate: number, peak: number) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  const g = ctx.createGain();
  g.gain.value = 0;
  const step = 1 / rate;
  for (let x = 0; x < dur; x += step) {
    g.gain.setValueAtTime(peak, t + x);
    g.gain.setValueAtTime(0, t + x + step / 2);
  }
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// ---------- studio tools: shaped layers, reverb and saturation ----------

/** Automation points: [seconds after the layer starts, value]. */
export type Pts = [number, number][];

function automate(p: AudioParam, t: number, pts: Pts, exp: boolean) {
  p.setValueAtTime(exp ? Math.max(1e-4, pts[0]![1]) : pts[0]![1], t + pts[0]![0]);
  for (const [dt, v] of pts.slice(1)) {
    if (exp) p.exponentialRampToValueAtTime(Math.max(1e-4, v), t + dt);
    else p.linearRampToValueAtTime(v, t + dt);
  }
}
const lastTime = (pts: Pts) => pts[pts.length - 1]![0];

/** Filtered noise with its own volume and filter curves (air, whooshes, risers, textures). */
export function noiseLayer(
  ctx: BaseAudioContext, dest: AudioNode, t: number, gain: Pts,
  filter: { type: BiquadFilterType; freq: Pts; q?: number },
) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const bq = ctx.createBiquadFilter();
  bq.type = filter.type;
  bq.Q.value = filter.q ?? 1;
  automate(bq.frequency, t, filter.freq, true);
  const g = ctx.createGain();
  automate(g.gain, t, gain, false);
  src.connect(bq).connect(g).connect(dest);
  const end = t + Math.max(lastTime(gain), lastTime(filter.freq)) + 0.05;
  src.start(t, Math.random());
  src.stop(end);
}

/** An oscillator with its own pitch and volume curves; `voices` detuned copies make it wide and rich. */
export function oscLayer(
  ctx: BaseAudioContext, dest: AudioNode, t: number, type: OscillatorType, freq: Pts, gain: Pts,
  opts: { voices?: number; spread?: number; lowpass?: Pts; q?: number } = {},
) {
  const g = ctx.createGain();
  automate(g.gain, t, gain, false);
  let into: AudioNode = g;
  if (opts.lowpass) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = opts.q ?? 0.7;
    automate(lp.frequency, t, opts.lowpass, true);
    lp.connect(g);
    into = lp;
  }
  g.connect(dest);
  const n = Math.max(1, opts.voices ?? 1);
  const end = t + Math.max(lastTime(gain), lastTime(freq)) + 0.05;
  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator();
    o.type = type;
    automate(o.frequency, t, freq, true);
    o.detune.value = n > 1 ? ((i / (n - 1)) * 2 - 1) * (opts.spread ?? 12) : 0;
    const vg = ctx.createGain();
    vg.gain.value = 1 / Math.sqrt(n);
    o.connect(vg).connect(into);
    o.start(t);
    o.stop(end);
  }
}

/** Partials of a struck bell or glass (inharmonic, the higher ones fade faster). */
const BELL = [[1, 1], [2.756, 0.5], [5.404, 0.28], [8.933, 0.14]] as const;
export function bell(ctx: BaseAudioContext, dest: AudioNode, t: number, f: number, dur: number, peak: number, bright = 1) {
  BELL.forEach(([ratio, amp], i) => f * ratio < 18000 && tone(ctx, dest, t, 'sine', f * ratio, f * ratio, dur / (1 + i * 0.8), peak * amp * (i ? bright : 1), 0.002));
}

/**
 * A reverb (decaying stereo noise impulse, filtered so the tail is warm). Returns the node to send
 * into; the wet signal goes to `dest`. The impulse comes from a fixed seed, so renders are repeatable.
 */
export function reverb(ctx: BaseAudioContext, dest: AudioNode, seconds = 2, wet = 0.3, tone = 5500): AudioNode {
  const len = Math.max(1, Math.ceil(seconds * SR));
  const ir = ctx.createBuffer(2, len, SR);
  const r = rng(Math.round(seconds * 1000) + 17);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    const pre = Math.floor(SR * 0.012); // short pre-delay: the room answers just after the sound
    for (let i = pre; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = tone;
  const g = ctx.createGain();
  g.gain.value = wet;
  conv.connect(lp).connect(g).connect(dest);
  return conv;
}

/** Warm saturation (tanh), for weight and loudness without harsh clipping. Returns its input. */
export function drive(ctx: BaseAudioContext, dest: AudioNode, amount = 2): AudioNode {
  const ws = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  ws.curve = curve;
  ws.oversample = '4x';
  ws.connect(dest);
  return ws;
}

/**
 * A mix bus: what goes in plays dry and also feeds a reverb, optionally through saturation first.
 * The usual way the premium sounds get their space and polish.
 */
export function bus(ctx: BaseAudioContext, dest: AudioNode, opts: { verb?: number; wet?: number; drive?: number; tone?: number } = {}): AudioNode {
  const input = ctx.createGain();
  const post = ctx.createGain();
  post.connect(dest);
  if (opts.verb) post.connect(reverb(ctx, dest, opts.verb, opts.wet ?? 0.3, opts.tone));
  input.connect(opts.drive ? drive(ctx, post, opts.drive) : post);
  return input;
}

/** Bring a sound to a fixed peak (so every premium effect sits at the same level) and fade the very end. */
export function master(d: Float32Array, target = 0.89) {
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
  if (peak > 1e-5) for (let i = 0; i < d.length; i++) d[i]! *= target / peak;
  const fade = Math.min(d.length, Math.floor(SR * 0.015));
  for (let i = 0; i < fade; i++) d[d.length - 1 - i]! *= i / fade;
  return d;
}
