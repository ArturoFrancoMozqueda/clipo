// Run with: npm test. Sound search (Spanish, synonyms) and favorites / recents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byIds, fold, loadFavorites, loadRecents, matchScore, MAX_RECENT, pushRecent, searchSounds, toggleFavorite } from '../src/sfxLibrary.ts';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const S = [
  { id: 'a', name: 'Ka-ching', use: 'Ganancia, venta, “dinero”', category: 'Tiempo y dinero', tags: 'caja registradora cobrar plata' },
  { id: 'b', name: 'Aplauso grande', use: 'Celebración', category: 'Reacciones', tags: 'gente publico' },
  { id: 'c', name: 'Moneda', use: 'Ganar algo', category: 'Juegos' },
  { id: 'd', name: 'Disco rayado DJ', use: '¡Espera, qué!', category: 'Transiciones', tags: 'scratch' },
];

test('folding removes accents, case and punctuation', () => {
  assert.equal(fold('  ¡Celebración,  ÑANDÚ! '), 'celebracion nandu');
});

test('search finds by name, use, tags, synonyms, plurals and ignores accents', () => {
  assert.deepEqual(searchSounds(S, 'aplausos').map((s) => s.id), ['b']);
  assert.deepEqual(searchSounds(S, 'celebracion').map((s) => s.id), ['b']);
  assert.deepEqual(searchSounds(S, 'plata').map((s) => s.id).sort(), ['a', 'c']);
  assert.equal(searchSounds(S, 'scratch')[0]!.id, 'd');
  assert.deepEqual(searchSounds(S, 'disco').map((s) => s.id), ['d']);
  assert.deepEqual(searchSounds(S, 'xyz'), []);
  assert.equal(searchSounds(S, '  ').length, S.length);
});

test('every word must match, and name matches rank first', () => {
  assert.deepEqual(searchSounds(S, 'dinero registradora').map((s) => s.id), ['a']);
  assert.equal(searchSounds(S, 'moneda')[0]!.id, 'c');
  assert.ok(matchScore(S[2]!, 'moneda') > matchScore(S[0]!, 'moneda'));
});

test('favorites toggle and persist; recents keep the newest first without repeats and cap the list', () => {
  const st = mem();
  assert.deepEqual(loadFavorites(st), []);
  assert.deepEqual(toggleFavorite('x', st), ['x']);
  assert.deepEqual(toggleFavorite('y', st), ['y', 'x']);
  assert.deepEqual(toggleFavorite('x', st), ['y']);
  assert.deepEqual(loadFavorites(st), ['y']);
  for (let i = 0; i < 20; i++) pushRecent(`s${i}`, st);
  pushRecent('s5', st);
  const r = loadRecents(st);
  assert.equal(r.length, MAX_RECENT);
  assert.equal(r[0], 's5');
  assert.equal(new Set(r).size, r.length);
});

test('broken or missing storage never throws', () => {
  const bad = { getItem: () => '{oops', setItem: () => { throw new Error('full'); } };
  assert.deepEqual(loadFavorites(bad), []);
  assert.deepEqual(toggleFavorite('x', bad), ['x']);
  assert.deepEqual(loadRecents(null), []);
  assert.deepEqual(byIds(S, ['d', 'gone', 'a']).map((s) => s.id), ['d', 'a']);
});
