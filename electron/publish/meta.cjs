// Facebook Pages and Instagram Reels from the desktop app, with no server of ours:
// - Sign-in: Facebook Login "manual flow" in the user's browser, with a loopback redirect to
//   http://localhost:<port>/ (Meta allows localhost redirects while the app is in Development mode)
//   and a random state. The code is exchanged for a 60-day user token; the Page tokens read with it
//   don't expire.
// - The Meta app is the owner's own: the App ID is public (it can be built in, see meta-client.cjs);
//   the App Secret is pasted once in Cuentas. Meta requires it to exchange the code and to get the
//   long-lived token, so it is encrypted with Electron safeStorage like the tokens, never sent to the page.
// - Facebook: the video goes to the Page in chunks (upload_phase start/transfer/finish), resumed after
//   drops; native scheduling with scheduled_publish_time.
// - Instagram: Reels "resumable" upload to rupload.facebook.com (no public URL needed), status polling
//   until FINISHED, then media_publish. Instagram can't schedule through the API: the page's local
//   scheduler (src/publish/queue.ts) does it, with Clipo open.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createState, startLoopback } = require('./oauth.cjs');
const { backoffMs } = require('./resumable.cjs');
const { fail } = require('./errors.cjs');
const { bad, toBuffer, fileSource, tempFiles } = require('./files.cjs');
const { explainGraphError } = require('./meta-errors.cjs');
const { builtInMetaApp, APP_ID_RE, APP_SECRET_RE, CONFIG_ID_RE } = require('./meta-client.cjs');

/** The one Graph API version Clipo talks to (v26.0, released July 29, 2026). */
const GRAPH_VERSION = 'v26.0';
const META = {
  dialog: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`,
  graph: `https://graph.facebook.com/${GRAPH_VERSION}`,
  video: `https://graph-video.facebook.com/${GRAPH_VERSION}`,
  rupload: 'https://rupload.facebook.com',
};
// List the Pages and their linked Instagram professional accounts, publish videos to a Page, and
// publish Reels. business_management is needed when the Pages belong to a business portfolio.
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management', 'instagram_basic', 'instagram_content_publish'];
/** Tried first, so http://localhost:47615/ can be added to "Valid OAuth Redirect URIs" if Meta asks. */
const LOOPBACK_PORT = 47615;

// ---------- limits and validation of what the page sends ----------
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
/** Facebook Page videos: up to 10 GB. Instagram Reels: up to 300 MB, 3 s to 15 min. */
const FB_MAX_BYTES = 10 * GIB;
const IG_MAX_BYTES = 300 * MIB;
const MAX_THUMB_BYTES = 10 * MIB;
const FB_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']);
const IG_MIMES = new Set(['video/mp4', 'video/quicktime']);
const THUMB_MIMES = new Set(['image/jpeg', 'image/png']);
const FB_TITLE_MAX = 255;
const FB_TEXT_MAX = 63206;
const IG_CAPTION_MAX = 2200;
const IG_HASHTAGS_MAX = 30;
const IG_MENTIONS_MAX = 20;
/** Facebook schedules between 10 minutes and 6 months ahead. */
const SCHEDULE_MIN_MS = 10 * 60_000;
const SCHEDULE_MAX_MS = 180 * 24 * 3600_000;
const ID_RE = /^[\w-]{1,128}$/;
const NETWORKS = new Set(['facebook', 'instagram_reels']);

const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const isNumericId = (v) => typeof v === 'string' && /^\d{1,32}$/.test(v);
const chars = (s) => Array.from(s).length;
const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('hex');
const isRetry = (e) => typeof e?.message === 'string' && e.message.startsWith('R|');
const isFail = (e) => typeof e?.message === 'string' && /^[RF]\|/.test(e.message);
/** An https image URL from Meta's CDN for the avatar, or undefined. */
const imageUrl = (u) => (typeof u === 'string' && u.length < 2048 && /^https:\/\//.test(u) ? u : undefined);

const sleep = (ms, signal) =>
  new Promise((res, rej) => {
    if (signal?.aborted) return rej(fail('Subida cancelada.'));
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), rej(fail('Subida cancelada.'))), { once: true });
  });

/** The post text, rebuilt from an allow-list and checked against each network's limits. */
function buildText(network, t) {
  if (!t || typeof t !== 'object') throw bad('texto');
  const caption = typeof t.caption === 'string' ? t.caption : '';
  if (network === 'instagram_reels') {
    if (chars(caption) > IG_CAPTION_MAX) throw fail(`El texto es muy largo para Instagram (máximo ${IG_CAPTION_MAX} letras).`, false);
    if ((caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length > IG_HASHTAGS_MAX) throw fail(`Instagram acepta hasta ${IG_HASHTAGS_MAX} hashtags. Quita algunos.`, false);
    if ((caption.match(/(^|\s)@[\w.]+/g) || []).length > IG_MENTIONS_MAX) throw fail(`Instagram acepta hasta ${IG_MENTIONS_MAX} menciones (@). Quita algunas.`, false);
    return { caption };
  }
  if (chars(caption) > FB_TEXT_MAX) throw fail('El texto es muy largo para Facebook.', false);
  const title = typeof t.title === 'string' ? t.title.trim() : '';
  if (chars(title) > FB_TITLE_MAX) throw fail(`El título es muy largo para Facebook (máximo ${FB_TITLE_MAX} letras).`, false);
  return title ? { caption, title } : { caption };
}

/** `endpoints`, `pollMs` and `loopbackPort` exist only so tests can point it at a fake Meta. */
function register({
  app,
  ipcMain,
  shell,
  safeStorage,
  BrowserWindow,
  endpoints = {},
  builtIn = builtInMetaApp(),
  pollMs = [3000, 5000, 10_000, 15_000, 20_000],
  pollLimitMs = 15 * 60_000,
  loopbackPort = LOOPBACK_PORT,
}) {
  const { dialog: DIALOG, graph: GRAPH, video: VIDEO, rupload: RUPLOAD } = { ...META, ...endpoints };
  const dir = path.join(app.getPath('userData'), 'publish');
  const file = path.join(dir, 'meta.json');

  // ---------- encrypted storage ----------
  // Same rule as YouTube: on Linux without a keyring ("basic_text") nothing is really encrypted,
  // so Clipo refuses to store the secret and tokens there.
  const canEncrypt = () =>
    safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text');
  const enc = (value) => safeStorage.encryptString(JSON.stringify(value)).toString('base64');
  const dec = (b64) => JSON.parse(safeStorage.decryptString(Buffer.from(b64, 'base64')));

  function load() {
    let d = {};
    try {
      d = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    return { appId: '', secret: null, configId: '', logins: [], accounts: [], ...d };
  }
  function save(data) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 1), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  }
  const appIdOf = (data) => data.appId || builtIn?.appId || '';
  let secretCache = { raw: null, value: null };
  function secretOf(data) {
    if (!data.secret) return null;
    if (secretCache.raw !== data.secret) secretCache = { raw: data.secret, value: dec(data.secret) };
    return secretCache.value;
  }
  const publicAccount = (a) => ({
    id: a.id,
    provider: 'meta',
    networks: a.networks,
    name: a.name,
    avatar: a.avatar,
    connectedAt: a.connectedAt,
    detail: a.kind === 'page' ? 'Página de Facebook' : `Instagram · vinculada a la página “${a.pageName}”`,
  });

  // ---------- Graph calls ----------
  // appsecret_proof proves the call comes from the owner of the App Secret (Meta recommends it for
  // every call made with a user or Page token). Meta's docs show the time-stamped form; if Graph
  // doesn't take it, Clipo falls back to the classic one (HMAC of the token alone).
  let proofMode = 'timed';
  function proof(secret, token) {
    if (!secret || !token) return {};
    if (proofMode === 'classic') return { appsecret_proof: hmac(secret, token) };
    const t = Math.floor(Date.now() / 1000);
    return { appsecret_proof: hmac(secret, `${token}|${t}`), appsecret_time: String(t) };
  }

  function graphFail(err, status, net) {
    const { message, retryable } = explainGraphError(err, status, net);
    const e = fail(message, retryable);
    e.graph = { code: Number(err?.code) || 0, subcode: Number(err?.error_subcode) || 0, status };
    return e;
  }

  /** One Graph call. `params` go in the query (GET/DELETE) or the form (POST); `form` is for files. */
  async function graph(method, url, { token, params = {}, form, signal, net = 'Facebook' } = {}) {
    for (let attempt = 0; ; attempt++) {
      const all = { ...params, ...(token ? { access_token: token, ...proof(secretOf(load()), token) } : {}) };
      const u = new URL(url);
      let body;
      if (method === 'GET' || method === 'DELETE') for (const [k, v] of Object.entries(all)) u.searchParams.set(k, String(v));
      else if (form) {
        for (const [k, v] of Object.entries(all)) form.set(k, String(v));
        body = form;
      } else body = new URLSearchParams(Object.entries(all).map(([k, v]) => [k, String(v)]));
      let res;
      try {
        res = await fetch(u, { method, body, signal });
      } catch {
        if (signal?.aborted) throw fail('Subida cancelada.');
        throw fail(`No hay conexión con ${net}. Revisa tu internet y pulsa “Reintentar”.`);
      }
      const json = await res.json().catch(() => ({}));
      if (res.ok && !json?.error) return json;
      const err = json?.error;
      if (attempt === 0 && token && proofMode === 'timed' && Number(err?.code) === 100 && /appsecret/i.test(err?.message || '')) {
        proofMode = 'classic';
        continue;
      }
      throw graphFail(err, res.status, net);
    }
  }

  /** oauth/access_token (code → token, short → long-lived). Needs the App Secret. */
  async function exchange(params) {
    const u = new URL(`${GRAPH}/oauth/access_token`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    let res;
    try {
      res = await fetch(u);
    } catch {
      throw fail('No hay conexión con Facebook. Revisa tu internet.', false);
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.access_token) return json;
    const msg = String(json?.error?.message || '');
    if (/client secret|client_secret/i.test(msg))
      throw fail('Meta rechazó la clave secreta de la app. Cópiala otra vez desde developers.facebook.com (Configuración de la app → Básica → Clave secreta) y pégala en Cuentas.', false);
    if (/redirect_uri/i.test(msg))
      throw fail('Meta no aceptó la dirección de regreso. En tu app de Meta, Inicio de sesión con Facebook → Configuración, agrega http://localhost:47615/ en “URI de redireccionamiento de OAuth válidos”.', false);
    if (/verification code|authorization code|code has (expired|been used)/i.test(msg)) throw fail('El inicio de sesión venció. Vuelve a pulsar “Conectar con Facebook”.', false);
    throw graphFail(json?.error, res.status, 'Facebook');
  }

  // ---------- connect ----------
  let connecting = null;

  /** Every Page the person can publish on, with its linked Instagram professional account. */
  async function listPages(token) {
    const pages = [];
    let url = `${GRAPH}/me/accounts`;
    let params = { fields: 'id,name,access_token,tasks,picture{url},instagram_business_account{id,username,name,profile_picture_url}', limit: 100 };
    for (let i = 0; i < 10 && url; i++) {
      const r = await graph('GET', url, { token, params });
      pages.push(...(Array.isArray(r.data) ? r.data : []));
      const next = r.paging?.next;
      // Only follow "next" links to Graph itself (the token goes with them).
      url = typeof next === 'string' && next.startsWith(`${new URL(GRAPH).origin}/`) ? next : '';
      params = {};
    }
    return pages.filter(
      (p) => isNumericId(p?.id) && typeof p.access_token === 'string' && (!Array.isArray(p.tasks) || p.tasks.includes('CREATE_CONTENT') || p.tasks.includes('MANAGE')),
    );
  }

  async function connect(sender) {
    if (!canEncrypt()) throw fail('Este equipo no permite guardar la sesión de forma cifrada, así que Clipo no conecta cuentas.', false);
    const data = load();
    const appId = appIdOf(data);
    const secret = secretOf(data);
    if (!appId) throw fail('Primero pega el identificador de tu app de Meta (App ID) en Cuentas.', false);
    if (!secret) throw fail('Falta la clave secreta de tu app de Meta (App Secret). Pégala en Cuentas → Facebook e Instagram.', false);
    connecting?.cancel();
    const state = createState();
    let loop;
    try {
      loop = await startLoopback({ state, host: 'localhost', port: loopbackPort });
    } catch {
      throw fail('No se pudo preparar el inicio de sesión en este equipo. Cierra otros programas y vuelve a intentarlo.', false);
    }
    connecting = loop;
    try {
      const url = new URL(DIALOG);
      const p = { client_id: appId, redirect_uri: loop.redirectUri, state, response_type: 'code' };
      // Facebook Login for Business: the configuration lists the permissions; else ask with scope.
      if (data.configId) Object.assign(p, { config_id: data.configId, override_default_response_type: 'true' });
      // IG_API_ONBOARDING is Meta's "Instagram API with Facebook Login" dialog: it also offers to pick
      // (and link) the Instagram professional account of each Page.
      else Object.assign(p, { scope: SCOPES.join(','), auth_type: 'rerequest', display: 'page', extras: JSON.stringify({ setup: { channel: 'IG_API_ONBOARDING' } }) });
      for (const [k, v] of Object.entries(p)) url.searchParams.set(k, v);
      await shell.openExternal(url.toString());
      let got;
      try {
        got = await loop.result;
      } catch (e) {
        throw e.message === 'timeout'
          ? fail('Pasaron 5 minutos sin respuesta de Facebook. Vuelve a pulsar “Conectar con Facebook”.', false)
          : fail('Conexión cancelada.', false);
      }
      const win = BrowserWindow?.fromWebContents(sender);
      if (win) (win.isMinimized() && win.restore(), win.focus());
      if (got.error) {
        throw fail(got.error === 'access_denied' ? 'No diste permiso en Facebook, así que no se conectó nada.' : `Facebook no permitió conectar (${got.error}).`, false);
      }
      const short = await exchange({ client_id: appId, client_secret: secret, redirect_uri: loop.redirectUri, code: got.code });
      // 60-day user token; Page tokens read with it have no expiry.
      const long = await exchange({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: secret, fb_exchange_token: short.access_token });
      const userToken = long.access_token;
      const me = await graph('GET', `${GRAPH}/me`, { token: userToken, params: { fields: 'id,name' } });
      if (!isNumericId(me.id)) throw fail('Facebook no devolvió tu cuenta. Vuelve a intentarlo.', false);
      const perms = await graph('GET', `${GRAPH}/me/permissions`, { token: userToken });
      const granted = new Set((Array.isArray(perms.data) ? perms.data : []).filter((x) => x?.status === 'granted').map((x) => x.permission));
      if (!granted.has('pages_show_list')) throw fail('No diste el permiso para ver tus páginas, así que no se conectó nada. Vuelve a conectar y déjalo marcado.', false);
      const canFb = granted.has('pages_manage_posts');
      const canIg = granted.has('instagram_content_publish') && granted.has('instagram_basic');

      const pages = await listPages(userToken);
      if (!pages.length) {
        throw fail(
          'Facebook no devolvió ninguna página. Al conectar, en “Editar acceso” elige tus páginas (y su cuenta de Instagram). Recuerda: los perfiles personales no se pueden usar, solo páginas.',
          false,
        );
      }
      const now = Date.now();
      const accounts = [];
      for (const pg of pages) {
        const token = enc(pg.access_token);
        const name = String(pg.name || 'Mi página').slice(0, 200);
        if (canFb) accounts.push({ id: pg.id, kind: 'page', networks: ['facebook'], name, avatar: imageUrl(pg.picture?.data?.url), connectedAt: now, userId: me.id, pageId: pg.id, pageName: name, token });
        const ig = pg.instagram_business_account;
        if (canIg && isNumericId(ig?.id)) {
          const username = typeof ig.username === 'string' && /^[\w.]{1,30}$/.test(ig.username) ? ig.username : '';
          accounts.push({
            id: ig.id,
            kind: 'instagram',
            networks: ['instagram_reels'],
            name: username ? `@${username}` : String(ig.name || 'Instagram').slice(0, 200),
            username,
            avatar: imageUrl(ig.profile_picture_url),
            connectedAt: now,
            userId: me.id,
            pageId: pg.id,
            pageName: name,
            token,
          });
        }
      }
      const notes = [];
      if (!canFb) notes.push('No diste el permiso para publicar en páginas, así que tus páginas de Facebook no se conectaron.');
      if (!granted.has('instagram_content_publish')) notes.push('No diste el permiso para publicar en Instagram, así que Instagram no se conectó.');
      else if (!accounts.some((a) => a.kind === 'instagram'))
        notes.push('Ninguna de tus páginas tiene una cuenta profesional de Instagram vinculada (o no la elegiste al conectar). Vincúlala en la app de Instagram y vuelve a conectar.');
      if (!accounts.length) throw fail(notes.join(' ') || 'No se pudo conectar ninguna cuenta.', false);

      // Connecting again replaces what this Facebook user had connected.
      const fresh = load();
      const ids = new Set(accounts.map((a) => a.id));
      fresh.accounts = [...fresh.accounts.filter((a) => a.userId !== me.id && !ids.has(a.id)), ...accounts];
      const login = { userId: me.id, name: String(me.name || '').slice(0, 200), appId, token: enc(userToken), expiresAt: long.expires_in ? now + long.expires_in * 1000 : null };
      fresh.logins = [...fresh.logins.filter((l) => l.userId !== me.id), login];
      // Logins whose accounts all moved to this one are no longer needed.
      fresh.logins = fresh.logins.filter((l) => fresh.accounts.some((a) => a.userId === l.userId));
      save(fresh);
      return { accounts: accounts.map(publicAccount), notes };
    } finally {
      loop.cancel();
      if (connecting === loop) connecting = null;
    }
  }

  /** Best effort: remove Clipo's access in the Facebook account (DELETE /{user-id}/permissions). */
  async function revoke(login) {
    try {
      await graph('DELETE', `${GRAPH}/${login.userId}/permissions`, { token: dec(login.token), signal: AbortSignal.timeout(10_000) });
    } catch {}
  }

  async function disconnect(accountId) {
    if (!isId(accountId)) return;
    const data = load();
    const acc = data.accounts.find((a) => a.id === accountId);
    if (!acc) return;
    // The Facebook grant covers every Page and Instagram account of that login: revoke it only
    // when the last one is disconnected.
    const login = data.logins.find((l) => l.userId === acc.userId);
    const last = !!login && !data.accounts.some((a) => a.id !== accountId && a.userId === acc.userId);
    if (last) await revoke(login);
    const fresh = load();
    fresh.accounts = fresh.accounts.filter((a) => a.id !== accountId);
    if (last) fresh.logins = fresh.logins.filter((l) => l.userId !== acc.userId || fresh.accounts.some((a) => a.userId === l.userId));
    save(fresh);
  }

  // ---------- Facebook Page video ----------
  /** jobId -> { id, videoId, start, end, total } so "Reintentar" continues where it stopped. */
  const fbSessions = new Map();

  function offsets(r, total) {
    const start = Number(r.start_offset);
    const end = Number(r.end_offset);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > total) {
      throw fail('Facebook respondió algo inesperado durante la subida. Pulsa “Reintentar”.');
    }
    return { start, end };
  }

  async function uploadFacebook({ jobId, acc, src, text, publishAt, published, thumbnail, signal, report }) {
    const token = dec(acc.token);
    const total = src.size;
    const at = `${VIDEO}/${acc.pageId}/videos`;
    let s = fbSessions.get(jobId);
    if (s && s.total !== total) s = undefined;
    if (!s) {
      const r = await graph('POST', at, { token, params: { upload_phase: 'start', file_size: total }, signal });
      if (!isNumericId(String(r.upload_session_id ?? '')) || !isNumericId(String(r.video_id ?? ''))) throw fail('Facebook no abrió la subida. Pulsa “Reintentar”.');
      s = { id: String(r.upload_session_id), videoId: String(r.video_id), total, ...offsets(r, total) };
      fbSessions.set(jobId, s);
    }
    let failures = 0;
    // Facebook says which bytes it wants next (start_offset..end_offset); equal offsets = all received.
    while (s.start < s.end) {
      report(s.start, total);
      if (signal.aborted) throw fail('Subida cancelada.');
      const piece = await src.read(s.start, s.end - 1);
      const form = new FormData();
      form.set('video_file_chunk', new Blob([piece]), 'chunk');
      try {
        const r = await graph('POST', at, { token, params: { upload_phase: 'transfer', upload_session_id: s.id, start_offset: s.start }, form, signal });
        Object.assign(s, offsets(r, total));
        failures = 0;
      } catch (e) {
        if (signal.aborted) throw fail('Subida cancelada.');
        if (!isRetry(e)) {
          fbSessions.delete(jobId);
          throw e;
        }
        // A dropped connection or a temporary error: wait and send the same piece again.
        if (++failures > 6) {
          // Facebook kept refusing (not just the internet): start over on "Reintentar".
          if (e.graph) fbSessions.delete(jobId);
          throw fail('Se perdió la conexión con Facebook varias veces. Revisa tu internet y pulsa “Reintentar”: seguirá desde donde quedó.');
        }
        await sleep(backoffMs(failures), signal);
      }
    }
    report(total, total);
    const fin = { upload_phase: 'finish', upload_session_id: s.id, description: text.caption };
    if (text.title) fin.title = text.title;
    if (publishAt) Object.assign(fin, { published: 'false', scheduled_publish_time: Math.floor(publishAt / 1000) });
    else if (published === false) fin.published = 'false';
    const r = await graph('POST', at, { token, params: fin, signal });
    if (r.success === false) throw fail('Facebook recibió el video pero no lo publicó. Revisa la página antes de reintentar.', false);
    fbSessions.delete(jobId);
    const videoId = s.videoId;

    const notes = [];
    if (thumbnail) {
      try {
        const form = new FormData();
        form.set('source', new Blob([thumbnail.bytes], { type: thumbnail.mime }), thumbnail.mime === 'image/png' ? 'cover.png' : 'cover.jpg');
        await graph('POST', `${GRAPH}/${videoId}/thumbnails`, { token, params: { is_preferred: 'true' }, form });
      } catch (e) {
        notes.push(`El video se subió, pero Facebook no aceptó la portada${isFail(e) ? ` (${e.message.slice(2)})` : ''}.`);
      }
    }
    let url = `https://www.facebook.com/${acc.pageId}/videos/${videoId}/`;
    try {
      const v = await graph('GET', `${GRAPH}/${videoId}`, { token, params: { fields: 'permalink_url' } });
      const p = typeof v.permalink_url === 'string' ? v.permalink_url : '';
      if (p.startsWith('/')) url = `https://www.facebook.com${p}`;
      else if (p.startsWith('https://')) url = p;
    } catch {}
    return { remoteId: videoId, url, note: notes.join(' ') || undefined };
  }

  // ---------- Instagram Reels ----------
  /** jobId -> { containerId, tokenIndex, total } once the bytes are with Instagram (retry = only publish). */
  const igSessions = new Map();

  /** The tokens to try for Instagram: the linked Page's, then the user's (60 days) as a fallback. */
  function igTokens(data, acc) {
    const out = [dec(acc.token)];
    const login = data.logins.find((l) => l.userId === acc.userId);
    if (login && (!login.expiresAt || login.expiresAt > Date.now())) out.push(dec(login.token));
    return out;
  }

  async function createContainer(acc, tokens, caption, signal) {
    const params = { media_type: 'REELS', upload_type: 'resumable', caption, share_to_feed: 'true' };
    for (let i = 0; ; i++) {
      try {
        const r = await graph('POST', `${GRAPH}/${acc.id}/media`, { token: tokens[i], params, signal, net: 'Instagram' });
        if (!isNumericId(String(r.id ?? ''))) throw fail('Instagram no abrió la subida. Pulsa “Reintentar”.');
        const id = String(r.id);
        // The token goes to this address: only ever to Meta's upload host.
        let uri = `${RUPLOAD}/ig-api-upload/${GRAPH_VERSION}/${id}`;
        try {
          if (typeof r.uri === 'string' && new URL(r.uri).origin === new URL(RUPLOAD).origin) uri = r.uri;
        } catch {}
        return { id, uri, tokenIndex: i };
      } catch (e) {
        const code = e.graph?.code || 0;
        if (i + 1 < tokens.length && (code === 190 || code === 10 || (code >= 200 && code <= 299))) continue;
        throw e;
      }
    }
  }

  async function sendBytes(uri, token, src, signal, report) {
    const total = src.size;
    const PIECE = 4 * MIB;
    let sent = 0;
    const body = new ReadableStream({
      async pull(c) {
        if (sent >= total) return c.close();
        const end = Math.min(sent + PIECE, total) - 1;
        const b = await src.read(sent, end);
        sent = end + 1;
        c.enqueue(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
        // The bytes are most of the work; Instagram's processing is the last 5 %.
        report(Math.floor(sent * 0.95), total);
      },
    });
    let res;
    try {
      res = await fetch(uri, {
        method: 'POST',
        headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(total), 'Content-Length': String(total), 'Content-Type': 'application/octet-stream' },
        body,
        duplex: 'half',
        signal,
      });
    } catch {
      if (signal.aborted) throw fail('Subida cancelada.');
      throw fail('Se cortó la conexión con Instagram. Revisa tu internet y pulsa “Reintentar”.');
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.success !== false) return;
    const dbg = json.debug_info || {};
    const msg = typeof dbg.message === 'string' ? `: ${dbg.message.slice(0, 200)}` : '.';
    throw fail(`Instagram no recibió el video${msg} Pulsa “Reintentar”.`, dbg.retriable !== false && (res.status >= 500 || res.status === 429 || dbg.retriable === true));
  }

  /** Wait until Instagram has processed the video. Returns 'finished' or 'published'. */
  async function waitFinished(containerId, token, signal, jobId) {
    const started = Date.now();
    for (let i = 0; ; i++) {
      let r;
      try {
        r = await graph('GET', `${GRAPH}/${containerId}`, { token, params: { fields: 'status_code,status' }, signal, net: 'Instagram' });
      } catch (e) {
        if (signal.aborted || !isRetry(e)) throw e;
        r = { status_code: 'IN_PROGRESS' };
      }
      if (r.status_code === 'FINISHED') return 'finished';
      if (r.status_code === 'PUBLISHED') return 'published';
      if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
        igSessions.delete(jobId);
        if (r.status_code === 'EXPIRED') throw fail('La subida a Instagram venció (pasaron 24 horas sin publicarse). Pulsa “Reintentar”.');
        const sub = /\b(2207\d{3})\b/.exec(String(r.status || ''))?.[1];
        const { message, retryable } = sub ? explainGraphError({ code: 100, error_subcode: Number(sub) }, 400, 'Instagram') : { message: '', retryable: false };
        throw fail(message || `Instagram no pudo procesar el video${r.status ? ` (${String(r.status).slice(0, 200)})` : ''}. Revisa que sea MP4, de 3 s a 15 min.`, retryable);
      }
      if (Date.now() - started > pollLimitMs) {
        throw fail('Instagram sigue procesando el video. Pulsa “Reintentar” en unos minutos: Clipo no lo vuelve a subir, solo lo publica cuando esté listo.');
      }
      await sleep(pollMs[Math.min(i, pollMs.length - 1)] ?? 10_000, signal);
    }
  }

  async function uploadInstagram({ jobId, acc, src, text, signal, report }) {
    const data = load();
    const tokens = igTokens(data, acc);
    // Instagram allows a limited number of API posts per 24 h (100 today): say so before uploading.
    try {
      const q = await graph('GET', `${GRAPH}/${acc.id}/content_publishing_limit`, { token: tokens[0], params: { fields: 'config,quota_usage' }, signal, net: 'Instagram' });
      const d = Array.isArray(q.data) ? q.data[0] : undefined;
      const max = Number(d?.config?.quota_total);
      if (max > 0 && Number(d?.quota_usage) >= max) {
        throw fail(`Esta cuenta llegó al límite de ${max} publicaciones por API de Instagram en 24 horas. Pulsa “Reintentar” más tarde o publícalo desde la app de Instagram.`);
      }
    } catch (e) {
      if (signal.aborted || /límite de \d+ publicaciones/.test(e.message)) throw e;
    }

    let s = igSessions.get(jobId);
    if (s && s.total !== src.size) s = undefined;
    if (!s) {
      for (let attempt = 1; ; attempt++) {
        const c = await createContainer(acc, tokens, text.caption, signal);
        try {
          await sendBytes(c.uri, tokens[c.tokenIndex], src, signal, report);
          s = { containerId: c.id, tokenIndex: c.tokenIndex, total: src.size };
          igSessions.set(jobId, s);
          break;
        } catch (e) {
          // A new container each time: the old one simply expires unpublished after 24 h.
          if (signal.aborted || !isRetry(e) || attempt >= 3) throw e;
          await sleep(backoffMs(attempt), signal);
        }
      }
    }
    const token = tokens[s.tokenIndex] ?? tokens[0];
    report(Math.floor(src.size * 0.95), src.size);
    const profile = acc.username ? `https://www.instagram.com/${acc.username}/` : 'https://www.instagram.com/';
    if ((await waitFinished(s.containerId, token, signal, jobId)) === 'published') {
      igSessions.delete(jobId);
      return { remoteId: s.containerId, url: profile, note: 'Ya estaba publicado en Instagram (el intento anterior llegó a publicarlo).' };
    }
    let media;
    for (let i = 1; ; i++) {
      try {
        media = await graph('POST', `${GRAPH}/${acc.id}/media_publish`, { token, params: { creation_id: s.containerId }, signal, net: 'Instagram' });
        break;
      } catch (e) {
        // "Not ready yet" right after FINISHED happens: wait a bit and try again.
        const notReady = e.graph?.code === 9007 || e.graph?.subcode === 2207027;
        if (signal.aborted || !notReady || i >= 5) throw e;
        await sleep(pollMs[Math.min(i, pollMs.length - 1)] ?? 10_000, signal);
      }
    }
    igSessions.delete(jobId);
    if (!isNumericId(String(media?.id ?? ''))) throw fail('Instagram publicó pero no devolvió la publicación. Revisa la app de Instagram antes de reintentar.', false);
    let url = profile;
    try {
      const m = await graph('GET', `${GRAPH}/${media.id}`, { token, params: { fields: 'permalink' }, net: 'Instagram' });
      if (typeof m.permalink === 'string' && m.permalink.startsWith('https://')) url = m.permalink;
    } catch {}
    return { remoteId: String(media.id), url };
  }

  // ---------- upload (both networks) ----------
  /** jobId -> AbortController of the running upload. */
  const running = new Map();
  const files = tempFiles({ app, name: 'clipo-upload-meta', maxBytes: FB_MAX_BYTES, mimes: FB_MIMES });

  async function upload(sender, req) {
    if (!req || typeof req !== 'object') throw bad('pedido');
    const { jobId, accountId, network } = req;
    if (!isId(jobId) || !isId(accountId)) throw bad('ids');
    if (!NETWORKS.has(network)) throw bad('red');
    const ig = network === 'instagram_reels';
    const mimes = ig ? IG_MIMES : FB_MIMES;
    if (req.mime !== undefined && !mimes.has(req.mime)) throw fail(ig ? 'Instagram solo acepta videos MP4 o MOV.' : 'Facebook no acepta ese tipo de video. Exporta en MP4.', false);
    const text = buildText(network, req.text);
    let publishAt;
    if (req.publishAt !== undefined) {
      if (ig) throw fail('Instagram no permite programar por API: Clipo lo sube a la hora elegida (con Clipo abierto).', false);
      const t = req.publishAt;
      if (!Number.isSafeInteger(t) || t < Date.now() + SCHEDULE_MIN_MS - 60_000 || t > Date.now() + SCHEDULE_MAX_MS) {
        throw fail('Facebook programa entre 10 minutos y 6 meses más adelante. Elige otra hora.', false);
      }
      publishAt = t;
    }
    if (req.published !== undefined && typeof req.published !== 'boolean') throw bad('publicado');
    let thumbnail;
    if (req.thumbnail && !ig) {
      const tb = toBuffer(req.thumbnail.bytes);
      if (!tb || !tb.length || tb.length > MAX_THUMB_BYTES || !THUMB_MIMES.has(req.thumbnail.mime)) throw fail('La portada tiene que ser JPG o PNG de hasta 10 MB.', false);
      thumbnail = { bytes: tb, mime: req.thumbnail.mime };
    }
    const f = files.complete(req.fileId);
    if (ig && f.total > IG_MAX_BYTES) throw fail('Instagram acepta Reels de hasta 300 MB. Exporta el video más corto o en menor calidad.', false);
    if (ig && !IG_MIMES.has(f.mime)) throw fail('Instagram solo acepta videos MP4 o MOV.', false);
    const acc = load().accounts.find((a) => a.id === accountId);
    if (!acc || !acc.networks.includes(network)) throw fail('Esa cuenta ya no está conectada. Conéctala de nuevo en Cuentas.', false);
    if (running.has(jobId)) throw fail('Ese video ya se está subiendo.', false);

    const ac = new AbortController();
    running.set(jobId, ac);
    let last = 0;
    const report = (sent, total) => {
      const now = Date.now();
      if (sent < total && now - last < 250) return;
      last = now;
      if (!sender.isDestroyed()) sender.send('meta:progress', { jobId, sent, total });
    };
    let src;
    try {
      src = await fileSource(f.file);
      if (!src.size) throw fail('El video está vacío.', false);
      const args = { jobId, acc, src, text, signal: ac.signal, report };
      const res = ig ? await uploadInstagram(args) : await uploadFacebook({ ...args, publishAt, published: req.published, thumbnail });
      report(src.size, src.size);
      // Done: the temp copy is no longer needed. (After a failure it is kept so "Reintentar" resumes.)
      await files.discard(req.fileId);
      return res;
    } catch (e) {
      if (isFail(e)) throw e;
      throw fail(`No hay conexión con ${ig ? 'Instagram' : 'Facebook'}. Revisa tu internet y pulsa “Reintentar”.`);
    } finally {
      await src?.close().catch(() => {});
      running.delete(jobId);
    }
  }

  // ---------- status ----------
  const when = (v) => {
    const t = typeof v === 'number' ? v * 1000 : Date.parse(String(v || '').replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
    return Number.isFinite(t) ? new Date(t).toLocaleString('es') : '';
  };

  async function status(accountId, remoteId) {
    if (!isId(accountId) || !isId(remoteId)) throw bad('ids');
    const acc = load().accounts.find((a) => a.id === accountId);
    if (!acc) throw fail('Esa cuenta ya no está conectada. Conéctala de nuevo en Cuentas.', false);
    const token = dec(acc.token);
    if (acc.kind === 'instagram') {
      try {
        const m = await graph('GET', `${GRAPH}/${remoteId}`, { token, params: { fields: 'permalink,timestamp' }, net: 'Instagram' });
        return { state: 'ready', detail: `Publicado en Instagram${m.timestamp ? ` · ${when(m.timestamp)}` : ''}` };
      } catch (e) {
        if (e.graph?.code === 100) return { state: 'unknown', detail: 'Instagram no encuentra la publicación. Puede que la hayan borrado.' };
        throw e;
      }
    }
    let v;
    try {
      v = await graph('GET', `${GRAPH}/${remoteId}`, { token, params: { fields: 'status,published,scheduled_publish_time' } });
    } catch (e) {
      if (e.graph?.code === 100) return { state: 'unknown', detail: 'Facebook no encuentra el video. Puede que lo hayan borrado.' };
      throw e;
    }
    const vs = v.status?.video_status;
    const pub = v.published === false ? (v.scheduled_publish_time ? ` · Facebook lo publica el ${when(v.scheduled_publish_time)}` : ' · sin publicar (está en la biblioteca de videos de la página)') : '';
    switch (vs) {
      case 'ready':
        return { state: 'ready', detail: `Listo en Facebook${pub}` };
      case 'processing':
      case 'upload_complete':
      case 'uploading':
        return { state: 'processing', detail: `Facebook lo está procesando${pub}` };
      case 'error':
        return { state: 'failed', detail: 'Facebook no pudo procesar el video. Vuelve a exportarlo como MP4 y publícalo otra vez.' };
      case 'expired':
        return { state: 'failed', detail: 'La subida a Facebook venció antes de terminar.' };
      default:
        return { state: 'unknown', detail: `Estado en Facebook: ${vs || 'desconocido'}${pub}` };
    }
  }

  // ---------- IPC (only from Clipo's own page) ----------
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!event.senderFrame?.url.startsWith('app://clipo/')) throw new Error('forbidden');
      return fn(event, ...args);
    });

  handle('meta:getConfig', () => {
    const d = load();
    return {
      appId: d.appId || '',
      hasSecret: !!d.secret,
      configId: d.configId || '',
      encryption: canEncrypt(),
      builtInAppId: builtIn?.appId || '',
      usingBuiltIn: !d.appId && !!builtIn,
      redirectUri: `http://localhost:${LOOPBACK_PORT}/`,
      graphVersion: GRAPH_VERSION,
    };
  });
  handle('meta:setConfig', async (_e, cfg) => {
    const { appId, appSecret, configId } = cfg && typeof cfg === 'object' ? cfg : {};
    const id = String(appId ?? '').trim();
    if (id && !APP_ID_RE.test(id)) throw fail('Eso no parece un identificador de app de Meta (App ID): son solo números, por ejemplo 1234567890123456.', false);
    if (appSecret !== undefined && appSecret !== null && typeof appSecret !== 'string') throw bad('clave secreta');
    const secret = typeof appSecret === 'string' ? appSecret.trim() : undefined;
    if (secret && !APP_SECRET_RE.test(secret)) throw fail('Eso no parece una clave secreta de Meta (App Secret): son 32 letras y números. Cópiala con el botón “Mostrar” de Configuración → Básica.', false);
    if (configId !== undefined && configId !== null && typeof configId !== 'string') throw bad('configuración');
    const conf = typeof configId === 'string' ? configId.trim() : undefined;
    if (conf && !CONFIG_ID_RE.test(conf)) throw fail('Eso no parece un identificador de configuración (son solo números).', false);
    if (!canEncrypt()) throw fail('Este equipo no permite guardar datos cifrados.', false);
    const d = load();
    // Tokens belong to one app: another App ID means connecting again. Revoke the old grants first.
    if (d.accounts.length && appIdOf(d) !== (id || builtIn?.appId || '')) {
      await Promise.all(d.logins.map(revoke));
      d.accounts = [];
      d.logins = [];
    }
    d.appId = id;
    if (secret !== undefined) d.secret = secret ? enc(secret) : null;
    if (conf !== undefined) d.configId = conf;
    save(d);
  });
  handle('meta:connect', (e) => connect(e.sender));
  handle('meta:cancelConnect', () => connecting?.cancel());
  handle('meta:accounts', () => (canEncrypt() ? load().accounts.map(publicAccount) : []));
  handle('meta:disconnect', (_e, id) => disconnect(id));
  handle('meta:upload', (e, req) => upload(e.sender, req));
  handle('meta:uploadBegin', (_e, total, mime) => files.begin(total, mime));
  handle('meta:uploadAppend', (_e, fileId, bytes) => files.append(fileId, bytes));
  handle('meta:uploadDiscard', (_e, fileId) => files.discard(fileId));
  handle('meta:cancelUpload', (_e, jobId) => (isId(jobId) ? running.get(jobId)?.abort() : undefined));
  handle('meta:status', (_e, accountId, remoteId) => status(accountId, remoteId));

  return {
    activeUploads: () => running.size,
    /** Remove the temp copies of videos (call on quit). */
    cleanup: files.cleanup,
  };
}

module.exports = { register, GRAPH_VERSION, SCOPES };
