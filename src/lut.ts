// Imported color looks (.cube 3D LUTs). Parsing, resampling and the pixel math are pure so tests can
// check them; drawing uses WebGL2 (a 3D texture, fast enough for every frame) and falls back to the
// same trilinear math on the CPU. Preview and export call the same function, so they match.
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

// ---------- drawing (browser only) ----------

interface Gl {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  img: WebGLTexture;
  luts: Map<string, WebGLTexture>;
  uAmount: WebGLUniformLocation;
  uSize: WebGLUniformLocation;
}

let glState: Gl | null | undefined;

const VS = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D img;
uniform sampler3D lut;
uniform float amount;
uniform float size;
in vec2 uv;
out vec4 o;
void main() {
  vec4 c = texture(img, uv);
  vec3 g = texture(lut, c.rgb * ((size - 1.0) / size) + 0.5 / size).rgb;
  o = vec4(mix(c.rgb, g, amount), 1.0);
}`;

function initGl(): Gl | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) return null;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'img'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'lut'), 1);
    const img = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    return { canvas, gl, img, luts: new Map(), uAmount: gl.getUniformLocation(prog, 'amount')!, uSize: gl.getUniformLocation(prog, 'size')! };
  } catch {
    return null;
  }
}

function getGl() {
  if (glState === undefined || glState?.gl.isContextLost()) glState = initGl();
  return glState;
}

function lutTexture(s: Gl, l: LutData) {
  const { gl } = s;
  let tex = s.luts.get(l.id);
  if (!tex) {
    tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, l.size, l.size, l.size, 0, gl.RGB, gl.UNSIGNED_BYTE, lutBytes(l));
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    s.luts.set(l.id, tex);
  }
  return tex;
}

/** Recolor the whole canvas of `ctx` (W×H pixels) with a LUT. */
export function applyLut(ctx: CanvasRenderingContext2D, l: LutData | undefined, amount: number, W: number, H: number) {
  if (!l || amount <= 0.001 || W < 1 || H < 1) return;
  const s = getGl();
  if (s) {
    const { gl, canvas } = s;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    const tex = lutTexture(s, l);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.img);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas);
    gl.uniform1f(s.uAmount, Math.min(1, amount));
    gl.uniform1f(s.uSize, l.size);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(canvas, 0, 0, W, H);
    ctx.restore();
    return;
  }
  const img = ctx.getImageData(0, 0, W, H);
  applyLutToPixels(img.data, lutBytes(l), l.size, amount);
  ctx.putImageData(img, 0, 0);
}
