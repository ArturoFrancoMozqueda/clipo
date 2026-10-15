import type { AspectId, PlatformId } from './types';

/**
 * Where each social network wants a video: formats, size, length and the parts of the screen its
 * app covers with buttons and text. Everything here is pure data so it can be tested and updated.
 *
 * VERIFICAR VIGENTE: las cifras cambian seguido. Revisadas en octubre de 2026 a partir de las guías
 * públicas de cada red; son aproximadas (sobre todo las zonas seguras, que cambian con cada versión
 * de la app y con el tamaño del teléfono). Ante la duda, quedarse con lo más estricto.
 */

/** Margins as a fraction of the frame (0..1) that the app's interface covers. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Platform {
  id: PlatformId;
  /** Name shown to the user. */
  name: string;
  /** Short note shown under the name. */
  hint: string;
  /** Accepted formats; the first one is the recommended one. */
  formats: AspectId[];
  /** Recommended short side in pixels (1080 → 1080×1920 vertical, 1920×1080 horizontal). */
  short: number;
  /** Highest frame rate accepted. Clipo exports at 30 fps, which every network accepts. */
  maxFps: number;
  /** Longest video, in seconds. */
  maxSeconds: number;
  /** Shortest video, in seconds (0 = no minimum). */
  minSeconds: number;
  /** Largest file, in bytes. */
  maxBytes: number;
  /** Characters allowed in the post text (description + hashtags). */
  captionMax: number;
  /** The network asks for a separate title. */
  hasTitle?: boolean;
  /** Longest title, in characters. */
  titleMax?: number;
  /** Safe zone for the recommended format. Other formats use GENERIC_SAFE. */
  safe: Insets;
  /** Extra note about the limits (e.g. what depends on the account). */
  note?: string;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;
const MIN = 60;

/** For formats without a known overlay layout: player controls at the bottom and a small border. */
export const GENERIC_SAFE: Insets = { top: 0.05, right: 0.05, bottom: 0.1, left: 0.05 };

// Verificar vigente (revisado 2026-10).
export const PLATFORMS: Record<PlatformId, Platform> = {
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    hint: 'Vertical',
    formats: ['9:16', '1:1', '16:9'],
    short: 1080,
    maxFps: 60,
    maxSeconds: 60 * MIN,
    minSeconds: 1,
    maxBytes: 4 * GB,
    captionMax: 2200,
    // Top: "Siguiendo / Para ti". Right: like, comments, share. Bottom: name, text and music.
    safe: { top: 0.08, right: 0.13, bottom: 0.2, left: 0.05 },
    note: 'Hasta 60 min al subir desde el teléfono o la PC; algunas cuentas tienen menos.',
  },
  instagram_reels: {
    id: 'instagram_reels',
    name: 'Instagram Reels',
    hint: 'Vertical',
    formats: ['9:16', '4:5', '1:1'],
    short: 1080,
    maxFps: 60,
    maxSeconds: 3 * MIN,
    minSeconds: 3,
    maxBytes: 300 * MB,
    captionMax: 2200,
    // Top: camera and title. Right: buttons. Bottom: profile, text and audio (the tallest of all).
    safe: { top: 0.13, right: 0.11, bottom: 0.22, left: 0.05 },
    note: 'Los Reels más largos de 3 min se muestran como video normal y pueden no recomendarse.',
  },
  youtube_shorts: {
    id: 'youtube_shorts',
    name: 'YouTube Shorts',
    hint: 'Vertical',
    formats: ['9:16', '1:1'],
    short: 1080,
    maxFps: 60,
    maxSeconds: 3 * MIN,
    minSeconds: 1,
    maxBytes: 256 * GB,
    captionMax: 5000,
    hasTitle: true,
    titleMax: 100,
    safe: { top: 0.08, right: 0.13, bottom: 0.2, left: 0.05 },
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    hint: 'Horizontal',
    formats: ['16:9'],
    short: 1080,
    maxFps: 60,
    maxSeconds: 15 * MIN,
    minSeconds: 0,
    maxBytes: 256 * GB,
    captionMax: 5000,
    hasTitle: true,
    titleMax: 100,
    // Bottom: progress bar and controls. Top: title while paused.
    safe: { top: 0.08, right: 0.04, bottom: 0.12, left: 0.04 },
    note: 'Más de 15 min requiere verificar la cuenta (hasta 12 h).',
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    hint: 'Publicación',
    formats: ['4:5', '1:1', '16:9', '9:16'],
    short: 1080,
    maxFps: 60,
    maxSeconds: 240 * MIN,
    minSeconds: 1,
    maxBytes: 10 * GB,
    captionMax: 63206,
    safe: { top: 0.05, right: 0.05, bottom: 0.12, left: 0.05 },
  },
  x: {
    id: 'x',
    name: 'X (Twitter)',
    hint: 'Publicación',
    formats: ['16:9', '1:1', '9:16'],
    short: 1080,
    maxFps: 60,
    maxSeconds: 140,
    minSeconds: 0.5,
    maxBytes: 512 * MB,
    captionMax: 280,
    safe: { top: 0.05, right: 0.05, bottom: 0.12, left: 0.05 },
    note: 'Las cuentas de pago permiten videos más largos.',
  },
  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    hint: 'Publicación',
    formats: ['1:1', '16:9', '4:5', '9:16'],
    short: 1080,
    maxFps: 60,
    maxSeconds: 30 * MIN,
    minSeconds: 3,
    maxBytes: 5 * GB,
    captionMax: 3000,
    safe: { top: 0.05, right: 0.05, bottom: 0.12, left: 0.05 },
  },
};

export const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];

export const isPlatformId = (v: unknown): v is PlatformId => typeof v === 'string' && v in PLATFORMS;

/** The area of a network's screen to keep important text out of, for a given format. */
export function safeZoneFor(id: PlatformId, aspect: AspectId): Insets {
  const p = PLATFORMS[id];
  return aspect === p.formats[0] ? p.safe : GENERIC_SAFE;
}

/** Video bitrate the exporter uses for an output size (bits per second). */
export const exportBitrate = (short: number) => (short >= 1080 ? 8_000_000 : 5_000_000);
export const AUDIO_BITRATE = 160_000;

/** Approximate file size of an export, in bytes (MP4 overhead included). */
export function estimateBytes(seconds: number, short: number) {
  return Math.ceil((Math.max(0, seconds) * (exportBitrate(short) + AUDIO_BITRATE) * 1.02) / 8);
}

/** "#viaje #playa" or "viaje, playa" → ['#viaje', '#playa'], without duplicates. */
export function parseHashtags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const tag = raw.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (!tag) continue;
    const h = `#${tag}`;
    if (!out.some((x) => x.toLowerCase() === h.toLowerCase())) out.push(h);
  }
  return out;
}

/** Description and hashtags as they would be pasted into the network. */
export function postCaption(description: string, hashtags: string) {
  const tags = parseHashtags(hashtags).join(' ');
  const d = description.trim();
  return d && tags ? `${d}\n\n${tags}` : d || tags;
}

/** "1,5 GB", "300 MB". */
export function fmtBytes(n: number) {
  if (n >= GB) return `${(n / GB).toLocaleString('es', { maximumFractionDigits: 1 })} GB`;
  return `${Math.max(1, Math.round(n / MB))} MB`;
}

/** "45 s", "3 min", "2 min 20 s", "4 h". */
export function fmtSeconds(s: number) {
  s = Math.round(s);
  if (s < 60) return `${s} s`;
  if (s >= 3600 && s % 3600 === 0) return `${s / 3600} h`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

// ---------- checks before publishing ----------

/**
 * "Revisar antes de publicar": checks a version of the video against a network's limits and says
 * what to do about each problem. Pure (the measurements come from the caller) so it can be tested.
 */

export interface AudioLevels {
  /** Loudest sample, in dBFS (0 = the maximum). -Infinity for silence. */
  peakDb: number;
  /** Average level, in dBFS. */
  rmsDb: number;
  /** Share of samples at the very top (0..1): clipping. */
  clipped: number;
}

/** Where a text or sticker sits, as fractions of the frame. */
export interface ItemBox {
  kind: 'text' | 'sticker';
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CheckInput {
  platform: PlatformId;
  aspect: AspectId;
  duration: number;
  /** Short side of the export, e.g. 720 or 1080. */
  short: number;
  /** null when not measured (e.g. no sound to check). */
  audio: AudioLevels | null;
  /** Texts and stickers in this format. */
  boxes: ItemBox[];
  description?: string;
  hashtags?: string;
  title?: string;
}

export type IssueLevel = 'error' | 'warn' | 'ok';

export interface Issue {
  level: IssueLevel;
  /** What is wrong (or right). */
  text: string;
  /** What to do. */
  fix?: string;
}

/** Below this average level the video sounds too quiet next to others in the feed. */
export const QUIET_DB = -30;
/** More than this share of clipped samples sounds distorted. */
const CLIP_SHARE = 0.0005;

const dbOf = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

/** Peak, average and clipping of mixed audio channels. */
export function audioLevels(channels: ArrayLike<number>[]): AudioLevels {
  let peak = 0;
  let sq = 0;
  let n = 0;
  let clip = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
      if (a >= 0.999) clip++;
      sq += a * a;
      n++;
    }
  }
  return { peakDb: dbOf(peak), rmsDb: n ? dbOf(Math.sqrt(sq / n)) : -Infinity, clipped: n ? clip / n : 0 };
}

const short = (s: string, n = 24) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

const SIDE_TEXT = {
  top: { where: 'arriba', fix: 'Bájalo un poco' },
  bottom: { where: 'abajo', fix: 'Súbelo un poco' },
  left: { where: 'a la izquierda', fix: 'Muévelo hacia el centro' },
  right: { where: 'a la derecha', fix: 'Muévelo hacia el centro' },
} as const;

/** Which edge of the safe zone a box crosses the most, or null when it is fully inside. */
export function outsideSide(b: ItemBox, platform: PlatformId, aspect: AspectId): keyof typeof SIDE_TEXT | null {
  const z = safeZoneFor(platform, aspect);
  const over = {
    top: z.top - b.y0,
    bottom: b.y1 - (1 - z.bottom),
    left: z.left - b.x0,
    right: b.x1 - (1 - z.right),
  };
  let best: keyof typeof SIDE_TEXT | null = null;
  let most = 0.002; // tolerance: a hair over the line is fine
  for (const k of Object.keys(over) as (keyof typeof over)[]) {
    if (over[k] > most) {
      most = over[k];
      best = k;
    }
  }
  return best;
}

export function checkVersion(c: CheckInput): Issue[] {
  const p = PLATFORMS[c.platform];
  const out: Issue[] = [];

  if (!p.formats.includes(c.aspect)) {
    out.push({
      level: 'error',
      text: `${p.name} no usa el formato ${c.aspect}.`,
      fix: `Elige ${p.formats.join(' o ')} para esta red.`,
    });
  } else if (c.aspect !== p.formats[0]) {
    out.push({
      level: 'warn',
      text: `${p.name} acepta ${c.aspect}, pero se ve mejor en ${p.formats[0]}.`,
      fix: `Si puedes, guarda esta versión en ${p.formats[0]} para ocupar toda la pantalla.`,
    });
  }

  if (c.duration > p.maxSeconds + 0.05) {
    out.push({
      level: 'error',
      text: `Dura ${fmtSeconds(c.duration)} y ${p.name} admite hasta ${fmtSeconds(p.maxSeconds)}.`,
      fix: `Recorta ${fmtSeconds(Math.ceil(c.duration - p.maxSeconds))} o divide el video en partes.`,
    });
  } else if (c.duration < p.minSeconds) {
    out.push({
      level: 'error',
      text: `Dura ${fmtSeconds(c.duration)} y ${p.name} pide al menos ${fmtSeconds(p.minSeconds)}.`,
      fix: 'Alarga el último clip o agrega una foto al final.',
    });
  } else {
    out.push({ level: 'ok', text: `Duración correcta (${fmtSeconds(c.duration)}).` });
  }
  if (p.note && c.duration > p.maxSeconds * 0.8) out.push({ level: 'warn', text: p.note });

  const bytes = estimateBytes(c.duration, c.short);
  if (bytes > p.maxBytes) {
    out.push({
      level: 'error',
      text: `Pesará unos ${fmtBytes(bytes)} y ${p.name} admite hasta ${fmtBytes(p.maxBytes)}.`,
      fix: c.short > 720 ? 'Guarda en 720p o acorta el video.' : 'Acorta el video.',
    });
  } else {
    out.push({ level: 'ok', text: `Peso estimado: unos ${fmtBytes(bytes)}.` });
  }

  if (c.audio) {
    if (c.audio.peakDb === -Infinity) {
      out.push({ level: 'warn', text: 'El video no tiene sonido.', fix: 'Si es a propósito, está bien. Si no, agrega música en “Música”.' });
    } else if (c.audio.clipped > CLIP_SHARE) {
      out.push({
        level: 'warn',
        text: 'El sonido está saturado: algunas partes suenan distorsionadas.',
        fix: 'Baja el volumen de la música o de los clips más fuertes (toca el clip → Volumen).',
      });
    } else if (c.audio.rmsDb < QUIET_DB) {
      out.push({
        level: 'warn',
        text: 'El sonido está muy bajo: se escuchará menos que otros videos.',
        fix: 'Sube el volumen de tus clips o de la voz (toca el clip → Volumen).',
      });
    } else {
      out.push({ level: 'ok', text: 'Volumen del sonido correcto.' });
    }
  }

  let outside = 0;
  for (const b of c.boxes) {
    const side = outsideSide(b, c.platform, c.aspect);
    if (!side) continue;
    outside++;
    if (outside > 5) continue; // the rest are summed up below
    const what = b.kind === 'text' ? `El texto “${short(b.label)}”` : 'Un sticker';
    out.push({
      level: 'warn',
      text: `${what} queda ${SIDE_TEXT[side].where}, donde ${p.name} pone sus botones o textos.`,
      fix: `${SIDE_TEXT[side].fix}. Activa “Ver zona segura” para ver el área libre.`,
    });
  }
  if (outside > 5) out.push({ level: 'warn', text: `Hay ${outside - 5} textos o stickers más fuera de la zona segura.` });
  else if (!outside && c.boxes.length) out.push({ level: 'ok', text: 'Textos y stickers dentro de la zona segura.' });

  const caption = postCaption(c.description ?? '', c.hashtags ?? '');
  if (caption.length > p.captionMax) {
    out.push({
      level: 'error',
      text: `La descripción con hashtags tiene ${caption.length} caracteres y ${p.name} admite ${p.captionMax}.`,
      fix: `Quita ${caption.length - p.captionMax} caracteres.`,
    });
  }
  if (p.hasTitle && p.titleMax && (c.title ?? '').length > p.titleMax) {
    out.push({ level: 'error', text: `El título es muy largo (máximo ${p.titleMax} caracteres).`, fix: 'Acórtalo.' });
  }
  return out;
}

/** The worst level in a list: what the summary badge shows. */
export function worstLevel(issues: Issue[]): IssueLevel {
  if (issues.some((i) => i.level === 'error')) return 'error';
  if (issues.some((i) => i.level === 'warn')) return 'warn';
  return 'ok';
}
