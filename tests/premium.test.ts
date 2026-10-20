// Run with: npm test. Catalog of the premium sound pack and the math of the premium effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/hooks.ts';
import { heartPulse } from '../src/fxmath.ts';

// soundPremium.ts imports other app modules Vite-style (no extension): load it through the test hooks.
const { PREMIUM_SFX, TRANSITION_SFX } = await import('../src/soundPremium.ts');
const { master, SR } = await import('../src/synth.ts');

test('premium sounds have unique ids, a length, and a hit inside the sound', () => {
  const ids = new Set<string>();
  for (const s of PREMIUM_SFX) {
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
    assert.ok(s.id.startsWith('p-'), s.id);
    assert.equal(s.premium, true);
    assert.ok(s.build && (s.seconds ?? 0) > 0, s.id);
    if (s.hit !== undefined) assert.ok(s.hit >= 0 && s.hit < s.seconds!, `${s.id} hit ${s.hit}`);
  }
  assert.ok(PREMIUM_SFX.length >= 30);
});

test('every transition sound is a premium sound with a hit to line up with the cut', () => {
  const byId = new Map(PREMIUM_SFX.map((s) => [s.id, s]));
  assert.equal(TRANSITION_SFX.none, null);
  for (const [tr, id] of Object.entries(TRANSITION_SFX)) {
    if (tr === 'none') continue;
    const s = byId.get(id!);
    assert.ok(s, `${tr} → ${id} is missing`);
    assert.ok(s.hit !== undefined, `${id} has no hit`);
  }
});

test('master brings any sound to the same peak and fades the very end', () => {
  for (const level of [0.05, 0.5, 3]) {
    const d = new Float32Array(SR).fill(level);
    master(d);
    assert.ok(Math.abs(d[SR / 2]! - 0.89) < 1e-6);
    assert.equal(d[SR - 1], 0);
  }
  const silent = master(new Float32Array(100));
  assert.ok(silent.every((v) => v === 0));
});

test('heartbeat pulse: strong beat, softer second beat, quiet in between, once a second', () => {
  assert.ok(Math.abs(heartPulse(0) - 1) < 1e-9);
  assert.ok(Math.abs(heartPulse(2) - 1) < 1e-9);
  const dub = heartPulse(0.23);
  assert.ok(dub > 0.5 && dub < 0.8, `dub ${dub}`);
  assert.ok(heartPulse(0.6) < 0.02);
  assert.ok(Math.abs(heartPulse(-0.77) - dub) < 1e-9);
});
