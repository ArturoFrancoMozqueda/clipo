// Imported color looks (.cube 3D LUTs). Parsing, resampling and the pixel math are pure so tests can
// check them (this module has no runtime imports, so Node tests load it directly). Drawing lives in
// grade.ts: WebGL2 (a 3D texture, in the same pass as the clip's color correction), falling back to
// the same math on the CPU. Preview and export call the same function, so they match.
import type { LutData } from './types';

/** Largest grid stored with a project: 33³ RGB bytes ≈ 108 KB (most .cube files are 17, 33 or 65). */
export const LUT_MAX_SIZE = 33;

export interface CubeLut {
  title: string;
  /** Points per side of the 3D grid. */
  size: number;
  /** size³ RGB floats, red changing fastest. */
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

/** Read a .cube file (Adobe/Resolve format). 1D LUTs are turned into the equivalent 3D grid. */
export function parseCube(text: string): CubeLut {
  let title = '';
  let size3 = 0;
  let size1 = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];
  const triple = (parts: string[], line: number): [number, number, number] => {
    const v = parts.slice(1, 4).map(Number);
    if (v.length !== 3 || v.some((x) => !Number.isFinite(x))) throw new Error(`Línea ${line}: se esperaban tres números`);
    return v as [number, number, number];
  };
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'TITLE') title = line.slice(5).trim().replace(/^"|"$/g, '');
    else if (key === 'LUT_3D_SIZE') size3 = parseInt(parts[1], 10);
    else if (key === 'LUT_1D_SIZE') size1 = parseInt(parts[1], 10);
    else if (key === 'DOMAIN_MIN') domainMin = triple(parts, i + 1);
    else if (key === 'DOMAIN_MAX') domainMax = triple(parts, i + 1);
    else if (key === 'LUT_3D_INPUT_RANGE' || key === 'LUT_1D_INPUT_RANGE') {
      const lo = Number(parts[1]);
      const hi = Number(parts[2]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error(`Línea ${i + 1}: rango no válido`);
      domainMin = [lo, lo, lo];
      domainMax = [hi, hi, hi];
    } else if (/^[-+.\d]/.test(key)) {
      if (parts.length < 3) throw new Error(`Línea ${i + 1}: se esperaban tres números`);
      for (let k = 0; k < 3; k++) {
        const v = Number(parts[k]);
        if (!Number.isFinite(v)) throw new Error(`Línea ${i + 1}: número no válido`);
        values.push(v);
      }
    }
    // Other keywords (LUT_IN_VIDEO_RANGE, vendor tags…) don't change the colors: ignore them.
  }
  if (domainMax.some((v, k) => v <= domainMin[k])) throw new Error('El rango del LUT no es válido');
  if (size3) {
    if (size3 < 2 || size3 > 256) throw new Error('Tamaño de LUT no válido');
    if (values.length !== size3 ** 3 * 3) throw new Error(`El archivo está incompleto: faltan colores (${values.length / 3} de ${size3 ** 3})`);
    return { title, size: size3, data: Float32Array.from(values), domainMin, domainMax };
  }
  if (size1) {
    if (size1 < 2 || size1 > 65536) throw new Error('Tamaño de LUT no válido');
    if (values.length !== size1 * 3) throw new Error('El archivo está incompleto: faltan colores');
    // A 1D LUT is a curve per channel; express it as a 3D grid (each axis only uses its own curve).
    const n = Math.min(size1, LUT_MAX_SIZE);
    const curve = (ch: number, x: number) => {
      const pos = x * (size1 - 1);
      const j = Math.min(size1 - 2, Math.floor(pos));
      const f = pos - j;
      return values[j * 3 + ch] * (1 - f) + values[(j + 1) * 3 + ch] * f;
    };
    const data = new Float32Array(n ** 3 * 3);
    for (let b = 0; b < n; b++)
      for (let g = 0; g < n; g++)
        for (let r = 0; r < n; r++) {
          const o = (r + g * n + b * n * n) * 3;
          data[o] = curve(0, r / (n - 1));
          data[o + 1] = curve(1, g / (n - 1));
          data[o + 2] = curve(2, b / (n - 1));
        }
    return { title, size: n, data, domainMin, domainMax };
  }
  throw new Error('No es un archivo .cube: falta LUT_3D_SIZE');
}

/** Trilinear lookup in a size³ RGB grid (values in any unit), input in grid units 0..size-1. */
function trilinear(grid: ArrayLike<number>, n: number, r: number, g: number, b: number, out: number[]) {
  const r0 = Math.min(n - 2, Math.floor(r));
  const g0 = Math.min(n - 2, Math.floor(g));
  const b0 = Math.min(n - 2, Math.floor(b));
  const fr = r - r0;
  const fg = g - g0;
  const fb = b - b0;
  const n2 = n * n;
  for (let ch = 0; ch < 3; ch++) {
    const at = (dr: number, dg: number, db: number) => grid[((r0 + dr) + (g0 + dg) * n + (b0 + db) * n2) * 3 + ch];
    const c00 = at(0, 0, 0) * (1 - fr) + at(1, 0, 0) * fr;
    const c10 = at(0, 1, 0) * (1 - fr) + at(1, 1, 0) * fr;
    const c01 = at(0, 0, 1) * (1 - fr) + at(1, 0, 1) * fr;
    const c11 = at(0, 1, 1) * (1 - fr) + at(1, 1, 1) * fr;
    out[ch] = (c00 * (1 - fg) + c10 * fg) * (1 - fb) + (c01 * (1 - fg) + c11 * fg) * fb;
  }
}

const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The LUT as bytes on a 0..1 input grid of at most LUT_MAX_SIZE points per side. The file's
 * input range (DOMAIN_MIN/MAX) is baked in so drawing never needs it.
 */
export function lutToBytes(lut: CubeLut, maxSize = LUT_MAX_SIZE): { size: number; bytes: Uint8Array } {
  const n = Math.min(lut.size, maxSize);
  const same = n === lut.size && lut.domainMin.every((v) => v === 0) && lut.domainMax.every((v) => v === 1);
  const bytes = new Uint8Array(n ** 3 * 3);
  const out = [0, 0, 0];
  const m = lut.size - 1;
  const pos = (x: number, ch: number) => c01((x - lut.domainMin[ch]) / (lut.domainMax[ch] - lut.domainMin[ch])) * m;
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const o = (r + g * n + b * n * n) * 3;
        if (same) {
          out[0] = lut.data[o];
          out[1] = lut.data[o + 1];
          out[2] = lut.data[o + 2];
        } else trilinear(lut.data, lut.size, pos(r / (n - 1), 0), pos(g / (n - 1), 1), pos(b / (n - 1), 2), out);
        bytes[o] = Math.round(c01(out[0]) * 255);
        bytes[o + 1] = Math.round(c01(out[1]) * 255);
        bytes[o + 2] = Math.round(c01(out[2]) * 255);
      }
  return { size: n, bytes };
}

export function bytesToBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Build the project record for an imported file. Throws an Error with a message for the user. */
export function lutFromCube(id: string, fileName: string, text: string): LutData {
  const cube = parseCube(text);
  const { size, bytes } = lutToBytes(cube);
  const name = (cube.title || fileName.replace(/\.cube$/i, '')).trim().slice(0, 40) || 'LUT';
  return { id, name, size, data: bytesToBase64(bytes) };
}

const decoded = new Map<string, Uint8Array>();
/** Decoded bytes of a stored LUT (cached by id; ids are never reused for other data). */
export function lutBytes(l: LutData) {
  let b = decoded.get(l.id);
  if (!b || b.length !== l.size ** 3 * 3) {
    b = base64ToBytes(l.data);
    decoded.set(l.id, b);
  }
  return b;
}

/** Apply a LUT to RGBA pixels in place, mixed with the original by `amount` (CPU path, also tests). */
export function applyLutToPixels(px: Uint8ClampedArray, bytes: Uint8Array, size: number, amount = 1) {
  const a = c01(amount);
  if (a <= 0) return;
  const k = (size - 1) / 255;
  const out = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) {
    trilinear(bytes, size, px[i] * k, px[i + 1] * k, px[i + 2] * k, out);
    px[i] = px[i] + (out[0] - px[i]) * a;
    px[i + 1] = px[i + 1] + (out[1] - px[i + 1]) * a;
    px[i + 2] = px[i + 2] + (out[2] - px[i + 2]) * a;
  }
}
