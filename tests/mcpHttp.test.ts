import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startHttp } from '../mcp/http-server.mjs';
test('authenticated HTTP MCP initializes, exposes matching tools/resources/prompts and rejects web requests', async () => {
  const token = randomBytes(32).toString('hex');
  const endpoint = await startHttp({ port: 0, token, call: async (tool: string) => ({ tool, project: null, jobs: [] }) });
  const client = new Client({ name: 'clipo-http-test', version: '1' });
  try {
    assert.equal((await fetch(endpoint.url, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(endpoint.url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, Origin: 'https://untrusted.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(endpoint.url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: 'x'.repeat(1048577) })).status, 413);
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: { Authorization: 'Bearer ' + token } } }));
    assert.ok((await client.listTools()).tools.some((t) => t.name === 'clipo_action'));
    assert.equal((await client.listResources()).resources.length, 2);
    const read = await client.readResource({ uri: 'clipo://project' }); assert.match(JSON.stringify(read), /clipo_get_project/);
    assert.equal((await client.listPrompts()).prompts.length, 1);
    const result = await client.callTool({ name: 'clipo_status', arguments: {} }); assert.ok(!result.isError);
  } finally { await client.close(); await endpoint.close(); }
});
