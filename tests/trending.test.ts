// Run with: npm test. Renders every "Tendencia" sound offline and checks it like a sound engineer
// would at a glance: not silent, not clipped, the declared length, and a believable spectrum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/hooks.ts';
import { db, installWebAudio, peakOf, rmsOf, spectrum } from './helpers/webaudio.ts';

installWebAudio();
const { TRENDING_SFX } = await import('../src/soundTrending.ts');
const { render, master, SR } = await import('../src/synth.ts');

const rendered = new Map<string, Float32Array>();
async function get(id: string) {
  const s = TRENDING_SFX.find((x) => x.id === id)!;
  if (!rendered.has(id)) rendered.set(id, master(await render(s.seconds!, s.build!, 7)));
  return rendered.get(id)!;
}

test('trending pack: unique t- ids, Spanish names, tags, a length and a hit inside the sound', () => {
  const ids = new Set<string>();
  for (const s of TRENDING_SFX) {
    assert.ok(!ids.has(s.id), `duplicate ${s.id}`);
    ids.add(s.id);
    assert.ok(s.id.startsWith('t-'), s.id);
    assert.equal(s.trending, true);
    assert.ok(s.name && s.use && s.tags, `${s.id} needs name, use and tags`);
    assert.ok(s.build && (s.seconds ?? 0) > 0.3 && s.seconds! <= 8, s.id);
    if (s.hit !== undefined) assert.ok(s.hit >= 0 && s.hit < s.seconds!, `${s.id} hit`);
  }
  assert.ok(TRENDING_SFX.length >= 45, `only ${TRENDING_SFX.length}`);
});

test('every trending sound renders: sound, no clipping, no NaN, right length, sane spectrum', async () => {
  for (const s of TRENDING_SFX) {
    const d = await get(s.id);
    assert.equal(d.length, Math.ceil(s.seconds! * SR), `${s.id} length`);
    assert.ok(!d.some((v) => !Number.isFinite(v)), `${s.id} has NaN`);
    const peak = peakOf(d);
    assert.ok(peak > 0.8 && peak <= 0.9, `${s.id} peak ${peak}`);
    assert.ok(db(rmsOf(d)) > -42, `${s.id} too quiet (${db(rmsOf(d)).toFixed(1)} dB)`);
    // It starts with sound or a quick build and ends gently: the last 20 ms are faded.
    assert.ok(Math.abs(d[d.length - 1]!) < 1e-6, `${s.id} last sample`);
    // Not a constant offset (DC) and not stuck: the average is far below the peak.
    let mean = 0;
    for (let i = 0; i < d.length; i++) mean += d[i]!;
    assert.ok(Math.abs(mean / d.length) < 0.02, `${s.id} DC`);
    const sp = spectrum(d, SR);
    assert.ok(sp.centroid > 30 && sp.centroid < 14000, `${s.id} centroid ${sp.centroid}`);
  }
});

test('trending sounds do not end abruptly: the last 60 ms are much quieter than the loudest part', async () => {
  const abrupt: string[] = [];
  for (const s of TRENDING_SFX) {
    const d = await get(s.id);
    const tail = rmsOf(d, d.length - Math.floor(SR * 0.06));
    if (db(tail) > -26) abrupt.push(`${s.id} ${db(tail).toFixed(1)} dB`);
  }
  assert.deepEqual(abrupt, []);
});

test('the sounds have the shape their name promises', async () => {
  const sub = spectrum(await get('t-808-hit'), SR);
  assert.ok(sub.low > 0.6, `808 should be mostly low, got ${sub.low}`);
  const air = spectrum(await get('t-asmr-brush'), SR);
  assert.ok(air.high > 0.4 && air.centroid > 2500, 'brush is airy');
  const money = spectrum(await get('t-ka-ching'), SR);
  assert.ok(money.high > 0.15, 'ka-ching is bright');
  // The riser is quiet at first and loudest right before its hit.
  const riser = await get('t-riser-tension');
  assert.ok(rmsOf(riser, 0, SR * 0.5) < rmsOf(riser, Math.floor(SR * 3), Math.floor(SR * 3.6)) * 0.5);
  // The impact lands at once: its loudest moment is in the first 50 ms.
  const hit = await get('t-deep-hit');
  assert.ok(peakOf(hit, 0, Math.floor(SR * 0.05)) > 0.5 * peakOf(hit));
  // Record scratch: loud before the end of the scratch, then a decaying stop.
  const rs = await get('t-record-scratch');
  assert.ok(rmsOf(rs, 0, SR * 0.5) > rmsOf(rs, Math.floor(SR * 1.1), rs.length) * 2);
});

test('renders are repeatable: the same sound twice is identical', async () => {
  const s = TRENDING_SFX.find((x) => x.id === 't-applause-short')!;
  const a = await render(s.seconds!, s.build!, 7);
  const b = await render(s.seconds!, s.build!, 7);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 997) assert.equal(a[i], b[i]);
});
