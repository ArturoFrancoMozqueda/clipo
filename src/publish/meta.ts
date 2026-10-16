// Facebook Pages and Instagram Reels through the desktop app. Sign-in, tokens, the App Secret and
// the uploads all live in Electron's main process (electron/publish/meta.cjs); this side only forwards.
import { bridgeError, desktop } from './desktop';
import { PublishError } from './queue';
import { checkMeta, metaCaption } from './text';
import type { Availability, Publisher, UploadInput } from './types';

const ONLY_DESKTOP = 'Publicar directo funciona solo en la app de Clipo para computadora.';

export const metaPublisher: Publisher = {
  id: 'meta-desktop',
  networks: ['facebook', 'instagram_reels'],

  async availability(): Promise<Availability> {
    const m = desktop()?.meta;
    if (!m) return { ok: false, reason: desktop() ? 'Actualiza la app de Clipo para publicar en Facebook e Instagram.' : ONLY_DESKTOP };
    const c = await m.getConfig();
    if (!c.encryption) return { ok: false, reason: 'Este equipo no permite guardar la sesión de forma cifrada, así que Clipo no conecta cuentas.' };
    if (!c.appId && !c.usingBuiltIn) return { ok: false, reason: 'Falta configurar Facebook e Instagram: pega el App ID de tu app de Meta en Cuentas.' };
    if (!c.hasSecret) return { ok: false, reason: 'Falta configurar Facebook e Instagram: pega la clave secreta (App Secret) de tu app de Meta en Cuentas.' };
    return { ok: true };
  },

  async listAccounts() {
    return (await desktop()?.meta?.accounts()) ?? [];
  },

  async connect() {
    const m = desktop()?.meta;
    if (!m) throw new PublishError('Conectar cuentas funciona solo en la app de Clipo para computadora.', false);
    let r;
    try {
      r = await m.connect();
    } catch (e) {
      throw new PublishError(bridgeError(e).message, false);
    }
    const [first] = r.accounts;
    if (!first) throw new PublishError(r.notes.join(' ') || 'No se conectó ninguna cuenta.', false);
    return first;
  },

  cancelConnect() {
    void desktop()?.meta?.cancelConnect();
  },

  async disconnect(accountId) {
    await desktop()?.meta?.disconnect(accountId);
  },

  check: checkMeta,

  async upload(input: UploadInput, onProgress, signal) {
    const m = desktop()?.meta;
    if (!m) throw new PublishError(ONLY_DESKTOP, false);
    if (input.network !== 'facebook' && input.network !== 'instagram_reels') throw new PublishError('Esta red no se publica con Facebook.', false);
    const network = input.network;
    const issues = checkMeta(network, input.videoInfo, input.post);
    if (issues.length) throw new PublishError(issues.join(' '), false);
    const ig = network === 'instagram_reels';
    const publishAt = ig ? undefined : input.options.nativePublishAt;
    // Facebook has no "unlisted": anything but public is uploaded without publishing it.
    const unpublished = !ig && !publishAt && input.options.privacy !== 'public';
    if (ig && input.options.privacy !== 'public') throw new PublishError('Instagram no tiene publicaciones privadas ni no listadas: elige “Público”.', false);

    const off = m.onProgress((p) => p.jobId === input.jobId && p.total > 0 && onProgress((p.sent / p.total) * 100));
    const abort = () => void m.cancelUpload(input.jobId);
    signal.addEventListener('abort', abort);
    const mime = input.video.type || 'video/mp4';
    let fileId: string | undefined;
    try {
      // Hand the video over in pieces, one after another, so it never sits whole in memory.
      const begun = await m.uploadBegin(input.video.size, mime);
      fileId = begun.fileId;
      for (let at = 0; at < input.video.size; at += begun.chunkLimit) {
        if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
        await m.uploadAppend(fileId, await input.video.slice(at, at + begun.chunkLimit).arrayBuffer());
      }
      const title = input.post.title?.trim();
      const res = await m.upload({
        jobId: input.jobId,
        accountId: input.accountId,
        network,
        fileId,
        mime,
        text: { caption: metaCaption(input.post), ...(!ig && title ? { title } : {}) },
        ...(publishAt ? { publishAt } : {}),
        ...(unpublished ? { published: false } : {}),
        thumbnail: !ig && input.thumbnail ? { bytes: await input.thumbnail.arrayBuffer(), mime: input.thumbnail.type || 'image/jpeg' } : undefined,
      });
      const notes = [res.note];
      if (publishAt) notes.push(`Facebook lo publicará el ${new Date(publishAt).toLocaleString('es')}.`);
      if (unpublished) notes.push('Quedó sin publicar, en la biblioteca de videos de la página (Facebook no tiene “no listado” ni “privado”).');
      if (ig && input.thumbnail) notes.push('Instagram usa un cuadro del video como portada: la portada elegida no se puede enviar desde la computadora.');
      return { remoteId: res.remoteId, url: res.url, note: notes.filter(Boolean).join(' ') || undefined };
    } catch (e) {
      // A retry sends the video again, so the half-used copy is not needed.
      if (fileId) void m.uploadDiscard(fileId).catch(() => {});
      const { message, retryable } = bridgeError(e);
      throw new PublishError(message, retryable);
    } finally {
      off();
      signal.removeEventListener('abort', abort);
    }
  },

  async status(accountId, remoteId) {
    const m = desktop()?.meta;
    if (!m) return { state: 'unknown', detail: 'Solo se puede consultar desde la app de computadora.' };
    try {
      return await m.status(accountId, remoteId);
    } catch (e) {
      return { state: 'unknown', detail: bridgeError(e).message };
    }
  },
};
