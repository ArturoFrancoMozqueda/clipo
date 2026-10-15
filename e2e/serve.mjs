// Serves dist/ with the same headers as production (vercel.json: CSP, COOP/COEP, caching),
// so the end-to-end tests catch CSP violations and cross-origin isolation problems.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const root = join(process.cwd(), 'dist');
const port = Number(process.env.PORT || 4173);
const rules = JSON.parse(await readFile('vercel.json', 'utf8')).headers.map((r) => ({ re: new RegExp(`^${r.source}$`), headers: r.headers }));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.tflite': 'application/octet-stream',
  '.data': 'application/octet-stream', '.onnx': 'application/octet-stream',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const r of rules) if (r.re.test(path)) for (const h of r.headers) res.setHeader(h.key, h.value);
  let file = normalize(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(root, 'index.html');
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`dist en http://localhost:${port}`));
