/** Measurements on decoded samples, never a claim about every frame between them. */
export function frameMetrics(rgba: Uint8ClampedArray) {
  const histogram = new Array<number>(24).fill(0);
  let luma = 0; let dark = 0;
  const pixels = rgba.length / 4;
  if (!pixels) throw new Error('No hay píxeles para analizar.');
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!; const g = rgba[i + 1]!; const b = rgba[i + 2]!;
    const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    luma += y; if (y < 0.04) dark++;
    histogram[Math.min(7, r >> 5)]!++;
    histogram[8 + Math.min(7, g >> 5)]!++;
    histogram[16 + Math.min(7, b >> 5)]!++;
  }
  return { meanLuma: luma / pixels, darkFraction: dark / pixels, histogram: histogram.map((n) => n / (pixels * 3)) };
}
export function histogramDistance(a: number[], b: number[]) {
  return a.reduce((sum, n, i) => sum + Math.abs(n - b[i]!), 0) / 2;
}
export function pixelDifference(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  if (!a.length || a.length !== b.length) throw new Error('Muestras incompatibles.');
  let difference = 0;
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) difference += Math.abs(a[i]! - b[i]!);
  return difference / (a.length / 4 * 3 * 255);
}
export function sampleTimes(from: number, to: number, count: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to - from > 120 || !Number.isInteger(count) || count < 1 || count > 24) {
    throw new Error('Usa un intervalo de hasta 120 segundos y entre 1 y 24 muestras.');
  }
  // Centres of equal intervals: never seek exactly to EOF.
  return Array.from({ length: count }, (_, i) => from + (i + 0.5) * (to - from) / count);
}
