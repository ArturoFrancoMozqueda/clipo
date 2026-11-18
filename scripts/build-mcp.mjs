import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
// Standalone server: no TypeScript loader, source checkout or SDK installation at runtime.
await mkdir('mcp/standalone', { recursive: true });
await build({ entryPoints: ['mcp/server.mjs'], outfile: 'mcp/standalone/server.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm', external: ['electron'],
  banner: { js: "import { createRequire as __clipoCreateRequire } from 'node:module'; const require = __clipoCreateRequire(import.meta.url);" },
});
await build({ entryPoints: ['mcp/http-server.mjs'], outfile: 'mcp/standalone/http-server.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm', external: ['electron'],
  banner: { js: "import { createRequire as __clipoCreateRequire } from 'node:module'; const require = __clipoCreateRequire(import.meta.url);" },
});
await copyFile('docs/MCP.md', 'mcp/standalone/README.md');
await copyFile('docs/MCP-COVERAGE.md', 'mcp/standalone/MCP-COVERAGE.md');
await copyFile('mcp/config.mjs', 'mcp/standalone/config.mjs');
console.log('Standalone MCP: mcp/standalone/server.mjs (Node >=22.18)');
