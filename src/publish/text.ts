// Post text helpers and the YouTube (incl. Shorts), Facebook and Instagram rules. Pure functions.
import { fmtBytes, fmtSeconds, PLATFORMS } from '../platforms';
import type { NetworkId, PostOptions, PostText, VideoInfo } from './types';

/** "#viaje playa, #Mar #mar" -> ["#viaje", "#playa", "#Mar"] (no duplicates, case-insensitive). */
export function parseHashtags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const word = raw.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    out.push(`#${word}`);
  }
  return out;
}

/** Common text plus an optional per-network override (empty override fields fall back). */
export function mergePost(common: PostText, own?: Partial<PostText>): PostText {
  return {
    title: own?.title?.trim() ? own.title : common.title,
    description: own?.description?.trim() ? own.description : common.description,
    hashtags: own?.hashtags?.trim() ? own.hashtags : common.hashtags,
  };
}

// ---------- YouTube ----------

/** YouTube treats square or vertical videos up to 3 minutes as Shorts. */
export const SHORTS_MAX_SECONDS = 180;
const TITLE_MAX = 100;
const DESCRIPTION_MAX_BYTES = 5000;
const TAGS_MAX_CHARS = 500;

const noAngles = (s: string) => s.replace(/[<>]/g, '');

/** Cut to at most `max` UTF-8 bytes without breaking a character. */
export function truncateBytes(s: string, max: number): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  let out = '';
  let used = 0;
  for (const ch of s) {
    const n = enc.encode(ch).length;
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return out;
}

/** Problems that block uploading this video to YouTube (or as a Short). */
export function checkYouTube(network: NetworkId, video: VideoInfo, post: PostText): string[] {
  const issues: string[] = [];
  if (!youtubeTitle(post, video)) issues.push('Escribe un título para YouTube.');
  if (network === 'youtube_shorts') {
    if (video.width > video.height) issues.push('Para Shorts el video tiene que ser vertical o cuadrado (usa el formato 9:16).');
    if (video.duration > SHORTS_MAX_SECONDS + 0.5) issues.push('Un Short puede durar como máximo 3 minutos.');
  }
  return issues;
}

/** The title YouTube will get: the post title, else the first line of the description, else the file name. */
export function youtubeTitle(post: PostText, video: VideoInfo): string {
  const first = post.description.split('\n').find((l) => l.trim()) ?? '';
  const base = post.title?.trim() || first.trim() || video.name.replace(/\.[^.]+$/, '');
  return [...noAngles(base).trim()].slice(0, TITLE_MAX).join('');
}

export interface YouTubeMetadata {
  snippet: { title: string; description: string; tags?: string[]; categoryId: string };
  status: { privacyStatus: 'public' | 'unlisted' | 'private'; selfDeclaredMadeForKids: boolean; publishAt?: string };
}

/** The `video` resource sent when the upload starts (videos.insert, part=snippet,status). */
export function buildYouTubeMetadata(network: NetworkId, video: VideoInfo, post: PostText, options: PostOptions): YouTubeMetadata {
  const tags = parseHashtags(post.hashtags);
  if (network === 'youtube_shorts' && !tags.some((t) => t.toLowerCase() === '#shorts')) tags.push('#Shorts');
  const title = youtubeTitle(post, video);
  // Hashtags go at the end of the description (YouTube links them) and, without '#', as tags.
  const body = noAngles(post.description).trim();
  const description = truncateBytes([body, tags.join(' ')].filter(Boolean).join('\n\n'), DESCRIPTION_MAX_BYTES);
  const keywords: string[] = [];
  let used = 0;
  for (const t of tags.map((t) => t.slice(1))) {
    const cost = t.length + (t.includes(' ') ? 2 : 0) + (keywords.length ? 1 : 0);
    if (used + cost > TAGS_MAX_CHARS) break;
    keywords.push(t);
    used += cost;
  }
  const meta: YouTubeMetadata = {
    snippet: { title, description, categoryId: '22' },
    status: { privacyStatus: options.privacy, selfDeclaredMadeForKids: options.madeForKids },
  };
  if (keywords.length) meta.snippet.tags = keywords;
  // YouTube's own scheduling: only for private videos that were never published.
  if (options.nativePublishAt) {
    meta.status.privacyStatus = 'private';
    meta.status.publishAt = new Date(options.nativePublishAt).toISOString();
  }
  return meta;
}

export const youtubeUrl = (network: NetworkId, id: string) =>
  network === 'youtube_shorts' ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;

// ---------- Facebook and Instagram (Meta) ----------
// Limits of the Graph API (verified Oct 2026, Graph API v26.0):
// https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
// https://developers.facebook.com/docs/graph-api/reference/page/videos/

/** Instagram Reels published through the API: 3 s to 15 min, up to 300 MB, at most 1920 px wide. */
export const IG_REELS_MIN_SECONDS = 3;
export const IG_REELS_MAX_SECONDS = 15 * 60;
export const IG_REELS_MAX_BYTES = PLATFORMS.instagram_reels.maxBytes;
export const IG_REELS_MAX_WIDTH = 1920;
const IG_HASHTAGS_MAX = 30;
const IG_MENTIONS_MAX = 20;
const FB_TITLE_MAX = 255;
/** Facebook schedules between 10 minutes and 6 months ahead. */
export const FB_SCHEDULE_MAX_MS = 180 * 24 * 3600_000;

/** Description and hashtags as one caption (Facebook and Instagram have no separate tags). */
export function metaCaption(post: PostText): string {
  const tags = parseHashtags(post.hashtags).join(' ');
  const body = post.description.trim();
  return body && tags ? `${body}\n\n${tags}` : body || tags;
}

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/** Problems that block publishing this video on a Facebook Page or as an Instagram Reel. */
export function checkMeta(network: NetworkId, video: VideoInfo, post: PostText): string[] {
  const issues: string[] = [];
  const caption = metaCaption(post);
  const len = [...caption].length;
  if (network === 'instagram_reels') {
    const p = PLATFORMS.instagram_reels;
    if (video.duration && video.duration < IG_REELS_MIN_SECONDS - 0.05) issues.push('Un Reel tiene que durar al menos 3 segundos.');
    if (video.duration > IG_REELS_MAX_SECONDS + 0.5) issues.push('Por API, Instagram acepta Reels de hasta 15 minutos.');
    if (video.bytes > IG_REELS_MAX_BYTES) issues.push(`Instagram acepta Reels de hasta ${fmtBytes(IG_REELS_MAX_BYTES)}. Exporta en menor calidad o más corto.`);
    if (video.width > IG_REELS_MAX_WIDTH) issues.push('Instagram acepta videos de hasta 1920 píxeles de ancho. Exporta en 1080p.');
    if (video.type && !/^video\/(mp4|quicktime)$/.test(video.type)) issues.push('Instagram solo acepta videos MP4 o MOV.');
    if (len > p.captionMax) issues.push(`El texto pasa de ${p.captionMax} letras (lleva ${len}).`);
    if (count(caption, /(^|\s)#[\p{L}\p{N}_]+/gu) > IG_HASHTAGS_MAX) issues.push(`Instagram acepta hasta ${IG_HASHTAGS_MAX} hashtags.`);
    if (count(caption, /(^|\s)@[\w.]+/g) > IG_MENTIONS_MAX) issues.push(`Instagram acepta hasta ${IG_MENTIONS_MAX} menciones (@).`);
    return issues;
  }
  const p = PLATFORMS.facebook;
  if (video.duration > p.maxSeconds + 0.5) issues.push(`Facebook acepta videos de hasta ${fmtSeconds(p.maxSeconds)}.`);
  if (video.bytes > p.maxBytes) issues.push(`Facebook acepta videos de hasta ${fmtBytes(p.maxBytes)}.`);
  if (len > p.captionMax) issues.push(`El texto pasa de ${p.captionMax} letras.`);
  if ([...(post.title ?? '').trim()].length > FB_TITLE_MAX) issues.push(`El título pasa de ${FB_TITLE_MAX} letras.`);
  return issues;
}
