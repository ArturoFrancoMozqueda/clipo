// Copies the built web app (dist/) to site/app/ for GitHub Pages, so it can be opened and installed
// from a phone (https://<user>.github.io/clipo/app/). Pages can't send custom headers, so the
// Content-Security-Policy from vercel.json goes into index.html as a <meta> tag instead
// (frame-ancestors is header-only and is dropped). Without COOP/COEP the app runs single-threaded,
// as it always does in Safari.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const csp = vercel.headers.flatMap((h) => h.headers).find((x) => x.key === 'Content-Security-Policy')?.value;
if (!csp) throw new Error('No Content-Security-Policy in vercel.json');
const metaCsp = csp
  .split(';')
  .map((d) => d.trim())
  .filter((d) => d && !d.startsWith('frame-ancestors'))
  .join('; ');

rmSync('site/app', { recursive: true, force: true });
cpSync('dist', 'site/app', { recursive: true });
const file = 'site/app/index.html';
const html = readFileSync(file, 'utf8');
const tag = `<meta http-equiv="Content-Security-Policy" content="${metaCsp}" />`;
if (!html.includes('<meta charset')) throw new Error('index.html has no <meta charset>');
writeFileSync(file, html.replace(/(<meta charset[^>]*>)/, `$1\n    ${tag}`));
console.log('site/app ready');
