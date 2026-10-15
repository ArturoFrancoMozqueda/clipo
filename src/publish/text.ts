// Post text helpers and the YouTube (incl. Shorts) metadata rules. Pure functions.
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
