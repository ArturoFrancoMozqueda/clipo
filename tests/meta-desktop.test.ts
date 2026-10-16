// Run with: npm test. The desktop Meta adapter (electron/publish/meta.cjs) end to end against a fake
// Facebook on 127.0.0.1: loopback sign-in with state, code → token → long-lived token, Pages and
// Instagram discovery, encrypted storage, chunked Page video with native scheduling and a dropped
// chunk, Instagram Reels resumable upload + status polling + publish, error mapping and disconnect.
// No real Meta account involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import meta from '../electron/publish/meta.cjs';
import metaErrors from '../electron/publish/meta-errors.cjs';

const KIB = 1024;
const CHUNK = 256 * KIB;
const APP_ID = '1234567890123';
const SECRET = 'a'.repeat(16) + 'b'.repeat(16);

type Form = Record<string, string>;

function fakeMeta() {
  const st = {
    redirect: '',
    proofErrors: 0,
    expired: false,
    rateLimited: false,
    fbTotal: 0,
    fbBytes: [] as Buffer[],
    fbFailNext: true,
    finish: null as Form | null,
    thumb: 0,
    igBytes: 0,
    igAuth: '',
    container: null as Form | null,
    statusPolls: 0,
    publishTries: 0,
    revoked: '',
  };
  const log: string[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url!, 'http://x');
    const json = (status: number, v: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(v));
    const graphError = (status: number, error: object) => json(status, { error: { type: 'OAuthException', fbtrace_id: 'T', ...error } });
    log.push(`${req.method} ${url.pathname}`);

    // Instagram's upload host: the token comes in the header, never in the URL.
    if (url.pathname.startsWith('/rup/')) {
      st.igAuth = String(req.headers.authorization);
      if (req.headers.offset !== '0' || Number(req.headers.file_size) !== body.length) return json(400, { debug_info: { retriable: false, message: 'bad headers' } });
      st.igBytes = body.length;
      return json(200, { success: true, message: 'Upload successful.' });
    }

    // Graph: params from the query (GET/DELETE) or the form (urlencoded or multipart).
    const p: Form = Object.fromEntries(url.searchParams);
    let file: Blob | null = null;
    if (body.length && req.headers['content-type']) {
      const fd = await new Response(body, { headers: { 'content-type': String(req.headers['content-type']) } }).formData();
      for (const [k, v] of fd) {
        if (typeof v === 'string') p[k] = v;
        else file = v;
      }
    }
    const route = url.pathname.replace(/^\/(graph|video)/, '');

    if (route === '/oauth/access_token') {
      if (p.client_id !== APP_ID || p.client_secret !== SECRET) return graphError(400, { code: 1, message: 'Error validating client secret.' });
      if (p.grant_type === 'fb_exchange_token') return p.fb_exchange_token === 'SHORT' ? json(200, { access_token: 'LONG', token_type: 'bearer', expires_in: 5_184_000 }) : graphError(400, { code: 190 });
      if (p.code !== 'C1' || p.redirect_uri !== st.redirect) return graphError(400, { code: 100, message: 'Invalid verification code format.' });
      return json(200, { access_token: 'SHORT', token_type: 'bearer', expires_in: 3600 });
    }

    // Every call made with a token carries a valid time-stamped appsecret_proof.
    const token = p.access_token ?? '';
    if (!['LONG', 'PAGE1', 'PAGE2'].includes(token)) return graphError(400, { code: 190, message: 'Invalid OAuth access token.' });
    const expect = crypto.createHmac('sha256', SECRET).update(`${token}|${p.appsecret_time}`).digest('hex');
    if (p.appsecret_proof !== expect || Math.abs(Date.now() / 1000 - Number(p.appsecret_time)) > 300) {
      st.proofErrors++;
      return graphError(400, { code: 100, message: 'Invalid appsecret_proof provided in the API argument' });
    }
    if (st.expired) return graphError(400, { code: 190, error_subcode: 463, message: 'Error validating access token: Session has expired.' });
    if (st.rateLimited) return graphError(400, { code: 4, message: 'Application request limit reached', is_transient: true });

    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    switch (`${req.method} ${route}`) {
      case 'GET /me':
        return json(200, { id: '100200300', name: 'Ana' });
      case 'GET /me/permissions':
        return json(200, {
          data: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish'].map((permission) => ({ permission, status: 'granted' })),
        });
      case 'GET /me/accounts':
        if (p.after) return json(200, { data: [{ id: '222', name: 'Solo estadísticas', access_token: 'PAGE2', tasks: ['ANALYZE'] }] });
        return json(200, {
          data: [
            {
              id: '111',
              name: 'Mi Página',
              access_token: 'PAGE1',
              tasks: ['ANALYZE', 'CREATE_CONTENT', 'MANAGE', 'MODERATE'],
              picture: { data: { url: 'https://scontent.xx.fbcdn.net/p.jpg' } },
              instagram_business_account: { id: '178414', username: 'mi.marca', profile_picture_url: 'https://scontent.cdninstagram.com/i.jpg' },
            },
          ],
          paging: { next: `${base}/graph/me/accounts?after=X`, cursors: { after: 'X' } },
        });
      case 'POST /111/videos': {
        if (p.upload_phase === 'start') {
          st.fbTotal = Number(p.file_size);
          return json(200, { video_id: '555', upload_session_id: '777', start_offset: '0', end_offset: String(Math.min(CHUNK, st.fbTotal)) });
        }
        if (p.upload_phase === 'transfer') {
          const got = st.fbBytes.reduce((n, b) => n + b.length, 0);
          if (p.upload_session_id !== '777' || Number(p.start_offset) !== got || !file) return graphError(400, { code: 100, message: 'bad transfer' });
          // The second piece "drops" once: the same piece must be sent again.
          if (got === CHUNK && st.fbFailNext) return (st.fbFailNext = false), graphError(500, { code: 1, message: 'An unknown error occurred', is_transient: true });
          st.fbBytes.push(Buffer.from(await file.arrayBuffer()));
          const now = got + file.size;
          return json(200, { start_offset: String(now), end_offset: String(Math.min(now + CHUNK, st.fbTotal)) });
        }
        if (p.upload_phase === 'finish') return (st.finish = p), json(200, { success: true });
        return graphError(400, { code: 100 });
      }
      case 'POST /555/thumbnails':
        st.thumb = file?.size ?? 0;
        return json(200, { success: true });
      case 'GET /555':
        if (p.fields === 'permalink_url') return json(200, { permalink_url: '/mipagina/videos/555/', id: '555' });
        return json(200, { status: { video_status: 'ready' }, published: false, scheduled_publish_time: Number(st.finish?.scheduled_publish_time) });
      case 'GET /178414/content_publishing_limit':
        return json(200, { data: [{ quota_usage: 3, config: { quota_total: 100, quota_duration: 86400 } }] });
      case 'POST /178414/media':
        st.container = p;
        return json(200, { id: '9001', uri: `${base}/rup/ig-api-upload/v26.0/9001` });
      case 'GET /9001':
        return json(200, { status_code: ++st.statusPolls < 3 ? 'IN_PROGRESS' : 'FINISHED', id: '9001' });
      case 'POST /178414/media_publish':
        if (p.creation_id !== '9001') return graphError(400, { code: 100 });
        if (++st.publishTries === 1) return graphError(400, { code: 9007, error_subcode: 2207027, message: 'Media ID is not available' });
        return json(200, { id: '17890' });
      case 'GET /17890':
        return json(200, { permalink: 'https://www.instagram.com/reel/AbC/', timestamp: '2026-10-15T10:00:00+0000' });
      case 'DELETE /100200300/permissions':
        st.revoked = token;
        return json(200, { success: true });
    }
    json(404, {});
  });
  return new Promise<{ base: string; st: typeof st; log: string[]; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      resolve({ base, st, log, close: () => server.close() });
    }),
  );
}

type Harness = { call: (ch: string, ...args: unknown[]) => Promise<unknown>; handlers: Map<string, (...a: unknown[]) => unknown>; progress: number[]; dir: string; opened: URL[] };

function harness(base: string, st: { redirect: string }, browser: 'approve' | 'deny' = 'approve'): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipo-meta-'));
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const progress: number[] = [];
  const opened: URL[] = [];
  const event = { senderFrame: { url: 'app://clipo/index.html' }, sender: { isDestroyed: () => false, send: (_c: string, p: { sent: number }) => progress.push(p.sent) } };
  const call = async (ch: string, ...args: unknown[]) => handlers.get(ch)!(event, ...args);

  meta.register({
    app: { getPath: () => dir },
    BrowserWindow: undefined,
    ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) },
    shell: {
      // Plays the user's browser: read the login URL, try a forged redirect, then the real one.
      openExternal: async (u: string) => {
        const url = new URL(u);
        opened.push(url);
        const p = url.searchParams;
        st.redirect = p.get('redirect_uri')!;
        assert.match(st.redirect, /^http:\/\/localhost:\d+\/$/);
        assert.equal((await fetch(`${st.redirect}?code=EVIL&state=WRONG`)).status, 404, 'a redirect with another state is ignored');
        if (browser === 'deny') await fetch(`${st.redirect}?error=access_denied&error_reason=user_denied&state=${p.get('state')}`);
        else await fetch(`${st.redirect}?code=C1&state=${p.get('state')}#_=_`);
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s).map((b) => b ^ 0x5a),
      decryptString: (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a)).toString(),
    },
    endpoints: { dialog: `${base}/dialog`, graph: `${base}/graph`, video: `${base}/video`, rupload: `${base}/rup` },
    builtIn: null,
    pollMs: [5],
    loopbackPort: 0,
  });
  return { call, handlers, progress, dir, opened };
}

/** Hand a video over like the page does: begin, append in pieces, then the fileId. */
async function handOver(call: Harness['call'], video: Buffer) {
  const { fileId, chunkLimit } = (await call('meta:uploadBegin', video.length, 'video/mp4')) as { fileId: string; chunkLimit: number };
  for (let at = 0; at < video.length; at += chunkLimit) await call('meta:uploadAppend', fileId, video.subarray(at, at + chunkLimit));
  return fileId;
}

test('Meta: sign in, Pages + Instagram, Page video with schedule, Reel, status and disconnect', async () => {
  const g = await fakeMeta();
  const { call, handlers, progress, dir, opened } = harness(g.base, g.st);
  try {
    assert.throws(() => handlers.get('meta:accounts')!({ senderFrame: { url: 'https://evil.example/' } }), /forbidden/);

    // Configuration: App ID and App Secret, validated and the secret stored encrypted.
    await assert.rejects(call('meta:setConfig', { appId: 'abc' }), /App ID/);
    await assert.rejects(call('meta:setConfig', { appId: APP_ID, appSecret: 'short' }), /App Secret/);
    await assert.rejects(call('meta:connect'), /Primero pega/);
    await call('meta:setConfig', { appId: APP_ID, appSecret: SECRET });
    const cfg = (await call('meta:getConfig')) as Record<string, unknown>;
    assert.equal(cfg.appId, APP_ID);
    assert.equal(cfg.hasSecret, true);
    assert.equal(cfg.graphVersion, 'v26.0');
    assert.ok(!JSON.stringify(cfg).includes(SECRET), 'the page never sees the secret');

    const r = (await call('meta:connect')) as { accounts: { id: string; name: string; networks: string[]; provider: string }[]; notes: string[] };
    const login = opened[0]!.searchParams;
    assert.equal(login.get('client_id'), APP_ID);
    assert.equal(login.get('response_type'), 'code');
    assert.match(login.get('scope')!, /pages_manage_posts/);
    assert.match(login.get('scope')!, /instagram_content_publish/);
    assert.equal(login.get('client_secret'), null, 'no secret in the browser URL');
    assert.deepEqual(
      r.accounts.map((a) => [a.id, a.name, a.networks.join(), a.provider]),
      [
        ['111', 'Mi Página', 'facebook', 'meta'],
        ['178414', '@mi.marca', 'instagram_reels', 'meta'],
      ],
      'Pages you can publish on and their Instagram account; the analytics-only Page on page 2 is skipped',
    );
    assert.deepEqual(r.notes, []);
    assert.equal(g.st.proofErrors, 0);
    const onDisk = fs.readFileSync(path.join(dir, 'publish', 'meta.json'), 'utf8');
    for (const secret of ['SHORT', 'LONG', 'PAGE1', SECRET]) assert.ok(!onDisk.includes(secret), `${secret} is stored encrypted`);

    // Facebook Page: chunked upload with one dropped piece, native schedule and a cover.
    const video = crypto.randomBytes(CHUNK * 2 + 100 * KIB);
    const publishAt = Date.now() + 2 * 3600_000;
    const fb = (await call('meta:upload', {
      jobId: 'j1',
      accountId: '111',
      network: 'facebook',
      fileId: await handOver(call, video),
      mime: 'video/mp4',
      text: { caption: 'Hola #viaje', title: 'Mi viaje' },
      publishAt,
      thumbnail: { bytes: new Uint8Array([1, 2, 3, 4]).buffer, mime: 'image/jpeg' },
    })) as { remoteId: string; url: string; note?: string };
    assert.deepEqual(fb, { remoteId: '555', url: 'https://www.facebook.com/mipagina/videos/555/', note: undefined });
    assert.ok(Buffer.concat(g.st.fbBytes).equals(video), 'every byte arrived once, in order');
    assert.equal(g.log.filter((l) => l === 'POST /video/111/videos').length, 6, 'start + 3 pieces + the dropped one again + finish');
    assert.equal(g.st.finish?.published, 'false');
    assert.equal(g.st.finish?.scheduled_publish_time, String(Math.floor(publishAt / 1000)));
    assert.equal(g.st.finish?.description, 'Hola #viaje');
    assert.equal(g.st.finish?.title, 'Mi viaje');
    assert.equal(g.st.thumb, 4);
    assert.equal(progress.at(-1), video.length);
    const st1 = (await call('meta:status', '111', '555')) as { state: string; detail: string };
    assert.equal(st1.state, 'ready');
    assert.match(st1.detail, /Facebook lo publica el/);

    // Facebook can't schedule closer than 10 minutes; Instagram can't schedule at all.
    await assert.rejects(
      call('meta:upload', { jobId: 'j2', accountId: '111', network: 'facebook', fileId: await handOver(call, video), mime: 'video/mp4', text: { caption: '' }, publishAt: Date.now() + 60_000 }),
      /10 minutos/,
    );
    await assert.rejects(
      call('meta:upload', { jobId: 'j3', accountId: '178414', network: 'instagram_reels', fileId: await handOver(call, video), mime: 'video/mp4', text: { caption: '' }, publishAt }),
      /Instagram no permite programar/,
    );
    await assert.rejects(
      call('meta:upload', { jobId: 'j4', accountId: '178414', network: 'facebook', fileId: await handOver(call, video), mime: 'video/mp4', text: { caption: '' } }),
      /ya no está conectada/,
      'an Instagram account is not a Page',
    );

    // Instagram Reel: resumable upload, processing, a "not ready" on publish, then the permalink.
    progress.length = 0;
    const reel = crypto.randomBytes(300 * KIB);
    const ig = (await call('meta:upload', {
      jobId: 'j5',
      accountId: '178414',
      network: 'instagram_reels',
      fileId: await handOver(call, reel),
      mime: 'video/mp4',
      text: { caption: 'Reel #playa' },
    })) as { remoteId: string; url: string };
    assert.deepEqual(ig, { remoteId: '17890', url: 'https://www.instagram.com/reel/AbC/' });
    assert.equal(g.st.container?.media_type, 'REELS');
    assert.equal(g.st.container?.upload_type, 'resumable');
    assert.equal(g.st.container?.caption, 'Reel #playa');
    assert.equal(g.st.igAuth, 'OAuth PAGE1');
    assert.equal(g.st.igBytes, reel.length);
    assert.equal(g.st.statusPolls, 3);
    assert.equal(g.st.publishTries, 2);
    assert.equal(progress.at(-1), reel.length);
    assert.equal(((await call('meta:status', '178414', '17890')) as { state: string }).state, 'ready');

    // Errors: rate limit is retryable, an expired session is not and says how to fix it.
    g.st.rateLimited = true;
    await assert.rejects(call('meta:status', '111', '555'), /^Error: R\|.*límite de uso/);
    g.st.rateLimited = false;
    g.st.expired = true;
    await assert.rejects(
      call('meta:upload', { jobId: 'j6', accountId: '111', network: 'facebook', fileId: await handOver(call, video), mime: 'video/mp4', text: { caption: '' } }),
      /^Error: F\|La conexión con Facebook venció o se revocó/,
    );
    g.st.expired = false;

    // Disconnecting the Page keeps the grant (Instagram still uses it); the last one revokes it.
    await call('meta:disconnect', '111');
    assert.equal(g.st.revoked, '');
    await call('meta:disconnect', '178414');
    assert.equal(g.st.revoked, 'LONG');
    assert.deepEqual(await call('meta:accounts'), []);
  } finally {
    g.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Meta: a wrong App Secret and a denied login give clear, final errors', async () => {
  const g = await fakeMeta();
  const wrong = harness(g.base, g.st);
  const denied = harness(g.base, g.st, 'deny');
  try {
    await wrong.call('meta:setConfig', { appId: APP_ID, appSecret: 'c'.repeat(32) });
    await assert.rejects(wrong.call('meta:connect'), /^Error: F\|Meta rechazó la clave secreta/);
    await denied.call('meta:setConfig', { appId: APP_ID, appSecret: SECRET });
    await assert.rejects(denied.call('meta:connect'), /^Error: F\|No diste permiso en Facebook/);
    assert.deepEqual(await denied.call('meta:accounts'), []);
  } finally {
    g.close();
    for (const h of [wrong, denied]) fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test('Graph errors become plain Spanish with the right retry flag', () => {
  const { explainGraphError } = metaErrors;
  assert.deepEqual(explainGraphError({ code: 190, error_subcode: 463 }, 400).retryable, false);
  assert.match(explainGraphError({ code: 190 }, 400, 'Instagram').message, /Instagram venció/);
  for (const code of [4, 17, 32, 613, 80001]) assert.equal(explainGraphError({ code }, 400).retryable, true, `rate limit ${code}`);
  assert.match(explainGraphError({ code: 10 }, 403).message, /permiso/);
  assert.equal(explainGraphError({ code: 200 }, 403).retryable, false);
  assert.match(explainGraphError({ code: 368 }, 400).message, /spam/);
  assert.equal(explainGraphError({ code: 100, error_subcode: 2207042 }, 400).retryable, true);
  assert.match(explainGraphError({ code: 100, error_subcode: 2207026 }, 400).message, /MP4/);
  assert.equal(explainGraphError({ code: 1, is_transient: true }, 500).retryable, true);
  assert.match(explainGraphError({ code: 100, message: 'Invalid parameter' }, 400).message, /Invalid parameter/);
});

test('built-in Meta App ID: read from the build file, ignored when malformed', async () => {
  const { builtInMetaApp } = await import('../electron/publish/meta-client.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipo-mc-'));
  const file = path.join(dir, 'meta-client.json');
  const saved = process.env.CLIPO_META_APP_ID;
  delete process.env.CLIPO_META_APP_ID;
  try {
    assert.equal(builtInMetaApp(file), null);
    fs.writeFileSync(file, JSON.stringify({ appId: ' 1234567890 ' }));
    assert.deepEqual(builtInMetaApp(file), { appId: '1234567890' });
    fs.writeFileSync(file, JSON.stringify({ appId: 'x1', appSecret: 'never read' }));
    assert.equal(builtInMetaApp(file), null);
  } finally {
    if (saved !== undefined) process.env.CLIPO_META_APP_ID = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
