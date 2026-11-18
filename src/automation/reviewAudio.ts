import type { Project } from '../types';
import { getBlob } from '../db';
import { extractAudio, resampleMono } from '../audioExtract';
import { encodeWav } from '../voice';

/** Read a bounded source interval, without music, effects, ducking or export normalization. */
export async function reviewAudio(project: Project, assetId: string, from: number, to: number, check: () => void) {
  const asset = Object.hasOwn(project.assets, assetId) ? project.assets[assetId] : undefined;
  if (!asset || asset.kind === 'image') throw new Error('Selecciona un archivo con audio del proyecto abierto.');
  if (to <= from || to - from > 60 || to > asset.duration + 0.001) throw new Error('Usa un intervalo válido de hasta 60 segundos del archivo original.');
  const blob = await getBlob(assetId);
  if (!blob) throw new Error('No se encontró el archivo original.');
  const pcm = await extractAudio(blob, from, to, { maxChannels: 1, check, fallbackRate: 16000 });
  check();
  if (!pcm) throw new Error('No se pudo leer el audio original.');
  const samples = await resampleMono(pcm, 16000);
  check();
  const wav = new Uint8Array(await encodeWav(samples, 16000).arrayBuffer());
  let binary = '';
  for (let i = 0; i < wav.length; i += 16384) binary += String.fromCharCode(...wav.subarray(i, i + 16384));
  return { range: { assetId, from, to, domain: 'source' }, sampleRate: 16000,
    audio: { mimeType: 'audio/wav', data: btoa(binary) } };
}
