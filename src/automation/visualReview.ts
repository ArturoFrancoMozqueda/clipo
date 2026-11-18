import { frameMetrics, histogramDistance, pixelDifference, sampleTimes } from './visualMetrics';
import { extractAudio, resampleMono } from '../audioExtract';
import { integratedLoudness, peak } from '../audioDsp';
import { encodeWav } from '../voice';

export interface VisualOptions { from: number; to: number; samples: number; sceneThreshold: number }
function canvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No se pudo crear el analizador visual.');
  return { c, ctx };
}
function event(target: HTMLMediaElement | HTMLImageElement, type: string, start: () => void, check: () => void) {
  return new Promise<void>((resolve, reject) => {
    const clean = () => { clearTimeout(timer); target.removeEventListener(type, done); target.removeEventListener('error', fail); };
    const done = () => { clean(); try { check(); resolve(); } catch (e) { reject(e); } };
    const fail = () => { clean(); reject(new Error('No se pudo decodificar el medio para revisión.')); };
    const timer = setTimeout(() => { clean(); reject(new Error('Tiempo agotado al decodificar el medio.')); }, 12000);
    target.addEventListener(type, done, { once: true }); target.addEventListener('error', fail, { once: true });
    try { check(); start(); } catch (e) { clean(); reject(e); }
  });
}

/** Isolated decoder; never changes the editor, selection, playhead or source blob. */
export async function inspectVisual(blob: Blob, kind: 'video' | 'image', options: VisualOptions, check: () => void) {
  const times = sampleTimes(options.from, options.to, kind === 'image' ? 1 : options.samples);
  const url = URL.createObjectURL(blob); const video = document.createElement('video');
  const img = new Image(); let duration: number | null = null;
  try {
    let source: CanvasImageSource; let width: number; let height: number;
    if (kind === 'image') {
      await event(img, 'load', () => { img.src = url; }, check);
      source = img; width = img.naturalWidth; height = img.naturalHeight;
    } else {
      video.muted = true; video.preload = 'auto';
      await event(video, 'loadeddata', () => { video.src = url; video.load(); }, check);
      duration = video.duration; width = video.videoWidth; height = video.videoHeight; source = video;
      if (!Number.isFinite(duration) || options.to > duration + 0.001) throw new Error('Intervalo fuera del video decodificado.');
    }
    if (!width || !height) throw new Error('El medio no contiene imagen decodificable.');
    const columns = Math.min(4, times.length); const tileW = 256; const tileH = 168;
    const sheet = canvas(columns * tileW, Math.ceil(times.length / columns) * tileH);
    const probe = canvas(64, 36);
    const frames: Array<{ time: number; meanLuma: number; darkFraction: number; change: number | null; pixelDifference: number | null }> = [];
    const sceneChanges: Array<{ from: number; to: number; score: number }> = [];
    const issues: Array<{ code: string; from: number; to: number }> = [];
    let previous: number[] | undefined;
    let previousPixels: Uint8ClampedArray | undefined;
    for (const [i, time] of times.entries()) {
      check();
      if (kind === 'video' && Math.abs(video.currentTime - time) > 0.00001) await event(video, 'seeked', () => { video.currentTime = time; }, check);
      check();
      const x = i % columns * tileW; const y = Math.floor(i / columns) * tileH;
      sheet.ctx.fillStyle = '#101014'; sheet.ctx.fillRect(x, y, tileW, tileH);
      const scale = Math.min(tileW / width, 140 / height);
      sheet.ctx.drawImage(source, x + (tileW - width * scale) / 2, y + (140 - height * scale) / 2, width * scale, height * scale);
      sheet.ctx.font = '14px sans-serif'; sheet.ctx.fillStyle = '#ffffff'; sheet.ctx.fillText(`${i + 1} · ${time.toFixed(3)} s`, x + 8, y + 159);
      probe.ctx.drawImage(source, 0, 0, 64, 36);
      const pixels = probe.ctx.getImageData(0, 0, 64, 36).data;
      const metrics = frameMetrics(pixels);
      const change = previous ? histogramDistance(previous, metrics.histogram) : null;
      const movement = previousPixels ? pixelDifference(previousPixels, pixels) : null;
      frames.push({ time, meanLuma: metrics.meanLuma, darkFraction: metrics.darkFraction, change, pixelDifference: movement });
      if (metrics.darkFraction > 0.98) issues.push({ code: 'DARK_SAMPLE', from: time, to: time });
      if (movement !== null && movement < 0.002) issues.push({ code: 'STATIC_SAMPLE_PAIR', from: times[i - 1]!, to: time });
      if (change !== null && change >= options.sceneThreshold) sceneChanges.push({ from: times[i - 1]!, to: time, score: change });
      previous = metrics.histogram;
      previousPixels = pixels;
    }
    check();
    return { media: { width, height, duration }, range: { from: options.from, to: options.to }, frames, sceneChanges, issues,
      coverage: { mode: 'sampled', samples: times.length, intervalSeconds: (options.to - options.from) / times.length,
        unmeasured: ['frames_between_samples', 'text_legibility', 'audiovisual_sync', 'unexpected_freezes'],
        note: 'Los cambios son candidatos entre muestras; negro o imagen estática pueden ser intencionales. No es una revisión de todos los fotogramas.' },
      image: { mimeType: 'image/jpeg', data: sheet.c.toDataURL('image/jpeg', 0.85).split(',')[1]! } };
  } finally { video.removeAttribute('src'); video.load(); img.src = ''; URL.revokeObjectURL(url); }
}

/** Decode the exported mix itself, not a second rendering of the timeline. */
export async function inspectRenderedAudio(blob: Blob, from: number, to: number, check: () => void) {
  if (to - from > 60) throw new Error('La revisión de audio admite hasta 60 segundos.');
  const pcm = await extractAudio(blob, from, to, { maxChannels: 2, check }); check();
  if (!pcm) return { audioAnalysis: { decoded: false, reason: 'No hay pista de audio decodificable; no demuestra silencio.' } };
  const lufs = integratedLoudness(pcm.channels, pcm.sampleRate); const samplePeak = peak(pcm.channels);
  const mono = await resampleMono(pcm, 16000); check();
  const bytes = new Uint8Array(await encodeWav(mono, 16000).arrayBuffer());
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { audioAnalysis: { decoded: true, from, to, decodedStart: pcm.start, sampleRate: pcm.sampleRate,
    duration: pcm.channels[0]!.length / pcm.sampleRate, integratedLufs: Number.isFinite(lufs) ? lufs : null, silent: samplePeak === 0,
    samplePeak, possibleClipping: samplePeak >= 0.999, truePeakMeasured: false }, audio: { mimeType: 'audio/wav', data: btoa(binary) } };
}
