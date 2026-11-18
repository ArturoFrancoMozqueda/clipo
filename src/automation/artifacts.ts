import { uid } from '../store';
import { agentStorage, digest } from './storage';
export interface Artifact {
  id: string; projectId: string; name: string; type: string; bytes: number; sha256: string; createdAt: number;
  media?: { duration: number; width: number; height: number }; blob: Blob;
}
export const publicArtifact = ({ blob: _blob, ...info }: Artifact) => info;
export async function mediaInfo(blob: Blob) {
  const v = document.createElement('video'); const url = URL.createObjectURL(blob);
  try {
    return await new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No se pudo verificar el video exportado.')), 15000);
      v.onloadeddata = () => {
        clearTimeout(timer);
        if (!Number.isFinite(v.duration) || v.duration <= 0 || !v.videoWidth) reject(new Error('Video exportado vacío o inválido.'));
        else resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
      };
      v.onerror = () => { clearTimeout(timer); reject(new Error('No se puede decodificar el video exportado.')); };
      v.preload = 'auto'; v.muted = true; v.src = url; v.load();
    });
  } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}
export async function storeArtifact(projectId: string, name: string, blob: Blob, media?: Artifact['media']) {
  if (!blob.size) throw new Error('El resultado está vacío.');
  const artifact: Artifact = { id: uid(), projectId, name, type: blob.type, bytes: blob.size, sha256: await digest(await blob.arrayBuffer()), createdAt: Date.now(), blob, media };
  await agentStorage.put('artifact:' + artifact.id, artifact);
  const saved = await getArtifact(artifact.id);
  if (saved.bytes !== blob.size || await digest(await saved.blob.arrayBuffer()) !== artifact.sha256) throw new Error('No se pudo verificar el archivo guardado.');
  return publicArtifact(artifact);
}
export async function getArtifact(id: string) {
  const a = await agentStorage.get<Artifact>('artifact:' + id);
  if (!a) throw new Error('Archivo de resultado inexistente.'); return a;
}
export async function readArtifact(id: string, offset: number, length: number) {
  const a = await getArtifact(id);
  if (offset > a.bytes) throw new Error('Posición fuera del archivo.');
  const chunk = new Uint8Array(await a.blob.slice(offset, offset + length).arrayBuffer());
  let binary = ''; for (let i = 0; i < chunk.length; i += 8192) binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
  return { artifact: publicArtifact(a), offset, nextOffset: offset + chunk.length, eof: offset + chunk.length >= a.bytes, data: btoa(binary) };
}
