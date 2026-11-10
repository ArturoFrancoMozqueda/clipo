// "Tendencia": original sounds in the styles short-form creators use right now (punchline hits,
// record scratches, risers, phonk cowbells, 808 slides, glitch stutters, cartoon and meme effects,
// money, notifications, ASMR, crowds). They are designed here from scratch with the layered tools in
// synth.ts: nothing is copied or imitated note for note from any recording, so they are free to use.
import type { Sfx } from './sound';
import { bell, bus, clap, filt, gate, hz, noiseLayer, oscLayer, pluck, type Build } from './synth';

type Ctx = BaseAudioContext;

// ---------- shared parts ----------

function click(c: Ctx, o: AudioNode, t: number, peak = 0.5, f = 3500, q = 0.8) {
  noiseLayer(c, o, t, [[0, 0], [0.001, peak], [0.02, 0]], { type: 'bandpass', freq: [[0, f], [0.02, f]], q });
}
function snare(c: Ctx, o: AudioNode, t: number, p = 1) {
  noiseLayer(c, o, t, [[0, 0], [0.002, p * 0.7], [0.18, 0]], { type: 'bandpass', freq: [[0, 1900], [0.18, 1500]], q: 0.8 });
  oscLayer(c, o, t, 'triangle', [[0, 230], [0.08, 160]], [[0, 0], [0.002, p * 0.4], [0.1, 0]]);
}
function hat(c: Ctx, o: AudioNode, t: number, p = 0.3, len = 0.04) {
  noiseLayer(c, o, t, [[0, 0], [0.001, p], [len, 0]], { type: 'highpass', freq: [[0, 7500], [len, 7500]], q: 0.7 });
}
function cowbell(c: Ctx, o: AudioNode, t: number, p = 0.6, ratio = 1, len = 0.4) {
  const f = filt(c, o, 'bandpass', 780 * ratio, 1.1);
  for (const x of [540, 800]) {
    oscLayer(c, f, t, 'square', [[0, x * ratio], [len, x * ratio]], [[0, 0], [0.002, p * 0.5], [0.06, p * 0.28], [len, 0]]);
  }
}
/** Sub bass with a pitch glide (808): `from`/`to` are semitones relative to `m`. */
function sub808(c: Ctx, o: AudioNode, t: number, m: number, len: number, p = 1, from = 0, to = 0) {
  oscLayer(c, o, t, 'sine', [[0, hz(m + from)], [0.05, hz(m + from)], [Math.min(len, 0.05 + len * 0.6), hz(m + to)], [len, hz(m + to)]], [[0, 0], [0.004, p], [len * 0.65, p * 0.7], [len, 0]]);
  click(c, o, t, p * 0.25, 1500);
}
function boom(c: Ctx, o: AudioNode, t: number, size = 1, p = 1) {
  oscLayer(c, o, t, 'sine', [[0, 110], [0.08, 60], [1.6 * size, 28]], [[0, 0], [0.004, p], [0.25, p * 0.75], [1.9 * size, 0]]);
  noiseLayer(c, o, t, [[0, 0], [0.003, p * 0.8], [0.08, p * 0.3], [1 * size, 0]], { type: 'lowpass', freq: [[0, 5000], [0.1, 1100], [1 * size, 120]], q: 0.5 });
}
function whoosh(c: Ctx, o: AudioNode, t: number, len: number, hit: number, low: number, high: number, p = 0.8, q = 1.3) {
  noiseLayer(c, o, t, [[0, 0], [hit * 0.6, p * 0.3], [hit, p], [hit + (len - hit) * 0.35, p * 0.3], [len, 0]], {
    type: 'bandpass', freq: [[0, low], [hit, high], [len, low * 1.4]], q,
  });
  noiseLayer(c, o, t, [[0, 0], [hit, p * 0.2], [len, 0]], { type: 'highpass', freq: [[0, 3000], [hit, 7500], [len, 4000]], q: 0.7 });
}
/** A short blip that falls in pitch: the base of pops, bonks and bubbles. */
function blip(c: Ctx, o: AudioNode, t: number, f0: number, f1: number, len: number, p = 0.6) {
  oscLayer(c, o, t, 'sine', [[0, f0], [len, f1]], [[0, 0], [0.003, p], [len, 0]]);
}

const sfx = (s: Omit<Sfx, 'premium' | 'trending'> & { build: Build }): Sfx => ({ ...s, premium: true, trending: true });

export const TRENDING_SFX: Sfx[] = [
  // ---------- Impactos: remates y golpes ----------
  sfx({
    id: 't-deep-hit', name: 'Impacto profundo', use: 'Remate de chiste, golpe de efecto', category: 'Impactos', seconds: 2.6, hit: 0,
    tags: 'boom remate punchline meme golpe grave', build: (c, o) => {
      const b = bus(c, o, { verb: 1.6, wet: 0.2, drive: 2 });
      boom(c, b, 0, 0.8);
      click(c, b, 0, 0.5, 2200);
    },
  }),
  sfx({
    id: 't-punchline', name: 'Golpe de remate', use: 'Justo después de decir algo fuerte', category: 'Impactos', seconds: 1.3, hit: 0,
    tags: 'punchline remate chiste golpe seco boom', build: (c, o) => {
      const b = bus(c, o, { verb: 0.9, wet: 0.15, drive: 2.5 });
      boom(c, b, 0, 0.45, 0.95);
      clap(c, b, 0, 0.5, 1800);
    },
  }),
  sfx({
    id: 't-meme-boom', name: 'Boom de meme', use: 'Sorpresa, “¡¿qué?!”', category: 'Impactos', seconds: 1.8, hit: 0,
    tags: 'meme boom vine sorpresa susto explosion', build: (c, o) => {
      const b = bus(c, o, { verb: 1.2, wet: 0.2, drive: 6 });
      oscLayer(c, b, 0, 'sine', [[0, 95], [0.1, 48], [1.4, 32]], [[0, 0], [0.003, 1], [0.35, 0.7], [1.5, 0]]);
      noiseLayer(c, b, 0, [[0, 0], [0.002, 0.8], [0.12, 0.25], [0.9, 0]], { type: 'lowpass', freq: [[0, 4000], [0.15, 700], [0.9, 150]] });
    },
  }),
  sfx({
    id: 't-808-hit', name: '808 seco', use: 'Golpe grave de trap', category: 'Impactos', seconds: 1.3, hit: 0,
    tags: '808 trap bajo grave sub', build: (c, o) => {
      const b = bus(c, o, { drive: 3, verb: 0.5, wet: 0.08 });
      sub808(c, b, 0, 36, 1, 1);
    },
  }),
  sfx({
    id: 't-808-slide', name: '808 que se desliza', use: 'Bajo de trap que cae', category: 'Impactos', seconds: 1.9, hit: 0,
    tags: '808 slide trap drill bajo glide desliza', build: (c, o) => {
      const b = bus(c, o, { drive: 3.5, verb: 0.6, wet: 0.08 });
      sub808(c, b, 0, 36, 1.6, 1, 12, -5);
    },
  }),
  sfx({
    id: 't-bass-drop', name: 'Drop con wub', use: 'Cuando entra el ritmo', category: 'Impactos', seconds: 3, hit: 0,
    tags: 'drop dubstep wub bajo caida ritmo beat', build: (c, o) => {
      const b = bus(c, o, { verb: 1.4, wet: 0.15, drive: 4 });
      boom(c, b, 0, 0.7, 0.9);
      oscLayer(c, b, 0, 'sawtooth', [[0, hz(31)], [2.2, hz(29)]], [[0, 0], [0.01, 0.55], [1.8, 0.4], [2.4, 0]], {
        voices: 2, spread: 10, lowpass: [[0, 900], [0.6, 400], [2.4, 200]], q: 4, vib: { rate: 3.5, depth: [[0, 0], [0.05, 8], [2.4, 4]] },
      });
    },
  }),
  sfx({
    id: 't-phonk-cowbell', name: 'Cowbell phonk', use: 'Videos de autos, actitud, edits', category: 'Impactos', seconds: 2.6, hit: 0,
    tags: 'phonk cowbell cencerro auto drift edit', build: (c, o) => {
      const b = bus(c, o, { verb: 0.9, wet: 0.14, drive: 2.2 });
      [[0, 1], [0.25, 1], [0.5, 0.89], [0.75, 1], [1, 1.19], [1.5, 1], [1.75, 0.89], [2, 1]].forEach(([t, r]) => cowbell(c, b, t!, 0.7, r!, 0.35));
    },
  }),
  sfx({
    id: 't-phonk-hit', name: 'Golpe phonk', use: 'Entrada de un edit oscuro', category: 'Impactos', seconds: 2, hit: 0,
    tags: 'phonk golpe cowbell 808 edit oscuro', build: (c, o) => {
      const b = bus(c, o, { verb: 1, wet: 0.15, drive: 3.5 });
      sub808(c, b, 0, 34, 1.5, 1, 7, 0);
      cowbell(c, b, 0, 0.7, 1, 0.5);
      cowbell(c, b, 0.25, 0.55, 1.19, 0.4);
      hat(c, b, 0.12, 0.3);
      clap(c, b, 0.5, 0.5);
    },
  }),

  // ---------- Cinemáticos: tensión y suspenso ----------
  sfx({
    id: 't-dun-dun-dun', name: 'Dun dun dun', use: 'Suspenso, “¡y entonces…!”', category: 'Cinemáticos', seconds: 4, hit: 0,
    tags: 'suspenso dun drama tres golpes misterio susto', build: (c, o) => {
      const b = bus(c, o, { verb: 3, wet: 0.4, drive: 2, tone: 3500 });
      [[0, 50, 1], [0.55, 50, 0.9], [1.1, 45, 1]].forEach(([t, m, p]) => {
        boom(c, b, t!, 0.5, p! * 0.75);
        for (const n of [m!, m! + 7, m! + 12]) {
          oscLayer(c, b, t!, 'sawtooth', [[0, hz(n)], [1.2, hz(n)]], [[0, 0], [0.02, 0.3 * p!], [0.35, 0.18], [1.2, 0]], { voices: 3, spread: 10, lowpass: [[0, 300], [0.04, 2600], [0.9, 400]] });
        }
      });
    },
  }),
  sfx({
    id: 't-braam-wide', name: 'Braam de película', use: 'Algo enorme se acerca', category: 'Cinemáticos', seconds: 5, hit: 0,
    tags: 'braam inception pelicula tension trailer enorme', build: (c, o) => {
      const b = bus(c, o, { verb: 3.5, wet: 0.4, drive: 3, tone: 2800 });
      for (const m of [29, 36, 41, 48]) {
        oscLayer(c, b, 0, 'sawtooth', [[0, hz(m) * 0.985], [0.2, hz(m)], [3.4, hz(m) * 0.97]], [[0, 0], [0.08, 0.5], [0.8, 0.42], [3.6, 0]], {
          voices: 4, spread: 16, lowpass: [[0, 120], [0.18, 1400], [0.8, 600], [3.6, 160]], q: 2.5,
        });
      }
      boom(c, b, 0, 0.9, 0.7);
    },
  }),
  sfx({
    id: 't-horror-stab', name: 'Susto', use: 'Película de terror, susto', category: 'Cinemáticos', seconds: 2, hit: 0,
    tags: 'susto terror horror cuerdas violines chillido miedo', build: (c, o) => {
      const b = bus(c, o, { verb: 2, wet: 0.35, drive: 2 });
      for (const [m, d] of [[88, 0], [89, 5], [94, -6]] as const) {
        oscLayer(c, b, 0, 'sawtooth', [[0, hz(m)], [1.3, hz(m) * 0.97]], [[0, 0], [0.015, 0.3], [0.5, 0.25], [1.4, 0]], {
          voices: 2, spread: 20 + d, lowpass: [[0, 6000], [1.4, 2500]], vib: { rate: 7, depth: [[0, 4], [1.4, 12]] },
        });
      }
      noiseLayer(c, b, 0, [[0, 0], [0.004, 0.4], [0.12, 0]], { type: 'highpass', freq: [[0, 3000], [0.12, 3000]] });
      boom(c, b, 0, 0.3, 0.5);
    },
  }),
  sfx({
    id: 't-riser-tension', name: 'Subida de tensión', use: 'Antes del momento clave', category: 'Cinemáticos', seconds: 4.4, hit: 3.6,
    tags: 'riser subida tension build up antes drop suspenso', build: (c, o) => {
      const b = bus(c, o, { verb: 1.6, wet: 0.2, tone: 8000 });
      noiseLayer(c, b, 0, [[0, 0], [2.5, 0.25], [3.55, 0.8], [3.6, 0]], { type: 'bandpass', freq: [[0, 250], [3.6, 9000]], q: 1.8 });
      for (const m of [45, 52]) {
        oscLayer(c, b, 0, 'sawtooth', [[0, hz(m)], [3.6, hz(m + 19)]], [[0, 0], [3.2, 0.2], [3.55, 0.28], [3.6, 0]], { voices: 3, lowpass: [[0, 300], [3.6, 7000]] });
      }
      // The bursts get faster and faster toward the top.
      const segs: [number, number][] = [];
      for (let t = 0, g = 0.45; t < 3.5; t += g, g = Math.max(0.05, g * 0.82)) segs.push([t, g * 0.6]);
      const g = gate(c, b, 0, segs);
      oscLayer(c, g, 0, 'square', [[0, 300], [3.6, 1800]], [[0, 0], [3.4, 0.12], [3.6, 0]], { lowpass: [[0, 800], [3.6, 5000]] });
    },
  }),
  sfx({
    id: 't-snare-roll', name: 'Redoble que sube', use: 'Cuenta hasta el momento clave', category: 'Cinemáticos', seconds: 4.6, hit: 3.2,
    tags: 'redoble tambor snare roll sube anuncio suspenso', build: (c, o) => {
      const b = bus(c, o, { verb: 1.2, wet: 0.2 });
      let t = 0;
      let gap = 0.22;
      while (t < 3.1) {
        snare(c, b, t, 0.25 + 0.55 * (t / 3.1));
        t += gap;
        gap = Math.max(0.035, gap * 0.88);
      }
      boom(c, b, 3.2, 0.5, 0.8);
      clap(c, b, 3.2, 0.6);
    },
  }),
  sfx({
    id: 't-reverse-cymbal', name: 'Platillo reverso', use: 'Entrada a un golpe o cambio de escena', category: 'Cinemáticos', seconds: 2.8, hit: 2.3,
    tags: 'platillo reverso reverse cymbal subida entrada', build: (c, o) => {
      const b = bus(c, o, { verb: 1.2, wet: 0.2 });
      noiseLayer(c, b, 0, [[0, 0], [1.1, 0.06], [1.8, 0.3], [2.25, 0.9], [2.3, 0]], { type: 'highpass', freq: [[0, 3000], [2.3, 9500]], q: 0.7 });
      noiseLayer(c, b, 0, [[0, 0], [2.0, 0.1], [2.3, 0.35], [2.32, 0]], { type: 'bandpass', freq: [[0, 5000], [2.3, 8000]], q: 0.8 });
      noiseLayer(c, b, 2.3, [[0, 0], [0.003, 0.5], [0.2, 0.12], [0.45, 0]], { type: 'highpass', freq: [[0, 6000], [0.45, 5000]] });
    },
  }),
  sfx({
    id: 't-mystery-drone', name: 'Misterio', use: 'Intriga, historias de misterio', category: 'Cinemáticos', seconds: 7,
    tags: 'misterio intriga drone zumbido oscuro true crime', build: (c, o) => {
      const b = bus(c, o, { verb: 3.5, wet: 0.5, tone: 3500 });
      for (const [m, d] of [[31, 0], [38, 5], [43, -4]] as const) {
        oscLayer(c, b, 0, 'sawtooth', [[0, hz(m)], [6.5, hz(m)]], [[0, 0], [2, 0.22], [4.5, 0.18], [6.5, 0]], {
          voices: 3, spread: 14 + d, lowpass: [[0, 200], [3, 700], [6.5, 250]], vib: { rate: 0.4, depth: [[0, 0.5], [6.5, 1.5]] },
        });
      }
      noiseLayer(c, b, 0, [[0, 0], [2.5, 0.07], [6.5, 0]], { type: 'bandpass', freq: [[0, 500], [3, 1500], [6.5, 400]], q: 2 });
      bell(c, b, 3.1, hz(82), 3, 0.1);
    },
  }),
  sfx({
    id: 't-heartbeat-fast', name: 'Latido acelerado', use: 'Nervios, persecución, susto', category: 'Cinemáticos', seconds: 4.2,
    tags: 'latido corazon nervios acelerado persecucion tension', build: (c, o) => {
      const b = bus(c, o, { verb: 1.2, wet: 0.2, drive: 1.6 });
      let t = 0;
      let period = 1;
      while (t < 3.6) {
        for (const [dt, p] of [[0, 1], [0.2 * period, 0.7]] as const) {
          oscLayer(c, b, t + dt, 'sine', [[0, 80], [0.14, 40]], [[0, 0], [0.008, p], [0.22, 0]], { lowpass: [[0, 300], [0.22, 300]] });
        }
        t += period;
        period = Math.max(0.45, period * 0.9);
      }
    },
  }),
  sfx({
    id: 't-choir', name: 'Coro celestial', use: 'Revelación emotiva, momento mágico', category: 'Cinemáticos', seconds: 6,
    tags: 'coro aah celestial angel emotivo final cielo', build: (c, o) => {
      const b = bus(c, o, { verb: 4, wet: 0.55, tone: 6000 });
      // Voice-like: detuned saws through two "ah" formant filters.
      const ah = filt(c, b, 'bandpass', 800, 4);
      const ah2 = filt(c, b, 'bandpass', 1200, 5);
      for (const m of [57, 64, 69, 72]) {
        for (const dest of [ah, ah2]) {
          oscLayer(c, dest, 0, 'sawtooth', [[0, hz(m)], [5.4, hz(m)]], [[0, 0], [1.5, 0.35], [4, 0.3], [5.4, 0]], { voices: 3, spread: 18, vib: { rate: 5, depth: [[0, 0], [1.5, 2.5], [5.4, 3]] } });
        }
      }
    },
  }),

  // ---------- Transiciones ----------
  sfx({
    id: 't-record-scratch', name: 'Disco rayado DJ', use: '¡Espera, qué! Pausa cómica', category: 'Transiciones', seconds: 1.3, hit: 0.55,
    tags: 'disco rayado scratch dj alto frena para espera', build: (c, o) => {
      const b = bus(c, o, { verb: 0.5, wet: 0.1, drive: 2 });
      // Hand moving the record forward and back: bands of noise sweeping up and down.
      const sweeps: [number, number, number, number][] = [[0, 0.16, 500, 3500], [0.16, 0.3, 3200, 700], [0.3, 0.43, 800, 4000], [0.43, 0.55, 3500, 400]];
      for (const [a, z, f0, f1] of sweeps) {
        noiseLayer(c, b, a, [[0, 0], [0.01, 0.8], [z - a - 0.01, 0.7], [z - a, 0]], { type: 'bandpass', freq: [[0, f0], [z - a, f1]], q: 4 });
        oscLayer(c, b, a, 'sawtooth', [[0, f0 / 6], [z - a, f1 / 6]], [[0, 0], [0.01, 0.12], [z - a, 0]], { lowpass: [[0, 2000], [z - a, 2000]] });
      }
      noiseLayer(c, b, 0.55, [[0, 0], [0.01, 0.5], [0.6, 0]], { type: 'bandpass', freq: [[0, 2500], [0.6, 180]], q: 3 });
    },
  }),
  sfx({
    id: 't-record-stop', name: 'Disco que se frena', use: 'Todo se detiene', category: 'Transiciones', seconds: 1.7, hit: 0,
    tags: 'disco frena stop vinilo cinta lento detener', build: (c, o) => {
      const b = bus(c, o, { verb: 0.6, wet: 0.1, drive: 1.5 });
      for (const m of [60, 64, 67]) {
        oscLayer(c, b, 0, 'sawtooth', [[0, hz(m)], [1.1, hz(m) / 10]], [[0, 0], [0.02, 0.22], [0.8, 0.18], [1.2, 0]], { voices: 2, lowpass: [[0, 3500], [1.2, 120]] });
      }
      noiseLayer(c, b, 0, [[0, 0], [0.02, 0.18], [1.1, 0]], { type: 'bandpass', freq: [[0, 4000], [1.1, 200]], q: 1.5 });
    },
  }),
  sfx({
    id: 't-rewind', name: 'Rebobinado rápido', use: 'Volver atrás en el tiempo', category: 'Transiciones', seconds: 1.8, hit: 1.5,
    tags: 'rebobinar rewind atras tiempo cinta rapido', build: (c, o, r) => {
      const b = bus(c, o, { verb: 0.7, wet: 0.12 });
      noiseLayer(c, b, 0, [[0, 0], [0.1, 0.45], [1.4, 0.45], [1.5, 0]], { type: 'bandpass', freq: [[0, 600], [1.4, 3800]], q: 2.5 });
      for (let i = 0; i < 24; i++) {
        const t = i * 0.058;
        oscLayer(c, b, t, 'sawtooth', [[0, hz(80 + Math.floor(r() * 10))], [0.05, hz(66)]], [[0, 0], [0.004, 0.1], [0.05, 0]], { lowpass: [[0, 3000], [0.05, 3000]] });
      }
      click(c, b, 1.5, 0.5, 1800);
    },
  }),
  sfx({
    id: 't-glitch-stutter', name: 'Tartamudeo glitch', use: 'Falla digital, edit rápido', category: 'Transiciones', seconds: 1.5, hit: 0.1,
    tags: 'glitch tartamudeo stutter falla digital tecnologia error', build: (c, o, r) => {
      const b = bus(c, o, { verb: 0.4, wet: 0.1, drive: 5 });
      const segs: [number, number][] = [];
      for (let t = 0, g = 0.16; t < 1.25; t += g * 1.35, g = Math.max(0.025, g * 0.78)) segs.push([t, g]);
      const gt = gate(c, b, 0, segs);
      oscLayer(c, gt, 0, 'square', [[0, 440], [1.3, 880]], [[0, 0], [0.005, 0.25], [1.3, 0.25]], { lowpass: [[0, 2500], [1.3, 2500]] });
      oscLayer(c, gt, 0, 'sawtooth', [[0, 110], [1.3, 110]], [[0, 0], [0.005, 0.3], [1.3, 0.3]]);
      for (let i = 0; i < 6; i++) click(c, b, 0.2 + i * 0.2 + r() * 0.05, 0.35, 1500 + r() * 5000, 4);
    },
  }),
  sfx({
    id: 't-whoosh-air', name: 'Whoosh de aire', use: 'Cambio de escena limpio', category: 'Transiciones', seconds: 1.1, hit: 0.3,
    tags: 'whoosh aire viento cambio escena pase rapido', build: (c, o) => whoosh(c, bus(c, o, { verb: 0.8, wet: 0.14, tone: 7000 }), 0, 0.7, 0.3, 500, 4200, 0.85, 1.1),
  }),
  sfx({
    id: 't-whoosh-double', name: 'Whoosh doble', use: 'Dos cortes seguidos', category: 'Transiciones', seconds: 1.4, hit: 0.62,
    tags: 'whoosh doble dos pase rapido cortes', build: (c, o) => {
      const b = bus(c, o, { verb: 0.9, wet: 0.15, tone: 7000 });
      whoosh(c, b, 0, 0.45, 0.2, 700, 4500, 0.55, 1.1);
      whoosh(c, b, 0.38, 0.8, 0.24, 350, 3200, 0.9, 1.3);
    },
  }),
  sfx({
    id: 't-whoosh-cine', name: 'Whoosh cinematográfico', use: 'Cambio épico con peso', category: 'Transiciones', seconds: 2.4, hit: 0.95,
    tags: 'whoosh cinematico epico pesado trailer', build: (c, o) => {
      const b = bus(c, o, { verb: 2.2, wet: 0.3, drive: 1.6, tone: 5000 });
      whoosh(c, b, 0, 1.5, 0.95, 160, 1800, 0.95, 1.6);
      oscLayer(c, b, 0, 'sine', [[0, 140], [0.95, 70], [1.5, 40]], [[0, 0], [0.95, 0.5], [1.5, 0]]);
      boom(c, b, 0.95, 0.35, 0.45);
    },
  }),
  sfx({
    id: 't-swoosh-up', name: 'Barrido hacia arriba', use: 'Algo sube o aparece', category: 'Transiciones', seconds: 1.3, hit: 1,
    tags: 'barrido arriba sube whoosh subida aparece', build: (c, o) => {
      const b = bus(c, o, { verb: 0.8, wet: 0.15, tone: 9000 });
      noiseLayer(c, b, 0, [[0, 0], [0.9, 0.7], [1, 0.9], [1.02, 0]], { type: 'bandpass', freq: [[0, 400], [1, 8000]], q: 2 });
      oscLayer(c, b, 0, 'sine', [[0, 300], [1, 1800]], [[0, 0], [0.9, 0.12], [1, 0.16], [1.02, 0]]);
    },
  }),
  sfx({
    id: 't-swoosh-down', name: 'Barrido hacia abajo', use: 'Algo baja o desaparece', category: 'Transiciones', seconds: 1.3, hit: 0,
    tags: 'barrido abajo baja whoosh cae desaparece', build: (c, o) => {
      const b = bus(c, o, { verb: 0.8, wet: 0.15, tone: 9000 });
      noiseLayer(c, b, 0, [[0, 0], [0.02, 0.9], [0.9, 0.2], [1.1, 0]], { type: 'bandpass', freq: [[0, 7500], [1.1, 300]], q: 2 });
      oscLayer(c, b, 0, 'sine', [[0, 1600], [1.1, 250]], [[0, 0], [0.02, 0.16], [1.1, 0]]);
    },
  }),
  sfx({
    id: 't-whip', name: 'Latigazo', use: 'Movimiento de cámara brusco', category: 'Transiciones', seconds: 0.7, hit: 0.12,
    tags: 'latigazo whip crack rapido golpe aire brusco', build: (c, o) => {
      const b = bus(c, o, { verb: 0.5, wet: 0.1 });
      whoosh(c, b, 0, 0.3, 0.12, 900, 6500, 0.7, 1);
      click(c, b, 0.12, 0.8, 4500, 1.5);
    },
  }),

  // ---------- Cómicos ----------
  sfx({
    id: 't-fail-tuba', name: 'Fail descendente', use: 'Fracaso, “no salió bien”', category: 'Cómicos', seconds: 2.8,
    tags: 'fail fracaso triste tuba trombon cae error comico perder', build: (c, o) => {
      const b = bus(c, o, { verb: 0.8, wet: 0.12 });
      [[0, 55], [0.4, 53], [0.8, 51], [1.2, 48]].forEach(([t, m], i) => {
        const len = i === 3 ? 1.3 : 0.36;
        oscLayer(c, b, t!, 'sawtooth', [[0, hz(m!)], [len, hz(m!) * (i === 3 ? 0.9 : 1)]], [[0, 0], [0.03, 0.4], [len * 0.7, 0.35], [len, 0]], {
          lowpass: [[0, 500], [0.1, 1400], [len, 400]], q: 3, vib: i === 3 ? { rate: 5.5, depth: [[0, 0], [0.5, 5], [len, 8]] } : undefined,
        });
      });
    },
  }),
  sfx({
    id: 't-spring', name: 'Resorte', use: 'Algo rebota, humor', category: 'Cómicos', seconds: 1.2,
    tags: 'resorte boing rebote salta comico caricatura muelle', build: (c, o) => {
      const b = bus(c, o, { verb: 0.5, wet: 0.1 });
      oscLayer(c, b, 0, 'triangle', [[0, 220], [0.05, 520], [0.9, 300]], [[0, 0], [0.01, 0.7], [0.9, 0]], { vib: { rate: 24, depth: [[0, 90], [0.9, 8]] }, lowpass: [[0, 2500], [0.9, 1500]] });
    },
  }),
  sfx({
    id: 't-whistle-up', name: 'Silbato cómico sube', use: 'Algo sube, sorpresa', category: 'Cómicos', seconds: 1.1,
    tags: 'silbato sube slide whistle comico caricatura', build: (c, o) => {
      const b = bus(c, o, { verb: 0.6, wet: 0.12 });
      oscLayer(c, b, 0, 'sine', [[0, 500], [0.9, 2300]], [[0, 0], [0.04, 0.5], [0.85, 0.45], [0.95, 0]], { vib: { rate: 7, depth: [[0, 8], [0.9, 30]] } });
    },
  }),
  sfx({
    id: 't-whistle-down', name: 'Silbato cómico baja', use: 'Algo cae, decepción', category: 'Cómicos', seconds: 1.3,
    tags: 'silbato baja cae slide whistle comico caricatura', build: (c, o) => {
      const b = bus(c, o, { verb: 0.6, wet: 0.12 });
      oscLayer(c, b, 0, 'sine', [[0, 2300], [1.1, 380]], [[0, 0], [0.04, 0.5], [1, 0.4], [1.15, 0]], { vib: { rate: 7, depth: [[0, 30], [1.1, 8]] } });
    },
  }),
  sfx({
    id: 't-cartoon-pop', name: 'Pop de caricatura', use: 'Aparece un personaje o sticker', category: 'Cómicos', seconds: 0.4,
    tags: 'pop caricatura burbuja aparece sticker globo', build: (c, o) => {
      const b = bus(c, o, { verb: 0.4, wet: 0.1 });
      blip(c, b, 0, 1100, 260, 0.1, 0.8);
      click(c, b, 0, 0.3, 4000);
    },
  }),
  sfx({
    id: 't-bonk', name: 'Bonk', use: 'Golpe en la cabeza, error tonto', category: 'Cómicos', seconds: 0.9, hit: 0,
    tags: 'bonk golpe cabeza madera comico caricatura toc', build: (c, o) => {
      const b = bus(c, o, { verb: 0.5, wet: 0.1 });
      blip(c, b, 0, 330, 180, 0.22, 0.9);
      oscLayer(c, b, 0, 'triangle', [[0, 880], [0.12, 520]], [[0, 0], [0.002, 0.4], [0.12, 0]], { lowpass: [[0, 2500], [0.12, 1500]] });
      click(c, b, 0, 0.5, 1800, 1.5);
    },
  }),
  sfx({
    id: 't-cartoon-run', name: 'Correr de caricatura', use: 'Salir corriendo', category: 'Cómicos', seconds: 1.9,
    tags: 'correr huir caricatura escapar rapido pasos comico', build: (c, o) => {
      const b = bus(c, o, { verb: 0.6, wet: 0.1 });
      for (let i = 0; i < 18; i++) {
        const t = i * 0.075;
        blip(c, b, t, 500 + i * 70, 300 + i * 70, 0.05, 0.4);
        click(c, b, t, 0.18, 2500);
      }
      whoosh(c, b, 1.4, 0.5, 0.15, 800, 5000, 0.5);
    },
  }),
  sfx({
    id: 't-sad-violin', name: 'Violín triste', use: 'Drama exagerado, “qué pena”', category: 'Cómicos', seconds: 4,
    tags: 'violin triste drama pena llorar sad comico telenovela', build: (c, o) => {
      const b = bus(c, o, { verb: 2.2, wet: 0.3 });
      [[0, 76, 1], [1.1, 74, 0.9], [2.2, 71, 1.6]].forEach(([t, m, len]) => {
        oscLayer(c, b, t!, 'sawtooth', [[0, hz(m!) * 0.98], [0.25, hz(m!)], [len!, hz(m!)]], [[0, 0], [0.25, 0.3], [len! * 0.8, 0.25], [len!, 0]], {
          voices: 2, spread: 8, lowpass: [[0, 2500], [len!, 1800]], vib: { rate: 5.5, depth: [[0, 0], [0.4, 5], [len!, 7]] },
        });
      });
    },
  }),

  // ---------- Reacciones ----------
  sfx({
    id: 't-ding-right', name: 'Ding de acierto', use: 'Respuesta correcta, buena idea', category: 'Reacciones', seconds: 1.6,
    tags: 'ding correcto acierto bien campana quiz concurso', build: (c, o) => {
      const b = bus(c, o, { verb: 1.2, wet: 0.25, tone: 9000 });
      bell(c, b, 0, hz(88), 1.3, 0.55);
      bell(c, b, 0.1, hz(95), 1.3, 0.5);
    },
  }),
  sfx({
    id: 't-buzzer', name: 'Zumbido de error', use: 'Respuesta incorrecta', category: 'Reacciones', seconds: 1.1,
    tags: 'error incorrecto mal buzzer zumbido equivocado quiz', build: (c, o) => {
      const b = bus(c, o, { verb: 0.4, wet: 0.08, drive: 3 });
      for (const f of [110, 116]) oscLayer(c, b, 0, 'sawtooth', [[0, f], [0.8, f]], [[0, 0], [0.01, 0.4], [0.7, 0.4], [0.8, 0]], { lowpass: [[0, 1800], [0.8, 1800]] });
      oscLayer(c, b, 0, 'square', [[0, 220], [0.8, 220]], [[0, 0], [0.01, 0.12], [0.7, 0.12], [0.8, 0]], { lowpass: [[0, 1500], [0.8, 1500]] });
    },
  }),
  sfx({
    id: 't-applause-big', name: 'Aplauso grande', use: 'Celebración, final de un logro', category: 'Reacciones', seconds: 4.2,
    tags: 'aplauso aplausos publico gente celebracion clap ovacion', build: (c, o, r) => {
      const b = bus(c, o, { verb: 1.8, wet: 0.3 });
      noiseLayer(c, b, 0, [[0, 0], [0.4, 0.2], [2.8, 0.18], [4, 0]], { type: 'bandpass', freq: [[0, 1800], [4, 1500]], q: 0.6 });
      for (let i = 0; i < 260; i++) {
        const t = r() * 3.8;
        const swell = Math.min(1, t / 0.5) * (1 - Math.max(0, t - 2.8) / 1.1);
        clap(c, b, t, 0.1 + r() * 0.3 * swell, 900 + r() * 1800);
      }
    },
  }),
  sfx({
    id: 't-applause-short', name: 'Aplauso corto', use: 'Reconocimiento rápido', category: 'Reacciones', seconds: 2,
    tags: 'aplauso corto clap gente bien hecho', build: (c, o, r) => {
      const b = bus(c, o, { verb: 1.2, wet: 0.25 });
      noiseLayer(c, b, 0, [[0, 0], [0.2, 0.18], [1.2, 0.14], [1.8, 0]], { type: 'bandpass', freq: [[0, 1800], [1.8, 1500]], q: 0.6 });
      for (let i = 0; i < 90; i++) clap(c, b, r() * 1.5, 0.1 + r() * 0.3, 900 + r() * 1800);
    },
  }),
  sfx({
    id: 't-wow', name: 'Ohhh de sorpresa', use: 'Dato increíble, asombro', category: 'Reacciones', seconds: 2.4,
    tags: 'wow ohh sorpresa asombro publico gente increible', build: (c, o) => {
      const b = bus(c, o, { verb: 1.6, wet: 0.3 });
      // A small crowd saying "ooh": detuned saws through a dark vowel filter that opens and closes.
      const oh = filt(c, b, 'bandpass', 450, 3.5);
      const oh2 = filt(c, b, 'bandpass', 800, 4);
      for (const [m, d] of [[55, -8], [58, 0], [62, 6], [67, 10]] as const) {
        for (const dest of [oh, oh2]) {
          oscLayer(c, dest, 0, 'sawtooth', [[0, hz(m - 2)], [0.4, hz(m)], [1.9, hz(m - 1)]], [[0, 0], [0.4, 0.3], [1.3, 0.25], [1.9, 0]], { voices: 3, spread: 22 + d, vib: { rate: 5, depth: [[0, 0], [0.5, 3], [1.9, 3]] } });
        }
      }
    },
  }),

  // ---------- Interfaz ----------
  sfx({
    id: 't-message', name: 'Mensaje nuevo', use: 'Llega un chat o aviso', category: 'Interfaz', seconds: 1.1,
    tags: 'mensaje chat notificacion aviso whatsapp mensajes nuevo llega', build: (c, o) => {
      const b = bus(c, o, { verb: 0.8, wet: 0.2, tone: 8000 });
      bell(c, b, 0, hz(91), 0.5, 0.45, 0.7);
      bell(c, b, 0.11, hz(96), 0.7, 0.45, 0.7);
    },
  }),
  sfx({
    id: 't-sent', name: 'Mensaje enviado', use: 'Se manda un mensaje', category: 'Interfaz', seconds: 0.8,
    tags: 'enviado enviar mensaje send swoosh sube', build: (c, o) => {
      const b = bus(c, o, { verb: 0.5, wet: 0.12 });
      noiseLayer(c, b, 0, [[0, 0], [0.12, 0.35], [0.2, 0]], { type: 'bandpass', freq: [[0, 1200], [0.2, 6000]], q: 1.5 });
      blip(c, b, 0.12, 700, 1300, 0.12, 0.5);
    },
  }),
  sfx({
    id: 't-typing-fast', name: 'Escribiendo rápido', use: 'Texto que se escribe solo', category: 'Interfaz', seconds: 2.2,
    tags: 'teclado escribir tipear typing texto computadora rapido', build: (c, o, r) => {
      const b = bus(c, o, { verb: 0.4, wet: 0.08 });
      let t = 0.02;
      while (t < 1.9) {
        click(c, b, t, 0.35 + r() * 0.25, 2200 + r() * 1800, 1.2);
        blip(c, b, t, 260 + r() * 80, 150, 0.04, 0.25);
        t += 0.05 + r() * 0.09 + (r() < 0.12 ? 0.12 : 0);
      }
    },
  }),
  sfx({
    id: 't-text-in', name: 'Texto aparece', use: 'Entra un título o subtítulo', category: 'Interfaz', seconds: 0.7,
    tags: 'texto titulo aparece pop entrada letras subtitulo', build: (c, o) => {
      const b = bus(c, o, { verb: 0.5, wet: 0.12 });
      whoosh(c, b, 0, 0.22, 0.14, 1500, 6000, 0.35, 1);
      blip(c, b, 0.14, 500, 1000, 0.1, 0.5);
      click(c, b, 0.14, 0.3, 4500);
    },
  }),
  sfx({
    id: 't-text-bounce', name: 'Texto con rebote', use: 'Palabra que salta en pantalla', category: 'Interfaz', seconds: 0.9,
    tags: 'texto rebote bounce salta palabra pop elastico', build: (c, o) => {
      const b = bus(c, o, { verb: 0.5, wet: 0.12 });
      blip(c, b, 0, 350, 1100, 0.1, 0.55);
      blip(c, b, 0.14, 500, 1250, 0.08, 0.4);
      blip(c, b, 0.26, 700, 1500, 0.06, 0.28);
    },
  }),
  sfx({
    id: 't-caption-ticks', name: 'Palabra por palabra', use: 'Subtítulos que aparecen uno a uno', category: 'Interfaz', seconds: 2,
    tags: 'subtitulos palabras captions tick karaoke uno a uno', build: (c, o, r) => {
      const b = bus(c, o, { verb: 0.4, wet: 0.1 });
      for (let i = 0; i < 6; i++) {
        const t = i * 0.28;
        blip(c, b, t, 900 + (i % 3) * 120, 600 + (i % 3) * 80, 0.06, 0.4);
        click(c, b, t, 0.2 + r() * 0.1, 4500);
      }
    },
  }),
  sfx({
    id: 't-shutter', name: 'Obturador de cámara', use: 'Foto, captura, congelar imagen', category: 'Interfaz', seconds: 0.7, hit: 0,
    tags: 'camara foto obturador shutter captura click flash', build: (c, o) => {
      const b = bus(c, o, { verb: 0.6, wet: 0.12 });
      click(c, b, 0, 0.8, 2800, 1.2);
      blip(c, b, 0, 170, 90, 0.07, 0.5);
      click(c, b, 0.07, 0.6, 1800, 1.2);
      blip(c, b, 0.07, 140, 80, 0.06, 0.35);
    },
  }),

  // ---------- Tiempo y dinero ----------
  sfx({
    id: 't-ka-ching', name: 'Ka-ching', use: 'Ganancia, venta, “dinero”', category: 'Tiempo y dinero', seconds: 2.6, hit: 0.14,
    tags: 'dinero ka-ching caja registradora venta ganancia cobrar plata billete', build: (c, o, r) => {
      const b = bus(c, o, { verb: 1.4, wet: 0.25, tone: 10000 });
      // The drawer: a mechanical clunk and a rattle, then the bell and coins.
      noiseLayer(c, b, 0, [[0, 0], [0.004, 0.5], [0.12, 0]], { type: 'bandpass', freq: [[0, 900], [0.12, 500]], q: 1.2 });
      blip(c, b, 0, 220, 110, 0.1, 0.5);
      bell(c, b, 0.14, hz(96), 2, 0.5, 1.2);
      bell(c, b, 0.14, hz(103), 1.4, 0.25);
      for (let i = 0; i < 7; i++) bell(c, b, 0.26 + r() * 0.3, hz(97 + Math.floor(r() * 8)), 0.22, 0.1);
    },
  }),
  sfx({
    id: 't-coins', name: 'Lluvia de monedas', use: 'Premio, mucho dinero', category: 'Tiempo y dinero', seconds: 2.8,
    tags: 'monedas dinero lluvia premio jackpot oro tesoro', build: (c, o, r) => {
      const b = bus(c, o, { verb: 1.6, wet: 0.3, tone: 10000 });
      for (let i = 0; i < 42; i++) {
        const t = r() * 1.9;
        const f = hz(93 + Math.floor(r() * 9));
        bell(c, b, t, f, 0.18 + r() * 0.12, 0.06 + r() * 0.08 * (1 - t / 2.2));
        click(c, b, t, 0.08, 6000, 2);
      }
    },
  }),
  sfx({
    id: 't-countdown', name: 'Cuenta atrás 3-2-1', use: 'Antes de empezar, “¡ya!”', category: 'Tiempo y dinero', seconds: 4.6, hit: 3,
    tags: 'cuenta regresiva atras 3 2 1 beep comienzo inicio carrera', build: (c, o) => {
      const b = bus(c, o, { verb: 1, wet: 0.15, tone: 8000 });
      for (const t of [0, 1, 2]) {
        oscLayer(c, b, t, 'sine', [[0, 880], [0.2, 880]], [[0, 0], [0.005, 0.55], [0.15, 0.5], [0.2, 0]]);
        click(c, b, t, 0.2, 5000);
      }
      oscLayer(c, b, 3, 'sine', [[0, 1760], [0.9, 1760]], [[0, 0], [0.005, 0.6], [0.7, 0.45], [0.9, 0]]);
      oscLayer(c, b, 3, 'sine', [[0, 880], [0.9, 880]], [[0, 0], [0.005, 0.3], [0.9, 0]]);
    },
  }),
  sfx({
    id: 't-wall-clock', name: 'Reloj de pared', use: 'El tiempo pasa, espera', category: 'Tiempo y dinero', seconds: 4.2,
    tags: 'reloj pared tictac tiempo espera segundos tic tac', build: (c, o) => {
      const b = bus(c, o, { verb: 1.4, wet: 0.25 });
      for (let i = 0; i < 8; i++) {
        const tock = i % 2;
        click(c, b, i * 0.5, 0.45, tock ? 1600 : 2200, 2);
        blip(c, b, i * 0.5, tock ? 520 : 700, tock ? 380 : 520, 0.05, 0.3);
      }
    },
  }),
  sfx({
    id: 't-timer', name: 'Temporizador', use: 'Se acabó el tiempo', category: 'Tiempo y dinero', seconds: 2.6,
    tags: 'temporizador timer alarma cocina tiempo terminado aviso', build: (c, o) => {
      const b = bus(c, o, { verb: 1, wet: 0.2, tone: 9000 });
      for (const t of [0, 0.6, 1.2]) {
        bell(c, b, t, hz(91), 0.55, 0.45, 0.8);
        bell(c, b, t + 0.14, hz(91), 0.45, 0.35, 0.8);
      }
    },
  }),

  // ---------- Ciencia ficción y magia ----------
  sfx({
    id: 't-shimmer', name: 'Brillo mágico', use: 'Aparece algo especial', category: 'Ciencia ficción y magia', seconds: 3.4,
    tags: 'brillo magia magico estrellas destello hada polvo shimmer', build: (c, o, r) => {
      const b = bus(c, o, { verb: 3, wet: 0.5, tone: 10000 });
      for (let i = 0; i < 18; i++) bell(c, b, i * 0.06 + r() * 0.03, hz(84 + [0, 4, 7, 12, 16, 19][i % 6]!), 0.9, 0.14);
      noiseLayer(c, b, 0, [[0, 0], [0.6, 0.1], [2.4, 0]], { type: 'highpass', freq: [[0, 7000], [2.4, 9500]] });
    },
  }),
  sfx({
    id: 't-harp-up', name: 'Arpa que sube', use: 'Sueño, transformación, flashback', category: 'Ciencia ficción y magia', seconds: 3,
    tags: 'arpa sube sueno flashback transformacion magia glissando', build: (c, o) => {
      const b = bus(c, o, { verb: 2.4, wet: 0.4, tone: 8000 });
      [60, 64, 67, 71, 72, 76, 79, 83, 84, 88].forEach((m, i) => pluck(c, b, i * 0.07, hz(m + 12), 1.4, 0.35, 0.8));
    },
  }),
  sfx({
    id: 't-power-up', name: 'Power up', use: 'Nivel nuevo, súper poder', category: 'Juegos', seconds: 1.4,
    tags: 'power up poder nivel juego sube energia mejora', build: (c, o) => {
      const b = bus(c, o, { verb: 0.8, wet: 0.15 });
      [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => oscLayer(c, b, i * 0.065, 'square', [[0, hz(m)], [0.1, hz(m)]], [[0, 0], [0.004, 0.2], [0.1, 0]], { lowpass: [[0, 4000], [0.1, 4000]] }));
      oscLayer(c, b, 0.45, 'square', [[0, hz(84)], [0.5, hz(84)]], [[0, 0], [0.005, 0.22], [0.5, 0]], { lowpass: [[0, 4000], [0.5, 2500]], vib: { rate: 6, depth: [[0, 0], [0.5, 10]] } });
    },
  }),
  sfx({
    id: 't-fanfare', name: 'Fanfarria', use: 'Ganaste, gran anuncio', category: 'Juegos', seconds: 3.2,
    tags: 'fanfarria victoria ganar trompetas anuncio ganaste celebrar', build: (c, o) => {
      const b = bus(c, o, { verb: 2.2, wet: 0.3, tone: 7000 });
      const brass = (t: number, notes: number[], len: number, p: number) => notes.forEach((m) => oscLayer(c, b, t, 'sawtooth', [[0, hz(m)], [len, hz(m)]], [[0, 0], [0.04, p], [len * 0.7, p * 0.8], [len, 0]], { voices: 2, spread: 8, lowpass: [[0, 800], [0.08, 3000], [len, 1200]] }));
      brass(0, [60, 64, 67], 0.22, 0.2);
      brass(0.25, [60, 64, 67], 0.22, 0.2);
      brass(0.5, [62, 65, 69], 0.3, 0.2);
      brass(0.85, [64, 67, 72], 1.9, 0.26);
      boom(c, b, 0.85, 0.3, 0.4);
      [88, 91, 95].forEach((m, i) => bell(c, b, 0.9 + i * 0.05, hz(m), 1.5, 0.12));
    },
  }),

  // ---------- Ambiente ----------
  sfx({
    id: 't-vinyl', name: 'Vinilo', use: 'Aire retro, nostalgia, lo-fi', category: 'Ambiente', seconds: 6,
    tags: 'vinilo crackle polvo retro lofi nostalgia disco viejo', build: (c, o, r) => {
      const b = bus(c, o, { verb: 0.4, wet: 0.08 });
      noiseLayer(c, b, 0, [[0, 0], [0.3, 0.05], [5.6, 0.05], [5.9, 0]], { type: 'bandpass', freq: [[0, 3500], [5.9, 3500]], q: 0.5 });
      for (let i = 0; i < 90; i++) click(c, b, r() * 5.7, 0.08 + r() * 0.35, 1500 + r() * 6000, 1);
    },
  }),
  sfx({
    id: 't-asmr-taps', name: 'Toques ASMR', use: 'Videos relajantes, productos', category: 'Ambiente', seconds: 3.2,
    tags: 'asmr toques taps golpecitos uñas relajante suave madera', build: (c, o, r) => {
      const b = bus(c, o, { verb: 0.7, wet: 0.15 });
      for (let i = 0; i < 12; i++) {
        const t = i * 0.22 + r() * 0.05;
        const f = 900 + r() * 500;
        click(c, b, t, 0.35, f * 2.5, 2.5);
        blip(c, b, t, f, f * 0.7, 0.05, 0.3);
      }
    },
  }),
  sfx({
    id: 't-asmr-brush', name: 'Cepillo suave', use: 'Textura relajante, ASMR', category: 'Ambiente', seconds: 3.6,
    tags: 'asmr cepillo brush suave textura relajante frotar maquillaje', build: (c, o) => {
      const b = bus(c, o, { verb: 0.6, wet: 0.12 });
      for (let i = 0; i < 4; i++) {
        const t = i * 0.85;
        noiseLayer(c, b, t, [[0, 0], [0.35, 0.3], [0.7, 0]], { type: 'bandpass', freq: [[0, 3000 + i * 300], [0.35, 5200], [0.7, 3200]], q: 0.9 });
      }
    },
  }),
  sfx({
    id: 't-asmr-clicks', name: 'Clics ASMR', use: 'Botones, plumas, cierres', category: 'Ambiente', seconds: 2.4,
    tags: 'asmr clic click boton pluma cierre mecanico satisfactorio', build: (c, o) => {
      const b = bus(c, o, { verb: 0.5, wet: 0.1 });
      for (let i = 0; i < 6; i++) {
        const t = i * 0.36;
        click(c, b, t, 0.55, 3200, 2);
        click(c, b, t + 0.045, 0.4, 1800, 2);
        blip(c, b, t, 700, 420, 0.03, 0.2);
      }
    },
  }),
];
