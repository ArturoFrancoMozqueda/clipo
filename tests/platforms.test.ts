// Run with: npm test. Fase A: network profiles, pre-publish checks and automatic reframing math.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERIC_SAFE, PLATFORMS, PLATFORM_IDS, audioLevels, checkVersion, estimateBytes, outsideSide, parseHashtags, postCaption, safeZoneFor,
  worstLevel, type CheckInput,
} from '../src/platforms.ts';
import { coverRect, maskCenter, sampleTimes, smoothTrack, trackAt } from '../src/reframe.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('every network has the ids the other modules use and sane limits', () => {
  assert.deepEqual(PLATFORM_IDS, ['tiktok', 'instagram_reels', 'youtube_shorts', 'youtube', 'facebook', 'x', 'linkedin']);
  for (const id of PLATFORM_IDS) {
    const p = PLATFORMS[id];
    assert.equal(p.id, id);
    assert.ok(p.name.length > 0);
    assert.ok(p.formats.length > 0 && p.formats.every((f) => ['9:16', '16:9', '1:1', '4:5'].includes(f)), `${id} formats`);
    assert.ok(p.maxSeconds > p.minSeconds && p.maxBytes > 0 && p.captionMax > 0);
    assert.ok(p.maxFps >= 30, `${id} accepts the 30 fps export`);
    const z = p.safe;
    for (const v of [z.top, z.right, z.bottom, z.left]) assert.ok(v >= 0 && v < 0.35);
    assert.ok(z.top + z.bottom < 0.6 && z.left + z.right < 0.6, `${id} leaves room inside`);
  }
  assert.equal(PLATFORMS.tiktok.formats[0], '9:16');
  assert.equal(PLATFORMS.youtube.formats[0], '16:9');
});

test('safe zone: the network layout in its main format, a generic border otherwise', () => {
  assert.equal(safeZoneFor('tiktok', '9:16'), PLATFORMS.tiktok.safe);
  assert.equal(safeZoneFor('tiktok', '16:9'), GENERIC_SAFE);
});

test('size estimate follows the export bitrate', () => {
  const a = estimateBytes(60, 720);
  const b = estimateBytes(60, 1080);
  assert.ok(b > a);
  // 60 s at 5.16 Mbit/s ≈ 38.7 MB plus 2 % overhead.
  near(a, Math.ceil((60 * 5_160_000 * 1.02) / 8), 1);
  assert.equal(estimateBytes(-1, 720), 0);
});

test('hashtags are cleaned up and deduplicated', () => {
  assert.deepEqual(parseHashtags('#viaje playa, ##Playa #mar! '), ['#viaje', '#playa', '#mar']);
  assert.deepEqual(parseHashtags('  '), []);
  assert.deepEqual(parseHashtags('#niño #canción'), ['#niño', '#canción']);
  assert.equal(postCaption(' Hola ', 'a b'), 'Hola\n\n#a #b');
  assert.equal(postCaption('', 'a'), '#a');
});

const base = (over: Partial<CheckInput> = {}): CheckInput => ({
  platform: 'tiktok',
  aspect: '9:16',
  duration: 30,
  short: 1080,
  audio: { peakDb: -3, rmsDb: -18, clipped: 0 },
  boxes: [],
  ...over,
});

test('a good video passes every check', () => {
  const issues = checkVersion(base());
  assert.equal(worstLevel(issues), 'ok', JSON.stringify(issues));
});

test('too long, too short and too heavy are errors that say what to do', () => {
  const long = checkVersion(base({ platform: 'x', aspect: '16:9', duration: 200 }));
  const e = long.find((i) => i.level === 'error')!;
  assert.match(e.text, /X \(Twitter\) admite hasta 2 min 20 s/);
  assert.match(e.fix!, /Recorta 1 min/);

  const brief = checkVersion(base({ platform: 'instagram_reels', duration: 1 }));
  assert.ok(brief.some((i) => i.level === 'error' && /al menos 3 s/.test(i.text)));

  // 2 min 20 s fits X, but 1080p for that long is under its 512 MB: no size error.
  const okSize = checkVersion(base({ platform: 'x', aspect: '16:9', duration: 140 }));
  assert.ok(!okSize.some((i) => i.level === 'error'));
  // Reels: 3 min at 1080p ≈ 187 MB, under 300 MB.
  assert.ok(!checkVersion(base({ platform: 'instagram_reels', duration: 180 })).some((i) => /Pesará/.test(i.text)));
});

test('formats: unsupported is an error, accepted-but-not-ideal a warning', () => {
  const yt = checkVersion(base({ platform: 'youtube', aspect: '9:16' }));
  assert.ok(yt.some((i) => i.level === 'error' && /no usa el formato/.test(i.text)));
  const sq = checkVersion(base({ platform: 'tiktok', aspect: '1:1' }));
  assert.ok(sq.some((i) => i.level === 'warn' && /se ve mejor en 9:16/.test(i.text)));
});

test('audio levels: silence, quiet, clipped', () => {
  const sil = audioLevels([new Float32Array(100)]);
  assert.equal(sil.peakDb, -Infinity);
  const loud = audioLevels([Float32Array.from({ length: 1000 }, (_, i) => (i % 2 ? 1 : -1))]);
  near(loud.peakDb, 0);
  near(loud.clipped, 1);
  const quiet = audioLevels([Float32Array.from({ length: 1000 }, (_, i) => (i % 2 ? 0.01 : -0.01))]);
  near(quiet.rmsDb, -40, 1e-3);

  assert.ok(checkVersion(base({ audio: loud })).some((i) => /saturado/.test(i.text)));
  assert.ok(checkVersion(base({ audio: quiet })).some((i) => /muy bajo/.test(i.text)));
  assert.ok(checkVersion(base({ audio: sil })).some((i) => /no tiene sonido/.test(i.text)));
  // Not measured: nothing said about audio.
  assert.ok(!checkVersion(base({ audio: null })).some((i) => /sonido/.test(i.text)));
});

test('texts under the app buttons are flagged with the side to move them from', () => {
  const caption = { kind: 'text' as const, label: 'Suscríbete', x0: 0.3, y0: 0.85, x1: 0.7, y1: 0.92 };
  assert.equal(outsideSide(caption, 'tiktok', '9:16'), 'bottom');
  const right = { kind: 'sticker' as const, label: '', x0: 0.85, y0: 0.4, x1: 0.97, y1: 0.5 };
  assert.equal(outsideSide(right, 'tiktok', '9:16'), 'right');
  const centered = { kind: 'text' as const, label: 'Hola', x0: 0.3, y0: 0.45, x1: 0.7, y1: 0.55 };
  assert.equal(outsideSide(centered, 'tiktok', '9:16'), null);

  const issues = checkVersion(base({ boxes: [caption, centered] }));
  const w = issues.find((i) => /Suscríbete/.test(i.text))!;
  assert.equal(w.level, 'warn');
  assert.match(w.text, /abajo/);
  assert.match(w.fix!, /Súbelo/);
});

test('post text longer than the network allows', () => {
  const issues = checkVersion(base({ platform: 'x', aspect: '16:9', description: 'a'.repeat(300) }));
  assert.ok(issues.some((i) => i.level === 'error' && /admite 280/.test(i.text)));
});

// ---------- reframing ----------

/** A w×h mask with a solid block of "person" pixels. */
function block(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const alpha = new Uint8ClampedArray(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) alpha[y * w + x] = 255;
  return { w, h, alpha };
}

test('mask center: horizontal centroid, vertical biased toward the head', () => {
  const c = maskCenter(block(100, 100, 70, 20, 90, 100))!;
  near(c.x, 0.8, 0.01);
  assert.ok(c.y > 0.2 && c.y < 0.6, `y=${c.y}`);
  assert.equal(maskCenter(block(100, 100, 0, 0, 0, 0)), null);
  assert.equal(maskCenter(block(100, 100, 0, 0, 2, 1)), null, 'a few stray pixels are nobody');
});

test('smoothing fills gaps, removes jitter and does not lag', () => {
  assert.deepEqual(smoothTrack([]), []);
  assert.deepEqual(smoothTrack([{ t: 0 }, { t: 1 }]), [{ t: 0, x: 0.5, y: 0.5 }, { t: 1, x: 0.5, y: 0.5 }]);

  const jitter = Array.from({ length: 60 }, (_, i) => ({ t: i / 3, x: 0.6 + (i % 2 ? 0.05 : -0.05), y: 0.4 }));
  const s = smoothTrack(jitter);
  const mid = s.slice(10, 50).map((p) => p.x);
  assert.ok(Math.max(...mid) - Math.min(...mid) < 0.03, 'jitter mostly gone');
  near(mid.reduce((a, b) => a + b) / mid.length, 0.6, 0.01);

  // A step from left to right: the zero-phase filter centers the move on the step instead of after it.
  const step = Array.from({ length: 31 }, (_, i) => ({ t: i / 3, x: i < 15 ? 0.2 : 0.8, y: 0.5 }));
  const st = smoothTrack(step);
  const at = (t: number) => trackAt(st, t).x;
  assert.ok(at(0) < 0.25 && at(10) > 0.75);
  near(at(5) + at(4.67), 1, 0.15); // roughly symmetric around the step

  // Steady motion keeps its ends: no pull toward the middle at the start and end of the clip.
  const pan = smoothTrack(Array.from({ length: 13 }, (_, i) => ({ t: i / 3, x: 0.15 + 0.05 * i, y: 0.5 })));
  near(pan[0].x, 0.15, 1e-3);
  near(pan[12].x, 0.75, 1e-3);

  const gaps = smoothTrack([{ t: 0, x: 0.3, y: 0.3 }, { t: 1 }, { t: 2 }, { t: 3, x: 0.3, y: 0.3 }], 0);
  assert.deepEqual(gaps.map((p) => p.x), [0.3, 0.3, 0.3, 0.3]);
});

test('trackAt interpolates and holds the ends', () => {
  const pts = [{ t: 1, x: 0.2, y: 0.5 }, { t: 3, x: 0.6, y: 0.7 }];
  assert.deepEqual(trackAt(pts, 0), { x: 0.2, y: 0.5 });
  near(trackAt(pts, 2).x, 0.4);
  near(trackAt(pts, 2).y, 0.6);
  assert.deepEqual(trackAt(pts, 9), { x: 0.6, y: 0.7 });
  assert.deepEqual(trackAt([], 1), { x: 0.5, y: 0.5 });
});

test('cover crop follows the subject without showing an edge', () => {
  // 1920×1080 into a 1080×1920 frame: picture scaled to 3413×1920.
  const centered = coverRect(1920, 1080, 1080, 1920);
  near(centered.dx, (1080 - centered.dw) / 2);
  near(centered.dh, 1920);
  const right = coverRect(1920, 1080, 1080, 1920, { x: 0.75, y: 0.5 });
  near(right.dx + 0.75 * right.dw, 540); // subject in the middle of the frame
  const edge = coverRect(1920, 1080, 1080, 1920, { x: 0.99, y: 0.5 });
  near(edge.dx, 1080 - edge.dw); // clamped: the right edge of the picture meets the frame
  const left = coverRect(1920, 1080, 1080, 1920, { x: 0, y: 0.5 });
  near(left.dx, 0);
  near(left.dy, 0, 1e-9); // no vertical room to move
});

test('sample times cover the whole clip', () => {
  const t = sampleTimes(2, 4, 0.5);
  assert.deepEqual(t, [2, 2.5, 3, 3.5, 4]);
  assert.equal(sampleTimes(0, 1000, 0.1, 50).length, 51);
  assert.deepEqual(sampleTimes(5, 5), [5, 5]);
});
