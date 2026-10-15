// Lets tests import app modules that use Vite-style imports (no extension) in plain Node, and
// swaps browser-only modules for small stubs. Register it, then import app code dynamically:
//   import { stub } from './helpers/hooks.ts';
//   stub('engine', 'export const engine = { pause() {}, play() {} };');
//   const ops = await import('../src/ops.ts');
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const stubs = new Map<string, string>();

/** Replace `src/<name>.ts` with `source` (an ES module) for every importer. */
export function stub(name: string, source: string) {
  stubs.set(name, source);
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/src/') && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL);
      const name = fileURLToPath(base).split('/src/').pop()!;
      if (stubs.has(name)) return { url: `stub:${name}`, shortCircuit: true };
      for (const ext of ['.ts', '.tsx']) {
        if (existsSync(fileURLToPath(base) + ext)) return next(base.href + ext, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('stub:')) return { format: 'module', source: stubs.get(url.slice(5))!, shortCircuit: true };
    if (url.endsWith('.json')) return { ...next(url, { ...context, importAttributes: { type: 'json' } }), shortCircuit: true };
    return next(url, context);
  },
});
