import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import './helpers/hooks.ts';
import type { RecordStore } from '../src/automation/storage.ts';
const { createRequestJournal } = await import('../src/automation/requests.ts');
const hash = async (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture() {
  const rows = new Map<string, unknown>();
  const storage: RecordStore = { async put(k, v) { rows.set(k, structuredClone(v)); }, async get<T>(k: string) { return structuredClone(rows.get(k)) as T; },
    async list<T>(prefix: string) { return [...rows].filter(([k]) => k.startsWith(prefix)).map(([, v]) => structuredClone(v) as T); }, async remove(k) { rows.delete(k); } };
  return { rows, storage, journal: createRequestJournal(storage, hash) };
}
test('durable receipt recovers lost responses and rejects key reuse without storing arguments', async () => {
  const { journal, rows } = fixture(); const args = { projectId: 'p', expectedRevision: 2, operations: ['private text'], response: 'full' };
  const started = await journal.begin('unique', 'clipo_edit', args);
  assert.equal((await journal.read('unique'))!.status, 'running');
  await journal.complete(started, { added: [{ id: 'new' }], revision: 3 });
  const replay = await journal.lookup('unique', 'clipo_edit', { ...args, response: 'summary' });
  assert.equal(replay!.status, 'completed'); assert.equal((replay!.result as { revision: number }).revision, 3);
  await assert.rejects(journal.lookup('unique', 'clipo_edit', { ...args, expectedRevision: 3 }), { code: 'REQUEST_KEY_REUSED' });
  await assert.rejects(journal.begin('unique', 'clipo_edit', args), { code: 'OUTCOME_UNKNOWN' });
  assert.ok(!JSON.stringify([...rows]).includes('private text'));
});
test('restart and failed durable completion never turn uncertain writes into retryable work', async () => {
  const { storage, journal } = fixture(); const r = await journal.begin('crash', 'clipo_undo', {});
  const restarted = createRequestJournal(storage, hash); await restarted.recover();
  assert.equal((await restarted.read('crash'))!.status, 'unknown');
  const put = storage.put; storage.put = async () => { throw new Error('disk'); };
  await assert.rejects(journal.complete(r, { saved: true }), /disk/);
  storage.put = put;
  assert.equal((await restarted.read('crash'))!.status, 'unknown');
  assert.equal(await restarted.read('absent'), null);
});
test('a failed reservation cannot produce a receipt or let execution start', async () => {
  const { journal, storage } = fixture();
  storage.put = async () => { throw new Error('quota'); };
  await assert.rejects(journal.begin('never-started', 'clipo_edit', {}), /quota/);
  assert.equal(await journal.read('never-started'), null);
});
