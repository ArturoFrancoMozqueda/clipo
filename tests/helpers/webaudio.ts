// A small offline Web Audio engine for tests, so the sounds and songs Clipo synthesizes can be
// rendered in plain Node and checked (not silent, no clipping, right length, sane spectrum).
// It covers what src/synth.ts uses: oscillators, gains, biquads, buffer sources, convolver,
// wave shaper, compressor and scheduled parameter curves. Graphs must have no feedback loops.
// It is close to a browser, not identical (the compressor is a plain soft-knee one).

interface Range { off: number; data: Float32Array }
const EMPTY: Range = { off: 0, data: new Float32Array(0) };

type Ev = { k: 'set' | 'lin' | 'exp'; t: number; v: number };

class Param {
  events: Ev[] = [];
  inputs: Node[] = [];
  private ctx: OfflineCtx;
  value: number;
  constructor(ctx: OfflineCtx, value: number) {
    this.ctx = ctx;
    this.value = value;
  }
  private add(e: Ev) {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1]!.t > e.t) i--;
    this.events.splice(i, 0, e);
    return this;
  }
  setValueAtTime(v: number, t: number) { return this.add({ k: 'set', t, v }); }
  linearRampToValueAtTime(v: number, t: number) { return this.add({ k: 'lin', t, v }); }
  exponentialRampToValueAtTime(v: number, t: number) { return this.add({ k: 'exp', t, v }); }
  cancelScheduledValues(t: number) { this.events = this.events.filter((e) => e.t < t); return this; }
  get constant() { return !this.events.length && !this.inputs.length; }

  /** Values for samples [a, b). */
  values(a: number, b: number): Float32Array {
    const out = new Float32Array(b - a);
    const ev = this.events;
    const sr = this.ctx.sampleRate;
    if (!ev.length) out.fill(this.value);
    else {
      let i = -1;
      let v0 = this.value;
      let t0 = 0;
      for (let n = a; n < b; n++) {
        const t = n / sr;
        while (i + 1 < ev.length && ev[i + 1]!.t <= t) {
          i++;
          v0 = ev[i]!.v;
          t0 = ev[i]!.t;
        }
        const nx = ev[i + 1];
        let v = v0;
        if (nx && nx.k !== 'set' && nx.t > t0) {
          const x = (t - t0) / (nx.t - t0);
          if (nx.k === 'lin') v = v0 + (nx.v - v0) * x;
          else if (v0 * nx.v > 0) v = v0 * Math.pow(nx.v / v0, x);
        }
        out[n - a] = v;
      }
    }
    for (const inp of this.inputs) addInto(out, a, inp.out());
    return out;
  }
}

function addInto(out: Float32Array, a: number, r: Range) {
  const from = Math.max(a, r.off);
  const to = Math.min(a + out.length, r.off + r.data.length);
  for (let n = from; n < to; n++) out[n - a]! += r.data[n - r.off]!;
}

abstract class Node {
  inputs: Node[] = [];
  private memo?: Range;
  private busy = false;
  context: OfflineCtx;
  constructor(context: OfflineCtx) {
    this.context = context;
  }
  connect<T extends Node | Param>(d: T): T {
    d.inputs.push(this);
    return d;
  }
  disconnect() {}
  out(): Range {
    if (this.memo) return this.memo;
    if (this.busy) throw new Error('feedback loops are not supported by the test audio engine');
    this.busy = true;
    this.memo = this.render();
    this.busy = false;
    return this.memo;
  }
  protected abstract render(): Range;
  protected mix(): Range {
    const rs = this.inputs.map((n) => n.out()).filter((r) => r.data.length);
    if (!rs.length) return EMPTY;
    if (rs.length === 1) return rs[0]!;
    const off = Math.min(...rs.map((r) => r.off));
    const end = Math.max(...rs.map((r) => r.off + r.data.length));
    const data = new Float32Array(end - off);
    for (const r of rs) addInto(data, off, r);
    return { off, data };
  }
}

const blep = (p: number, dt: number) => {
  if (p < dt) { const x = p / dt; return x + x - x * x - 1; }
  if (p > 1 - dt) { const x = (p - 1) / dt; return x * x + x + x + 1; }
  return 0;
};

class Osc extends Node {
  type: OscillatorType = 'sine';
  frequency = new Param(this.context, 440);
  detune = new Param(this.context, 0);
  private s = -1;
  private e = Infinity;
  start(t = 0) { this.s = Math.max(0, t); }
  stop(t = 0) { this.e = t; }
  protected render(): Range {
    const sr = this.context.sampleRate;
    if (this.s < 0) return EMPTY;
    const a = Math.ceil(this.s * sr);
    const b = Math.min(this.context.length, Math.ceil(this.e * sr));
    if (b <= a) return EMPTY;
    const f = this.frequency.values(a, b);
    const det = this.detune.constant ? null : this.detune.values(a, b);
    const k = Math.pow(2, this.detune.value / 1200);
    const data = new Float32Array(b - a);
    let p = 0;
    for (let i = 0; i < data.length; i++) {
      const dt = Math.min(0.49, Math.abs(f[i]! * (det ? Math.pow(2, det[i]! / 1200) : k)) / sr);
      let v: number;
      if (this.type === 'sine') v = Math.sin(2 * Math.PI * p);
      else if (this.type === 'sawtooth') v = 2 * p - 1 - blep(p, dt);
      else if (this.type === 'square') v = (p < 0.5 ? 1 : -1) + blep(p, dt) - blep((p + 0.5) % 1, dt);
      else v = 1 - 4 * Math.abs(((p + 0.25) % 1) - 0.5);
      data[i] = v;
      p += dt;
      if (p >= 1) p -= 1;
    }
    return { off: a, data };
  }
}

class Gain extends Node {
  gain = new Param(this.context, 1);
  protected render(): Range {
    const r = this.mix();
    if (!r.data.length) return EMPTY;
    const data = new Float32Array(r.data.length);
    if (this.gain.constant) {
      const g = this.gain.value;
      for (let i = 0; i < data.length; i++) data[i] = r.data[i]! * g;
    } else {
      const g = this.gain.values(r.off, r.off + data.length);
      for (let i = 0; i < data.length; i++) data[i] = r.data[i]! * g[i]!;
    }
    return { off: r.off, data };
  }
}

class Biquad extends Node {
  type: BiquadFilterType = 'lowpass';
  frequency = new Param(this.context, 350);
  Q = new Param(this.context, 1);
  gain = new Param(this.context, 0);
  detune = new Param(this.context, 0);
  private coefs(f: number, Q: number, gainDb: number) {
    const sr = this.context.sampleRate;
    const w = (2 * Math.PI * Math.min(sr * 0.499, Math.max(1, f))) / sr;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const A = Math.pow(10, gainDb / 40);
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    const aq = s / (2 * Math.pow(10, Q / 20));
    const al = s / (2 * Math.max(1e-4, Q));
    const as = (s / 2) * Math.SQRT2;
    const rA = Math.sqrt(A);
    switch (this.type) {
      case 'lowpass': b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + aq; a1 = -2 * c; a2 = 1 - aq; break;
      case 'highpass': b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + aq; a1 = -2 * c; a2 = 1 - aq; break;
      case 'bandpass': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
      case 'notch': b0 = 1; b1 = -2 * c; b2 = 1; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
      case 'allpass': b0 = 1 - al; b1 = -2 * c; b2 = 1 + al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
      case 'peaking': b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; break;
      case 'lowshelf':
        b0 = A * (A + 1 - (A - 1) * c + 2 * as * rA); b1 = 2 * A * (A - 1 - (A + 1) * c); b2 = A * (A + 1 - (A - 1) * c - 2 * as * rA);
        a0 = A + 1 + (A - 1) * c + 2 * as * rA; a1 = -2 * (A - 1 + (A + 1) * c); a2 = A + 1 + (A - 1) * c - 2 * as * rA; break;
      case 'highshelf':
        b0 = A * (A + 1 + (A - 1) * c + 2 * as * rA); b1 = -2 * A * (A - 1 + (A + 1) * c); b2 = A * (A + 1 + (A - 1) * c - 2 * as * rA);
        a0 = A + 1 - (A - 1) * c + 2 * as * rA; a1 = 2 * (A - 1 - (A + 1) * c); a2 = A + 1 - (A - 1) * c - 2 * as * rA; break;
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0] as const;
  }
  protected render(): Range {
    const r = this.mix();
    if (!r.data.length) return EMPTY;
    const sr = this.context.sampleRate;
    const n = Math.min(this.context.length - r.off, r.data.length + Math.ceil(0.3 * sr));
    const data = new Float32Array(n);
    const fixed = this.frequency.constant && this.Q.constant;
    const f = fixed ? null : this.frequency.values(r.off, r.off + n);
    const q = fixed ? null : this.Q.values(r.off, r.off + n);
    let [b0, b1, b2, a1, a2] = this.coefs(this.frequency.value, this.Q.value, this.gain.value);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      if (f && (i & 15) === 0) [b0, b1, b2, a1, a2] = this.coefs(f[i]!, q![i]!, this.gain.value);
      const x = i < r.data.length ? r.data[i]! : 0;
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      data[i] = y;
    }
    return { off: r.off, data };
  }
}

export class Buf {
  readonly chans: Float32Array[];
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.chans = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(i: number) { return this.chans[i]!; }
}

class BufSrc extends Node {
  buffer: Buf | null = null;
  loop = false;
  playbackRate = new Param(this.context, 1);
  private s = -1;
  private offset = 0;
  private e = Infinity;
  start(t = 0, offset = 0) { this.s = Math.max(0, t); this.offset = offset; }
  stop(t = 0) { this.e = t; }
  protected render(): Range {
    const b = this.buffer;
    const sr = this.context.sampleRate;
    if (this.s < 0 || !b || !b.length) return EMPTY;
    const rate = (this.playbackRate.value * b.sampleRate) / sr;
    const a = Math.ceil(this.s * sr);
    let end = Math.min(this.context.length, Math.ceil(this.e * sr));
    if (!this.loop) end = Math.min(end, a + Math.floor((b.length - this.offset * b.sampleRate) / rate));
    if (end <= a) return EMPTY;
    const src = b.getChannelData(0);
    const data = new Float32Array(end - a);
    let pos = this.offset * b.sampleRate;
    for (let i = 0; i < data.length; i++) {
      const p = this.loop ? pos % b.length : pos;
      const i0 = Math.floor(p);
      const fr = p - i0;
      const s0 = src[i0] ?? 0;
      const s1 = src[this.loop ? (i0 + 1) % b.length : i0 + 1] ?? 0;
      data[i] = s0 + (s1 - s0) * fr;
      pos += rate;
    }
    return { off: a, data };
  }
}

/** In-place radix-2 FFT (inverse when `inv`). */
export function fft(re: Float64Array, im: Float64Array, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr; im[b] = im[a]! - xi;
        re[a]! += xr; im[a]! += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i]! /= n; im[i]! /= n; }
}

class Convolver extends Node {
  buffer: Buf | null = null;
  normalize = true;
  protected render(): Range {
    const r = this.mix();
    const ir = this.buffer;
    if (!r.data.length || !ir) return EMPTY;
    const m = ir.length;
    // A mono input through a stereo impulse, heard in mono: the average of both channels.
    const h = new Float64Array(m);
    let power = 0;
    for (let ch = 0; ch < ir.numberOfChannels; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < m; i++) { h[i]! += d[i]! / ir.numberOfChannels; power += d[i]! * d[i]!; }
    }
    power = Math.sqrt(power / (ir.numberOfChannels * m));
    const scale = this.normalize ? (1 / Math.max(0.000125, power)) * 0.00125 * (44100 / ir.sampleRate) : 1;
    const outLen = Math.min(this.context.length - r.off, r.data.length + m - 1);
    let size = 1;
    while (size < r.data.length + m) size <<= 1;
    const ar = new Float64Array(size), ai = new Float64Array(size), br = new Float64Array(size), bi = new Float64Array(size);
    ar.set(r.data);
    br.set(h);
    fft(ar, ai);
    fft(br, bi);
    for (let i = 0; i < size; i++) {
      const x = ar[i]! * br[i]! - ai[i]! * bi[i]!;
      ai[i] = ar[i]! * bi[i]! + ai[i]! * br[i]!;
      ar[i] = x;
    }
    fft(ar, ai, true);
    const data = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) data[i] = ar[i]! * scale;
    return { off: r.off, data };
  }
}

class Shaper extends Node {
  curve: Float32Array | null = null;
  oversample = 'none';
  protected render(): Range {
    const r = this.mix();
    const c = this.curve;
    if (!r.data.length || !c) return r;
    const data = new Float32Array(r.data.length);
    const n = c.length;
    for (let i = 0; i < data.length; i++) {
      const p = Math.min(n - 1, Math.max(0, ((n - 1) / 2) * (r.data[i]! + 1)));
      const i0 = Math.floor(p);
      const a = c[i0]!;
      data[i] = a + ((c[Math.min(n - 1, i0 + 1)]! - a) * (p - i0));
    }
    return { off: r.off, data };
  }
}

class Compressor extends Node {
  threshold = new Param(this.context, -24);
  knee = new Param(this.context, 30);
  ratio = new Param(this.context, 12);
  attack = new Param(this.context, 0.003);
  release = new Param(this.context, 0.25);
  protected render(): Range {
    const r = this.mix();
    if (!r.data.length) return EMPTY;
    const sr = this.context.sampleRate;
    const T = this.threshold.value, W = this.knee.value, R = this.ratio.value;
    const curve = (x: number) => {
      if (x < T) return x;
      const k = 1 / R - 1;
      if (x <= T + W && W > 0) return x + (k * (x - T) * (x - T)) / (2 * W);
      return T + W + (k * W) / 2 + (x - T - W) / R;
    };
    const makeup = -curve(0) * 0.6;
    const aAtt = 1 - Math.exp(-1 / (sr * this.attack.value));
    const aRel = 1 - Math.exp(-1 / (sr * this.release.value));
    const data = new Float32Array(r.data.length);
    let envDb = 0;
    for (let i = 0; i < data.length; i++) {
      const x = r.data[i]!;
      const db = 20 * Math.log10(Math.max(1e-6, Math.abs(x)));
      const gr = curve(db) - db;
      envDb += (gr - envDb) * (gr < envDb ? aAtt : aRel);
      data[i] = x * Math.pow(10, (envDb + makeup) / 20);
    }
    return { off: r.off, data };
  }
}

class Dest extends Node {
  protected render() { return this.mix(); }
}

export class OfflineCtx {
  currentTime = 0;
  destination: Dest;
  channels: number;
  length: number;
  sampleRate: number;
  constructor(channels: number, length: number, sampleRate: number) {
    this.channels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.destination = new Dest(this);
  }
  createOscillator() { return new Osc(this); }
  createGain() { return new Gain(this); }
  createBiquadFilter() { return new Biquad(this); }
  createBufferSource() { return new BufSrc(this); }
  createConvolver() { return new Convolver(this); }
  createWaveShaper() { return new Shaper(this); }
  createDynamicsCompressor() { return new Compressor(this); }
  createBuffer(ch: number, len: number, sr: number) { return new Buf(ch, len, sr); }
  startRendering(): Promise<Buf> {
    const out = new Buf(1, this.length, this.sampleRate);
    const r = this.destination.out();
    const d = out.getChannelData(0);
    for (let i = 0; i < r.data.length && r.off + i < d.length; i++) d[r.off + i] = r.data[i]!;
    return Promise.resolve(out);
  }
}

/** Make `OfflineAudioContext` available to the app code under test. */
export function installWebAudio() {
  (globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = OfflineCtx;
}

// ---------- measuring what was rendered ----------

export const peakOf = (d: Float32Array, a = 0, b = d.length) => {
  let p = 0;
  for (let i = a; i < b; i++) p = Math.max(p, Math.abs(d[i]!));
  return p;
};
export const rmsOf = (d: Float32Array, a = 0, b = d.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += d[i]! * d[i]!;
  return Math.sqrt(s / Math.max(1, b - a));
};
export const db = (v: number) => 20 * Math.log10(Math.max(1e-9, v));

/** Power spectrum summary: centroid (Hz) and the share of energy under 200 Hz and over 4 kHz. */
export function spectrum(d: Float32Array, sr: number) {
  let size = 1;
  while (size < d.length) size <<= 1;
  const re = new Float64Array(size), im = new Float64Array(size);
  re.set(d);
  fft(re, im);
  let total = 0, weighted = 0, low = 0, high = 0;
  for (let i = 1; i < size / 2; i++) {
    const p = re[i]! * re[i]! + im[i]! * im[i]!;
    const f = (i * sr) / size;
    total += p;
    weighted += p * f;
    if (f < 200) low += p;
    if (f > 4000) high += p;
  }
  return { centroid: weighted / Math.max(1e-12, total), low: low / Math.max(1e-12, total), high: high / Math.max(1e-12, total) };
}
