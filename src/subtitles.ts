// Subtitle files (SRT / WebVTT) and word timing for karaoke captions.
// Pure functions with no browser APIs, so they run in the tests as they are.
import type { CaptionWord, TextItem } from './types';

/** A word with timeline times in seconds. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/** One subtitle on screen. Times are timeline seconds. */
export interface Cue {
  start: number;
  end: number;
  text: string;
  /** Per-word times (timeline seconds), when known. */
  words?: TimedWord[];
}

// ---------- grouping words into captions ----------

export interface GroupOptions {
  /** Longest line, in characters. */
  maxChars: number;
  /** A pause longer than this (seconds) starts a new caption. */
  maxGap: number;
  /** Longest a caption stays on screen while words keep coming (seconds). */
  maxDur: number;
}

export const GROUP_DEFAULTS: GroupOptions = { maxChars: 32, maxGap: 0.7, maxDur: 3.2 };

const SENTENCE_END = /[.?!…]["»”')]*$/;

/**
 * Join Whisper's words into short captions that are easy to read on a phone: a new caption
 * starts at a long pause, at the end of a sentence, or when the line gets too long.
 */
export function groupWords(input: TimedWord[], opts: Partial<GroupOptions> = {}): Cue[] {
  const o = { ...GROUP_DEFAULTS, ...opts };
  const words = input
    .map((w) => ({ text: w.text.trim(), start: w.start, end: Math.max(w.end, w.start + 0.05) }))
    .filter((w) => w.text);
  const cues: Cue[] = [];
  let cur: TimedWord[] = [];
  const len = (ws: TimedWord[]) => ws.reduce((n, w, i) => n + w.text.length + (i ? 1 : 0), 0);
  const flush = () => {
    const first = cur[0];
    const last = cur.at(-1);
    if (!first || !last) return;
    cues.push({ start: first.start, end: last.end, text: cur.map((w) => w.text).join(' '), words: cur });
    cur = [];
  };
  for (const w of words) {
    const first = cur[0];
    const last = cur.at(-1);
    if (first && last) {
      const tooLong = len(cur) + 1 + w.text.length > o.maxChars;
      const pause = w.start - last.end > o.maxGap;
      const tooSlow = w.end - first.start > o.maxDur;
      const sentence = SENTENCE_END.test(last.text) && len(cur) >= 8;
      if (tooLong || pause || tooSlow || sentence) flush();
    }
    cur.push(w);
  }
  flush();
  // Don't leave one short word alone on screen for a split second.
  for (let i = cues.length - 1; i > 0; i--) {
    const c = cues[i]!;
    const prev = cues[i - 1]!;
    if (
      c.words!.length === 1 &&
      c.text.length < 10 &&
      c.start - prev.end <= o.maxGap &&
      !SENTENCE_END.test(prev.text) &&
      prev.text.length + 1 + c.text.length <= o.maxChars + 8
    ) {
      cues.splice(i - 1, 2, { start: prev.start, end: c.end, text: `${prev.text} ${c.text}`, words: [...prev.words!, ...c.words!] });
    }
  }
  return cues;
}

// ---------- karaoke timing ----------

/** The words of a text as they are drawn: one array per line. */
export const textTokens = (text: string) => text.split('\n').map((l) => l.split(/\s+/).filter(Boolean));

/**
 * When each word of `text` is said, in seconds from the text's start. Uses the recorded words
 * when they still match the text; otherwise (edited text, imported subtitles) spreads the
 * words over the time the text is on screen, longer words taking longer.
 */
export function wordTimings(text: string, words: CaptionWord[] | undefined, duration: number): { start: number; end: number }[] {
  const tokens = textTokens(text).flat();
  if (!tokens.length) return [];
  if (words && words.length === tokens.length) return words.map((w) => ({ start: w.start, end: w.end }));
  let a = 0;
  let b = duration;
  const first = words?.[0];
  const last = words?.at(-1);
  if (first && last) {
    a = Math.max(0, first.start);
    b = Math.min(duration, Math.max(a + 0.1, last.end));
  }
  const weights = tokens.map((t) => t.length + 1);
  const total = weights.reduce((s, x) => s + x, 0);
  let t = a;
  return weights.map((w) => {
    const d = ((b - a) * w) / total;
    const r = { start: t, end: t + d };
    t += d;
    return r;
  });
}

/** Index of the word being said at `local` seconds: the last one that has started, or -1. */
export function activeWord(timings: { start: number }[], local: number): number {
  let k = -1;
  for (let i = 0; i < timings.length; i++) if (timings[i]!.start <= local + 1e-6) k = i;
  return k;
}

/** Word times after the text's start moves `dt` seconds later (splitting a caption). */
export function shiftWords(words: CaptionWord[] | undefined, dt: number): CaptionWord[] | undefined {
  return words?.map((w) => ({ ...w, start: w.start - dt, end: w.end - dt }));
}

/** Words with timeline times → words relative to a caption that starts at `start`. */
export const relativeWords = (words: TimedWord[] | undefined, start: number): CaptionWord[] | undefined =>
  words?.map((w) => ({ text: w.text, start: Math.max(0, w.start - start), end: Math.max(0, w.end - start) }));

/** Captions of a project as cues, in time order. */
export function textsToCues(texts: Pick<TextItem, 'text' | 'start' | 'duration' | 'words'>[]): Cue[] {
  return texts
    .filter((t) => t.text.trim())
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((t) => ({
      start: t.start,
      end: t.start + t.duration,
      text: t.text.trim(),
      words: t.words?.map((w) => ({ text: w.text, start: t.start + w.start, end: t.start + w.end })),
    }));
}

// ---------- writing SRT / VTT ----------

function stamp(sec: number, sep: ',' | '.') {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(ms % 1000, 3)}`;
}

/** Subtitle text without blank lines (they end a cue) or arrows (they look like timings). */
const safeText = (t: string) =>
  t
    .split('\n')
    .map((l) => l.trim().replace(/-->/g, '→'))
    .filter(Boolean)
    .join('\n');

export function toSRT(cues: Cue[]): string {
  return cues
    .filter((c) => safeText(c.text))
    .map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${safeText(c.text)}\n`)
    .join('\n');
}

const vttEscape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toVTT(cues: Cue[]): string {
  const body = cues
    .filter((c) => safeText(c.text))
    .map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${vttEscape(safeText(c.text))}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

// ---------- reading SRT / VTT ----------

const TIME = String.raw`(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?`;
const TIME_LINE = new RegExp(String.raw`^\s*${TIME}\s*-->\s*${TIME}`);
const INLINE_TIME = new RegExp(String.raw`<${TIME}>`, 'g');

// The minutes and seconds groups are not optional in the patterns, so they are always matched.
const toSec = (h: string | undefined, m: string | undefined, s: string | undefined, f: string | undefined) =>
  Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + (f ? Number(f.padEnd(3, '0')) / 1000 : 0);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' };

/** Plain text of a cue: no HTML/VTT tags, no SSA overrides like {\an8}, entities decoded. */
function cleanCueText(t: string) {
  return t
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Words of a VTT karaoke cue (`<00:01.500>word`), spread inside each timed piece. */
function inlineWords(raw: string, start: number, end: number): TimedWord[] | undefined {
  const marks: { at: number; index: number; len: number }[] = [];
  for (const m of raw.matchAll(INLINE_TIME)) marks.push({ at: toSec(m[1], m[2], m[3], m[4]), index: m.index!, len: m[0].length });
  if (!marks.length) return undefined;
  const pieces: { text: string; start: number; end: number }[] = [];
  let from = 0;
  let at = start;
  marks.forEach((mk, i) => {
    pieces.push({ text: raw.slice(from, mk.index), start: at, end: mk.at });
    from = mk.index + mk.len;
    at = mk.at;
    if (i === marks.length - 1) pieces.push({ text: raw.slice(from), start: at, end });
  });
  const out: TimedWord[] = [];
  for (const p of pieces) {
    const ws = cleanCueText(p.text).split(/\s+/).filter(Boolean);
    const total = ws.reduce((n, w) => n + w.length, 0);
    let t = p.start;
    for (const w of ws) {
      const d = ((Math.max(p.end, p.start) - p.start) * w.length) / total;
      out.push({ text: w, start: t, end: t + d });
      t += d;
    }
  }
  return out.length ? out : undefined;
}

/** Read an SRT or WebVTT file. Unknown blocks (headers, NOTE, STYLE…) are skipped. */
export function parseSubtitles(raw: string): Cue[] {
  const lines = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd());
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (l.trim()) cur.push(l);
    else if (cur.length) {
      blocks.push(cur);
      cur = [];
    }
  }
  if (cur.length) blocks.push(cur);

  const cues: Cue[] = [];
  for (const b of blocks) {
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(b[0]!)) {
      // A cue can't start with these words; the header may still share the block in sloppy files.
      if (!b.some((l) => TIME_LINE.test(l))) continue;
    }
    const at = b.findIndex((l) => TIME_LINE.test(l));
    if (at < 0) continue;
    const m = TIME_LINE.exec(b[at]!)!;
    const start = toSec(m[1], m[2], m[3], m[4]);
    const end = toSec(m[5], m[6], m[7], m[8]);
    const rawText = b.slice(at + 1).join('\n');
    const text = cleanCueText(rawText);
    if (!text || !(end > start)) continue;
    const words = inlineWords(rawText, start, end);
    cues.push(words ? { start, end, text, words } : { start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/**
 * Turn the bytes of a subtitle file into text. Most files are UTF-8, but many SRT files made on
 * Windows are Latin-1 / Windows-1252, which would break "ñ" and accents if read as UTF-8.
 */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
