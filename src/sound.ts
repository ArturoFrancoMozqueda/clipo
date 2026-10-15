// Sound effects and background music synthesized on the device with Web Audio.
// Everything here is generated from scratch, so it is ours: no licenses, no attribution,
// works offline, and each music render can be as long as the video.
import type { Asset, AudioRole } from './types';
import { putBlob } from './db';
import { uid, useStore } from './store';
import { encodeWav } from './voice';
import kenneyCatalog from './sfxCatalog.json';

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

/** Categories in the order the picker shows them. */
export const SFX_CATEGORIES = [
  'Transiciones', 'Cómicos', 'Reacciones', 'Impactos', 'Interfaz', 'Juegos', 'Ciencia ficción y magia',
  'Objetos', 'Tiempo y dinero', 'Ambiente', 'Cortinillas',
] as const;
export type SfxCategory = (typeof SFX_CATEGORIES)[number];

export interface Sfx {
  id: string;
  name: string;
  /** When to use it, in plain words. */
  use: string;
  category: SfxCategory;
  /** Synthesized on the device… */
  seconds?: number;
  build?: Build;
  /** …or a bundled recording (Kenney, CC0) under public/sfx/kenney/. */
  file?: string;
}

/** An oscillator whose pitch wobbles (vibrato), with an attack/decay envelope. */
function vibrato(ctx: BaseAudioContext, dest: AudioNode, t: number, type: OscillatorType, f: number, dur: number, peak: number, rate = 6, depth = 8) {
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
function pulsed(ctx: BaseAudioContext, dest: AudioNode, t: number, dur: number, type: OscillatorType, f: number, rate: number, peak: number) {
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

const SYNTH: Sfx[] = [
  // Transiciones
  { id: 'whoosh', name: 'Whoosh', use: 'Cambio de escena', category: 'Transiciones', seconds: 0.9, build: (c, o) => hiss(c, o, 0, 0.55, 0.9, 'bandpass', 250, 3200, 1.2, 0.25) },
  { id: 'whoosh-deep', name: 'Whoosh grave', use: 'Cambio dramático', category: 'Transiciones', seconds: 1.3, build: (c, o) => hiss(c, o, 0, 0.8, 1, 'bandpass', 120, 900, 1.5, 0.4) },
  { id: 'swish', name: 'Swish', use: 'Movimiento rápido', category: 'Transiciones', seconds: 0.35, build: (c, o) => hiss(c, o, 0, 0.12, 0.8, 'highpass', 3000, 9000, 0.7, 0.04) },
  { id: 'swipe', name: 'Deslizar', use: 'Texto que entra', category: 'Transiciones', seconds: 0.4, build: (c, o) => hiss(c, o, 0, 0.22, 0.7, 'highpass', 1200, 6000, 0.8, 0.06) },
  {
    id: 'riser', name: 'Suspenso', use: 'Antes de revelar algo', category: 'Transiciones', seconds: 2.6, build: (c, o) => {
      tone(c, o, 0, 'sawtooth', 110, 880, 2.2, 0.25, 1.8);
      hiss(c, o, 0, 2.2, 0.35, 'bandpass', 400, 8000, 1.5, 1.8);
    },
  },
  // Cómicos
  { id: 'pop', name: 'Pop', use: 'Aparece un sticker', category: 'Cómicos', seconds: 0.25, build: (c, o) => tone(c, o, 0, 'sine', 700, 140, 0.12, 0.9) },
  { id: 'boing', name: 'Boing', use: 'Humor', category: 'Cómicos', seconds: 0.8, build: (c, o) => tone(c, o, 0, 'triangle', 180, 520, 0.6, 0.7, 0.01) },
  {
    id: 'rimshot', name: 'Ba dum tss', use: 'Después de un chiste', category: 'Cómicos', seconds: 1.4, build: (c, o) => {
      tone(c, o, 0, 'sine', 210, 150, 0.15, 0.8);
      tone(c, o, 0.17, 'sine', 140, 100, 0.18, 0.9);
      tone(c, o, 0.36, 'sine', 120, 45, 0.25, 0.8);
      hiss(c, o, 0.36, 0.9, 0.45, 'highpass', 6500);
    },
  },
  {
    id: 'sad-trombone', name: 'Trombón triste', use: 'Fracaso, decepción', category: 'Cómicos', seconds: 2.6, build: (c, o) => {
      [55, 54, 53].forEach((m, i) => vibrato(c, o, i * 0.42, 'sawtooth', hz(m), 0.36, 0.3, 0, 0));
      vibrato(c, o, 1.26, 'sawtooth', hz(52), 1.1, 0.3, 6, 6);
    },
  },
  {
    id: 'crickets', name: 'Grillos', use: 'Silencio incómodo', category: 'Cómicos', seconds: 2.6, build: (c, o) => {
      for (const t of [0, 0.6, 1.3, 1.9]) pulsed(c, o, t, 0.24, 'sine', 4600, 32, 0.25);
    },
  },
  { id: 'slide-up', name: 'Silbato que sube', use: 'Algo sube o crece', category: 'Cómicos', seconds: 0.9, build: (c, o) => tone(c, o, 0, 'sine', 400, 1700, 0.7, 0.45, 0.02) },
  { id: 'slide-down', name: 'Silbato que baja', use: 'Algo cae o se encoge', category: 'Cómicos', seconds: 0.9, build: (c, o) => tone(c, o, 0, 'sine', 1700, 350, 0.7, 0.45, 0.02) },
  { id: 'scratch', name: 'Disco rayado', use: '¡Alto ahí!', category: 'Cómicos', seconds: 0.7, build: (c, o) => { hiss(c, o, 0, 0.18, 0.8, 'bandpass', 3000, 500, 3); hiss(c, o, 0.2, 0.25, 0.6, 'bandpass', 600, 2600, 3); } },
  { id: 'bubble', name: 'Burbuja', use: 'Algo flota', category: 'Cómicos', seconds: 0.3, build: (c, o) => tone(c, o, 0, 'sine', 300, 1300, 0.1, 0.6) },
  { id: 'honk', name: 'Bocina', use: 'Tráfico, susto', category: 'Cómicos', seconds: 0.8, build: (c, o) => { vibrato(c, o, 0, 'sawtooth', 350, 0.5, 0.25, 0, 0); vibrato(c, o, 0, 'sawtooth', 440, 0.5, 0.2, 0, 0); } },
  // Reacciones
  {
    id: 'ding', name: 'Ding', use: 'Dato importante', category: 'Reacciones', seconds: 1.4, build: (c, o) => {
      tone(c, o, 0, 'sine', 1318, 1318, 1.2, 0.6);
      tone(c, o, 0, 'sine', 2637, 2637, 0.6, 0.2);
    },
  },
  {
    id: 'success', name: 'Éxito', use: 'Logro, antes y después', category: 'Reacciones', seconds: 0.9, build: (c, o) => {
      [72, 76, 79, 84].forEach((m, i) => tone(c, o, i * 0.08, 'triangle', hz(m), hz(m), 0.35, 0.45));
    },
  },
  {
    id: 'tada', name: 'Tadá', use: 'Gran revelación', category: 'Reacciones', seconds: 1.8, build: (c, o) => {
      for (const m of [72, 76, 79]) vibrato(c, o, 0, 'sawtooth', hz(m), 0.12, 0.18, 0, 0);
      for (const m of [72, 76, 79, 84]) vibrato(c, o, 0.18, 'sawtooth', hz(m), 1.3, 0.16, 5, 4);
    },
  },
  { id: 'error', name: 'Error', use: 'Algo sale mal', category: 'Reacciones', seconds: 0.6, build: (c, o) => { tone(c, o, 0, 'square', 150, 150, 0.18, 0.25); tone(c, o, 0.22, 'square', 110, 110, 0.28, 0.25); } },
  { id: 'buzzer', name: 'Respuesta incorrecta', use: 'Concurso, fallo', category: 'Reacciones', seconds: 0.9, build: (c, o) => vibrato(c, o, 0, 'sawtooth', 110, 0.7, 0.35, 30, 6) },
  {
    id: 'correct', name: 'Respuesta correcta', use: 'Concurso, acierto', category: 'Reacciones', seconds: 0.8, build: (c, o) => {
      tone(c, o, 0, 'sine', hz(84), hz(84), 0.18, 0.5);
      tone(c, o, 0.12, 'sine', hz(88), hz(88), 0.5, 0.5);
    },
  },
  {
    id: 'drumroll', name: 'Redoble', use: 'Antes de un anuncio', category: 'Reacciones', seconds: 2.6, build: (c, o, r) => {
      for (let i = 0; i < 48; i++) hiss(c, o, i * 0.04 + r() * 0.006, 0.05, 0.12 + 0.35 * (i / 48), 'bandpass', 1700, 1700, 0.9);
      tone(c, o, 1.95, 'sine', 120, 50, 0.3, 0.9);
      hiss(c, o, 1.95, 0.6, 0.5, 'highpass', 5000);
    },
  },
  {
    id: 'applause', name: 'Aplausos', use: 'Final, celebración', category: 'Reacciones', seconds: 2.5, build: (c, o, r) => {
      for (let i = 0; i < 140; i++) {
        const t = r() * 2;
        hiss(c, o, t, 0.03 + r() * 0.03, 0.15 + r() * 0.25 * (1 - t / 2.4), 'bandpass', 1000 + r() * 2500, 1000, 1.2);
      }
    },
  },
  { id: 'heartbeat', name: 'Latido', use: 'Tensión, romance', category: 'Reacciones', seconds: 1.8, build: (c, o) => { for (const t of [0, 0.22, 0.9, 1.12]) tone(c, o, t, 'sine', 90, 45, 0.18, 0.9); } },
  { id: 'whistle', name: 'Silbato de árbitro', use: '¡Falta! ¡Tiempo!', category: 'Reacciones', seconds: 1, build: (c, o) => { vibrato(c, o, 0, 'sine', 2800, 0.7, 0.35, 40, 120); hiss(c, o, 0, 0.7, 0.08, 'bandpass', 2800, 2800, 2); } },
  // Impactos
  {
    id: 'impact', name: 'Golpe grave', use: 'Momento fuerte', category: 'Impactos', seconds: 1.2, build: (c, o) => {
      tone(c, o, 0, 'sine', 140, 38, 0.9, 1);
      hiss(c, o, 0, 0.35, 0.6, 'lowpass', 1800, 200);
    },
  },
  {
    id: 'bass-drop', name: 'Bass drop', use: 'Momento épico', category: 'Impactos', seconds: 2.2, build: (c, o) => {
      tone(c, o, 0, 'sine', 160, 28, 1.8, 1, 0.01);
      tone(c, o, 0, 'triangle', 80, 30, 1.2, 0.4, 0.01);
      hiss(c, o, 0, 0.5, 0.4, 'lowpass', 900, 120);
    },
  },
  // Interfaz
  { id: 'click', name: 'Clic seco', use: 'Tutoriales', category: 'Interfaz', seconds: 0.1, build: (c, o) => hiss(c, o, 0, 0.025, 0.8, 'highpass', 2500) },
  {
    id: 'notif', name: 'Notificación', use: 'Mensaje o aviso', category: 'Interfaz', seconds: 0.7, build: (c, o) => {
      tone(c, o, 0, 'sine', 988, 988, 0.25, 0.5);
      tone(c, o, 0.12, 'sine', 1319, 1319, 0.45, 0.5);
    },
  },
  // Juegos
  { id: 'coin', name: 'Moneda', use: 'Ganar algo', category: 'Juegos', seconds: 0.5, build: (c, o) => { tone(c, o, 0, 'square', hz(83), hz(83), 0.07, 0.25); tone(c, o, 0.07, 'square', hz(88), hz(88), 0.35, 0.25); } },
  { id: 'jump', name: 'Salto', use: 'Brinco', category: 'Juegos', seconds: 0.4, build: (c, o) => tone(c, o, 0, 'square', 280, 720, 0.2, 0.25) },
  {
    id: 'game-over', name: 'Fin del juego', use: 'Perder', category: 'Juegos', seconds: 1.8, build: (c, o) => {
      [67, 64, 60, 55].forEach((m, i) => tone(c, o, i * 0.32, 'square', hz(m), hz(m), i === 3 ? 0.7 : 0.25, 0.22));
    },
  },
  {
    id: 'level-up', name: 'Subir de nivel', use: 'Progreso', category: 'Juegos', seconds: 1, build: (c, o) => {
      [60, 64, 67, 72, 76, 79].forEach((m, i) => tone(c, o, i * 0.07, 'square', hz(m), hz(m), 0.12, 0.2));
    },
  },
  // Ciencia ficción y magia
  {
    id: 'magic', name: 'Magia', use: 'Transformación', category: 'Ciencia ficción y magia', seconds: 1.4, build: (c, o, r) => {
      for (let i = 0; i < 12; i++) tone(c, o, i * 0.07, 'sine', hz(84 + Math.floor(r() * 12)), hz(84 + Math.floor(r() * 12)), 0.4, 0.18);
      hiss(c, o, 0, 1, 0.12, 'highpass', 6000);
    },
  },
  {
    id: 'sparkle', name: 'Destello', use: 'Brillo, limpio', category: 'Ciencia ficción y magia', seconds: 1, build: (c, o, r) => {
      for (let i = 0; i < 8; i++) tone(c, o, i * 0.05, 'sine', hz(96 + Math.floor(r() * 8)), hz(96), 0.25, 0.15);
    },
  },
  // Objetos
  {
    id: 'shutter', name: 'Cámara', use: 'Foto, captura', category: 'Objetos', seconds: 0.4, build: (c, o) => {
      hiss(c, o, 0, 0.04, 0.9, 'bandpass', 3000, 3000, 0.7);
      hiss(c, o, 0.09, 0.06, 0.7, 'bandpass', 2000, 2000, 0.7);
    },
  },
  {
    id: 'typing', name: 'Teclado', use: 'Texto que se escribe', category: 'Objetos', seconds: 1.3, build: (c, o, r) => {
      for (let i = 0; i < 9; i++) hiss(c, o, i * 0.12 + r() * 0.04, 0.02, 0.5 + r() * 0.3, 'bandpass', 2200 + r() * 1800, 2200, 2);
    },
  },
  { id: 'vibrate', name: 'Vibración', use: 'Llega un mensaje', category: 'Objetos', seconds: 1.3, build: (c, o) => { pulsed(c, o, 0, 0.45, 'sawtooth', 160, 50, 0.3); pulsed(c, o, 0.7, 0.45, 'sawtooth', 160, 50, 0.3); } },
  { id: 'phone', name: 'Teléfono', use: 'Llamada', category: 'Objetos', seconds: 2.6, build: (c, o) => { for (const t of [0, 1.4]) { pulsed(c, o, t, 0.9, 'sine', 440, 22, 0.25); pulsed(c, o, t, 0.9, 'sine', 480, 22, 0.25); } } },
  { id: 'doorbell', name: 'Timbre', use: 'Visita, llegada', category: 'Objetos', seconds: 1.6, build: (c, o) => { tone(c, o, 0, 'sine', hz(76), hz(76), 0.7, 0.5); tone(c, o, 0.5, 'sine', hz(72), hz(72), 0.9, 0.5); } },
  // Tiempo y dinero
  {
    id: 'countdown', name: 'Cuenta regresiva', use: '3, 2, 1… ¡ya!', category: 'Tiempo y dinero', seconds: 4.2, build: (c, o) => {
      for (const t of [0, 1, 2]) tone(c, o, t, 'sine', 880, 880, 0.18, 0.5);
      tone(c, o, 3, 'sine', 1760, 1760, 0.7, 0.5);
    },
  },
  { id: 'clock', name: 'Reloj', use: 'El tiempo corre', category: 'Tiempo y dinero', seconds: 4, build: (c, o) => { for (let i = 0; i < 8; i++) hiss(c, o, i * 0.5, 0.015, 0.7, 'bandpass', i % 2 ? 2600 : 3400, 3000, 6); } },
  { id: 'alarm', name: 'Alarma', use: 'Despertar, urgencia', category: 'Tiempo y dinero', seconds: 2, build: (c, o) => { for (let i = 0; i < 4; i++) { tone(c, o, i * 0.5, 'square', 1000, 1000, 0.08, 0.2); tone(c, o, i * 0.5 + 0.14, 'square', 1000, 1000, 0.08, 0.2); } } },
  {
    id: 'cash', name: 'Caja registradora', use: 'Ventas, precio', category: 'Tiempo y dinero', seconds: 1.3, build: (c, o) => {
      hiss(c, o, 0, 0.12, 0.4, 'lowpass', 1500);
      tone(c, o, 0.12, 'sine', 2093, 2093, 0.9, 0.4);
      tone(c, o, 0.12, 'sine', 2637, 2637, 0.6, 0.25);
    },
  },
  // Ambiente
  {
    id: 'rain', name: 'Lluvia', use: 'Ambiente tranquilo', category: 'Ambiente', seconds: 6, build: (c, o, r) => {
      hiss(c, o, 0, 5.6, 0.25, 'lowpass', 1400, 1400, 0.7, 0.4);
      for (let i = 0; i < 70; i++) hiss(c, o, r() * 5.6, 0.01, 0.12 + r() * 0.15, 'highpass', 3500);
    },
  },
  {
    id: 'wind', name: 'Viento', use: 'Exterior, frío', category: 'Ambiente', seconds: 6, build: (c, o) => {
      for (let i = 0; i < 3; i++) hiss(c, o, i * 1.8, 2.4, 0.3, 'bandpass', 250 + i * 80, 700 - i * 60, 3, 1.2);
    },
  },
  { id: 'water-drop', name: 'Gota de agua', use: 'Detalle, limpieza', category: 'Ambiente', seconds: 0.5, build: (c, o) => tone(c, o, 0, 'sine', 1500, 550, 0.12, 0.6) },
];

const KENNEY: Sfx[] = (kenneyCatalog as { id: string; name: string; use: string; category: SfxCategory; file: string }[]).map((k) => ({
  id: `k-${k.id}`,
  name: k.name,
  use: k.use,
  category: k.category,
  file: k.file,
}));

/** Every sound effect, grouped by category in the picker. */
export const SFX: Sfx[] = [...SYNTH, ...KENNEY].sort((a, b) => SFX_CATEGORIES.indexOf(a.category) - SFX_CATEGORIES.indexOf(b.category));

const decoded = new Map<string, Promise<Float32Array>>();

/** Scale down anything that would clip, so no effect ever distorts. */
function limit(d: Float32Array, max = 0.95) {
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
  if (peak > max) for (let i = 0; i < d.length; i++) d[i]! *= max / peak;
  return d;
}

/** Mono samples at Clipo's sample rate, for a synthesized or a bundled sound. */
export function renderSfx(s: Sfx): Promise<Float32Array> {
  if (s.build) return render(s.seconds ?? 1, s.build, 7).then((d) => limit(d));
  let p = decoded.get(s.id);
  if (!p) {
    p = fetch(`./sfx/kenney/${s.file}`)
      .then((r) => r.arrayBuffer())
      .then((buf) => new OfflineAudioContext(1, 1, SR).decodeAudioData(buf))
      .then((ab) => {
        const out = new Float32Array(ab.length);
        for (let ch = 0; ch < ab.numberOfChannels; ch++) {
          const d = ab.getChannelData(ch);
          for (let i = 0; i < out.length; i++) out[i]! += d[i]! / ab.numberOfChannels;
        }
        return limit(out);
      });
    p.catch(() => decoded.delete(s.id));
    decoded.set(s.id, p);
  }
  return p;
}

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
      const chord = m.chords[b % m.chords.length]!;
      playChord(c, out, t0, bar, chord, m.pad);
      // Bass on the root, an octave down.
      const root = chord[0]! - 24;
      const bassHits = m.drums === 'four' || m.drums === 'epic' ? [0, 1, 2, 3] : [0, 2];
      for (const k of bassHits) tone(c, out, t0 + k * beat, 'triangle', hz(root), hz(root), beat * 0.9, 0.35, 0.01);
      // Melody/arpeggio: skip the first bars so the song builds up.
      if (m.lead && b >= 2) {
        for (let i = 0; i < 8; i++) {
          if (rests[i]) continue;
          const n = chord[pattern[i]! % chord.length]! + 12;
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
export async function addGenerated(samples: Float32Array, name: string, start: number, opts: { volume?: number; fadeIn?: number; fadeOut?: number; role?: AudioRole } = {}) {
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
    p.audios.push({ id: itemId, assetId: id, start, in: 0, out: duration, volume: opts.volume ?? 1, fadeIn: opts.fadeIn ?? 0, fadeOut: opts.fadeOut ?? 0, ...(opts.role ? { role: opts.role } : {}) });
  });
  if (!saved) s.notify('No hay espacio para guardar el audio: podrás editarlo, pero no se guardará al cerrar.');
}
