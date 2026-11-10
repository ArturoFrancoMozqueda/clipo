// Run with: npm test. Built-in resources of the creative panels: templates, text looks, caption looks,
// filters, effects and stickers must all be consistent and build valid projects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { stub } from './helpers/hooks.ts';
import type { Asset } from '../src/types.ts';

stub('engine', 'export const engine = { pause() {}, play() {} };');
// Text fitting measures with a canvas; without one it keeps the template's own sizes.
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ getContext: () => null }) };

const { BUILTIN_TEMPLATES } = await import('../src/templates/builtin.ts');
const { projectFromTemplate, fillText } = await import('../src/templates/build.ts');
const { templateDuration, TEMPLATE_CATEGORIES } = await import('../src/templates/types.ts');
const { normalizeProject } = await import('../src/normalize.ts');
const { TEXT_PRESETS, applyPreset, searchPresets, PLACEHOLDER_TEXT } = await import('../src/textPresets.ts');
const { TEXT_STYLES, getTextStyle, styleCase } = await import('../src/textStyles.ts');
const { getFont } = await import('../src/fonts.ts');
const { CAPTION_STYLES, CHUNK_OPTIONS, lookWithStyle, DEFAULT_LOOK } = await import('../src/captions.ts');
const { groupWords } = await import('../src/subtitles.ts');
const { FILTERS } = await import('../src/filters.ts');
const { EFFECTS, TRANSITIONS } = await import('../src/visuals.ts');
const { EFFECT_ICONS } = await import('../src/components/fxIcons.ts');
const { STICKER_ART, STICKER_GROUPS, searchStickers, stickerUrl } = await import('../src/stickers.ts');
const { hitPulse } = await import('../src/fxmath.ts');
const { pushRecent } = await import('../src/favorites.ts');

const unique = (ids: string[], what: string) => assert.equal(new Set(ids).size, ids.length, `${what} has repeated ids`);

function fakeAssets(n: number): Asset[] {
  return Array.from({ length: n }, (_, i) => ({ id: `a${i}`, kind: i % 2 ? 'video' : 'image', name: `m${i}`, duration: 8, width: 1080, height: 1920 }) as Asset);
}

test('every built-in template builds a valid project', () => {
  unique(BUILTIN_TEMPLATES.map((t) => t.id), 'templates');
  assert.ok(BUILTIN_TEMPLATES.length >= 20);
  const cats = new Set<string>(TEMPLATE_CATEGORIES.map((c) => c.id));
  for (const t of BUILTIN_TEMPLATES) {
    assert.ok(t.category && cats.has(t.category), `${t.id} has no gallery category`);
    assert.ok(t.slots.length > 0 && templateDuration(t) >= 5, t.id);
    for (const x of t.texts) {
      assert.ok(x.slot === 'all' || (x.slot >= 0 && x.slot < t.slots.length), `${t.id}: text on missing slot ${x.slot}`);
      assert.ok(x.x >= 0 && x.x <= 1 && x.y >= 0 && x.y <= 1, `${t.id}: text outside the frame`);
      assert.ok(TEXT_STYLES.some((s) => s.id === x.styleId), `${t.id}: unknown style ${x.styleId}`);
      for (const [, key] of x.text.matchAll(/\{(\w+)\}/g)) assert.ok(t.fields.some((f) => f.key === key), `${t.id}: {${key}} has no field`);
    }
    unique(t.fields.map((f) => f.key), `${t.id} fields`);
    for (const s of t.slots) assert.ok(FILTERS.some((f) => f.id === s.filter), `${t.id}: unknown filter ${s.filter}`);

    // With every file, with fewer files than slots, and with the example answers.
    for (const count of [t.slots.length, 1]) {
      const media = fakeAssets(count);
      const p = normalizeProject(projectFromTemplate(t, media, {}));
      assert.equal(p.clips.length, t.slots.length, t.id);
      assert.equal(p.texts.length, t.texts.length, t.id);
      for (const c of p.clips) {
        assert.ok(p.assets[c.assetId], t.id);
        assert.ok(c.out > c.in, t.id);
      }
      const end = p.clips.reduce((s, c) => s + (c.out - c.in) / c.speed, 0);
      for (const x of p.texts) {
        assert.ok(x.text.trim() && !/\{\w+\}/.test(x.text), `${t.id}: unfilled text "${x.text}"`);
        assert.ok(x.duration >= 0.5 && x.start >= 0 && x.start + x.duration <= end + 1e-6, `${t.id}: text outside the video`);
      }
    }
  }
});

test('template fields fall back to their example when left empty', () => {
  const t = BUILTIN_TEMPLATES[0]!;
  const f = t.fields[0]!;
  assert.equal(fillText(`{${f.key}}`, t, { [f.key]: '  ' }), f.default);
  assert.equal(fillText(`{${f.key}}`, t, { [f.key]: 'Hola' }), 'Hola');
});

test('text styles and quick looks are consistent', () => {
  unique(TEXT_STYLES.map((s) => s.id), 'text styles');
  assert.ok(TEXT_STYLES.length >= 30);
  unique(TEXT_PRESETS.map((p) => p.id), 'text presets');
  assert.ok(TEXT_PRESETS.length >= 50);
  for (const p of TEXT_PRESETS) {
    assert.ok(getFont(p.font), `${p.id}: unknown font ${p.font}`);
    assert.equal(getTextStyle(p.styleId).id, p.styleId, `${p.id}: unknown style ${p.styleId}`);
    assert.ok(p.size > 0.03 && p.size < 0.25, p.id);
    for (const v of [p.x, p.y]) assert.ok(v === undefined || (v >= 0 && v <= 1), p.id);
  }
  assert.equal(styleCase(getTextStyle('minimal'), 'Hola Mundo'), 'hola mundo');
  assert.equal(styleCase(getTextStyle('meme'), 'Hola'), 'HOLA');
  assert.equal(styleCase(getTextStyle('clasico'), 'Hola'), 'Hola');
});

test('a quick look keeps the user\'s words but fills the placeholder with an example', () => {
  const base = { id: 't', start: 0, duration: 3, x: 0.5, y: 0.75, size: 0.075, styleId: 'clasico' };
  const sample = TEXT_PRESETS.find((p) => p.sample)!;
  const empty = { ...base, text: PLACEHOLDER_TEXT };
  applyPreset(empty, sample);
  assert.equal(empty.text, sample.sample);
  const own = { ...base, text: 'Mi receta' };
  applyPreset(own, sample);
  assert.equal(own.text, 'Mi receta');
  assert.equal(own.styleId, sample.styleId);
  const karaoke = TEXT_PRESETS.find((p) => p.karaoke)!;
  const k = { ...base, text: 'hola a todos' };
  applyPreset(k, karaoke);
  assert.deepEqual(k.karaoke, karaoke.karaoke);
  applyPreset(k, TEXT_PRESETS.find((p) => !p.karaoke)!);
  assert.equal(k.karaoke, undefined);
});

test('searching quick looks ignores accents and case', () => {
  assert.ok(searchPresets('CÓMIC').some((p) => p.id === 'comic'));
  assert.ok(searchPresets('link').some((p) => p.id === 'link-bio'));
  assert.equal(searchPresets('zzzzqq').length, 0);
  assert.equal(searchPresets('').length, TEXT_PRESETS.length);
});

test('caption looks point to real styles and fonts, and bring their highlight along', () => {
  unique(CAPTION_STYLES.map((c) => c.id), 'caption styles');
  for (const c of CAPTION_STYLES) {
    assert.equal(getTextStyle(c.styleId).id, c.styleId, c.id);
    assert.ok(!c.font || getFont(c.font), `${c.id}: unknown font`);
  }
  const withKaraoke = CAPTION_STYLES.find((c) => c.karaoke)!;
  const look = lookWithStyle({ ...DEFAULT_LOOK, karaoke: 'none' }, withKaraoke.id);
  assert.equal(look.style, withKaraoke.id);
  assert.equal(look.karaoke, withKaraoke.karaoke!.mode);
  // A style without a highlight leaves the user's choice alone.
  const plain = CAPTION_STYLES.find((c) => !c.karaoke)!;
  assert.equal(lookWithStyle({ ...DEFAULT_LOOK, karaoke: 'box' }, plain.id).karaoke, 'box');
});

test('short caption modes never show more words than asked and keep every word', () => {
  const words = 'esto es una prueba de subtítulos con muchas palabras que se dicen seguidas sin pausa'.split(' ').map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
  for (const [mode, max] of [['corto', 3], ['palabra', 1]] as const) {
    const cues = groupWords(words, CHUNK_OPTIONS[mode]);
    assert.ok(cues.every((c) => c.words!.length <= max), mode);
    assert.equal(cues.flatMap((c) => c.words!).length, words.length, mode);
  }
  const phrases = groupWords(words, CHUNK_OPTIONS.frase);
  assert.ok(phrases.length < groupWords(words, CHUNK_OPTIONS.corto).length);
});

test('filters, effects and transitions have unique ids, and every effect has an icon', () => {
  unique(FILTERS.map((f) => f.id), 'filters');
  unique(EFFECTS.map((e) => e.id), 'effects');
  unique(TRANSITIONS.map((t) => t.id), 'transitions');
  assert.ok(FILTERS.length >= 30);
  // The ids of the first 22 filters are saved in projects.
  for (const id of ['none', 'vivid', 'warm', 'cool', 'bw', 'retro', 'bright', 'drama', 'soft', 'cine', 'sunset', 'night']) assert.ok(FILTERS.some((f) => f.id === id), id);
  for (const f of FILTERS) assert.ok(f.id === 'none' || f.fallback.length > 0, `${f.id} has no fallback`);
  for (const e of EFFECTS) assert.ok(EFFECT_ICONS[e.id], `effect ${e.id} has no icon`);
});

test('the hit pulse spikes every two seconds and settles', () => {
  assert.equal(hitPulse(0), 1);
  assert.equal(hitPulse(2), 1);
  assert.ok(hitPulse(0.1) > 0.4 && hitPulse(0.1) < 1);
  assert.equal(hitPulse(1), 0);
  assert.ok(Math.abs(hitPulse(-2)) <= 1);
});

test('every sticker has its picture, and own groups come first', () => {
  unique(STICKER_ART.map((s) => s.glyph), 'sticker glyphs');
  unique(STICKER_ART.map((s) => s.file), 'sticker files');
  assert.ok(STICKER_ART.length >= 180);
  for (const s of STICKER_ART) assert.ok(existsSync(`public/${stickerUrl(s).slice(2)}`), `missing ${s.file}`);
  assert.equal(STICKER_GROUPS[0]!.name, 'Señalar');
  assert.ok(searchStickers('fuego').some((s) => s.glyph === '🔥'));
  assert.ok(searchStickers('FLECHA').length >= 5);
  assert.ok(searchStickers('oferta').some((s) => s.file === 'clipo/oferta.svg'));
  assert.equal(searchStickers('   ').length, 0);
});

test('recently used lists keep the newest first, without repeats', () => {
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'c', 5), ['c', 'a', 'b']);
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b']);
});
