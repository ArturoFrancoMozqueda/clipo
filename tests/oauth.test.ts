// Run with: npm test. Desktop sign-in (PKCE + loopback) and resumable upload helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import oauth from '../electron/publish/oauth.cjs';
import resumable from '../electron/publish/resumable.cjs';

const { createVerifier, challengeS256, createState, buildAuthUrl, parseCallback, startLoopback } = oauth;
const { CHUNK_SIZE, chunkRange, nextOffset, isRetryableStatus, backoffMs, explainApiError } = resumable;

test('PKCE S256 matches the RFC 7636 example', () => {
  assert.equal(challengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('verifiers are random, 43 chars, from the unreserved set', () => {
  const a = createVerifier();
  const b = createVerifier();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9\-._~]{43}$/);
  assert.match(challengeS256(a), /^[A-Za-z0-9_-]{43}$/);
  assert.throws(() => challengeS256('short'));
  assert.notEqual(createState(), createState());
});

test('the authorization URL carries PKCE, state and the loopback redirect', () => {
  const url = new URL(
    buildAuthUrl('https://accounts.google.com/o/oauth2/v2/auth', {
      clientId: 'abc.apps.googleusercontent.com',
      redirectUri: 'http://127.0.0.1:5555',
      scopes: ['s1', 's2'],
      challenge: 'CH',
      state: 'ST',
      extra: { access_type: 'offline' },
    }),
  );
  const p = url.searchParams;
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.equal(p.get('code_challenge'), 'CH');
  assert.equal(p.get('state'), 'ST');
  assert.equal(p.get('redirect_uri'), 'http://127.0.0.1:5555');
  assert.equal(p.get('scope'), 's1 s2');
  assert.equal(p.get('access_type'), 'offline');
  assert.equal(p.get('client_secret'), null, 'no secret in the browser URL');
});

test('the redirect is accepted only with the right state', () => {
  assert.deepEqual(parseCallback('/?code=C&state=S', 'S'), { code: 'C' });
  assert.deepEqual(parseCallback('/?error=access_denied&state=S', 'S'), { error: 'access_denied' });
  assert.equal(parseCallback('/?code=C&state=EVIL', 'S'), null);
  assert.equal(parseCallback('/favicon.ico', 'S'), null);
});

test('loopback server: listens on 127.0.0.1, ignores noise, returns the code once', async () => {
  const loop = await startLoopback({ state: 'S1', timeoutMs: 5000 });
  assert.match(loop.redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await fetch(`${loop.redirectUri}/favicon.ico`)).status, 404);
  assert.equal((await fetch(`${loop.redirectUri}/?code=X&state=WRONG`)).status, 404);
  const page = await fetch(`${loop.redirectUri}/?code=GOOD&state=S1`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /volver a Clipo/);
  assert.deepEqual(await loop.result, { code: 'GOOD' });
  await assert.rejects(fetch(`${loop.redirectUri}/?code=AGAIN&state=S1`), 'server is closed after the first redirect');
});

test('loopback server: cancel and timeout reject', async () => {
  const a = await startLoopback({ state: 'x', timeoutMs: 5000 });
  a.cancel();
  await assert.rejects(a.result, /cancelled/);
  const b = await startLoopback({ state: 'x', timeoutMs: 20 });
  await assert.rejects(b.result, /timeout/);
});

test('resumable chunks are multiples of 256 KiB and the last one is shorter', () => {
  assert.equal(CHUNK_SIZE % (256 * 1024), 0);
  assert.deepEqual(chunkRange(0, 10, CHUNK_SIZE), { start: 0, end: 9 });
  assert.deepEqual(chunkRange(0, CHUNK_SIZE * 2, CHUNK_SIZE), { start: 0, end: CHUNK_SIZE - 1 });
  assert.deepEqual(chunkRange(CHUNK_SIZE, CHUNK_SIZE + 5, CHUNK_SIZE), { start: CHUNK_SIZE, end: CHUNK_SIZE + 4 });
  assert.throws(() => chunkRange(0, 10, 1000));
});

test('308 Range header gives the next byte; no header means start over', () => {
  assert.equal(nextOffset('bytes=0-999999'), 1_000_000);
  assert.equal(nextOffset(null), 0);
  assert.equal(nextOffset(''), 0);
});

test('only 500/502/503/504 are retried, with growing backoff', () => {
  assert.deepEqual([500, 502, 503, 504, 400, 401, 403, 404].map(isRetryableStatus), [true, true, true, true, false, false, false, false]);
  const zero = () => 0;
  assert.deepEqual([1, 2, 3, 6, 9].map((n) => backoffMs(n, zero)), [1000, 2000, 4000, 32000, 32000]);
});

test('API errors become plain Spanish with a retry hint', () => {
  const quota = explainApiError(403, { error: { errors: [{ reason: 'quotaExceeded' }] } });
  assert.match(quota.message, /cupo diario/);
  assert.equal(quota.retryable, true);
  assert.equal(explainApiError(400, { error: { errors: [{ reason: 'invalidTitle' }] } }).retryable, false);
  assert.equal(explainApiError(503, null).retryable, true);
  assert.equal(explainApiError(401, null).retryable, false);
});
