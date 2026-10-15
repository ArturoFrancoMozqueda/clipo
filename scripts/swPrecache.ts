import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Fills dist/sw.js with two lists:
 * - PRECACHE: the app shell only (entry JS/CSS and the chunks it loads, icons, manifest and the
 *   latin files of the most used fonts), stored on install so the editor opens offline.
 * - ASSETS: every file of this build's assets/ folder. The service worker keeps files from it in the runtime cache
 *   when they are first used (other fonts, AI workers, WASM, vision) and deletes, on activate,
 *   cached /assets/ files of older builds.
 */

/** Fonts in src/fonts.ts POPULAR_FONTS, by their @fontsource file prefix. Only the "latin" file is precached. */
const POPULAR_FONT_FILES = [
  'montserrat', 'poppins', 'bebas-neue', 'anton', 'oswald', 'bangers', 'luckiest-guy',
  'righteous', 'permanent-marker', 'caveat', 'pacifico', 'lobster', 'dancing-script', 'playfair-display',
];
const popularFont = new RegExp(`^assets/(${POPULAR_FONT_FILES.join('|')})-latin-\\d+-normal-[\\w-]+\\.woff2$`);

/** Heavy or rarely used files: never precached, cached on first use instead. */
const ON_DEMAND = [/\.wasm$/, /\.data$/, /\.mjs$/, /Worker-[\w-]+\.js$/, /^assets\/vision_/, /\.woff2?$/];

export function swPrecache(): Plugin {
  let outDir = 'dist';
  const shell = new Set<string>();
  const all = new Set<string>();
  return {
    name: 'clipo-sw-precache',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    generateBundle(_, bundle) {
      // The entry chunk and the chunks it imports statically form the shell; dynamic imports
      // (lazy panels, workers, AI engines) load on demand.
      const entries = Object.values(bundle).filter((f) => f.type === 'chunk' && f.isEntry);
      const seen = new Set<string>();
      const visit = (name: string) => {
        if (seen.has(name)) return;
        seen.add(name);
        const f = bundle[name];
        if (!f) return;
        if (f.type === 'chunk') {
          f.imports.forEach(visit);
          f.viteMetadata?.importedCss.forEach(visit);
        }
      };
      entries.forEach((e) => visit(e.fileName));

      for (const f of Object.values(bundle)) {
        const name = f.fileName;
        if (name === 'sw.js' || name.endsWith('.map')) continue;
        all.add(name);
        if (popularFont.test(name) || (seen.has(name) && !ON_DEMAND.some((r) => r.test(name)))) shell.add(name);
      }
    },
    async writeBundle() {
      const swPath = join(outDir, 'sw.js');
      const sw = await readFile(swPath, 'utf8');
      const urls = ['./', ...[...shell].sort().map((f) => `./${f}`)];
      // Public files are copied as-is, so list the ones the shell needs.
      urls.push('./manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png');
      // From the folder itself, so files emitted by worker builds are included too.
      const onDisk = await readdir(join(outDir, 'assets')).catch(() => [] as string[]);
      const assets = [...new Set([...[...all].filter((f) => f.startsWith('assets/')), ...onDisk.map((f) => `assets/${f}`)])]
        .filter((f) => !f.endsWith('.map'))
        .sort()
        .map((f) => `./${f}`);
      const version = createHash('sha256').update(urls.join('\n')).update(assets.join('\n')).digest('hex').slice(0, 10);
      await writeFile(
        swPath,
        sw
          .replace("'__VERSION__'", JSON.stringify(version))
          .replace('[/*__PRECACHE__*/]', JSON.stringify(urls))
          .replace('[/*__ASSETS__*/]', JSON.stringify(assets)),
      );
    },
  };
}
