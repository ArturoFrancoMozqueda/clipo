import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compatibleMedia } from '../electron/compatible-media.cjs';

test('HLG HEVC compatibility import preserves the original and produces verified SDR H264', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clipo-hlg-test-'));
  const source = path.join(dir, 'camera.mov');
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x36:rate=30', '-t', '0.5', '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le',
      '-x265-params', 'pools=1:frame-threads=1:log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc', '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', '-movflags', '+write_colr', source], { windowsHide: true });
    const original = await readFile(source);
    const result = await compatibleMedia(source, dir, new AbortController().signal);
    assert.equal(result.receipt.outputCodec, 'h264');
    assert.equal(result.receipt.outputTransfer, 'bt709', JSON.stringify(result.receipt));
    assert.equal(result.receipt.hdrToSdr, true);
    assert.equal(result.receipt.width, 64); assert.equal(result.receipt.height, 36);
    assert.ok(Math.abs(result.receipt.duration - .5) < .1);
    assert.deepEqual(await readFile(source), original);
    const excerpt = await compatibleMedia(source, dir, new AbortController().signal, { from: .1, to: .4 });
    assert.equal(excerpt.receipt.sourceFrom, .1);
    assert.ok(Math.abs(excerpt.receipt.duration - .3) < .1);
    await assert.rejects(compatibleMedia(source, dir, new AbortController().signal, { from: 0, to: 2 }), /fuera/);
    execFileSync('ffmpeg', ['-v', 'error', '-i', result.path, '-f', 'null', '-'], { windowsHide: true });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(compatibleMedia(source, dir, controller.signal));
    await assert.rejects(compatibleMedia('relative.mov', dir), /absoluta/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
