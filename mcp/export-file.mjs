import { open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { callEditor } from './bridge-client.mjs';

/** Exclusive creation: never overwrites an existing user file. Stream bounded chunks. */
export async function exportFile(args, call = callEditor) {
  if (!path.isAbsolute(args.path)) throw new Error('Usa una ruta absoluta para guardar el resultado.');
  const file = await open(args.path, 'wx');
  let complete = false;
  try {
    const hash = createHash('sha256'); let offset = 0; let artifact;
    for (;;) {
      const part = await call('clipo_read_artifact', { artifactId: args.artifactId, offset, length: 1048576 });
      artifact ??= part.artifact;
      if (part.artifact.sha256 !== artifact.sha256 || part.offset !== offset) throw new Error('El archivo cambió durante la copia.');
      const bytes = Buffer.from(part.data, 'base64');
      if (part.nextOffset !== offset + bytes.length || (!part.eof && !bytes.length)) throw new Error('Respuesta de archivo incompleta.');
      let written = 0;
      while (written < bytes.length) { const r = await file.write(bytes, written, bytes.length - written); if (!r.bytesWritten) throw new Error('No se pudo guardar el archivo.'); written += r.bytesWritten; }
      hash.update(bytes); offset += bytes.length;
      if (part.eof) break;
    }
    if (offset !== artifact.bytes || hash.digest('hex') !== artifact.sha256) throw new Error('La copia no coincide con el archivo original.');
    await file.sync(); complete = true;
    return { path: args.path, artifact, verified: true };
  } finally { await file.close(); if (!complete) await unlink(args.path).catch(() => {}); }
}
