// Sound effects and background music synthesized on the device with Web Audio.
// Everything here is generated from scratch, so it is ours: no licenses, no attribution,
// works offline, and each music render can be as long as the video.
import type { Asset } from './types';
import { putBlob } from './db';
import { uid, useStore } from './store';
import { encodeWav } from './voice';

const SR = 44100;

type Build = (ctx: OfflineAudioContext, out: AudioNode, rand: () => number) => void;

/** Small deterministic random generator, so a "version" of a song can be rebuilt exactly. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

async function render(seconds: number, build: Build, seed = 1): Promise<Float32Array> {
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
function noise(ctx: BaseAudioContext) {
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
function env(ctx: BaseAudioContext, t: number, peak: number, attack: number, decay: number, dest: AudioNode) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.002, attack));
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(dest);
  return g;
}

function tone(ctx: BaseAudioContext, dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, attack = 0.005) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  o.connect(env(ctx, t, peak, attack, dur, dest));
  o.start(t);
  o.stop(t + attack + dur + 0.05);
}

function hiss(ctx: BaseAudioContext, dest: AudioNode, t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1 = f0, q = 1, attack = 0.005) {
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

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// ---------- sound effects ----------

export interface Sfx {
  id: string;
  name: string;
  /** When to use it, in plain words. */
  use: string;
  seconds: number;
  build: Build;
}

export const SFX: Sfx[] = [
  { id: 'whoosh', name: 'Whoosh', use: 'Cambio de escena', seconds: 0.9, build: (c, o) => hiss(c, o, 0, 0.55, 0.9, 'bandpass', 250, 3200, 1.2, 0.25) },
  { id: 'swipe', name: 'Deslizar', use: 'Texto que entra', seconds: 0.4, build: (c, o) => hiss(c, o, 0, 0.22, 0.7, 'highpass', 1200, 6000, 0.8, 0.06) },
  { id: 'pop', name: 'Pop', use: 'Aparece un sticker', seconds: 0.25, build: (c, o) => tone(c, o, 0, 'sine', 700, 140, 0.12, 0.9) },
  { id: 'click', name: 'Clic', use: 'Tutoriales', seconds: 0.1, build: (c, o) => hiss(c, o, 0, 0.025, 0.8, 'highpass', 2500) },
  {
    id: 'ding', name: 'Ding', use: 'Dato importante', seconds: 1.4, build: (c, o) => {
      tone(c, o, 0, 'sine', 1318, 1318, 1.2, 0.6);
      tone(c, o, 0, 'sine', 2637, 2637, 0.6, 0.2);
    },
  },
  {
    id: 'notif', name: 'Notificación', use: 'Mensaje o aviso', seconds: 0.7, build: (c, o) => {
      tone(c, o, 0, 'sine', 988, 988, 0.25, 0.5);
      tone(c, o, 0.12, 'sine', 1319, 1319, 0.45, 0.5);
    },
  },
  {
    id: 'success', name: 'Éxito', use: 'Logro, antes y después', seconds: 0.9, build: (c, o) => {
      [72, 76, 79, 84].forEach((m, i) => tone(c, o, i * 0.08, 'triangle', hz(m), hz(m), 0.35, 0.45));
    },
  },
  { id: 'error', name: 'Error', use: 'Algo sale mal', seconds: 0.6, build: (c, o) => { tone(c, o, 0, 'square', 150, 150, 0.18, 0.25); tone(c, o, 0.22, 'square', 110, 110, 0.28, 0.25); } },
  { id: 'boing', name: 'Boing', use: 'Humor', seconds: 0.8, build: (c, o) => tone(c, o, 0, 'triangle', 180, 520, 0.6, 0.7, 0.01) },
  {
    id: 'impact', name: 'Golpe', use: 'Momento fuerte', seconds: 1.2, build: (c, o) => {
      tone(c, o, 0, 'sine', 140, 38, 0.9, 1);
      hiss(c, o, 0, 0.35, 0.6, 'lowpass', 1800, 200);
    },
  },
  {
    id: 'riser', name: 'Suspenso', use: 'Antes de revelar algo', seconds: 2.6, build: (c, o) => {
      tone(c, o, 0, 'sawtooth', 110, 880, 2.2, 0.25, 1.8);
      hiss(c, o, 0, 2.2, 0.35, 'bandpass', 400, 8000, 1.5, 1.8);
    },
  },
  {
    id: 'shutter', name: 'Cámara', use: 'Foto, captura', seconds: 0.4, build: (c, o) => {
      hiss(c, o, 0, 0.04, 0.9, 'bandpass', 3000, 3000, 0.7);
      hiss(c, o, 0.09, 0.06, 0.7, 'bandpass', 2000, 2000, 0.7);
    },
  },
  {
    id: 'typing', name: 'Teclado', use: 'Texto que se escribe', seconds: 1.3, build: (c, o, r) => {
      for (let i = 0; i < 9; i++) hiss(c, o, i * 0.12 + r() * 0.04, 0.02, 0.5 + r() * 0.3, 'bandpass', 2200 + r() * 1800, 2200, 2);
    },
  },
  {
    id: 'applause', name: 'Aplausos', use: 'Final, celebración', seconds: 2.5, build: (c, o, r) => {
      for (let i = 0; i < 140; i++) {
        const t = r() * 2;
        hiss(c, o, t, 0.03 + r() * 0.03, 0.15 + r() * 0.25 * (1 - t / 2.4), 'bandpass', 1000 + r() * 2500, 1000, 1.2);
      }
    },
  },
  {
    id: 'heartbeat', name: 'Latido', use: 'Tensión, romance', seconds: 1.8, build: (c, o) => {
      for (const t of [0, 0.22, 0.9, 1.12]) tone(c, o, t, 'sine', 90, 45, 0.18, 0.9);
    },
  },
  {
    id: 'magic', name: 'Magia', use: 'Transformación', seconds: 1.4, build: (c, o, r) => {
      for (let i = 0; i < 12; i++) tone(c, o, i * 0.07, 'sine', hz(84 + Math.floor(r() * 12)), hz(84 + Math.floor(r() * 12)), 0.4, 0.18);
      hiss(c, o, 0, 1, 0.12, 'highpass', 6000);
    },
  },
];

export const renderSfx = (s: Sfx) => render(s.seconds, s.build, 7);

// ---------- background music ----------

type DrumKit = 'none' | 'soft' | 'pop' | 'four' | 'epic';

export interface Mood {
  id: string;
  name: string;
  hint: string;
  bpm: number;
  /** One chord per bar, as MIDI notes. */
  chords: number[][];
  drums: DrumKit;
  pad: OscillatorType;
  lead: OscillatorType | null;
  lofi?: boolean;
}

export const MOODS: Mood[] = [
  { id: 'alegre', name: 'Alegre', hint: 'Vlogs, familia, buenas noticias', bpm: 118, chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], drums: 'pop', pad: 'triangle', lead: 'triangle' },
  { id: 'lofi', name: 'Relajado', hint: 'Recetas, estudio, día a día', bpm: 78, chords: [[62, 65, 69, 72], [55, 59, 62, 65], [60, 64, 67, 71], [57, 60, 64, 67]], drums: 'soft', pad: 'sine', lead: 'sine', lofi: true },
  { id: 'epico', name: 'Épico', hint: 'Deportes, logros, tráiler', bpm: 96, chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], drums: 'epic', pad: 'sawtooth', lead: null },
  { id: 'negocio', name: 'Negocio', hint: 'Productos, tutoriales, empresas', bpm: 108, chords: [[60, 64, 67], [53, 57, 60], [57, 60, 64], [55, 59, 62]], drums: 'pop', pad: 'triangle', lead: 'square' },
  { id: 'romantico', name: 'Romántico', hint: 'Parejas, bodas, recuerdos', bpm: 70, chords: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]], drums: 'none', pad: 'sine', lead: 'sine' },
  { id: 'energia', name: 'Energía', hint: 'Ejercicio, fiestas, retos', bpm: 126, chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], drums: 'four', pad: 'sawtooth', lead: 'square' },
];

function kick(c: BaseAudioContext, o: AudioNode, t: number, v = 1) {
  tone(c, o, t, 'sine', 150, 45, 0.28, 0.9 * v);
}
function snare(c: BaseAudioContext, o: AudioNode, t: number, v = 1) {
  hiss(c, o, t, 0.16, 0.35 * v, 'bandpass', 1800, 1800, 0.8);
  tone(c, o, t, 'triangle', 220, 160, 0.08, 0.25 * v);
}
function hat(c: BaseAudioContext, o: AudioNode, t: number, v = 1) {
  hiss(c, o, t, 0.04, 0.12 * v, 'highpass', 7000);
}

function playChord(c: BaseAudioContext, o: AudioNode, t: number, dur: number, notes: number[], wave: OscillatorType) {
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = wave === 'sawtooth' ? 1400 : 2600;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.1 / Math.sqrt(notes.length), t + Math.min(0.4, dur * 0.25));
  g.gain.setValueAtTime(0.1 / Math.sqrt(notes.length), t + dur * 0.8);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  f.connect(g).connect(o);
  for (const n of notes) {
    for (const detune of [-6, 6]) {
      const osc = c.createOscillator();
      osc.type = wave;
      osc.frequency.value = hz(n);
      osc.detune.value = detune;
      osc.connect(f);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }
}

function buildSong(m: Mood, seconds: number): Build {
  return (c, o, r) => {
    const beat = 60 / m.bpm;
    const bar = beat * 4;
    const bars = Math.ceil(seconds / bar);
    const master = c.createGain();
    master.gain.setValueAtTime(0.0001, 0);
    master.gain.linearRampToValueAtTime(0.9, 1.5);
    master.gain.setValueAtTime(0.9, Math.max(1.5, seconds - 2.5));
    master.gain.linearRampToValueAtTime(0.0001, seconds);
    master.connect(o);
    let out: AudioNode = master;
    if (m.lofi) {
      // Warm, slightly muffled sound with a little vinyl crackle.
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      lp.connect(master);
      out = lp;
      hiss(c, master, 0, seconds, 0.015, 'highpass', 4000);
    }
    // Arpeggio pattern for this "version": positions in the chord for each 8th note.
    const pattern = Array.from({ length: 8 }, () => Math.floor(r() * 4));
    const rests = Array.from({ length: 8 }, () => r() < 0.25);
    for (let b = 0; b < bars; b++) {
      const t0 = b * bar;
      const chord = m.chords[b % m.chords.length];
      playChord(c, out, t0, bar, chord, m.pad);
      // Bass on the root, an octave down.
      const root = chord[0] - 24;
      const bassHits = m.drums === 'four' || m.drums === 'epic' ? [0, 1, 2, 3] : [0, 2];
      for (const k of bassHits) tone(c, out, t0 + k * beat, 'triangle', hz(root), hz(root), beat * 0.9, 0.35, 0.01);
      // Melody/arpeggio: skip the first bars so the song builds up.
      if (m.lead && b >= 2) {
        for (let i = 0; i < 8; i++) {
          if (rests[i]) continue;
          const n = chord[pattern[i] % chord.length] + 12;
          tone(c, out, t0 + i * (beat / 2), m.lead, hz(n), hz(n), beat * 0.4, m.lead === 'square' ? 0.07 : 0.16, 0.005);
        }
      }
      // Drums.
      if (m.drums === 'none') continue;
      for (let k = 0; k < 4; k++) {
        const t = t0 + k * beat;
        if (m.drums === 'four') kick(c, out, t);
        else if (m.drums === 'epic') kick(c, out, t, k % 2 ? 0.6 : 1.1);
        else if (k === 0 || k === 2) kick(c, out, t, m.drums === 'soft' ? 0.6 : 1);
        if (k === 1 || k === 3) snare(c, out, t, m.drums === 'soft' ? 0.5 : 1);
        if (m.drums !== 'epic') {
          hat(c, out, t, 0.8);
          hat(c, out, t + beat / 2, m.drums === 'soft' ? 0.4 : 0.6);
        }
      }
    }
  };
}

/** Render a piece of music in a mood. A different `version` gives a different melody. */
export const renderSong = (m: Mood, seconds: number, version = 1) => render(seconds, buildSong(m, seconds), version * 7919 + m.bpm);

// ---------- preview and adding to the project ----------

let previewEl: HTMLAudioElement | null = null;
let previewUrl = '';

/** Play rendered samples through the speakers (for "listen before adding"). */
export function playPreview(samples: Float32Array) {
  stopPreview();
  previewUrl = URL.createObjectURL(encodeWav(samples, SR));
  previewEl = new Audio(previewUrl);
  previewEl.play().catch(() => {});
}

export function stopPreview() {
  previewEl?.pause();
  previewEl = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
}

/** Save generated audio on the device and put it on the audio track, as one undoable step. */
export async function addGenerated(samples: Float32Array, name: string, start: number, opts: { volume?: number; fadeIn?: number; fadeOut?: number } = {}) {
  const s = useStore.getState();
  if (!s.project) return;
  const blob = encodeWav(samples, SR);
  const id = uid();
  let saved = true;
  await putBlob(id, blob).catch(() => (saved = false));
  const duration = samples.length / SR;
  const asset: Asset = { id, kind: 'audio', name, duration, width: 0, height: 0 };
  s.addUrls({ [id]: URL.createObjectURL(blob) });
  const itemId = uid();
  s.commit((p) => {
    p.assets[id] = asset;
    p.audios.push({ id: itemId, assetId: id, start, in: 0, out: duration, volume: opts.volume ?? 1, fadeIn: opts.fadeIn ?? 0, fadeOut: opts.fadeOut ?? 0 });
  });
  if (!saved) s.notify('No hay espacio para guardar el audio: podrás editarlo, pero no se guardará al cerrar.');
}
