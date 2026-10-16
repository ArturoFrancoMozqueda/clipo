// Run with: npm test. The desktop YouTube adapter (electron/publish/youtube.cjs) end to end
// against a fake Google on 127.0.0.1: PKCE sign-in, encrypted tokens, chunked resumable upload
// with a dropped chunk, cover, status and disconnect. No real Google account involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import yt from '../electron/publish/youtube.cjs';

const KIB = 1024;
const CHUNK = 256 * KIB;

function fakeGoogle() {
  const log: string[] = [];
  const st = { clientId: '', challenge: '', received: 0, total: 0, failNext: true, metadata: null as unknown, thumb: 0, revoked: '' };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url!, 'http://x');
    const json = (status: number, v: unknown, headers = {}) => res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(v));
    log.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/token') {
      const p = new URLSearchParams(body.toString());
      st.clientId = p.get('client_id')!;
      if (p.get('grant_type') === 'authorization_code') {
        const ok = crypto.createHash('sha256').update(p.get('code_verifier')!).digest('base64url') === st.challenge;
        if (!ok || p.get('code') !== 'C1' || p.get('client_secret') !== 'SECRET') return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly' });
      }
      return json(200, { access_token: 'AT2', expires_in: 3600 });
    }
    if (url.pathname === '/revoke') return (st.revoked = new URLSearchParams(body.toString()).get('token')!), json(200, {});
    if (req.headers.authorization?.slice(7) !== 'AT1' && req.headers.authorization?.slice(7) !== 'AT2') return json(401, {});
    if (url.pathname === '/api/channels') return json(200, { items: [{ id: 'UC1', snippet: { title: 'Mi canal', thumbnails: { default: { url: 'https://img/x' } } } }] });
    if (url.pathname === '/upload/videos') {
      st.total = Number(req.headers['x-upload-content-length']);
      st.metadata = JSON.parse(body.toString());
      return res.writeHead(200, { Location: `http://127.0.0.1:${(server.address() as { port: number }).port}/session/1` }).end();
    }
    if (url.pathname === '/session/1') {
      const range = String(req.headers['content-range']);
      const done = () => json(201, { id: 'VID1' });
      const partial = () => res.writeHead(308, st.received ? { Range: `bytes=0-${st.received - 1}` } : {}).end();
      if (range.startsWith('bytes */')) return st.received === st.total ? done() : partial();
      const [, a, b] = /bytes (\d+)-(\d+)\//.exec(range)!.map(Number);
      if (b === undefined || a !== st.received || body.length !== b - a + 1) return json(400, { error: { message: 'bad range' } });
      // The second chunk "drops" once: the client must ask what arrived and continue.
      if (a === CHUNK && st.failNext) return (st.failNext = false), json(503, {});
      st.received = b + 1;
      return st.received === st.total ? done() : partial();
    }
    if (url.pathname === '/upload/thumbnails/set') return (st.thumb = body.length), json(200, {});
    if (url.pathname === '/api/videos') return json(200, { items: [{ status: { uploadStatus: 'processed', privacyStatus: 'public' } }] });
    json(404, {});
  });
  return new Promise<{ base: string; st: typeof st; log: string[]; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      resolve({ base, st, log, close: () => server.close() });
    }),
  );
}

type Harness = { call: (ch: string, ...args: unknown[]) => Promise<unknown>; handlers: Map<string, (...a: unknown[]) => unknown>; progress: number[]; dir: string };

/** Registers the adapter against the fake Google, with an optional client built into the app. */
function harness(base: string, st: { challenge: string }, builtIn: { clientId: string; clientSecret: string | undefined } | null): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipo-yt-'));
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const progress: number[] = [];
  const event = { senderFrame: { url: 'app://clipo/index.html' }, sender: { isDestroyed: () => false, send: (_c: string, p: { sent: number }) => progress.push(p.sent) } };
  // Like ipcMain.handle, a throw becomes a rejected promise.
  const call = async (ch: string, ...args: unknown[]) => handlers.get(ch)!(event, ...args);

  yt.register({
    app: { getPath: () => dir },
    BrowserWindow: undefined,
    ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) },
    shell: {
      // Plays the user's browser: read the auth URL and follow the redirect back to the loopback.
      openExternal: async (u: string) => {
        const p = new URL(u).searchParams;
        assert.equal(p.get('code_challenge_method'), 'S256');
        assert.equal(p.get('access_type'), 'offline');
        st.challenge = p.get('code_challenge')!;
        await fetch(`${p.get('redirect_uri')}/?code=C1&state=${p.get('state')}`);
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s).map((b) => b ^ 0x5a),
      decryptString: (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a)).toString(),
    },
    endpoints: { auth: `${base}/auth`, token: `${base}/token`, revoke: `${base}/revoke`, api: `${base}/api`, upload: `${base}/upload` },
    chunkSize: CHUNK,
    builtIn,
  });
  return { call, handlers, progress, dir };
}

test('sign in, upload in chunks after a drop, cover, status and disconnect', async () => {
  const g = await fakeGoogle();
  const { call, handlers, progress, dir } = harness(g.base, g.st, null);

  try {
    // Calls from other pages are refused.
    assert.throws(() => handlers.get('yt:accounts')!({ senderFrame: { url: 'https://evil.example/' } }), /forbidden/);

    await assert.rejects(call('yt:setConfig', { clientId: 'nope' }), /ID de cliente/);
    await call('yt:setConfig', { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'SECRET' });
    assert.deepEqual(await call('yt:getConfig'), { clientId: '123-abc.apps.googleusercontent.com', hasSecret: true, encryption: true, builtIn: false, usingBuiltIn: false });

    const acc = (await call('yt:connect')) as { id: string; name: string };
    assert.equal(acc.id, 'UC1');
    assert.equal(acc.name, 'Mi canal');
    const onDisk = fs.readFileSync(path.join(dir, 'publish', 'youtube.json'), 'utf8');
    assert.ok(!onDisk.includes('RT1') && !onDisk.includes('AT1') && !onDisk.includes('SECRET'), 'tokens and secret are stored encrypted');

    const video = crypto.randomBytes(CHUNK * 2 + 100 * KIB);
    const metadata = { snippet: { title: 'Hola', description: '', categoryId: '22' }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } };
    const res = (await call('yt:upload', {
      jobId: 'j1',
      accountId: 'UC1',
      bytes: video.buffer.slice(video.byteOffset, video.byteOffset + video.length),
      mime: 'video/mp4',
      metadata,
      thumbnail: { bytes: new Uint8Array([1, 2, 3]).buffer, mime: 'image/jpeg' },
    })) as { videoId: string; note?: string };
    assert.deepEqual(res, { videoId: 'VID1', note: undefined });
    assert.equal(g.st.received, video.length);
    assert.deepEqual(g.st.metadata, metadata);
    assert.equal(g.st.thumb, 3);
    assert.equal(progress.at(-1), video.length);
    assert.ok(g.log.filter((l) => l === 'PUT /session/1').length >= 5, 'chunks + status query after the drop');

    assert.deepEqual(await call('yt:status', 'UC1', 'VID1'), { state: 'ready', detail: 'Listo en YouTube · público' });

    await call('yt:disconnect', 'UC1');
    assert.equal(g.st.revoked, 'RT1');
    assert.deepEqual(await call('yt:accounts'), []);
  } finally {
    g.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the client built into the app connects with no setup; switching to your own reconnects', async () => {
  const g = await fakeGoogle();
  const builtIn = { clientId: '999-clipo.apps.googleusercontent.com', clientSecret: 'SECRET' };
  const { call, dir } = harness(g.base, g.st, builtIn);
  try {
    assert.deepEqual(await call('yt:getConfig'), { clientId: '', hasSecret: false, encryption: true, builtIn: true, usingBuiltIn: true });
    const acc = (await call('yt:connect')) as { id: string };
    assert.equal(acc.id, 'UC1');
    assert.equal(g.st.clientId, builtIn.clientId);

    // Refreshing uses the client the account was connected with.
    assert.deepEqual(await call('yt:status', 'UC1', 'VID1'), { state: 'ready', detail: 'Listo en YouTube · público' });

    // Your own Google project: channels connected with the built-in client are revoked and removed.
    await call('yt:setConfig', { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'SECRET' });
    assert.equal(g.st.revoked, 'RT1');
    assert.deepEqual(await call('yt:accounts'), []);
    assert.equal(((await call('yt:getConfig')) as { usingBuiltIn: boolean }).usingBuiltIn, false);
  } finally {
    g.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('built-in Google client: read from the build file, ignored when malformed', async () => {
  const { builtInGoogleClient } = await import('../electron/publish/google-client.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipo-gc-'));
  const file = path.join(dir, 'google-client.json');
  const saved = process.env.CLIPO_GOOGLE_CLIENT_ID;
  delete process.env.CLIPO_GOOGLE_CLIENT_ID;
  try {
    assert.equal(builtInGoogleClient(file), null, 'no file: no built-in client');
    fs.writeFileSync(file, JSON.stringify({ clientId: '1-x.apps.googleusercontent.com', clientSecret: ' S ' }));
    assert.deepEqual(builtInGoogleClient(file), { clientId: '1-x.apps.googleusercontent.com', clientSecret: 'S' });
    fs.writeFileSync(file, JSON.stringify({ clientId: 'not-a-client' }));
    assert.equal(builtInGoogleClient(file), null);
  } finally {
    if (saved !== undefined) process.env.CLIPO_GOOGLE_CLIENT_ID = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
