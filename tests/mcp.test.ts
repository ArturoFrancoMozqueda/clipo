import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { startBridge, readMedia } from '../electron/automation.cjs';
import { callEditor } from '../mcp/bridge-client.mjs';
import { toolSchemas } from '../src/automation/schema.ts';

test('local bridge authenticates, rejects browser requests and cleans up discovery', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clipo-bridge-'));
  const discoveryFile = path.join(dir, 'automation.json');
  const bridge = await startBridge({ discoveryFile, dispatch: async (r: { tool: string; args: object }) => ({ tool: r.tool, args: r.args }) });
  try {
    const info = JSON.parse(await readFile(discoveryFile, 'utf8'));
    const endpoint = `http://127.0.0.1:${bridge.port}/command`;
    const unauth = await fetch(endpoint, { method: 'POST', body: '{}' });
    assert.equal(unauth.status, 403);
    const browser = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${info.token}`, Origin: 'https://example.com' }, body: '{}' });
    assert.equal(browser.status, 403);
    const malformed = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${info.token}` }, body: '{' });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await callEditor('clipo_get_project', {}, { discoveryFile }), { tool: 'clipo_get_project', args: {} });
  } finally { bridge.close(); }
  await assert.rejects(readFile(discoveryFile));
  await rm(dir, { recursive: true, force: true });
});

test('real MCP stdio initialization, discovery, tools/call and tool errors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clipo-mcp-'));
  const discoveryFile = path.join(dir, 'automation.json');
  const received: { tool: string; args: object }[] = [];
  const bridge = await startBridge({ discoveryFile, dispatch: async (r: { tool: string; args: object }) => {
    received.push(r);
    if (r.tool === 'clipo_undo') throw new Error('Versión desactualizada');
    if (r.tool === 'clipo_redo') throw Object.assign(new Error('opaque native failure'), { errorDetails: { code: 'CONFLICT' } });
    return { revision: 3, project: { id: 'p1' } };
  } });
  const client = new Client({ name: 'clipo-test', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve(process.env.CLIPO_MCP_SERVER ?? 'mcp/server.mjs')], env: { ...process.env as Record<string, string>, CLIPO_BRIDGE_FILE: discoveryFile } }));
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((x) => x.name).sort(), Object.keys(toolSchemas).sort());
    assert.ok(tools.tools.every((x) => x.description && x.inputSchema && x.outputSchema));
    assert.equal(tools.tools.find((x) => x.name === 'clipo_inspect_media')!.annotations!.readOnlyHint, true);
    assert.ok(tools.tools.some((x) => x.name === 'clipo_edit'));
    const state = await client.callTool({ name: 'clipo_get_project', arguments: {} });
    assert.equal(state.isError, undefined, JSON.stringify(state));
    assert.deepEqual(state.structuredContent, JSON.parse((state.content[0] as { text: string }).text));
    assert.equal(received[0]!.tool, 'clipo_get_project');
    const bad = await client.callTool({ name: 'clipo_edit', arguments: { projectId: 'p1', expectedRevision: 3, operations: [{ op: 'settings', aspect: '7:3' }] } });
    assert.equal(bad.isError, true);
    assert.equal(received.length, 1);
    const conflict = await client.callTool({ name: 'clipo_undo', arguments: { projectId: 'p1', expectedRevision: 2 } });
    assert.equal(conflict.isError, true);
    assert.match(JSON.stringify(conflict.content), /Versión desactualizada/);
    const typed = await client.callTool({ name: 'clipo_redo', arguments: { projectId: 'p1', expectedRevision: 3 } });
    assert.equal(JSON.parse((typed.content[0] as { text: string }).text).error.code, 'CONFLICT');
    const compact = await client.callTool({ name: 'clipo_get_project', arguments: { response: 'summary' } });
    assert.equal((compact.structuredContent as { projectSummary: { id: string } }).projectSummary.id, 'p1');
    assert.equal((compact.structuredContent as { project?: unknown }).project, undefined);
  } finally { await client.close(); bridge.close(); await rm(dir, { recursive: true, force: true }); }
});

test('media bridge reads only bounded local media and gives actionable errors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clipo-media-'));
  try {
    const media = path.join(dir, 'test.png');
    await writeFile(media, new Uint8Array([1, 2, 3]));
    const r = await readMedia(media);
    assert.equal(r.name, 'test.png');
    assert.deepEqual(new Uint8Array(r.bytes), new Uint8Array([1, 2, 3]));
    await assert.rejects(readMedia('relative.png'), /absoluta/);
    await assert.rejects(readMedia(path.join(dir, 'secret.txt')), /absoluta/);
    await assert.rejects(callEditor('clipo_status', {}, { discoveryFile: path.join(dir, 'missing.json') }), /clipo_connect/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('bridge rejects overlapping calls, bounds messages and cancels expired work', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clipo-busy-'));
  const discoveryFile = path.join(dir, 'automation.json');
  let notifyStarted!: () => void;
  const started = new Promise<void>((r) => { notifyStarted = r; });
  let wasAborted = false;
  const bridge = await startBridge({ discoveryFile, timeout: 100, dispatch: async (_r: unknown, signal: AbortSignal) => {
    notifyStarted();
    return new Promise((_, reject) => signal.addEventListener('abort', () => { wasAborted = true; reject(new Error('cancelled')); }, { once: true }));
  } });
  try {
    const pending = callEditor('clipo_status', {}, { discoveryFile });
    // Attach rejection handling before the timeout can fire.
    const rejected = assert.rejects(pending, /cancel|agotado/);
    await started;
    await assert.rejects(callEditor('clipo_status', {}, { discoveryFile }), /otro comando/);
    await rejected;
    assert.equal(wasAborted, true);
    const info = JSON.parse(await readFile(discoveryFile, 'utf8'));
    const huge = await fetch(`http://127.0.0.1:${bridge.port}/command`, { method: 'POST', headers: { Authorization: `Bearer ${info.token}` }, body: 'x'.repeat(1024 * 1024 + 1) });
    assert.equal(huge.status, 413);
  } finally { bridge.close(); await rm(dir, { recursive: true, force: true }); }
});
