// Run with: npm test (Node 22.18+ runs TypeScript directly).
// The fixtures are synthetic drafts written by hand for these tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findDraftFile, matchMedia, parseDraft, type DraftPlan } from '../src/importers/capcut.ts';

const fixture = readFileSync(new URL('./fixtures/capcut-draft/draft_content.json', import.meta.url), 'utf8');

function plan(src: string): DraftPlan {
  const r = parseDraft(src);
  assert.ok(r.ok, 'expected the draft to parse');
  return r.plan;
}

test('maps the main track, texts, audio and canvas of the fixture', () => {
  const p = plan(fixture);
  assert.equal(p.name, 'Vacaciones de prueba');
  assert.equal(p.aspect, '9:16');

  assert.deepEqual(p.clips, [
    { media: 'v1', in: 2, out: 6, speed: 2, volume: 0.5 },
    { media: 'p1', in: 0, out: 3, speed: 1, volume: 1 },
  ]);
  assert.deepEqual(Object.values(p.media).map((m) => [m.key, m.fileName, m.kind]), [
    ['v1', 'playa.mp4', 'video'],
    ['p1', 'foto_perro.jpg', 'image'],
    ['a1', 'cancion.mp3', 'audio'],
  ]);

  assert.equal(p.texts.length, 2);
  assert.deepEqual(p.texts[0], { text: '¡Hola playa!', start: 0.5, duration: 2, x: 0.5, y: 0.25, size: 0.075 });
  const last = p.texts[1];
  assert.ok(last);
  assert.equal(last.text, 'Fin del viaje');
  assert.equal(last.x, 0.25);
  assert.equal(last.y, 0.9);
  assert.equal(last.size, 0.1);

  assert.deepEqual(p.audios, [{ media: 'a1', start: 1, in: 1, out: 6, volume: 0.8 }]);
});

test('reports everything it left out', () => {
  const notes = plan(fixture).skipped.join('\n');
  for (const needle of ['espacio vacío', '1 clip del video principal', 'fotogramas clave', '1 superposición', '1 texto', '1 audio', '1 sticker', '2 efectos', '1 transición', '1 animación']) {
    assert.ok(notes.includes(needle), `missing note about "${needle}" in:\n${notes}`);
  }
});

test('refuses unreadable or encrypted drafts without throwing', () => {
  assert.deepEqual(parseDraft('\x00\x9a\x13 binary-ish garbage'), { ok: false, reason: 'unreadable' });
  assert.deepEqual(parseDraft('U2FsdGVkX1+abc123=='), { ok: false, reason: 'unreadable' });
  assert.deepEqual(parseDraft(''), { ok: false, reason: 'unreadable' });
  assert.deepEqual(parseDraft('{"hello": 1}'), { ok: false, reason: 'not-a-draft' });
  assert.deepEqual(parseDraft('[1,2,3]'), { ok: false, reason: 'not-a-draft' });
});

test('survives missing and wrongly typed fields', () => {
  const p = plan(JSON.stringify({
    tracks: [
      null,
      { type: 'video', segments: [{ material_id: 'x', target_timerange: { start: 'a', duration: 1e6 } }, 5, { material_id: 'v' }] },
      { type: 'text', segments: 'nope' },
      { type: 'audio' },
    ],
    materials: { videos: [{ id: 'v', path: 'clip.mov' }, 'junk'], texts: null },
    canvas_config: 'wide',
  }));
  assert.equal(p.aspect, '9:16');
  assert.deepEqual(p.clips, []);
  assert.deepEqual(p.texts, []);
  assert.equal(p.name, 'Proyecto de CapCut');
  assert.ok(p.skipped.some((n) => n.includes('2 clips')));
});

test('derives speed from the time ranges and picks the closest canvas', () => {
  const p = plan(JSON.stringify({
    canvas_config: { width: 1920, height: 1080, ratio: 'original' },
    materials: { videos: [{ id: 'v', type: 'video', path: '/a/b/Clip 1.MOV' }] },
    tracks: [{ type: 'video', segments: [{ material_id: 'v', source_timerange: { start: 0, duration: 3e6 }, target_timerange: { start: 0, duration: 6e6 } }] }],
  }));
  assert.equal(p.aspect, '16:9');
  assert.deepEqual(p.clips[0], { media: 'v', in: 0, out: 3, speed: 0.5, volume: 1 });

  const odd = plan(JSON.stringify({ canvas_config: { width: 2000, height: 1000 }, tracks: [] }));
  assert.equal(odd.aspect, '16:9');
  assert.ok(odd.skipped.some((n) => n.includes('2000×1000')));
});

test('matches media by name, then by name without extension', () => {
  const refs = Object.values(plan(fixture).media);
  const files = [{ name: 'PLAYA.MP4' }, { name: 'foto_perro.png' }, { name: 'otra.mp3' }];
  const m = matchMedia(refs, files);
  assert.equal(m.get('v1')?.name, 'PLAYA.MP4');
  assert.equal(m.get('p1')?.name, 'foto_perro.png');
  assert.equal(m.has('a1'), false);
});

test('finds the draft file in a picked folder', () => {
  const pick = (names: string[]) => findDraftFile(names.map((name) => ({ name })))?.name;
  assert.equal(pick(['draft_meta_info.json', 'draft_info.json', 'playa.mp4']), 'draft_info.json');
  assert.equal(pick(['draft_info.json', 'draft_content.json']), 'draft_content.json');
  assert.equal(pick(['draft_meta_info.json', 'cover.jpg']), undefined);
});
