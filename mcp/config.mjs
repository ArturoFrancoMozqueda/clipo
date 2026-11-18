import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('./server.mjs', import.meta.url));
console.log(JSON.stringify({ mcpServers: { clipo: { command: process.execPath, args: [server] } } }, null, 2));
