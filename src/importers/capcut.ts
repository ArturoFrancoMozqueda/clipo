// Reads a CapCut draft the user exported or copied from their own device
// (draft_content.json / draft_info.json) and turns it into a plan for a Clipo
// project. It only looks at the plain JSON the user hands us: encrypted or
// unreadable drafts are reported as such and never decoded.
//
// This file must stay free of runtime imports so the tests can run it in Node.
import type { AspectId, MediaKind } from '../types';

/** Draft times are stored in microseconds. */
const US = 1_000_000;

export type DraftFailure = 'unreadable' | 'not-a-draft';

export interface MediaRef {
  /** Material id inside the draft. */
  key: string;
  /** Path recorded in the draft, as-is (it points to the original device). */
  path: string;
  /** File name we look for among the files the user selects. */
  fileName: string;
  kind: MediaKind;
}

export interface PlannedClip {
  media: string;
  in: number;
  out: number;
  speed: number;
  volume: number;
}

export interface PlannedText {
  text: string;
  start: number;
  duration: number;
  x: number;
  y: number;
  size: number;
}

export interface PlannedAudio {
  media: string;
  start: number;
  in: number;
  out: number;
  volume: number;
}

export interface DraftPlan {
  name: string;
  aspect: AspectId;
  /** Every media file the plan uses, keyed by MediaRef.key. */
  media: Record<string, MediaRef>;
  clips: PlannedClip[];
  texts: PlannedText[];
  audios: PlannedAudio[];
  /** Spanish, user-facing notes about what was left out or simplified. */
  skipped: string[];
}

export type ParseResult = { ok: true; plan: DraftPlan } | { ok: false; reason: DraftFailure };

// ---------- small readers that never throw ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const objs = (v: unknown): Obj[] => arr(v).filter(isObj);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 1000) / 1000;

function range(v: unknown): { start: number; duration: number } | null {
  if (!isObj(v)) return null;
  const duration = num(v.duration, -1);
  if (duration <= 0) return null;
  return { start: Math.max(0, num(v.start, 0)) / US, duration: duration / US };
}

export function baseName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const notImported = (n: number) => (n === 1 ? 'no se importó' : 'no se importaron');
const unreadable = (n: number) => (n === 1 ? 'no se pudo leer' : 'no se pudieron leer');

// ---------- aspect ----------

const RATIOS: [AspectId, number][] = [
  ['9:16', 9 / 16],
  ['16:9', 16 / 9],
  ['1:1', 1],
  ['4:5', 4 / 5],
];

function pickAspect(canvas: unknown, notes: string[]): AspectId {
  const c = isObj(canvas) ? canvas : {};
  const ratio = str(c.ratio);
  const exact = RATIOS.find(([id]) => id === ratio);
  if (exact) return exact[0];
  const w = num(c.width, 0);
  const h = num(c.height, 0);
  if (w <= 0 || h <= 0) return '9:16';
  const r = w / h;
  let best = RATIOS[0]!;
  for (const x of RATIOS) if (Math.abs(Math.log(x[1] / r)) < Math.abs(Math.log(best[1] / r))) best = x;
  if (Math.abs(Math.log(best[1] / r)) > 0.05) notes.push(`El formato ${w}×${h} no existe en Clipo; se usó ${best[0]}, el más parecido.`);
  return best[0];
}

// ---------- text content ----------

function textOf(material: Obj): string {
  const raw = str(material.content) || str(material.text);
  let text = raw;
  // Newer drafts keep the content as a JSON string: {"text": "...", "styles": [...]}.
  if (raw.trim().startsWith('{')) {
    try {
      const inner: unknown = JSON.parse(raw);
      if (isObj(inner) && typeof inner.text === 'string') text = inner.text;
    } catch {
      /* keep raw */
    }
  }
  // Older drafts wrap it in simple markup like <font ...>[hola]</font>.
  if (/<[a-z/][^>]*>/i.test(text)) text = text.replace(/<[^>]*>/g, '').replace(/^\[(.*)\]$/s, '$1');
  return text.trim();
}

// ---------- main entry ----------

/** Parse the text of draft_content.json or draft_info.json. */
export function parseDraft(source: string, fallbackName = 'Proyecto de CapCut'): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(source.replace(/^﻿/, ''));
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (!isObj(data) || !Array.isArray(data.tracks)) return { ok: false, reason: 'not-a-draft' };

  const notes: string[] = [];
  const materials = isObj(data.materials) ? data.materials : {};
  const media: Record<string, MediaRef> = {};

  const videoMats = new Map<string, Obj>();
  for (const m of objs(materials.videos)) if (str(m.id)) videoMats.set(str(m.id), m);
  const audioMats = new Map<string, Obj>();
  for (const m of objs(materials.audios)) if (str(m.id)) audioMats.set(str(m.id), m);
  const textMats = new Map<string, Obj>();
  for (const m of objs(materials.texts)) if (str(m.id)) textMats.set(str(m.id), m);

  const useMedia = (m: Obj, kind: MediaKind): string | null => {
    const key = str(m.id);
    const path = str(m.path);
    // Without a path there is no file of the user's to match (library music, generated media).
    const fileName = baseName(path);
    if (!key || !fileName) return null;
    media[key] ??= { key, path, fileName, kind };
    return key;
  };

  const tracks = objs(data.tracks);
  const videoTracks = tracks.filter((t) => str(t.type) === 'video');
  // The first video track is the main one; any others are overlays.
  const main = videoTracks[0];

  // ----- main track -----
  const clips: PlannedClip[] = [];
  let lostVideo = 0;
  let gaps = 0;
  let keyframes = 0;
  let cursor = 0;
  const mainSegs = objs(main?.segments)
    .map((s) => ({ s, target: range(s.target_timerange) }))
    .sort((a, b) => (a.target?.start ?? 0) - (b.target?.start ?? 0));
  for (const { s, target } of mainSegs) {
    const mat = videoMats.get(str(s.material_id));
    if (!mat || !target) {
      lostVideo++;
      continue;
    }
    const type = str(mat.type);
    if (type && type !== 'video' && type !== 'photo') {
      lostVideo++; // generated content such as solid-colour or text-to-video placeholders
      continue;
    }
    const kind: MediaKind = type === 'photo' ? 'image' : 'video';
    const key = useMedia(mat, kind);
    if (!key) {
      lostVideo++;
      continue;
    }
    if (target.start > cursor + 0.05) gaps++;
    cursor = Math.max(cursor, target.start + target.duration);
    if (arr(s.common_keyframes).length) keyframes++;

    const src = range(s.source_timerange);
    let speed = num(s.speed, 0);
    if (speed <= 0) speed = src ? src.duration / target.duration : 1;
    speed = clamp(speed, 0.1, 100);
    if (kind === 'image') {
      clips.push({ media: key, in: 0, out: round(target.duration), speed: 1, volume: 1 });
    } else {
      const start = src?.start ?? 0;
      const length = src?.duration ?? target.duration * speed;
      clips.push({
        media: key,
        in: round(start),
        out: round(start + length),
        speed: round(speed),
        volume: clamp(num(s.volume, 1), 0, 4),
      });
    }
  }
  if (gaps) notes.push(`Había ${plural(gaps, 'espacio vacío', 'espacios vacíos')} entre clips: en Clipo los clips van seguidos.`);
  if (lostVideo) notes.push(`${plural(lostVideo, 'clip', 'clips')} del video principal ${unreadable(lostVideo)} (por ejemplo, fondos de color o contenido generado).`);
  if (keyframes) notes.push(`${plural(keyframes, 'clip tenía', 'clips tenían')} animación por fotogramas clave; se importó sin ella.`);

  // ----- overlays (extra video tracks) -----
  const overlays = videoTracks.filter((t) => t !== main).reduce((n, t) => n + objs(t.segments).length, 0);
  if (overlays) notes.push(`${plural(overlays, 'superposición', 'superposiciones')} (video sobre video) ${notImported(overlays)}.`);

  // ----- texts -----
  const texts: PlannedText[] = [];
  let lostText = 0;
  for (const t of tracks.filter((t) => str(t.type) === 'text')) {
    for (const s of objs(t.segments)) {
      const mat = textMats.get(str(s.material_id));
      const target = range(s.target_timerange);
      const text = mat ? textOf(mat) : '';
      if (!text || !target) {
        lostText++;
        continue;
      }
      // Positions run from -1 to 1 with y pointing up; Clipo uses 0..1 from the top-left.
      const clip = isObj(s.clip) ? s.clip : {};
      const tr = isObj(clip.transform) ? clip.transform : {};
      const sc = isObj(clip.scale) ? clip.scale : {};
      const fontSize = num(mat!.font_size, 15);
      texts.push({
        text,
        start: round(target.start),
        duration: round(target.duration),
        x: round(clamp((num(tr.x, 0) + 1) / 2, 0.05, 0.95)),
        y: round(clamp((1 - num(tr.y, 0)) / 2, 0.05, 0.95)),
        size: round(clamp(0.075 * (fontSize / 15) * num(sc.x, 1), 0.03, 0.2)),
      });
    }
  }
  if (lostText) notes.push(`${plural(lostText, 'texto', 'textos')} ${unreadable(lostText)}.`);
  if (texts.length) notes.push('Los textos usan el estilo de Clipo: la fuente, el color y las animaciones de CapCut no se conservan.');

  // ----- audio -----
  const audios: PlannedAudio[] = [];
  let lostAudio = 0;
  let audioSpeed = 0;
  for (const t of tracks.filter((t) => str(t.type) === 'audio')) {
    for (const s of objs(t.segments)) {
      const mat = audioMats.get(str(s.material_id));
      const target = range(s.target_timerange);
      const key = mat && target ? useMedia(mat, 'audio') : null;
      if (!key || !target) {
        lostAudio++;
        continue;
      }
      const src = range(s.source_timerange);
      const speed = num(s.speed, 1);
      if (Math.abs(speed - 1) > 0.01) audioSpeed++;
      const start = src?.start ?? 0;
      audios.push({
        media: key,
        start: round(target.start),
        in: round(start),
        // Clipo plays audio at normal speed, so keep the length it had on the timeline.
        out: round(start + target.duration),
        volume: clamp(num(s.volume, 1), 0, 4),
      });
    }
  }
  if (lostAudio) notes.push(`${plural(lostAudio, 'audio', 'audios')} ${unreadable(lostAudio)} (por ejemplo, música de la biblioteca de CapCut sin archivo).`);
  if (audioSpeed) notes.push(`${plural(audioSpeed, 'audio tenía', 'audios tenían')} otra velocidad; en Clipo suena a velocidad normal.`);

  // ----- things Clipo doesn't have -----
  const countTrack = (type: string) =>
    tracks.filter((t) => str(t.type) === type).reduce((n, t) => n + objs(t.segments).length, 0);
  const stickers = countTrack('sticker');
  const effects = countTrack('effect') + countTrack('filter') + countTrack('adjust');
  const transitions = objs(materials.transitions).length;
  const animations = objs(materials.material_animations).filter((a) => objs(a.animations).length).length;
  if (stickers) notes.push(`${plural(stickers, 'sticker', 'stickers')} ${notImported(stickers)}.`);
  if (effects) notes.push(`${plural(effects, 'efecto o filtro', 'efectos o filtros')} ${notImported(effects)}.`);
  if (transitions) notes.push(`${plural(transitions, 'transición', 'transiciones')} ${notImported(transitions)}.`);
  if (animations) notes.push(`${plural(animations, 'animación', 'animaciones')} de entrada o salida ${notImported(animations)}.`);

  const name = str(data.name).trim() || fallbackName;
  return {
    ok: true,
    plan: { name, aspect: pickAspect(data.canvas_config, notes), media, clips, texts, audios, skipped: notes },
  };
}

// ---------- matching media to the files the user picked ----------

export interface PickedFile {
  name: string;
}

const norm = (s: string) => s.normalize('NFC').toLowerCase();
const stem = (s: string) => norm(s).replace(/\.[^.]+$/, '');

/**
 * Pair each draft media file with one of the picked files: first by exact
 * file name, then by name without extension (a .mov exported as .mp4, say).
 */
export function matchMedia<F extends PickedFile>(refs: MediaRef[], files: F[]): Map<string, F> {
  const byName = new Map<string, F>();
  const byStem = new Map<string, F>();
  for (const f of files) {
    byName.set(norm(f.name), f);
    if (!byStem.has(stem(f.name))) byStem.set(stem(f.name), f);
  }
  const out = new Map<string, F>();
  for (const r of refs) {
    const f = byName.get(norm(r.fileName)) ?? byStem.get(stem(r.fileName));
    if (f) out.set(r.key, f);
  }
  return out;
}

/** Pick the draft JSON out of a selected folder (or a single chosen file). */
export function findDraftFile<F extends PickedFile>(files: F[]): F | undefined {
  const by = (n: string) => files.find((f) => norm(f.name) === n);
  return by('draft_content.json') ?? by('draft_info.json') ?? files.find((f) => norm(f.name).endsWith('.json') && !norm(f.name).includes('meta'));
}

export const FAILURE_MESSAGE: Record<DraftFailure, string> = {
  unreadable:
    'No se puede leer este borrador. Puede que esté cifrado o dañado: las versiones recientes de CapCut guardan algunos borradores así y Clipo no puede abrirlos. Prueba con otro borrador.',
  'not-a-draft': 'Este archivo no parece un borrador de CapCut. Elige la carpeta del borrador (la que contiene draft_content.json o draft_info.json).',
};
