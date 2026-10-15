// OAuth 2.0 for installed apps: PKCE (RFC 7636, S256) and a one-shot loopback redirect
// on 127.0.0.1 (RFC 8252). No client secret is needed by this part.
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
 */
function startLoopback({ state, timeoutMs = 5 * 60_000 }) {
  return new Promise((resolveStart, rejectStart) => {
    let finish;
    const result = new Promise((res, rej) => {
      finish = (err, value) => {
        clearTimeout(timer);
        server.close();
        if (err) rej(err);
        else res(value);
      };
    });
    result.catch(() => {});
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      const got = u.pathname === '/' ? parseCallback(u, state) : null;
      if (!got) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }).end(PAGE(!!got.code));
      finish(null, got);
    });
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
    server.on('error', (e) => {
      clearTimeout(timer);
      rejectStart(e);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveStart({ redirectUri: `http://127.0.0.1:${port}`, result, cancel: () => finish(new Error('cancelled')) });
    });
  });
}

module.exports = { createVerifier, challengeS256, createState, buildAuthUrl, parseCallback, startLoopback };
