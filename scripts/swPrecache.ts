import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Fills the precache list in dist/sw.js with every file of the build, so the app opens offline
 * right after it is installed. Files over `maxBytes` (the 26 MB captions WASM) are left out and
 * cached the first time they are actually used instead.
 */
export function swPrecache({ maxBytes = 3 * 1024 * 1024 } = {}): Plugin {
  let outDir = 'dist';
  const files: string[] = [];
  return {
    name: 'clipo-sw-precache',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    generateBundle(_, bundle) {
      for (const f of Object.values(bundle)) {
        const size = f.type === 'chunk' ? Buffer.byteLength(f.code) : f.source.length;
        if (f.fileName !== 'sw.js' && !f.fileName.endsWith('.map') && size <= maxBytes) files.push(f.fileName);
      }
    },
    async writeBundle() {
      const swPath = join(outDir, 'sw.js');
      const sw = await readFile(swPath, 'utf8');
      const urls = ['./', ...[...new Set(files)].sort().map((f) => `./${f}`)];
      // Public files are copied as-is, so list the ones the shell needs.
      urls.push('./manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png');
      const version = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 10);
      await writeFile(swPath, sw.replace("'__VERSION__'", JSON.stringify(version)).replace('[/*__PRECACHE__*/]', JSON.stringify(urls)));
    },
  };
}
