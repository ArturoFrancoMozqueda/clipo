// Run with: npm test. Preview proxies: which videos get a light copy, its size/frame rate, and
// that the stored copies live and die with their media.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/hooks.ts';
import { frameRates, needsProxy, proxyReason, proxyTarget, PROXY_SIDE, type VideoTraits } from '../src/proxyPlan.ts';

const { blobsToDelete, proxyKey } = await import('../src/db.ts');

const video = (o: Partial<VideoTraits>): VideoTraits => ({
  width: 1920, height: 1080, codec: 'avc', fps: 30, peakFps: 30, bitrate: 8_000_000, duration: 20, ...o,
});

// ---------- the decision ----------

test('iPhone 4K HEVC (30 or 60 fps) needs a proxy', () => {
  assert.equal(proxyReason(video({ width: 3840, height: 2160, codec: 'hevc', fps: 30, peakFps: 30, bitrate: 45_000_000 })), 'size');
  assert.equal(proxyReason(video({ width: 2160, height: 3840, codec: 'hevc', fps: 60, peakFps: 60 })), 'size');
});

test('a Mac screen recording at 120 fps needs a proxy, also when idle frames lower its average', () => {
  assert.ok(needsProxy(video({ width: 3430, height: 1918, fps: 120, peakFps: 120 })));
  // Same width class as 1080p but 120 fps peak while the average is low (variable frame rate).
  assert.equal(proxyReason(video({ width: 1728, height: 1116, fps: 24, peakFps: 120 })), 'fps');
});

test('1080p: 60 fps or HEVC needs one, plain H.264 at 30 fps does not', () => {
  assert.equal(proxyReason(video({ fps: 60, peakFps: 60 })), 'fps');
  assert.equal(proxyReason(video({ codec: 'hevc' })), 'codec');
  assert.equal(proxyReason(video({})), null);
  assert.equal(proxyReason(video({ fps: 29.97, peakFps: 30.3 })), null);
});

test('small or already light videos keep their original', () => {
  assert.equal(proxyReason(video({ width: 1280, height: 720, fps: 60, peakFps: 60 })), null);
  assert.equal(proxyReason(video({ width: 720, height: 1280, codec: 'hevc' })), null);
  assert.equal(proxyReason(video({ width: 640, height: 360, fps: 240, peakFps: 240 })), 'fps'); // slow motion still costs
});

test('very high data rates need one; blips and broken info never do', () => {
  assert.equal(proxyReason(video({ bitrate: 80_000_000 })), 'bitrate');
  assert.equal(proxyReason(video({ width: 3840, height: 2160, duration: 0.5 })), null);
  assert.equal(proxyReason(video({ width: 0, height: 0 })), null);
  assert.equal(proxyReason(video({ width: 3840, height: 2160, duration: NaN })), null);
});

// ---------- the copy ----------

test('proxy target: long side capped at 1280 with even sizes, 30 fps at most', () => {
  const t = proxyTarget(video({ width: 3840, height: 2160, fps: 60, peakFps: 60 }));
  assert.deepEqual([t.width, t.height, t.maxFps], [PROXY_SIDE, 720, 30]);
  const portrait = proxyTarget(video({ width: 2160, height: 3840, fps: 30, peakFps: 30 }));
  assert.deepEqual([portrait.width, portrait.height, portrait.maxFps], [720, PROXY_SIDE, undefined]);
  const screen = proxyTarget(video({ width: 3430, height: 1918, fps: 120, peakFps: 120 }));
  assert.deepEqual([screen.width, screen.height, screen.maxFps], [1280, 716, 30]);
  const odd = proxyTarget(video({ width: 1081, height: 1921, codec: 'hevc' }));
  assert.equal(odd.width % 2, 0);
  assert.equal(odd.height, PROXY_SIDE);
});

test('proxy target keeps the size of a video that is only heavy for its frame rate', () => {
  const t = proxyTarget(video({ width: 640, height: 360, fps: 240, peakFps: 240 }));
  assert.deepEqual([t.width, t.height, t.maxFps], [640, 360, 30]);
});

test('proxy bitrate stays between 1 and 5 Mbit/s', () => {
  for (const v of [video({ width: 3840, height: 2160 }), video({ width: 640, height: 360, fps: 240 }), video({ width: 7680, height: 4320, fps: 120 })]) {
    const { bitrate } = proxyTarget(v);
    assert.ok(bitrate >= 1_000_000 && bitrate <= 5_000_000, String(bitrate));
  }
});

// ---------- frame rate from timestamps ----------

test('frame rates: constant, decode order and variable', () => {
  const cfr = Array.from({ length: 121 }, (_, i) => i / 60);
  const r = frameRates(cfr);
  assert.ok(Math.abs(r.fps - 60) < 1e-6 && Math.abs(r.peakFps - 60) < 1e-6);
  // B-frames come in decode order: same answer.
  const shuffled = [...cfr];
  for (let i = 1; i + 1 < shuffled.length; i += 3) [shuffled[i], shuffled[i + 1]] = [shuffled[i + 1]!, shuffled[i]!];
  assert.ok(Math.abs(frameRates(shuffled).fps - 60) < 1e-6);
  // Screen recording: bursts at 120 fps separated by idle seconds.
  const vfr: number[] = [];
  let t = 0;
  for (let burst = 0; burst < 4; burst++) {
    for (let i = 0; i < 30; i++) vfr.push((t += 1 / 120));
    t += 1;
  }
  const v = frameRates(vfr);
  assert.ok(v.fps < 40, `avg ${v.fps}`);
  assert.ok(Math.abs(v.peakFps - 120) < 0.5, `peak ${v.peakFps}`);
  assert.deepEqual(frameRates([1]), { fps: 0, peakFps: 0 });
});

// ---------- storage ----------

test('garbage collection removes a proxy together with its media, never on its own', () => {
  const stored = ['used1234ab', proxyKey('used1234ab'), 'orphan12ab', proxyKey('orphan12ab'), proxyKey('undo1234ab'), proxyKey('gone5678cd'), 'myvoice:x'];
  const gone = blobsToDelete(stored, new Set(['used1234ab']), new Set(['undo1234ab']));
  assert.deepEqual(gone, ['orphan12ab', proxyKey('orphan12ab'), proxyKey('gone5678cd')]);
});
