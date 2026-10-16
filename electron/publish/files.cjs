// Video bytes handed over by the page, shared by the YouTube and Meta adapters.
// Chunked transfer: begin(total, mime) → append(fileId, piece) in order (≤ 64 MiB each) → the
// adapter's upload({ fileId, … }). The video goes to a private temp file and is read back in
// pieces while uploading, so a multi-GB video is never held whole in memory.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('./errors.cjs');

/** Largest piece accepted by append. */
const MAX_APPEND_BYTES = 64 * 1024 * 1024;

const bad = (what) => fail(`Clipo envió datos no válidos para subir (${what}). Reintenta; si sigue pasando, vuelve a exportar el video.`, false);

/** ArrayBuffer / typed array / Buffer from IPC as a Buffer view (no copy), or null. */
function toBuffer(v) {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  return null;
}

/** Where the bytes of an upload come from: memory (old single-shot API) or a temp file (chunked API). */
function bufferSource(buf) {
  return { size: buf.length, read: async (start, end) => buf.subarray(start, end + 1), close: async () => {} };
}
async function fileSource(file) {
  const fh = await fs.promises.open(file, 'r');
  const { size } = await fh.stat();
  return {
    size,
    /** Bytes start..end, both included. */
    read: async (start, end) => {
      const out = Buffer.allocUnsafe(end - start + 1);
      let at = 0;
      while (at < out.length) {
        const { bytesRead } = await fh.read(out, at, out.length - at, start + at);
        if (!bytesRead) throw fail('El archivo temporal del video se cortó. Vuelve a pulsar “Publicar”.', false);
        at += bytesRead;
      }
      return out;
    },
    close: () => fh.close(),
  };
}

/**
 * Temp files of videos being handed over, in their own folder (`name`) under the system temp dir.
 * Files left by a previous run (crash, forced quit) are useless — their ids are gone — so the
 * folder is emptied on start and on cleanup().
 */
function tempFiles({ app, name, maxBytes, mimes }) {
  const tmpDir = path.join(app.getPath('temp'), name);
  /** fileId -> { file, total, written, mime, busy } */
  const files = new Map();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  async function begin(total, mime) {
    if (!Number.isSafeInteger(total) || total <= 0 || total > maxBytes) throw bad('tamaño');
    if (mime !== undefined && !mimes.has(mime)) throw bad('tipo de video');
    await fs.promises.mkdir(tmpDir, { recursive: true, mode: 0o700 });
    const fileId = crypto.randomUUID();
    const file = path.join(tmpDir, `${fileId}.part`);
    await fs.promises.writeFile(file, Buffer.alloc(0), { mode: 0o600 });
    files.set(fileId, { file, total, written: 0, mime: mime || 'video/mp4', busy: false });
    return { fileId, chunkLimit: MAX_APPEND_BYTES };
  }

  async function append(fileId, bytes) {
    const f = typeof fileId === 'string' ? files.get(fileId) : undefined;
    if (!f) throw bad('archivo');
    const buf = toBuffer(bytes);
    if (!buf || !buf.length || buf.length > MAX_APPEND_BYTES) throw bad('trozo');
    if (f.written + buf.length > f.total) throw bad('tamaño');
    if (f.busy) throw bad('orden');
    f.busy = true;
    try {
      await fs.promises.appendFile(f.file, buf);
      f.written += buf.length;
    } finally {
      f.busy = false;
    }
    return { written: f.written, total: f.total };
  }

  async function discard(fileId) {
    const f = typeof fileId === 'string' ? files.get(fileId) : undefined;
    if (!f) return;
    files.delete(fileId);
    await fs.promises.rm(f.file, { force: true }).catch(() => {});
  }

  /** A finished file by id, or a "bad data" error. */
  function complete(fileId) {
    const f = typeof fileId === 'string' ? files.get(fileId) : undefined;
    if (!f) throw bad('archivo');
    if (f.written !== f.total) throw bad('archivo incompleto');
    return f;
  }

  function cleanup() {
    files.clear();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }

  return { begin, append, discard, complete, cleanup };
}

module.exports = { MAX_APPEND_BYTES, bad, toBuffer, bufferSource, fileSource, tempFiles };
