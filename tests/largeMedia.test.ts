import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { statMedia, readMediaChunk, MEDIA_CHUNK, MAX_LOCAL_MEDIA } from '../electron/automation.cjs';

test('large local movies import in bounded chunks and detect source changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clipo-large-media-'));
  const movie = path.join(dir, 'camera.MOV');
  const file = await open(movie, 'w+');
  try {
    const size = 130 * 1024 * 1024 + 3;
    await file.truncate(size);
    await file.write(new Uint8Array([11, 22, 33]), 0, 3, size - 3);
    const info = await statMedia(movie);
    assert.equal(info.size, size);
    assert.deepEqual(new Uint8Array(await readMediaChunk(movie, info, size - 3, 3)), new Uint8Array([11, 22, 33]));
    assert.equal((await readMediaChunk(movie, info, 0, MEDIA_CHUNK)).byteLength, MEDIA_CHUNK);
    await assert.rejects(readMediaChunk(movie, info, 0, MEDIA_CHUNK + 1), /inválido/);
    await assert.rejects(readMediaChunk(movie, info, -1, 1), /inválido/);
    await assert.rejects(readMediaChunk(movie, info, size - 1, 2), /fuera/);
    await file.truncate(size - 1);
    await assert.rejects(readMediaChunk(movie, info, 0, 1), /cambió/);
    await file.truncate(MAX_LOCAL_MEDIA + 1);
    await assert.rejects(statMedia(movie), /8 GiB/);
    await assert.rejects(statMedia('relative.MOV'), /absoluta/);
    await assert.rejects(statMedia(path.join(dir, 'private.txt')), /absoluta/);
  } finally { await file.close(); await rm(dir, { recursive: true, force: true }); }
});
