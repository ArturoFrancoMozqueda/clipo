// Run with: npm test. Renders each music style offline and checks level, length, fades,
// rhythm and that "another version" really is another melody.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/hooks.ts';
import { db, installWebAudio, peakOf, rmsOf, spectrum } from './helpers/webaudio.ts';

installWebAudio();
// sound.ts pulls in the store, database and voice modules: stub the ones that need a browser.
const { stub } = await import('./helpers/hooks.ts');
stub('db', 'export const putBlob = async () => {};');
stub('store', 'export const uid = () => "id"; export const useStore = { getState: () => ({}) };');
stub('voice', 'export const encodeWav = () => new Blob([]);');
const { MOODS, renderSong, levelSong } = await import('../src/sound.ts');
const { STYLES } = await import('../src/musicStyles.ts');
const { SR } = await import('../src/synth.ts');

const SECONDS = 14;
const cache = new Map<string, Float32Array>();
async function song(id: string, version = 1) {
  const k = `${id}:${version}`;
  if (!cache.has(k)) cache.set(k, await renderSong(MOODS.find((m) => m.id === id)!, SECONDS, version));
  return cache.get(k)!;
}

test('the moods: unique ids, every new style has a composer, the old ids still exist', () => {
  const ids = MOODS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const old of ['alegre', 'lofi', 'epico', 'negocio', 'romantico', 'energia', 'urbano', 'cine', 'ambiental']) {
    assert.ok(ids.includes(old), `lost ${old}`);
  }
  const styled = MOODS.filter((m) => m.style);
  assert.ok(styled.length >= 10);
  for (const m of styled) assert.ok(STYLES[m.style!], m.id);
  for (const m of MOODS.filter((x) => !x.style)) assert.ok(m.chords && m.drums && m.pad, m.id);
});

test('every mood renders at the same loudness, never over the peak limit, with soft fades', async () => {
  for (const m of MOODS) {
    const d = await song(m.id);
    assert.equal(d.length, Math.ceil(SECONDS * SR), `${m.id} length`);
    assert.ok(!d.some((v) => !Number.isFinite(v)), `${m.id} NaN`);
    assert.ok(peakOf(d) <= 0.92 + 1e-6, `${m.id} peak ${peakOf(d)}`);
    const r = rmsOf(d, SR * 3, SR * 11);
    assert.ok(db(r) > -22 && db(r) < -12, `${m.id} loudness ${db(r).toFixed(1)} dB`);
    assert.ok(rmsOf(d, 0, SR * 0.1) < r * 0.3, `${m.id} should fade in`);
    assert.ok(rmsOf(d, d.length - SR * 0.2) < r * 0.2, `${m.id} should fade out`);
  }
});

test('beat styles have a real low end and a pulse; each style has its own character', async () => {
  for (const id of ['phonk', 'dembow', 'house', 'drill', 'amapiano', 'afrobeats', 'synthwave']) {
    const sp = spectrum((await song(id)).subarray(SR * 3, SR * 11), SR);
    assert.ok(sp.low > 0.08, `${id} low end ${sp.low}`);
  }
  // Loudness moves with the beat: the 8 ms envelope has strong swings.
  const house = (await song('house')).subarray(SR * 3, SR * 9);
  const env: number[] = [];
  for (let i = 0; i + 441 < house.length; i += 441) env.push(rmsOf(house, i, i + 441));
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  const sd = Math.sqrt(env.reduce((a, b) => a + (b - mean) ** 2, 0) / env.length);
  assert.ok(sd / mean > 0.3, `house should pulse, got ${sd / mean}`);
  // Lo-fi is darker than synthwave.
  assert.ok(spectrum(await song('lofihop'), SR).centroid < spectrum(await song('synthwave'), SR).centroid);
});

test('another version is another melody, and the same version is identical', async () => {
  for (const id of ['phonk', 'acustico']) {
    const a = await song(id, 1);
    const b = await song(id, 2);
    let diff = 0;
    for (let i = 0; i < a.length; i += 101) diff += Math.abs(a[i]! - b[i]!);
    assert.ok(diff > 1, `${id} versions should differ`);
    const again = await renderSong(MOODS.find((m) => m.id === id)!, SECONDS, 1);
    for (let i = 0; i < a.length; i += 9973) assert.equal(a[i], again[i]);
  }
});

test('levelSong never boosts past the peak and ignores silence', () => {
  const quiet = new Float32Array(1000).fill(0.01);
  levelSong(quiet);
  assert.ok(peakOf(quiet) <= 0.92 + 1e-6);
  const loud = new Float32Array(1000).fill(0.9);
  levelSong(loud);
  assert.ok(peakOf(loud) <= 0.92 + 1e-6);
  const silent = levelSong(new Float32Array(100));
  assert.ok(silent.every((v) => v === 0));
});
