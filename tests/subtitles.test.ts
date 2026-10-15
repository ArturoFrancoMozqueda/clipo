// Run with: npm test. Subtitle files (SRT / VTT) and word timing of karaoke captions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeWord, decodeSubtitleBytes, groupWords, parseSubtitles, relativeWords, shiftWords, textsToCues, toSRT, toVTT, wordTimings,
  type TimedWord,
} from '../src/subtitles.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('SRT with Windows line breaks, BOM, tags and two lines', () => {
  const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>¿Qué tal,</i> señor?\r\n\r\n2\r\n00:00:03,250 --> 00:01:04,005\r\nLínea uno\r\n{\\an8}Línea dos\r\n';
  const cues = parseSubtitles(srt);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 1, end: 2.5, text: '¿Qué tal, señor?' });
  const second = cues[1];
  assert.ok(second);
  near(second.start, 3.25);
  near(second.end, 64.005);
  assert.equal(second.text, 'Línea uno\nLínea dos');
});

test('VTT header, notes, styles, ids, cue settings, short times and entities', () => {
  const vtt = [
    'WEBVTT - mi video',
    '',
    'NOTE esto no es un subtítulo',
    '',
    'STYLE',
    '::cue { color: yellow }',
    '',
    'intro',
    '00:01.000 --> 00:02.000 align:center line:80%',
    '<v Ana>Hola &amp; adiós</v>',
    '',
    '01:00:00.5 --> 01:00:01.75',
    'Fin &lt;3',
  ].join('\n');
  const cues = parseSubtitles(vtt);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 1, end: 2, text: 'Hola & adiós' });
  const second = cues[1];
  assert.ok(second);
  near(second.start, 3600.5);
  near(second.end, 3601.75);
  assert.equal(second.text, 'Fin <3');
});

test('broken cues are skipped and cues come out in time order', () => {
  const srt = '1\n00:00:05,000 --> 00:00:06,000\nB\n\n2\n00:00:02,000 --> 00:00:01,000\nAl revés\n\n3\nsin tiempo\n\n4\n00:00:01,000 --> 00:00:02,000\nA\n\n5\n00:00:07,000 --> 00:00:08,000\n\n';
  assert.deepEqual(parseSubtitles(srt).map((c) => c.text), ['A', 'B']);
});

test('VTT karaoke timestamps become words', () => {
  const cues = parseSubtitles('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHola <00:00:01.500>mundo <00:00:02.000>de verdad\n');
  const [cue] = cues;
  assert.ok(cue);
  assert.equal(cue.text, 'Hola mundo de verdad');
  const w = cue.words!;
  assert.deepEqual(w.map((x) => x.text), ['Hola', 'mundo', 'de', 'verdad']);
  const [w0, w1, w2, w3] = w;
  assert.ok(w0 && w1 && w2 && w3);
  near(w0.start, 1);
  near(w1.start, 1.5);
  near(w2.start, 2);
  assert.ok(w3.start > 2 && w3.end <= 3 + 1e-9);
});

test('writing SRT and VTT, and reading them back', () => {
  const cues = [
    { start: 0, end: 1.2345, text: 'Primera línea\n\nsegunda' },
    { start: 3599.9996, end: 3601, text: 'A --> B & <c>' },
    { start: 5, end: 6, text: '   ' },
  ];
  const srt = toSRT(cues);
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:01,235\nPrimera línea\nsegunda\n\n2\n01:00:00,000 --> 01:00:01,000\nA → B & <c>\n');
  const vtt = toVTT(cues);
  assert.ok(vtt.startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:01.235\n'));
  assert.ok(vtt.includes('A → B &amp; &lt;c&gt;'));
  const back = parseSubtitles(vtt);
  assert.deepEqual(back.map((c) => c.text), ['Primera línea\nsegunda', 'A → B & <c>']);
  assert.equal(parseSubtitles(srt).length, 2);
});

test('texts → cues uses timeline times for the words', () => {
  const cues = textsToCues([
    { text: 'segundo', start: 4, duration: 1 },
    { text: 'hola todos', start: 1, duration: 2, words: [{ text: 'hola', start: 0, end: 0.5 }, { text: 'todos', start: 0.6, end: 1.4 }] },
    { text: '  ', start: 9, duration: 1 },
  ]);
  assert.deepEqual(cues.map((c) => [c.start, c.end, c.text]), [[1, 3, 'hola todos'], [4, 5, 'segundo']]);
  near(cues[0]!.words![1]!.start, 1.6);
});

test('subtitle bytes: UTF-8, Windows-1252 and UTF-16', () => {
  const utf8 = new TextEncoder().encode('Año y canción');
  assert.equal(decodeSubtitleBytes(utf8), 'Año y canción');
  // "Año" in Windows-1252: ñ = 0xF1, which is not valid UTF-8 on its own.
  assert.equal(decodeSubtitleBytes(new Uint8Array([0x41, 0xf1, 0x6f])), 'Año');
  const u16 = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0xf1, 0x00]);
  assert.equal(decodeSubtitleBytes(u16), 'Añ');
});

// ---------- grouping words ----------

/** Words said one after another, `gap` seconds apart. */
function say(text: string, from = 0, each = 0.3, gap = 0.05): TimedWord[] {
  let t = from;
  return text.split(' ').map((w) => {
    const r = { text: ` ${w}`, start: t, end: t + each };
    t += each + gap;
    return r;
  });
}

test('words are grouped into short lines with their own times', () => {
  const cues = groupWords(say('hola a todos y bienvenidos a mi canal de cocina casera'), { maxChars: 24 });
  for (const c of cues) assert.ok(c.text.length <= 24 + 8, c.text);
  assert.equal(cues.map((c) => c.text).join(' '), 'hola a todos y bienvenidos a mi canal de cocina casera');
  for (const c of cues) {
    near(c.start, c.words![0]!.start);
    near(c.end, c.words![c.words!.length - 1]!.end);
    assert.equal(c.text, c.words!.map((w) => w.text).join(' '));
  }
});

test('a long pause or the end of a sentence starts a new caption', () => {
  const ws = [...say('esto es lo primero.'), ...say('y esto va después', 1.6), ...say('tras una pausa larga', 5)];
  assert.deepEqual(groupWords(ws).map((c) => c.text), ['esto es lo primero.', 'y esto va después', 'tras una pausa larga']);
});

test('a caption does not stay too long and lone short words join the previous line', () => {
  const slow = groupWords(say('uno dos tres cuatro cinco seis', 0, 0.9, 0.1), { maxDur: 3.2, maxChars: 60 });
  for (const c of slow) assert.ok(c.end - c.start <= 3.2 + 1e-9 || c.words!.length === 1);
  assert.ok(slow.length >= 2);
  // "bien" alone would flash by; it is joined to the line before.
  const cues = groupWords(say('esto se ve muy bonito hoy y bien'), { maxChars: 28 });
  assert.equal(cues[cues.length - 1]!.text.endsWith('y bien'), true);
  assert.ok(cues.every((c) => c.words!.length > 1));
});

test('empty and zero-length words are cleaned', () => {
  const cues = groupWords([{ text: ' ', start: 0, end: 0.1 }, { text: 'hola', start: 1, end: 1 }]);
  assert.equal(cues.length, 1);
  const [cue] = cues;
  assert.ok(cue);
  assert.equal(cue.text, 'hola');
  assert.ok(cue.end > cue.start);
});

// ---------- karaoke timing ----------

test('recorded word times are used while the text still matches', () => {
  const words = [{ text: 'hola', start: 0.1, end: 0.4 }, { text: 'a', start: 0.5, end: 0.6 }, { text: 'todos', start: 0.8, end: 1.2 }];
  const t = wordTimings('Hola a\ntodos', words, 2);
  assert.deepEqual(t.map((x) => x.start), [0.1, 0.5, 0.8]);
  assert.equal(activeWord(t, 0), -1);
  assert.equal(activeWord(t, 0.5), 1);
  assert.equal(activeWord(t, 0.7), 1); // between words the last one stays lit
  assert.equal(activeWord(t, 1.9), 2);
});

test('edited or imported texts spread the words over the time on screen', () => {
  const t = wordTimings('uno dos tres', undefined, 3);
  assert.equal(t.length, 3);
  const [t0, t1, t2] = t;
  assert.ok(t0 && t1 && t2);
  near(t0.start, 0);
  near(t2.end, 3);
  assert.ok(t1.start > 0 && t2.start > t1.start);
  // A word was added after transcribing: keep inside the time the words were said.
  const words = [{ text: 'hola', start: 0.5, end: 0.9 }, { text: 'todos', start: 1, end: 1.5 }];
  const e = wordTimings('hola a todos', words, 4);
  assert.equal(e.length, 3);
  near(e[0]!.start, 0.5);
  near(e[2]!.end, 1.5);
});

test('splitting a caption keeps the words in sync, relative words never go negative', () => {
  const words = [{ text: 'a', start: 0.2, end: 0.4 }, { text: 'b', start: 1.2, end: 1.5 }];
  const shifted = shiftWords(words, 1)!;
  near(shifted[1]!.start, 0.2);
  near(shifted[0]!.start, -0.8);
  assert.equal(shiftWords(undefined, 1), undefined);
  const rel = relativeWords([{ text: 'x', start: 0.9, end: 1.3 }], 1)!;
  assert.deepEqual(rel.map((w) => w.start), [0]);
  near(rel[0]!.end, 0.3);
});
