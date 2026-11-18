import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createServer } from './server.mjs';

/** Local Streamable HTTP for clients/gateways that don't use stdio. Never binds externally. */
/** @param {{port?: number, token?: string, call?: (tool: string, args: any, options?: any) => Promise<any>}} [options] */
export async function startHttp({ port = 3939, token = process.env.CLIPO_MCP_TOKEN, call } = {}) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('Define CLIPO_MCP_TOKEN con al menos 32 caracteres aleatorios.');
  const expected = Buffer.from('Bearer ' + token);
  const handler = createMcpHandler(() => createServer(call), { maxRequestBodySize: 1048576 });
  const server = http.createServer(async (req, res) => {
    const reject = (status) => { res.writeHead(status); res.end(); };
    const auth = Buffer.from(req.headers.authorization ?? '');
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return reject(401);
    if (req.headers.origin || !/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host ?? '')) return reject(403);
    if (req.url !== '/mcp') return reject(404);
    if (!['POST', 'GET', 'DELETE'].includes(req.method)) return reject(405);
    try {
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 1048576) return reject(413); chunks.push(chunk); }
      const url = `http://127.0.0.1:${server.address().port}/mcp`;
      const response = await handler.fetch(new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body), res); else res.end();
    } catch { if (!res.headersSent) reject(500); else res.destroy(); }
  });
  server.requestTimeout = 130000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, async close() { server.closeAllConnections(); await handler.close(); await new Promise((resolve) => server.close(resolve)); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const server = await startHttp({ port: Number(process.env.CLIPO_MCP_PORT ?? 3939) });
    console.error(`Clipo MCP Streamable HTTP: ${server.url} (Bearer token; solo loopback)`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void server.close().then(() => process.exit(0)));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
