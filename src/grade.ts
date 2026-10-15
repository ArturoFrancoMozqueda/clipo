// GPU color pass: a clip's color correction (color.ts) and its imported LUT (lut.ts) applied to a
// canvas in one WebGL2 draw. Without WebGL2 the same math runs on the CPU. Browser only; nothing is
// created until the first use.
import type { ColorAdjust, LutData } from './types';
import { applyToPixels, colorKey, isNeutral, saturateMatrix, saturationFactor, toneLuts } from './color';
import { applyLutToPixels, lutBytes } from './lut';

interface Gl {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  img: WebGLTexture;
  /** Size of the picture last uploaded to `img`. */
  imgW: number;
  imgH: number;
  tone: WebGLTexture;
  /** colorKey of the curves in `tone` ('' = identity). */
  toneKey: string;
  /** 2³ identity grid bound when there is no LUT, so the sampler always has a complete texture. */
  noLut: WebGLTexture;
  luts: Map<string, WebGLTexture>;
  uAmount: WebGLUniformLocation;
  uSize: WebGLUniformLocation;
  uSat: WebGLUniformLocation;
  uGraded: WebGLUniformLocation;
}

let glState: Gl | null | undefined;

const VS = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
// Color correction (saturation matrix, then the per-channel tone curves) followed by the LUT, the
// same order as the CPU path (applyToPixels, then applyLutToPixels).
const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D img;
uniform sampler2D tone;
uniform sampler3D lut;
uniform mat3 sat;
uniform float graded;
uniform float amount;
uniform float size;
in vec2 uv;
out vec4 o;
void main() {
  vec4 c = texture(img, uv);
  vec3 x = c.rgb;
  if (graded > 0.5) {
    x = clamp(sat * x, 0.0, 1.0);
    vec3 t = x * (255.0 / 256.0) + 0.5 / 256.0;
    x = vec3(texture(tone, vec2(t.r, 0.5)).r, texture(tone, vec2(t.g, 0.5)).g, texture(tone, vec2(t.b, 0.5)).b);
  }
  if (amount > 0.0) x = mix(x, texture(lut, x * ((size - 1.0) / size) + 0.5 / size).rgb, amount);
  o = vec4(x, c.a);
}`;

function texture3d(gl: WebGL2RenderingContext, size: number, bytes: Uint8Array) {
  const tex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, size, size, size, 0, gl.RGB, gl.UNSIGNED_BYTE, bytes);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
  return tex;
}

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
    gl.uniform1i(gl.getUniformLocation(prog, 'tone'), 2);
    const tex2d = (unit: number, filter: number) => {
      const t = gl.createTexture()!;
      gl.activeTexture(unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const tone = tex2d(gl.TEXTURE2, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, toneBytes(undefined));
    const noLut = texture3d(gl, 2, Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 255, 0, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]));
    const img = tex2d(gl.TEXTURE0, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    return {
      canvas, gl, img, imgW: 0, imgH: 0, tone, toneKey: '', noLut, luts: new Map(),
      uAmount: gl.getUniformLocation(prog, 'amount')!,
      uSize: gl.getUniformLocation(prog, 'size')!,
      uSat: gl.getUniformLocation(prog, 'sat')!,
      uGraded: gl.getUniformLocation(prog, 'graded')!,
    };
  } catch {
    return null;
  }
}

/** The three tone curves as a 256×1 RGBA strip (identity without settings). */
function toneBytes(c: ColorAdjust | undefined) {
  const out = new Uint8Array(1024);
  const luts = c ? toneLuts(c) : null;
  for (let i = 0; i < 256; i++) {
    out[i * 4] = luts ? luts[0][i] : i;
    out[i * 4 + 1] = luts ? luts[1][i] : i;
    out[i * 4 + 2] = luts ? luts[2][i] : i;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function getGl() {
  if (glState === undefined || glState?.gl.isContextLost()) glState = initGl();
  return glState;
}

/**
 * True when color correction is drawn with WebGL2 (gradeCanvas), so the canvas filter must not
 * apply it as well. Decided once: the same answer for the preview and the export.
 */
let gpuColor: boolean | undefined;
export function colorOnGpu() {
  if (gpuColor === undefined) gpuColor = !!getGl();
  return gpuColor;
}

function lutTexture(s: Gl, l: LutData) {
  let tex = s.luts.get(l.id);
  if (!tex) {
    tex = texture3d(s.gl, l.size, lutBytes(l));
    s.luts.set(l.id, tex);
  }
  return tex;
}

/**
 * Recolor the whole canvas of `ctx`: color correction `color` (if any), then the LUT `l` mixed by
 * `amount`, in one GPU pass. Without WebGL2 the same math runs on the CPU. Alpha is kept.
 */
export function gradeCanvas(ctx: CanvasRenderingContext2D, color: ColorAdjust | undefined, l: LutData | undefined, amount: number) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const graded = !!color && !isNeutral(color, true);
  const lut = l && amount > 0.001 ? l : undefined;
  if ((!graded && !lut) || W < 1 || H < 1) return;
  const s = getGl();
  if (s) {
    const { gl, canvas } = s;
    // Grow only: the preview, overlay layers and the export grade different sizes, and resizing
    // the drawing buffer every call would reallocate it. The pass draws in the bottom-left corner.
    if (canvas.width < W || canvas.height < H) {
      canvas.width = Math.max(canvas.width, W);
      canvas.height = Math.max(canvas.height, H);
    }
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lut ? lutTexture(s, lut) : s.noLut);
    if (graded) {
      const key = colorKey(color!);
      if (key !== s.toneKey) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, s.tone);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, toneBytes(color));
        s.toneKey = key;
      }
      gl.uniformMatrix3fv(s.uSat, true, saturateMatrix(saturationFactor(color!)));
    }
    gl.uniform1f(s.uGraded, graded ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.img);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    // Same size as last time: update the texture in place instead of reallocating it.
    if (s.imgW === W && s.imgH === H) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas);
    else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas);
      s.imgW = W;
      s.imgH = H;
    }
    gl.uniform1f(s.uAmount, lut ? Math.min(1, amount) : 0);
    gl.uniform1f(s.uSize, lut ? lut.size : 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.filter = 'none';
    ctx.drawImage(canvas, 0, canvas.height - H, W, H, 0, 0, W, H);
    ctx.restore();
    return;
  }
  const img = ctx.getImageData(0, 0, W, H);
  if (graded) applyToPixels(color!, img.data);
  if (lut) applyLutToPixels(img.data, lutBytes(lut), lut.size, amount);
  ctx.putImageData(img, 0, 0);
}

/** Recolor the whole canvas of `ctx` (W×H pixels) with a LUT. */
export function applyLut(ctx: CanvasRenderingContext2D, l: LutData | undefined, amount: number, W: number, H: number) {
  if (W < 1 || H < 1) return;
  gradeCanvas(ctx, undefined, l, amount);
}
