import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportFile } from '../mcp/export-file.mjs';
test('artifact copies refuse overwrite, verify every byte and remove corrupt partial results', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clipo-artifact-test-'));
  const data = Buffer.alloc(2300000, 42); const sha256 = createHash('sha256').update(data).digest('hex');
  const call = async (_name: string, a: { offset: number; length: number }) => ({ artifact: { sha256, bytes: data.length }, offset: a.offset, nextOffset: Math.min(data.length, a.offset + a.length), eof: a.offset + a.length >= data.length, data: data.subarray(a.offset, a.offset + a.length).toString('base64') });
  try {
    const out = path.join(dir, 'video.mp4'); const result = await exportFile({ artifactId: 'a', path: out }, call);
    assert.equal(result.verified, true); assert.deepEqual(await readFile(out), data);
    await assert.rejects(exportFile({ artifactId: 'a', path: out }, call), /EEXIST/);
    await assert.rejects(exportFile({ artifactId: 'a', path: 'relative.mp4' }, call), /absoluta/);
    const bad = path.join(dir, 'bad.mp4');
    await assert.rejects(exportFile({ artifactId: 'a', path: bad }, async (name: string, args: { offset: number; length: number }) => ({ ...await call(name, args), artifact: { sha256: 'incorrect', bytes: data.length } })), /coincide/);
    await assert.rejects(readFile(bad), /ENOENT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
