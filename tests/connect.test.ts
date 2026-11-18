import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { connectEditor } from '../mcp/connect.mjs';
import { enabled } from '../electron/automation.cjs';
test('normal desktop startup enables the authenticated bridge; explicit disable wins', () => {
  assert.equal(enabled({}, []), true); assert.equal(enabled({ CLIPO_AUTOMATION: '0' }, []), false);
  assert.equal(enabled({}, ['--disable-clipo-agent']), false);
});
test('connecting to a running app does not start another process', async () => {
  const result = await connectEditor({ call: async () => ({ revision: 2 }), spawn: () => { throw new Error('must not launch'); } });
  assert.equal(result.connected, true); assert.equal(result.launched, false);
});
test('simultaneous connection requests start one known app, wait for readiness and preserve the project', async () => {
  let ready = false; let starts = 0;
  const deps = { call: async () => { if (!ready) throw new Error('No hay conexión activa'); return { project: { id: 'original' }, revision: 3 }; },
    target: async () => ({ command: 'known-clipo', args: [], cwd: '/known' }), spawn: () => { starts++; ready = true; return Object.assign(new EventEmitter(), { unref() {} }); } };
  const results = await Promise.all([connectEditor(deps), connectEditor(deps)]);
  assert.equal(starts, 1); assert.ok(results.every((r) => r.connected && r.project.id === 'original'));
});
test('busy/editor errors never start another app or retry a mutation', async () => {
  let starts = 0;
  await assert.rejects(connectEditor({ call: async () => { throw new Error('Clipo está ocupado'); }, spawn: () => { starts++; } }), /ocupado/);
  assert.equal(starts, 0);
});
