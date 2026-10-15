import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { isNewer } = createRequire(import.meta.url)('../electron/updates.cjs');

test('update check only offers strictly newer releases', () => {
  assert.equal(isNewer('v0.5.0', '0.4.0'), true);
  assert.equal(isNewer('v0.10.0', '0.9.9'), true);
  assert.equal(isNewer('1.0.0', '0.99.99'), true);
  assert.equal(isNewer('v0.4.0', '0.4.0'), false);
  assert.equal(isNewer('v0.3.9', '0.4.0'), false);
  assert.equal(isNewer('nightly', '0.4.0'), false);
});
