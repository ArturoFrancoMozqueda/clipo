// OAuth 2.0 for installed apps: PKCE (RFC 7636, S256) and a one-shot loopback redirect
// on 127.0.0.1 (RFC 8252). No client secret is needed by this part.
// Meta (electron/publish/meta.cjs) reuses the loopback and the state, with a "localhost" redirect.
const crypto = require('node:crypto');
const http = require('node:http');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** 32 random bytes -> 43 characters from the unreserved set, as RFC 7636 recommends. */
function createVerifier() {
  return b64url(crypto.randomBytes(32));
}

/** BASE64URL(SHA256(ASCII(code_verifier))) */
function challengeS256(verifier) {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) throw new Error('invalid code_verifier');
  return b64url(crypto.createHash('sha256').update(verifier, 'ascii').digest());
}

const createState = () => b64url(crypto.randomBytes(16));

function buildAuthUrl(endpoint, { clientId, redirectUri, scopes, challenge, state, extra = {} }) {
  const u = new URL(endpoint);
  const params = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    ...extra,
  };
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * Read the redirect. Returns { code } or { error }, or null when the request is not the redirect
 * (no code/error, or someone else's state — those are ignored, the real one may still come).
 */
function parseCallback(url, expectedState) {
  const u = url instanceof URL ? url : new URL(url, 'http://127.0.0.1');
  const code = u.searchParams.get('code');
  const error = u.searchParams.get('error');
  if (!code && !error) return null;
  if (u.searchParams.get('state') !== expectedState) return null;
  return error ? { error } : { code };
}

const PAGE = (ok) => `<!doctype html><meta charset="utf-8"><title>Clipo</title>
<body style="font-family:system-ui;background:#0e0e12;color:#fff;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:420px"><h1>${ok ? 'Listo' : 'No se conectó'}</h1>
<p>${ok ? 'Ya puedes cerrar esta pestaña y volver a Clipo.' : 'Puedes cerrar esta pestaña. En Clipo verás qué pasó.'}</p></div></body>`;

/**
 * Listen once on http://127.0.0.1:<free port>. Resolves with { redirectUri, result, cancel } where
 * `result` resolves with { code } or { error } and rejects on timeout or cancel.
 * `host: 'localhost'` is for providers that only accept "localhost" redirects (Meta): it listens on
 * 127.0.0.1 and ::1 at the same port and the redirect is http://localhost:<port>/. `port` is tried
 * first (so it can be registered with the provider) and a free one is used if it is taken.
 */
async function startLoopback({ state, timeoutMs = 5 * 60_000, host = '127.0.0.1', port = 0 }) {
  const servers = [];
  let timer;
  let finish;
  const result = new Promise((res, rej) => {
    finish = (err, value) => {
      clearTimeout(timer);
      for (const s of servers) s.close();
      if (err) rej(err);
      else res(value);
    };
  });
  result.catch(() => {});
  const handler = (req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const got = u.pathname === '/' ? parseCallback(u, state) : null;
    if (!got) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }).end(PAGE(!!got.code));
    finish(null, got);
  };
  const listen = (address, p) =>
    new Promise((res, rej) => {
      const server = http.createServer(handler);
      server.once('error', rej);
      server.listen(p, address, () => {
        servers.push(server);
        res(server.address().port);
      });
    });
  const closeAll = () => servers.splice(0).forEach((s) => s.close());

  let bound = 0;
  for (const p of port ? [port, 0, 0, 0] : [0, 0, 0]) {
    try {
      bound = await listen('127.0.0.1', p);
    } catch (e) {
      if (p) continue;
      throw e;
    }
    if (host !== 'localhost') break;
    try {
      await listen('::1', bound);
      break;
    } catch (e) {
      // No IPv6 on this machine: 127.0.0.1 alone is enough. Taken by someone else: try another port,
      // so the browser can't hand the redirect to another program.
      if (e.code !== 'EADDRINUSE') break;
      closeAll();
      bound = 0;
    }
  }
  if (!bound) throw new Error('no free port');
  timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
  const redirectUri = host === 'localhost' ? `http://localhost:${bound}/` : `http://127.0.0.1:${bound}`;
  return { redirectUri, result, cancel: () => finish(new Error('cancelled')) };
}

module.exports = { createVerifier, challengeS256, createState, buildAuthUrl, parseCallback, startLoopback };
