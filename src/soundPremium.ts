// Premium sound pack: effects designed like a sound studio does them, made on the device.
// Each one is built from several layers (sub, body, air, transient), glued with saturation and
// a reverb tail, then mastered to the same peak, so they sound full and consistent next to each other.
// Everything is synthesized from scratch: no licenses, no attribution, works offline.
import type { Sfx } from './sound';
import type { TransitionId } from './types';
import { bell, bus, hz, noiseLayer, oscLayer, tone, type Build } from './synth';

type Ctx = BaseAudioContext;

// ---------- layers shared by several sounds ----------

/** Air rushing past: a band of noise that swells up to `hit` and falls away, sweeping up then back down. */
function whoosh(c: Ctx, o: AudioNode, t: number, len: number, hit: number, low: number, high: number, peak = 0.8, q = 1.4) {
  noiseLayer(c, o, t, [[0, 0], [hit * 0.6, peak * 0.3], [hit, peak], [hit + (len - hit) * 0.35, peak * 0.3], [len, 0]], {
    type: 'bandpass', freq: [[0, low], [hit, high], [len, low * 1.4]], q,
  });
  // Thin high layer: the "texture" that makes it sound expensive instead of like plain noise.
  noiseLayer(c, o, t, [[0, 0], [hit, peak * 0.22], [len, 0]], { type: 'highpass', freq: [[0, 3000], [hit, 7500], [len, 4000]], q: 0.7 });
}

/** Low body under a whoosh: a soft sine that dips in pitch as it passes. */
function whooshBody(c: Ctx, o: AudioNode, t: number, len: number, hit: number, peak = 0.3) {
  oscLayer(c, o, t, 'sine', [[0, 150], [hit, 90], [len, 55]], [[0, 0], [hit, peak], [len, 0]]);
}

/** Short click that gives a hit its definition. */
function transient(c: Ctx, o: AudioNode, t: number, peak = 0.6, f = 3500) {
  noiseLayer(c, o, t, [[0, 0], [0.001, peak], [0.025, 0]], { type: 'bandpass', freq: [[0, f], [0.025, f]], q: 0.8 });
}

/** Cinematic low hit: sub drop, punchy body and a dark noise burst. `size` stretches the tail. */
function boom(c: Ctx, o: AudioNode, t: number, size = 1, peak = 1) {
  oscLayer(c, o, t, 'sine', [[0, 110], [0.08, 62], [1.8 * size, 28]], [[0, 0], [0.004, peak], [0.25, peak * 0.75], [2.2 * size, 0]]);
  oscLayer(c, o, t, 'triangle', [[0, 220], [0.12, 70]], [[0, 0], [0.002, peak * 0.5], [0.25, 0]]);
  noiseLayer(c, o, t, [[0, 0], [0.003, peak * 0.9], [0.08, peak * 0.35], [1.2 * size, 0]], {
    type: 'lowpass', freq: [[0, 5000], [0.1, 1200], [1.2 * size, 120]], q: 0.5,
  });
}

/** Metallic clang (anvil, trailer hit): two slightly detuned bells beat against each other. */
function metal(c: Ctx, o: AudioNode, t: number, f: number, dur: number, peak: number) {
  bell(c, o, t, f, dur, peak, 1.4);
  bell(c, o, t, f * 1.007, dur * 0.8, peak * 0.6);
}

/** A swell that grows toward `len` and stops dead (reversed cymbal). */
function reverseSwell(c: Ctx, o: AudioNode, t: number, len: number, peak = 0.8) {
  noiseLayer(c, o, t, [[0, 0], [len * 0.5, peak * 0.07], [len * 0.78, peak * 0.3], [len * 0.97, peak], [len, 0]], {
    type: 'highpass', freq: [[0, 2500], [len, 9000]], q: 0.7,
  });
  for (const m of [69, 76]) oscLayer(c, o, t, 'sine', [[0, hz(m)], [len, hz(m)]], [[0, 0], [len * 0.7, peak * 0.05], [len * 0.97, peak * 0.22], [len, 0]]);
}

/** Warm sustained chord (strings/pad), for tails and logos. */
function pad(c: Ctx, o: AudioNode, t: number, notes: number[], len: number, peak = 0.12) {
  for (const m of notes) {
    oscLayer(c, o, t, 'sawtooth', [[0, hz(m)], [len, hz(m)]], [[0, 0], [len * 0.3, peak], [len * 0.6, peak * 0.8], [len, 0]], {
      voices: 3, spread: 10, lowpass: [[0, 600], [len * 0.4, 1800], [len, 500]],
    });
  }
}

const sfx = (s: Omit<Sfx, 'premium'> & { build: Build }): Sfx => ({ ...s, premium: true });

export const PREMIUM_SFX: Sfx[] = [
  // ---------- Cinemáticos ----------
  sfx({
    id: 'p-boom', name: 'Boom cinemático', use: 'Título grande, tráiler', category: 'Cinemáticos', seconds: 4.5, hit: 0,
    build: (c, o) => {
      const b = bus(c, o, { verb: 3.5, wet: 0.45, drive: 1.8, tone: 3000 });
      boom(c, b, 0, 1.2);
      transient(c, b, 0, 0.5, 2500);
    },
  }),
  sfx({
    id: 'p-braam', name: 'Braam', use: 'Tensión de tráiler, algo enorme', category: 'Cinemáticos', seconds: 5, hit: 0,
    build: (c, o) => {
      const b = bus(c, o, { verb: 3.5, wet: 0.4, drive: 2.5, tone: 2500 });
      for (const m of [33, 40, 45, 52]) {
        oscLayer(c, b, 0, 'sawtooth', [[0, hz(m) * 0.98], [0.15, hz(m)], [3.2, hz(m) * 0.97]], [[0, 0], [0.06, 0.5], [0.6, 0.4], [3.4, 0]], {
          voices: 3, spread: 14, lowpass: [[0, 150], [0.12, 1600], [0.6, 700], [3.4, 200]], q: 2,
        });
      }
      boom(c, b, 0, 0.8, 0.6);
    },
  }),
  sfx({
    id: 'p-trailer-hit', name: 'Golpe de tráiler', use: 'Corte fuerte, momento épico', category: 'Cinemáticos', seconds: 4.5, hit: 0,
    build: (c, o) => {
      const b = bus(c, o, { verb: 3, wet: 0.45, drive: 1.6, tone: 4500 });
      boom(c, b, 0, 1, 0.9);
      metal(c, b, 0, 92, 2.4, 0.35);
      noiseLayer(c, b, 0, [[0, 0], [0.004, 0.35], [1.5, 0]], { type: 'highpass', freq: [[0, 4500], [1.5, 3000]] });
      transient(c, b, 0, 0.6, 3000);
    },
  }),
  sfx({
    id: 'p-stinger', name: 'Revelación', use: 'Giro inesperado, plot twist', category: 'Cinemáticos', seconds: 4.5, hit: 0,
    build: (c, o) => {
      const b = bus(c, o, { verb: 3, wet: 0.45, drive: 2, tone: 3500 });
      boom(c, b, 0, 0.9, 0.8);
      for (const m of [45, 52, 57, 60, 64]) {
        oscLayer(c, b, 0, 'sawtooth', [[0, hz(m)], [2, hz(m)]], [[0, 0], [0.03, 0.3], [0.4, 0.22], [2, 0]], {
          voices: 3, spread: 12, lowpass: [[0, 200], [0.05, 2500], [1.5, 500]],
        });
      }
    },
  }),
  sfx({
    id: 'p-sub-drop', name: 'Sub drop', use: 'Caída del ritmo, impacto grave', category: 'Cinemáticos', seconds: 2.6, hit: 0,
    build: (c, o) => {
      const b = bus(c, o, { verb: 1.5, wet: 0.15, drive: 1.4 });
      oscLayer(c, b, 0, 'sine', [[0, 130], [1.8, 26]], [[0, 0], [0.01, 1], [1.2, 0.7], [2.2, 0]]);
      transient(c, b, 0, 0.3, 1800);
    },
  }),
  sfx({
    id: 'p-riser', name: 'Riser épico', use: 'Subida antes de revelar algo', category: 'Cinemáticos', seconds: 4.4, hit: 3.2,
    build: (c, o) => {
      const b = bus(c, o, { verb: 2.5, wet: 0.35, tone: 7000 });
      noiseLayer(c, b, 0, [[0, 0], [2.6, 0.35], [3.2, 0.75], [3.22, 0]], { type: 'bandpass', freq: [[0, 300], [3.2, 9000]], q: 1.6 });
      for (const m of [45, 52, 57]) {
        oscLayer(c, b, 0, 'sawtooth', [[0, hz(m)], [3.2, hz(m + 12)]], [[0, 0], [3, 0.18], [3.2, 0.25], [3.22, 0]], {
          voices: 3, lowpass: [[0, 300], [3.2, 6000]],
        });
      }
    },
  }),
  sfx({
    id: 'p-reverse', name: 'Reverso', use: 'Entrada suave antes de un corte', category: 'Cinemáticos', seconds: 2.4, hit: 1.8,
    build: (c, o) => reverseSwell(c, bus(c, o, { verb: 1.2, wet: 0.2 }), 0, 1.8),
  }),
  sfx({
    id: 'p-downlifter', name: 'Bajada épica', use: 'Después del clímax, calma', category: 'Cinemáticos', seconds: 3.2, hit: 0,
    build: (c, o) => {
      const b = bus(c, o, { verb: 2, wet: 0.3 });
      noiseLayer(c, b, 0, [[0, 0], [0.02, 0.7], [2.5, 0]], { type: 'bandpass', freq: [[0, 9000], [2.5, 200]], q: 1.2 });
      oscLayer(c, b, 0, 'sawtooth', [[0, hz(69)], [2.5, hz(45)]], [[0, 0], [0.02, 0.2], [2.5, 0]], { voices: 3, lowpass: [[0, 4000], [2.5, 300]] });
    },
  }),
  sfx({
    id: 'p-tension', name: 'Tensión', use: 'Suspenso, misterio, true crime', category: 'Cinemáticos', seconds: 7,
    build: (c, o) => {
      const b = bus(c, o, { verb: 3, wet: 0.5, tone: 4000 });
      for (const m of [38, 39, 45]) oscLayer(c, b, 0, 'sine', [[0, hz(m)], [6, hz(m)]], [[0, 0], [1.5, 0.3], [4.5, 0.3], [6, 0]]);
      oscLayer(c, b, 0, 'sawtooth', [[0, hz(81)], [6, hz(81)]], [[0, 0], [3, 0.06], [6, 0]], { voices: 4, spread: 18, lowpass: [[0, 800], [6, 2500]] });
      noiseLayer(c, b, 0, [[0, 0], [2, 0.08], [6, 0]], { type: 'lowpass', freq: [[0, 400], [6, 700]] });
    },
  }),
  sfx({
    id: 'p-heartbeat', name: 'Latido cinemático', use: 'Nervios, tensión, romance', category: 'Cinemáticos', seconds: 3.2,
    build: (c, o) => {
      const b = bus(c, o, { verb: 1.5, wet: 0.25, drive: 1.5 });
      for (const [t, p] of [[0, 1], [0.28, 0.7], [1.2, 1], [1.48, 0.7]] as const) {
        oscLayer(c, b, t, 'sine', [[0, 75], [0.15, 40]], [[0, 0], [0.008, p], [0.25, 0]], { lowpass: [[0, 300], [0.25, 300]] });
      }
    },
  }),
  sfx({
    id: 'p-shimmer', name: 'Brillo celestial', use: 'Momento mágico, final emotivo', category: 'Cinemáticos', seconds: 5.5,
    build: (c, o) => {
      const b = bus(c, o, { verb: 4, wet: 0.6, tone: 9000 });
      [84, 88, 91, 96, 100].forEach((m, i) => bell(c, b, i * 0.12, hz(m), 1.6, 0.18));
      for (const m of [72, 76, 79, 84]) oscLayer(c, b, 0, 'sine', [[0, hz(m)], [2.5, hz(m)]], [[0, 0], [1, 0.12], [2.5, 0]]);
    },
  }),

  // ---------- Transiciones ----------
  sfx({
    id: 'p-whoosh', name: 'Whoosh premium', use: 'Cambio de escena', category: 'Transiciones', seconds: 1.5, hit: 0.38,
    build: (c, o) => {
      const b = bus(c, o, { verb: 1.2, wet: 0.2, tone: 6000 });
      whoosh(c, b, 0, 0.85, 0.38, 350, 2600, 0.85);
      whooshBody(c, b, 0, 0.85, 0.38);
    },
  }),
  sfx({
    id: 'p-whoosh-fast', name: 'Whoosh rápido', use: 'Barrido, movimiento veloz', category: 'Transiciones', seconds: 0.9, hit: 0.14,
    build: (c, o) => {
      const b = bus(c, o, { verb: 0.8, wet: 0.15, tone: 7000 });
      whoosh(c, b, 0, 0.35, 0.14, 600, 5000, 0.8, 1.1);
      whooshBody(c, b, 0, 0.35, 0.14, 0.2);
    },
  }),
  sfx({
    id: 'p-whoosh-heavy', name: 'Whoosh pesado', use: 'Cambio dramático, giro', category: 'Transiciones', seconds: 2.2, hit: 0.55,
    build: (c, o) => {
      const b = bus(c, o, { verb: 1.8, wet: 0.25, drive: 1.5, tone: 4000 });
      whoosh(c, b, 0, 1.3, 0.55, 150, 1500, 0.9, 1.6);
      whooshBody(c, b, 0, 1.3, 0.55, 0.5);
    },
  }),
  sfx({
    id: 'p-swoosh-hit', name: 'Whoosh con golpe', use: 'Cambio con impacto', category: 'Transiciones', seconds: 3, hit: 0.45,
    build: (c, o) => {
      const b = bus(c, o, { verb: 2.5, wet: 0.35, drive: 1.6, tone: 4500 });
      whoosh(c, b, 0, 0.46, 0.43, 300, 3000, 0.75);
      boom(c, b, 0.45, 0.8, 0.8);
      transient(c, b, 0.45, 0.5, 2800);
    },
  }),
  sfx({
    id: 'p-zoom-in', name: 'Zoom', use: 'Acercamiento rápido', category: 'Transiciones', seconds: 1.4, hit: 0.5,
    build: (c, o) => {
      const b = bus(c, o, { verb: 1, wet: 0.3 });
      oscLayer(c, b, 0, 'sawtooth', [[0, hz(48)], [0.5, hz(72)]], [[0, 0], [0.45, 0.25], [0.5, 0]], { voices: 3, lowpass: [[0, 400], [0.5, 5000]] });
      noiseLayer(c, b, 0, [[0, 0], [0.45, 0.6], [0.5, 0]], { type: 'bandpass', freq: [[0, 500], [0.5, 8000]] });
      transient(c, b, 0.5, 0.5);
      oscLayer(c, b, 0.5, 'sine', [[0, 120], [0.2, 45]], [[0, 0], [0.004, 0.6], [0.3, 0]]);
    },
  }),
  sfx({
    id: 'p-glitch', name: 'Glitch digital', use: 'Corte con falla, tecnología', category: 'Transiciones', seconds: 1.1, hit: 0.05,
    build: (c, o, r) => {
      const b = bus(c, o, { verb: 0.5, wet: 0.15, drive: 6 });
      for (let i = 0; i < 16; i++) {
        const t = i * 0.045 + r() * 0.02;
        const d = 0.015 + r() * 0.035;
        if (r() < 0.5) {
          const f = 200 + r() * 2800;
          tone(c, b, t, 'square', f, f * (r() < 0.5 ? 1 : 0.5), d, 0.25, 0.001);
        } else {
          const f = 800 + r() * 6000;
          noiseLayer(c, b, t, [[0, 0], [0.001, 0.5], [d, 0.4], [d + 0.002, 0]], { type: 'bandpass', freq: [[0, f], [d, f]], q: 3 });
        }
      }
    },
  }),
  sfx({
    id: 'p-tape-stop', name: 'Tape stop', use: 'Pausa dramática, todo se frena', category: 'Transiciones', seconds: 1.5, hit: 0,
    build: (c, o) => {
      const b = bus(c, o, { drive: 1.6, verb: 0.8, wet: 0.12 });
      for (const m of [57, 64, 69]) {
        oscLayer(c, b, 0, 'sawtooth', [[0, hz(m)], [1, hz(m) / 8]], [[0, 0], [0.02, 0.25], [0.8, 0.2], [1.1, 0]], { voices: 2, lowpass: [[0, 3000], [1.1, 150]] });
      }
      oscLayer(c, b, 0, 'sine', [[0, 120], [1, 20]], [[0, 0], [0.01, 0.5], [1, 0]]);
    },
  }),
  sfx({
    id: 'p-rewind', name: 'Rebobinar', use: 'Volver atrás, flashback', category: 'Transiciones', seconds: 1.7,
    build: (c, o, r) => {
      const b = bus(c, o, { verb: 0.8, wet: 0.15 });
      for (let i = 0; i < 14; i++) {
        oscLayer(c, b, i * 0.08, 'sawtooth', [[0, hz(84 + Math.floor(r() * 12))], [0.07, hz(60)]], [[0, 0], [0.005, 0.12], [0.07, 0]], { lowpass: [[0, 3000], [0.07, 3000]] });
      }
      noiseLayer(c, b, 0, [[0, 0], [0.1, 0.3], [1.2, 0.3], [1.3, 0]], { type: 'bandpass', freq: [[0, 800], [1.2, 4000]], q: 2 });
    },
  }),
  sfx({
    id: 'p-camera-flash', name: 'Flash de cámara', use: 'Foto, transición con flash', category: 'Transiciones', seconds: 1.4, hit: 0,
    build: (c, o) => {
      const b = bus(c, o, { verb: 1.2, wet: 0.3, tone: 9000 });
      transient(c, b, 0, 0.8, 3000);
      transient(c, b, 0.06, 0.6, 2000);
      noiseLayer(c, b, 0, [[0, 0], [0.005, 0.45], [0.5, 0]], { type: 'highpass', freq: [[0, 5000], [0.5, 9000]] });
      oscLayer(c, b, 0, 'sine', [[0, 3000], [0.6, 7000]], [[0, 0], [0.02, 0.06], [0.6, 0]]);
    },
  }),

  // ---------- Interfaz ----------
  sfx({
    id: 'p-ui-tap', name: 'Toque suave', use: 'Botones, tocar la pantalla', category: 'Interfaz', seconds: 0.5,
    build: (c, o) => {
      const b = bus(c, o, { verb: 0.4, wet: 0.12 });
      oscLayer(c, b, 0, 'sine', [[0, 1800], [0.05, 1200]], [[0, 0], [0.002, 0.5], [0.06, 0]]);
      transient(c, b, 0, 0.3, 5000);
    },
  }),
  sfx({
    id: 'p-text-pop', name: 'Pop de texto', use: 'Texto o sticker que aparece', category: 'Interfaz', seconds: 0.6,
    build: (c, o) => {
      const b = bus(c, o, { verb: 0.5, wet: 0.15 });
      oscLayer(c, b, 0, 'sine', [[0, 300], [0.04, 900], [0.12, 700]], [[0, 0], [0.004, 0.7], [0.12, 0]]);
      transient(c, b, 0, 0.3, 4000);
    },
  }),
  sfx({
    id: 'p-swipe-ui', name: 'Deslizar suave', use: 'Cambiar de pantalla, carrusel', category: 'Interfaz', seconds: 0.8, hit: 0.15,
    build: (c, o) => whoosh(c, bus(c, o, { verb: 0.5, wet: 0.12 }), 0, 0.3, 0.15, 1500, 6000, 0.5, 0.9),
  }),
  sfx({
    id: 'p-notify-glass', name: 'Notificación cristal', use: 'Mensaje, aviso elegante', category: 'Interfaz', seconds: 2.2,
    build: (c, o) => {
      const b = bus(c, o, { verb: 1.8, wet: 0.35, tone: 9000 });
      bell(c, b, 0, hz(88), 1.2, 0.5);
      bell(c, b, 0.11, hz(95), 1.4, 0.45);
    },
  }),
  sfx({
    id: 'p-error-soft', name: 'Error suave', use: 'Algo no salió bien', category: 'Interfaz', seconds: 1,
    build: (c, o) => {
      const b = bus(c, o, { verb: 0.6, wet: 0.15 });
      oscLayer(c, b, 0, 'triangle', [[0, hz(64)], [0.12, hz(64)]], [[0, 0], [0.005, 0.4], [0.12, 0]], { lowpass: [[0, 1500], [0.12, 1500]] });
      oscLayer(c, b, 0.14, 'triangle', [[0, hz(60)], [0.25, hz(60)]], [[0, 0], [0.005, 0.4], [0.25, 0]], { lowpass: [[0, 1500], [0.25, 1500]] });
    },
  }),
  sfx({
    id: 'p-typing', name: 'Teclado mecánico', use: 'Texto que se escribe, programar', category: 'Interfaz', seconds: 1.7,
    build: (c, o, r) => {
      const b = bus(c, o, { verb: 0.35, wet: 0.1 });
      for (let i = 0; i < 11; i++) {
        const t = i * 0.12 + r() * 0.05;
        transient(c, b, t, 0.5, 2500 + r() * 1500);
        oscLayer(c, b, t, 'sine', [[0, 300 + r() * 80], [0.03, 180]], [[0, 0], [0.002, 0.35], [0.05, 0]]);
      }
    },
  }),

  // ---------- Impactos ----------
  sfx({
    id: 'p-punch', name: 'Golpe seco', use: 'Golpe, texto que cae', category: 'Impactos', seconds: 1.1, hit: 0,
    build: (c, o) => {
      const b = bus(c, o, { drive: 2, verb: 0.8, wet: 0.18 });
      oscLayer(c, b, 0, 'sine', [[0, 160], [0.12, 48]], [[0, 0], [0.002, 1], [0.18, 0]]);
      noiseLayer(c, b, 0, [[0, 0], [0.001, 0.7], [0.08, 0]], { type: 'lowpass', freq: [[0, 6000], [0.06, 800]] });
      transient(c, b, 0, 0.5);
    },
  }),
  sfx({
    id: 'p-slam', name: 'Golpe de título', use: 'Título que aparece con fuerza', category: 'Impactos', seconds: 2.6, hit: 0,
    build: (c, o) => {
      const b = bus(c, o, { verb: 2, wet: 0.3, drive: 1.8 });
      boom(c, b, 0, 0.6, 0.9);
      noiseLayer(c, b, 0, [[0, 0], [0.002, 0.6], [0.12, 0]], { type: 'bandpass', freq: [[0, 1800], [0.12, 1200]], q: 1.2 });
      transient(c, b, 0, 0.6, 4000);
    },
  }),
  sfx({
    id: 'p-thud', name: 'Caída suave', use: 'Algo cae, aterrizaje', category: 'Impactos', seconds: 1.1, hit: 0,
    build: (c, o) => {
      const b = bus(c, o, { verb: 0.8, wet: 0.15 });
      oscLayer(c, b, 0, 'sine', [[0, 90], [0.3, 40]], [[0, 0], [0.004, 0.8], [0.35, 0]]);
      noiseLayer(c, b, 0, [[0, 0], [0.003, 0.4], [0.15, 0]], { type: 'lowpass', freq: [[0, 400], [0.15, 200]] });
    },
  }),

  // ---------- Reacciones, dinero y magia ----------
  sfx({
    id: 'p-ding-gold', name: 'Ding dorado', use: 'Dato clave, buena idea', category: 'Reacciones', seconds: 2.6,
    build: (c, o) => {
      const b = bus(c, o, { verb: 2, wet: 0.35, tone: 9000 });
      bell(c, b, 0, hz(84), 2.2, 0.6);
      bell(c, b, 0, hz(96), 0.5, 0.2);
    },
  }),
  sfx({
    id: 'p-success-chime', name: 'Logro premium', use: 'Meta cumplida, antes y después', category: 'Reacciones', seconds: 3,
    build: (c, o) => {
      const b = bus(c, o, { verb: 2.2, wet: 0.4, tone: 9000 });
      [72, 76, 79, 83, 86].forEach((m, i) => bell(c, b, i * 0.07, hz(m + 12), 1.5, 0.3));
      for (const m of [60, 64, 67, 71]) oscLayer(c, b, 0.2, 'sine', [[0, hz(m)], [2, hz(m)]], [[0, 0], [0.5, 0.08], [2, 0]]);
    },
  }),
  sfx({
    id: 'p-cash', name: 'Dinero (bling)', use: 'Ventas, precio, ganancia', category: 'Tiempo y dinero', seconds: 2.2,
    build: (c, o, r) => {
      const b = bus(c, o, { verb: 1.6, wet: 0.35, tone: 10000 });
      for (let i = 0; i < 6; i++) bell(c, b, r() * 0.25, hz(96 + Math.floor(r() * 7)), 0.25, 0.12);
      bell(c, b, 0.12, hz(91), 1.6, 0.45);
      bell(c, b, 0.12, hz(98), 1.2, 0.3);
    },
  }),
  sfx({
    id: 'p-tick', name: 'Tic tac de tensión', use: 'Cuenta atrás, el tiempo corre', category: 'Tiempo y dinero', seconds: 4.2,
    build: (c, o) => {
      const b = bus(c, o, { verb: 1, wet: 0.25 });
      for (let i = 0; i < 8; i++) {
        transient(c, b, i * 0.5, 0.6, i % 2 ? 2600 : 3200);
        oscLayer(c, b, i * 0.5, 'sine', [[0, 900], [0.02, 600]], [[0, 0], [0.001, 0.2], [0.03, 0]]);
      }
      oscLayer(c, b, 0, 'sine', [[0, hz(33)], [4, hz(33)]], [[0, 0], [1, 0.15], [3.8, 0.15], [4.1, 0]]);
    },
  }),
  sfx({
    id: 'p-magic-dust', name: 'Polvo mágico', use: 'Transformación, aparece algo', category: 'Ciencia ficción y magia', seconds: 3.4,
    build: (c, o, r) => {
      const b = bus(c, o, { verb: 3, wet: 0.55, tone: 10000 });
      for (let i = 0; i < 26; i++) bell(c, b, r() * 1.8, hz(88 + Math.floor(r() * 16)), 0.6, 0.12);
      noiseLayer(c, b, 0, [[0, 0], [0.8, 0.12], [2, 0]], { type: 'highpass', freq: [[0, 6000], [2, 9000]] });
    },
  }),
  sfx({
    id: 'p-portal', name: 'Portal', use: 'Teletransporte, cambio de mundo', category: 'Ciencia ficción y magia', seconds: 3.6,
    build: (c, o) => {
      const b = bus(c, o, { verb: 3, wet: 0.5 });
      oscLayer(c, b, 0, 'sawtooth', [[0, hz(40)], [1.5, hz(64)], [2.5, hz(52)]], [[0, 0], [1.2, 0.25], [2.5, 0]], {
        voices: 4, spread: 20, lowpass: [[0, 200], [1.5, 3000], [2.5, 400]],
      });
      noiseLayer(c, b, 0, [[0, 0], [1.2, 0.3], [2.5, 0]], { type: 'bandpass', freq: [[0, 400], [1.5, 6000], [2.5, 800]], q: 3 });
    },
  }),

  // ---------- Ambiente ----------
  sfx({
    id: 'p-ocean', name: 'Olas del mar', use: 'Playa, calma, viajes', category: 'Ambiente', seconds: 8.5,
    build: (c, o) => {
      const b = bus(c, o, { verb: 2, wet: 0.3 });
      for (let w = 0; w < 3; w++) {
        noiseLayer(c, b, w * 2.7, [[0, 0.05], [1.1, 0.45], [2.6, 0.05], [2.8, 0]], { type: 'lowpass', freq: [[0, 300], [1.2, 1800], [2.6, 400]] });
      }
    },
  }),
  sfx({
    id: 'p-space', name: 'Espacio', use: 'Ciencia ficción, misterio, noche', category: 'Ambiente', seconds: 8.5,
    build: (c, o) => {
      const b = bus(c, o, { verb: 4, wet: 0.6 });
      for (const m of [36, 43, 48]) oscLayer(c, b, 0, 'sine', [[0, hz(m)], [8, hz(m)]], [[0, 0], [2, 0.25], [6, 0.25], [8, 0]]);
      oscLayer(c, b, 0, 'sine', [[0, hz(96)], [8, hz(96)]], [[0, 0], [3, 0.04], [5, 0.02], [8, 0]]);
    },
  }),

  // ---------- Cortinillas ----------
  sfx({
    id: 'p-logo', name: 'Logo premium', use: 'Intro, aparece tu marca', category: 'Cortinillas', seconds: 5, hit: 1.2,
    build: (c, o) => {
      const b = bus(c, o, { verb: 3.5, wet: 0.45, drive: 1.4, tone: 6000 });
      reverseSwell(c, b, 0, 1.2, 0.7);
      boom(c, b, 1.2, 0.8, 0.8);
      for (const m of [76, 83, 88]) bell(c, b, 1.2, hz(m), 2.5, 0.25);
      pad(c, b, 1.2, [52, 59, 64, 68], 3);
    },
  }),
  sfx({
    id: 'p-outro', name: 'Cierre elegante', use: 'Final del video', category: 'Cortinillas', seconds: 4.5,
    build: (c, o) => {
      const b = bus(c, o, { verb: 3.5, wet: 0.5, tone: 7000 });
      [88, 84, 79, 76].forEach((m, i) => bell(c, b, i * 0.15, hz(m), 1.8, 0.3));
      pad(c, b, 0, [60, 64, 67, 72], 3.5, 0.1);
    },
  }),
];

/**
 * The premium sound that goes with each transition, placed so its main moment lands on the cut.
 * A plain cut has none.
 */
export const TRANSITION_SFX: Record<TransitionId, string | null> = {
  none: null,
  fade: 'p-whoosh',
  fadeBlack: 'p-whoosh-heavy',
  fadeWhite: 'p-reverse',
  slide: 'p-swipe-ui',
  push: 'p-whoosh',
  zoom: 'p-zoom-in',
  wipe: 'p-whoosh-fast',
  iris: 'p-whoosh',
  flash: 'p-camera-flash',
  spin: 'p-whoosh-heavy',
  blur: 'p-reverse',
  glitch: 'p-glitch',
  whip: 'p-whoosh-fast',
  zoomBlur: 'p-zoom-in',
  filmBurn: 'p-reverse',
  shake: 'p-swoosh-hit',
  pixelate: 'p-glitch',
  lightSweep: 'p-reverse',
  spinZoom: 'p-whoosh-heavy',
  swipeUp: 'p-whoosh-fast',
  cube: 'p-whoosh',
  flip: 'p-swipe-ui',
  split: 'p-swoosh-hit',
  blinds: 'p-swipe-ui',
  mosaic: 'p-glitch',
};
