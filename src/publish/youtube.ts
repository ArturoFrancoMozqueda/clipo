// YouTube (and Shorts) through the desktop app. Sign-in, tokens and the resumable upload all
// happen in Electron's main process (electron/publish/youtube.cjs); this side only forwards.
import { bridgeError, desktop } from './desktop';
import { PublishError } from './queue';
import { buildYouTubeMetadata, checkYouTube, youtubeUrl } from './text';
import type { Availability, Publisher, UploadInput } from './types';

export const youtubePublisher: Publisher = {
  id: 'youtube-desktop',
  networks: ['youtube', 'youtube_shorts'],

  async availability(): Promise<Availability> {
    const d = desktop();
    if (!d) return { ok: false, reason: 'Publicar directo funciona solo en la app de Clipo para computadora.' };
    const c = await d.youtube.getConfig();
    if (!c.encryption) return { ok: false, reason: 'Este equipo no permite guardar la sesión de forma cifrada, así que Clipo no conecta cuentas.' };
    if (!c.clientId) return { ok: false, reason: 'Falta configurar YouTube: pega tu “ID de cliente” de Google en Cuentas.' };
    return { ok: true };
  },

  async listAccounts() {
    return (await desktop()?.youtube.accounts()) ?? [];
  },

  async connect() {
    const d = desktop();
    if (!d) throw new PublishError('Conectar cuentas funciona solo en la app de Clipo para computadora.', false);
    try {
      return await d.youtube.connect();
    } catch (e) {
      throw new PublishError(bridgeError(e).message, false);
    }
  },

  cancelConnect() {
    void desktop()?.youtube.cancelConnect();
  },

  async disconnect(accountId) {
    await desktop()?.youtube.disconnect(accountId);
  },

  check: checkYouTube,

  async upload(input: UploadInput, onProgress, signal) {
    const d = desktop();
    if (!d) throw new PublishError('Publicar directo funciona solo en la app de Clipo para computadora.', false);
    const issues = checkYouTube(input.network, input.videoInfo, input.post);
    if (issues.length) throw new PublishError(issues.join(' '), false);
    const off = d.youtube.onProgress((p) => p.jobId === input.jobId && p.total > 0 && onProgress((p.sent / p.total) * 100));
    const abort = () => void d.youtube.cancelUpload(input.jobId);
    signal.addEventListener('abort', abort);
    const yt = d.youtube;
    const mime = input.video.type || 'video/mp4';
    let fileId: string | undefined;
    try {
      if (yt.chunkedUpload && yt.uploadBegin && yt.uploadAppend) {
        // Hand the video over in pieces, one after another, so it never sits whole in memory.
        const begun = await yt.uploadBegin(input.video.size, mime);
        fileId = begun.fileId;
        for (let at = 0; at < input.video.size; at += begun.chunkLimit) {
          if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
          await yt.uploadAppend(fileId, await input.video.slice(at, at + begun.chunkLimit).arrayBuffer());
        }
      }
      const res = await yt.upload({
        jobId: input.jobId,
        accountId: input.accountId,
        ...(fileId ? { fileId } : { bytes: await input.video.arrayBuffer() }),
        mime,
        metadata: buildYouTubeMetadata(input.network, input.videoInfo, input.post, input.options),
        thumbnail: input.thumbnail ? { bytes: await input.thumbnail.arrayBuffer(), mime: input.thumbnail.type || 'image/jpeg' } : undefined,
      });
      const notes = [res.note];
      if (input.options.nativePublishAt) {
        notes.push(`YouTube lo hará público el ${new Date(input.options.nativePublishAt).toLocaleString('es')}. Hasta entonces está privado.`);
      }
      return { remoteId: res.videoId, url: youtubeUrl(input.network, res.videoId), note: notes.filter(Boolean).join(' ') || undefined };
    } catch (e) {
      // A retry sends the video again, so the half-used copy is not needed.
      if (fileId) void yt.uploadDiscard?.(fileId).catch(() => {});
      const { message, retryable } = bridgeError(e);
      throw new PublishError(message, retryable);
    } finally {
      off();
      signal.removeEventListener('abort', abort);
    }
  },

  async status(accountId, remoteId) {
    const d = desktop();
    if (!d) return { state: 'unknown', detail: 'Solo se puede consultar desde la app de computadora.' };
    try {
      return await d.youtube.status(accountId, remoteId);
    } catch (e) {
      return { state: 'unknown', detail: bridgeError(e).message };
    }
  },
};
