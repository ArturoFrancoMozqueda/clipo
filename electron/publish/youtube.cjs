// YouTube (and Shorts) from the desktop app, with no server of ours:
// - Sign-in: OAuth 2.0 for installed apps, PKCE + loopback redirect, in the user's browser.
// - Tokens and the optional client secret: encrypted with Electron safeStorage, never sent to the page.
// - Upload: YouTube Data API v3 resumable upload, in chunks, resumed after drops.
// The Google Cloud client is the user's own (they paste its ID in Clipo); nothing secret ships in the app.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createVerifier, challengeS256, createState, buildAuthUrl, startLoopback } = require('./oauth.cjs');
const { CHUNK_SIZE, chunkRange, nextOffset, isRetryableStatus, backoffMs, explainApiError } = require('./resumable.cjs');
const { fail } = require('./errors.cjs');

const GOOGLE = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  api: 'https://www.googleapis.com/youtube/v3',
  upload: 'https://www.googleapis.com/upload/youtube/v3',
};
// Upload videos + read the own channel name and the processing state of uploaded videos.
// youtube.readonly is needed: channels.list(mine=true) for the channel name/avatar shown in Cuentas,
// and videos.list(part=status,processingDetails) for "Estado". youtube.upload alone allows neither.
const SCOPE_UPLOAD = 'https://www.googleapis.com/auth/youtube.upload';
const SCOPES = [SCOPE_UPLOAD, 'https://www.googleapis.com/auth/youtube.readonly'];
const CLIENT_ID_RE = /^[\w.-]+\.apps\.googleusercontent\.com$/;

// ---------- limits and validation of what the page sends ----------
const GIB = 1024 ** 3;
/** YouTube's own limit per video. */
const MAX_VIDEO_BYTES = 256 * GIB;
/** A video sent in one IPC message (the old API) is held twice in memory: keep it bounded. */
const MAX_SINGLE_SHOT_BYTES = 2 * GIB;
/** Largest piece accepted by yt:uploadAppend. */
const MAX_APPEND_BYTES = 64 * 1024 * 1024;
/** YouTube rejects custom thumbnails over 2 MB. */
const MAX_THUMB_BYTES = 2 * 1024 * 1024;
const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']);
const THUMB_MIMES = new Set(['image/jpeg', 'image/png']);
const PRIVACY = new Set(['public', 'unlisted', 'private']);
const ID_RE = /^[\w-]{1,128}$/;

const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const bad = (what) => fail(`Clipo envió datos no válidos para subir (${what}). Reintenta; si sigue pasando, vuelve a exportar el video.`, false);

/** ArrayBuffer / typed array / Buffer from IPC as a Buffer view (no copy), or null. */
function toBuffer(v) {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  return null;
}

/** The video resource for videos.insert, rebuilt field by field from an allow-list. */
function buildMetadata(m) {
  if (!m || typeof m !== 'object') throw bad('metadata');
  const sn = m.snippet && typeof m.snippet === 'object' ? m.snippet : {};
  const st = m.status && typeof m.status === 'object' ? m.status : {};
  const title = typeof sn.title === 'string' ? sn.title.trim() : '';
  if (!title || Array.from(title).length > 100) throw fail('El título tiene que tener entre 1 y 100 letras.', false);
  const description = typeof sn.description === 'string' ? sn.description : '';
  if (Buffer.byteLength(description) > 5000) throw fail('La descripción es demasiado larga para YouTube (máximo 5000 bytes).', false);
  const categoryId = typeof sn.categoryId === 'string' && /^\d{1,3}$/.test(sn.categoryId) ? sn.categoryId : '22';
  const snippet = { title, description, categoryId };
  if (sn.tags !== undefined) {
    if (!Array.isArray(sn.tags) || sn.tags.length > 100 || !sn.tags.every((t) => typeof t === 'string' && t.length <= 100)) throw bad('tags');
    if (sn.tags.join(',').length > 500) throw fail('Los hashtags pasan del límite de YouTube (500 letras). Quita algunos.', false);
    if (sn.tags.length) snippet.tags = sn.tags.slice();
  }
  if (!PRIVACY.has(st.privacyStatus)) throw bad('privacidad');
  const status = { privacyStatus: st.privacyStatus, selfDeclaredMadeForKids: st.selfDeclaredMadeForKids === true };
  if (st.publishAt !== undefined) {
    const t = typeof st.publishAt === 'string' ? Date.parse(st.publishAt) : NaN;
    if (!Number.isFinite(t)) throw fail('La fecha programada no es válida para YouTube. Elige una hora en el futuro.', false);
    status.publishAt = new Date(t).toISOString();
  }
  return { snippet, status };
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

const sleep = (ms, signal) =>
  new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), rej(fail('Subida cancelada.'))), { once: true });
  });

/** `endpoints` and `chunkSize` exist only so tests can point it at a fake Google. */
function register({ app, ipcMain, shell, safeStorage, BrowserWindow, endpoints = {}, chunkSize = CHUNK_SIZE }) {
  const { auth: AUTH_URL, token: TOKEN_URL, revoke: REVOKE_URL, api: API, upload: UPLOAD_API } = { ...GOOGLE, ...endpoints };
  const dir = path.join(app.getPath('userData'), 'publish');
  const file = path.join(dir, 'youtube.json');

  // ---------- encrypted storage ----------
  // On Linux without a keyring, Electron "encrypts" with a hard-coded key (backend "basic_text"):
  // that is not real protection, so Clipo refuses to store tokens there.
  const canEncrypt = () =>
    safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text');
  const enc = (value) => safeStorage.encryptString(JSON.stringify(value)).toString('base64');
  const dec = (b64) => JSON.parse(safeStorage.decryptString(Buffer.from(b64, 'base64')));

  function load() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return { clientId: '', secret: null, accounts: [] };
    }
  }
  function save(data) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 1), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  }
  const publicAccount = (a) => ({ id: a.id, provider: 'google', networks: ['youtube', 'youtube_shorts'], name: a.name, avatar: a.avatar, connectedAt: a.connectedAt });
  const clientSecret = (data) => (data.secret ? dec(data.secret) : undefined);

  // ---------- tokens ----------
  async function tokenRequest(params) {
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, body };
  }

  function tokenError(body) {
    switch (body.error) {
      case 'invalid_client':
      case 'unauthorized_client':
        return fail('Google rechazó el ID de cliente. Revisa que sea de tipo “App de escritorio”, que esté bien copiado y, si Google te dio un secreto, que también esté pegado.', false);
      case 'invalid_grant':
        return fail('La conexión con este canal venció o se revocó. Ve a Cuentas, desconéctalo y vuelve a conectarlo. (Con la app de Google “en prueba”, Google corta la conexión cada 7 días.)', false);
      default:
        return fail(`Google no aceptó la conexión${body.error_description ? `: ${body.error_description}` : '.'}`, false);
    }
  }

  /** A valid access token for the account, refreshing it when it is about to expire. */
  async function accessToken(accountId, force = false) {
    const data = load();
    const acc = data.accounts.find((a) => a.id === accountId);
    if (!acc) throw fail('Ese canal ya no está conectado. Conéctalo de nuevo en Cuentas.', false);
    const tok = dec(acc.token);
    if (!force && tok.access_token && tok.expires_at - 60_000 > Date.now()) return tok.access_token;
    if (!tok.refresh_token) throw fail('Falta el permiso permanente de Google. Desconecta el canal y conéctalo otra vez.', false);
    const params = { client_id: data.clientId, grant_type: 'refresh_token', refresh_token: tok.refresh_token };
    const secret = clientSecret(data);
    if (secret) params.client_secret = secret;
    let r;
    try {
      r = await tokenRequest(params);
    } catch {
      throw fail('No hay conexión con Google. Revisa tu internet.');
    }
    if (!r.ok) throw tokenError(r.body);
    tok.access_token = r.body.access_token;
    tok.expires_at = Date.now() + (r.body.expires_in || 3600) * 1000;
    if (r.body.refresh_token) tok.refresh_token = r.body.refresh_token;
    acc.token = enc(tok);
    save(data);
    return tok.access_token;
  }

  async function api(accountId, url, init = {}) {
    for (let attempt = 0; ; attempt++) {
      const token = await accessToken(accountId, attempt > 0);
      const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
      if (res.status === 401 && attempt === 0) continue;
      return res;
    }
  }

  async function apiFail(res) {
    const { message, retryable } = explainApiError(res.status, await res.json().catch(() => null));
    return fail(message, retryable);
  }

  // ---------- connect ----------
  let connecting = null;

  async function connect(sender) {
    if (!canEncrypt()) throw fail('Este equipo no permite guardar la sesión de forma cifrada, así que Clipo no conecta cuentas.', false);
    const data = load();
    if (!data.clientId) throw fail('Primero pega tu ID de cliente de Google.', false);
    connecting?.cancel();
    const verifier = createVerifier();
    const state = createState();
    const loop = await startLoopback({ state });
    connecting = loop;
    try {
      const url = buildAuthUrl(AUTH_URL, {
        clientId: data.clientId,
        redirectUri: loop.redirectUri,
        scopes: SCOPES,
        challenge: challengeS256(verifier),
        state,
        // offline + consent: Google returns a refresh token, so uploads work without signing in each time.
        extra: { access_type: 'offline', prompt: 'consent select_account' },
      });
      await shell.openExternal(url);
      let got;
      try {
        got = await loop.result;
      } catch (e) {
        throw e.message === 'timeout'
          ? fail('Pasaron 5 minutos sin respuesta de Google. Vuelve a pulsar “Conectar”.', false)
          : fail('Conexión cancelada.', false);
      }
      const win = BrowserWindow?.fromWebContents(sender);
      if (win) (win.isMinimized() && win.restore(), win.focus());
      if (got.error) {
        throw fail(got.error === 'access_denied' ? 'No diste permiso en Google, así que no se conectó el canal.' : `Google no permitió conectar (${got.error}).`, false);
      }
      const params = { client_id: data.clientId, code: got.code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: loop.redirectUri };
      const secret = clientSecret(data);
      if (secret) params.client_secret = secret;
      const r = await tokenRequest(params).catch(() => {
        throw fail('No hay conexión con Google. Revisa tu internet.', false);
      });
      if (!r.ok) throw tokenError(r.body);
      const granted = String(r.body.scope || '').split(' ');
      if (!granted.includes(SCOPE_UPLOAD)) throw fail('En Google no marcaste el permiso para subir videos. Vuelve a conectar y déjalo marcado.', false);
      const tok = { access_token: r.body.access_token, refresh_token: r.body.refresh_token, expires_at: Date.now() + (r.body.expires_in || 3600) * 1000 };

      const ch = await fetch(`${API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
      if (!ch.ok) throw await apiFail(ch);
      const item = (await ch.json()).items?.[0];
      if (!item) throw fail('Esta cuenta de Google no tiene canal de YouTube. Crea uno en youtube.com y vuelve a conectarla.', false);

      const fresh = load();
      const old = fresh.accounts.find((a) => a.id === item.id);
      if (!tok.refresh_token && old) tok.refresh_token = dec(old.token).refresh_token;
      const acc = {
        id: item.id,
        name: item.snippet?.title || 'Mi canal',
        avatar: item.snippet?.thumbnails?.default?.url,
        connectedAt: Date.now(),
        token: enc(tok),
      };
      fresh.accounts = [...fresh.accounts.filter((a) => a.id !== item.id), acc];
      save(fresh);
      return publicAccount(acc);
    } finally {
      loop.cancel();
      if (connecting === loop) connecting = null;
    }
  }

  /** Best effort: also remove Clipo's access in the Google account. */
  async function revoke(acc) {
    try {
      const tok = dec(acc.token);
      const t = tok.refresh_token || tok.access_token;
      if (t) await fetch(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t }), signal: AbortSignal.timeout(10_000) });
    } catch {}
  }

  async function disconnect(accountId) {
    if (!isId(accountId)) return;
    const data = load();
    const acc = data.accounts.find((a) => a.id === accountId);
    if (!acc) return;
    await revoke(acc);
    const fresh = load();
    fresh.accounts = fresh.accounts.filter((a) => a.id !== accountId);
    save(fresh);
  }

  // ---------- upload ----------
  /** jobId -> { uri, total } so a retry resumes where the last attempt stopped. */
  const sessions = new Map();
  /** jobId -> AbortController of the running upload. */
  const running = new Map();

  async function startSession(accountId, metadata, total, mime) {
    const res = await api(accountId, `${UPLOAD_API}/videos?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(total), 'X-Upload-Content-Type': mime },
      body: JSON.stringify(metadata),
    });
    if (!res.ok) throw await apiFail(res);
    const uri = res.headers.get('location');
    if (!uri) throw fail('YouTube no devolvió la dirección de subida. Intenta otra vez.');
    return uri;
  }

  /** Ask how much YouTube already has. Returns { offset } or { done: videoResource }. */
  async function queryOffset(accountId, uri, total, signal) {
    const res = await api(accountId, uri, { method: 'PUT', headers: { 'Content-Range': `bytes */${total}` }, body: Buffer.alloc(0), signal });
    if (res.status === 200 || res.status === 201) return { done: await res.json() };
    if (res.status === 308) return { offset: nextOffset(res.headers.get('range')) };
    if (res.status === 404 || res.status === 410) return { expired: true };
    if (isRetryableStatus(res.status)) return { offset: null };
    throw await apiFail(res);
  }

  async function sendAll({ jobId, accountId, src, mime, metadata, signal, report }) {
    const total = src.size;
    let s = sessions.get(jobId);
    if (s && s.total !== total) s = undefined;
    let offset = 0;
    if (s) {
      const q = await queryOffset(accountId, s.uri, total, signal).catch((e) => (signal.aborted ? Promise.reject(e) : { offset: null }));
      if (q.done) return q.done;
      if (q.expired || q.offset == null) s = undefined;
      else offset = q.offset;
    }
    if (!s) {
      s = { uri: await startSession(accountId, metadata, total, mime), total };
      sessions.set(jobId, s);
      offset = 0;
    }
    report(offset, total);
    let failures = 0;
    for (;;) {
      if (signal.aborted) throw fail('Subida cancelada.');
      const { start, end } = chunkRange(offset, total, chunkSize);
      const body = await src.read(start, end);
      let res = null;
      try {
        res = await api(accountId, s.uri, {
          method: 'PUT',
          headers: { 'Content-Type': mime, 'Content-Range': `bytes ${start}-${end}/${total}` },
          body,
          signal,
        });
      } catch (e) {
        if (signal.aborted) throw fail('Subida cancelada.');
        if (e.message?.startsWith('F|')) throw e;
      }
      if (res && (res.status === 200 || res.status === 201)) return res.json();
      if (res && res.status === 308) {
        offset = nextOffset(res.headers.get('range'));
        failures = 0;
        report(offset, total);
        continue;
      }
      if (res && (res.status === 404 || res.status === 410)) {
        // The session expired: start over once from the first byte.
        sessions.delete(jobId);
        s = { uri: await startSession(accountId, metadata, total, mime), total };
        sessions.set(jobId, s);
        offset = 0;
        report(0, total);
        continue;
      }
      if (res && !isRetryableStatus(res.status) && res.status !== 429) throw await apiFail(res);
      // Dropped connection or a temporary server error: wait, ask what arrived, continue from there.
      if (++failures > 6) throw fail('Se perdió la conexión con YouTube varias veces. Revisa tu internet y pulsa “Reintentar”: seguirá desde donde quedó.');
      await sleep(backoffMs(failures), signal);
      const q = await queryOffset(accountId, s.uri, total, signal).catch((e) => (signal.aborted ? Promise.reject(e) : { offset: null }));
      if (q.done) return q.done;
      if (q.offset != null) offset = q.offset;
    }
  }

  async function setThumbnail(accountId, videoId, thumb) {
    try {
      const res = await api(accountId, `${UPLOAD_API}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
        method: 'POST',
        headers: { 'Content-Type': thumb.mime },
        body: thumb.bytes,
      });
      if (res.ok) return undefined;
      if (res.status === 403) return 'El video se subió, pero YouTube no dejó poner la portada: tu canal tiene que estar verificado (youtube.com/verify).';
      return `El video se subió, pero la portada no: ${explainApiError(res.status, await res.json().catch(() => null)).message}`;
    } catch {
      return 'El video se subió, pero la portada no se pudo enviar. Puedes ponerla en YouTube Studio.';
    }
  }

  // ---------- chunked transfer from the page (no whole video in one IPC message) ----------
  // yt:uploadBegin → yt:uploadAppend (in order, ≤ 64 MiB each) → yt:upload({ fileId, … }).
  // The video is written to a private temp file and read back chunk by chunk while uploading.
  const tmpDir = path.join(app.getPath('temp'), 'clipo-upload');
  /** fileId -> { file, total, written, mime } */
  const files = new Map();
  // Files left by a previous run (crash, forced quit) are useless: their ids are gone.
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  async function beginFile(total, mime) {
    if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_VIDEO_BYTES) throw bad('tamaño');
    if (mime !== undefined && !VIDEO_MIMES.has(mime)) throw bad('tipo de video');
    await fs.promises.mkdir(tmpDir, { recursive: true, mode: 0o700 });
    const fileId = crypto.randomUUID();
    const file = path.join(tmpDir, `${fileId}.part`);
    await fs.promises.writeFile(file, Buffer.alloc(0), { mode: 0o600 });
    files.set(fileId, { file, total, written: 0, mime: mime || 'video/mp4', busy: false });
    return { fileId, chunkLimit: MAX_APPEND_BYTES };
  }

  async function appendFile(fileId, bytes) {
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

  async function discardFile(fileId) {
    const f = typeof fileId === 'string' ? files.get(fileId) : undefined;
    if (!f) return;
    files.delete(fileId);
    await fs.promises.rm(f.file, { force: true }).catch(() => {});
  }

  async function upload(sender, req) {
    if (!req || typeof req !== 'object') throw bad('pedido');
    const { jobId, accountId } = req;
    if (!isId(jobId) || !isId(accountId)) throw bad('ids');
    if (req.mime !== undefined && !VIDEO_MIMES.has(req.mime)) throw bad('tipo de video');
    const metadata = buildMetadata(req.metadata);
    let thumbnail;
    if (req.thumbnail) {
      const tb = toBuffer(req.thumbnail.bytes);
      if (!tb || !tb.length || tb.length > MAX_THUMB_BYTES || !THUMB_MIMES.has(req.thumbnail.mime)) throw fail('La portada tiene que ser JPG o PNG de hasta 2 MB.', false);
      thumbnail = { bytes: tb, mime: req.thumbnail.mime };
    }
    let file;
    if (req.fileId !== undefined) {
      file = typeof req.fileId === 'string' ? files.get(req.fileId) : undefined;
      if (!file) throw bad('archivo');
      if (file.written !== file.total) throw bad('archivo incompleto');
    }
    if (running.has(jobId)) throw fail('Ese video ya se está subiendo.', false);
    const ac = new AbortController();
    running.set(jobId, ac);
    let last = 0;
    const report = (sent, total) => {
      const now = Date.now();
      if (sent < total && now - last < 250) return;
      last = now;
      if (!sender.isDestroyed()) sender.send('yt:progress', { jobId, sent, total });
    };
    let src;
    try {
      if (file) src = await fileSource(file.file);
      else {
        const buf = toBuffer(req.bytes);
        if (!buf) throw bad('video');
        if (buf.length > MAX_SINGLE_SHOT_BYTES) throw fail('El video es muy grande para enviarlo de una vez. Actualiza Clipo y vuelve a intentarlo.', false);
        src = bufferSource(buf);
      }
      if (!src.size) throw fail('El video está vacío.', false);
      const mime = req.mime || file?.mime || 'video/mp4';
      const video = await sendAll({ jobId, accountId, src, mime, metadata, signal: ac.signal, report });
      sessions.delete(jobId);
      report(src.size, src.size);
      if (!video?.id) throw fail('YouTube terminó la subida pero no devolvió el video. Revisa YouTube Studio antes de reintentar.', false);
      // Done: the temp copy is no longer needed. (After a failure it is kept so "Reintentar" resumes.)
      if (file) await discardFile(req.fileId);
      const note = thumbnail ? await setThumbnail(accountId, video.id, thumbnail) : undefined;
      return { videoId: video.id, note };
    } catch (e) {
      if (e.message?.match(/^[RF]\|/)) throw e;
      throw fail('No hay conexión con YouTube. Revisa tu internet y pulsa “Reintentar”.');
    } finally {
      await src?.close().catch(() => {});
      running.delete(jobId);
    }
  }

  async function status(accountId, videoId) {
    if (!isId(accountId) || !isId(videoId)) throw bad('ids');
    const res = await api(accountId, `${API}/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`);
    if (!res.ok) throw await apiFail(res);
    const v = (await res.json()).items?.[0];
    if (!v) return { state: 'unknown', detail: 'YouTube no encuentra el video. Puede que lo hayan borrado.' };
    const vis = { public: 'público', unlisted: 'no listado', private: 'privado' }[v.status?.privacyStatus] || v.status?.privacyStatus;
    const when = v.status?.publishAt ? ` · se publica el ${new Date(v.status.publishAt).toLocaleString('es')}` : '';
    switch (v.status?.uploadStatus) {
      case 'processed':
        return { state: 'ready', detail: `Listo en YouTube · ${vis}${when}` };
      case 'uploaded':
        return { state: 'processing', detail: `YouTube lo está procesando · ${vis}${when}` };
      case 'failed':
        return { state: 'failed', detail: `YouTube no pudo procesarlo (${v.status.failureReason || 'motivo desconocido'}).` };
      case 'rejected':
        return { state: 'failed', detail: `YouTube lo rechazó (${v.status.rejectionReason || 'motivo desconocido'}).` };
      case 'deleted':
        return { state: 'failed', detail: 'El video fue borrado de YouTube.' };
      default:
        return { state: 'unknown', detail: `Estado: ${v.status?.uploadStatus || 'desconocido'}` };
    }
  }

  // ---------- IPC (only from Clipo's own page) ----------
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!event.senderFrame?.url.startsWith('app://clipo/')) throw new Error('forbidden');
      return fn(event, ...args);
    });

  handle('yt:getConfig', () => {
    const d = load();
    return { clientId: d.clientId || '', hasSecret: !!d.secret, encryption: canEncrypt() };
  });
  handle('yt:setConfig', async (_e, cfg) => {
    const { clientId, clientSecret: secret } = cfg && typeof cfg === 'object' ? cfg : {};
    const id = String(clientId || '').trim();
    if (id && !CLIENT_ID_RE.test(id)) throw fail('Eso no parece un ID de cliente de Google: termina en “.apps.googleusercontent.com”.', false);
    if (secret !== undefined && secret !== null && (typeof secret !== 'string' || secret.length > 256)) throw bad('secreto');
    if (!canEncrypt()) throw fail('Este equipo no permite guardar datos cifrados.', false);
    const d = load();
    // Tokens belong to one client: a different client ID means connecting the channels again.
    // Revoke them in Google first, so no grant is left behind for the old client.
    if (d.clientId && id !== d.clientId) {
      await Promise.all(d.accounts.map(revoke));
      d.accounts = [];
    }
    d.clientId = id;
    if (secret !== undefined) d.secret = String(secret ?? '').trim() ? enc(String(secret).trim()) : null;
    save(d);
  });
  handle('yt:connect', (e) => connect(e.sender));
  handle('yt:cancelConnect', () => connecting?.cancel());
  handle('yt:accounts', () => (canEncrypt() ? load().accounts.map(publicAccount) : []));
  handle('yt:disconnect', (_e, id) => disconnect(id));
  handle('yt:upload', (e, req) => upload(e.sender, req));
  handle('yt:uploadBegin', (_e, total, mime) => beginFile(total, mime));
  handle('yt:uploadAppend', (_e, fileId, bytes) => appendFile(fileId, bytes));
  handle('yt:uploadDiscard', (_e, fileId) => discardFile(fileId));
  handle('yt:cancelUpload', (_e, jobId) => (isId(jobId) ? running.get(jobId)?.abort() : undefined));
  handle('yt:status', (_e, accountId, videoId) => status(accountId, videoId));

  return {
    activeUploads: () => running.size,
    /** Remove the temp copies of videos (call on quit). */
    cleanup: () => {
      files.clear();
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

module.exports = { register };
