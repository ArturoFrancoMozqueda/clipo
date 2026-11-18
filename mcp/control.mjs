// Call Clipo through the actual MCP stdio protocol from a terminal or an existing chat.
// This also works before a host refreshes its list of newly configured MCP servers.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [name, argsFile, outputFile] = process.argv.slice(2);
if (!name) {
  console.error('Usage: node mcp/control.mjs <tool|tools> [args.json|-] [result.json]');
  process.exitCode = 1;
} else {
  const client = new Client({ name: 'clipo-control', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('./server.mjs', import.meta.url))], env: { ...process.env } }));
    if (name === 'tools') console.log(JSON.stringify((await client.listTools()).tools.map((tool) => tool.name)));
    else {
      const args = argsFile && argsFile !== '-' ? JSON.parse(await readFile(argsFile, 'utf8')) : {};
      const response = await client.callTool({ name, arguments: args }, { timeout: name === 'clipo_import_media' && args.normalize === true ? 610000 : 130000 });
      if (response.isError) throw new Error(response.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'));
      const result = JSON.parse(response.content.find((c) => c.type === 'text').text);
      if (outputFile) {
        const output = path.resolve(outputFile);
        await mkdir(path.dirname(output), { recursive: true });
        const images = response.content.filter((c) => c.type === 'image');
        const imageFiles = [];
        for (let i = 0; i < images.length; i++) {
          const image = images[i];
          const target = output + `.${i + 1}.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`;
          await writeFile(target, Buffer.from(image.data, 'base64'));
          imageFiles.push(target);
        }
        const audioFiles = [];
        for (const [i, audio] of response.content.filter((c) => c.type === 'audio').entries()) {
          const target = output + `.${i + 1}.wav`;
          await writeFile(target, Buffer.from(audio.data, 'base64')); audioFiles.push(target);
        }
        await writeFile(output, JSON.stringify({ ...result, imageFiles, audioFiles }, null, 2) + '\n');
        console.log(JSON.stringify({ output, imageFiles, audioFiles, revision: result.revision,
          project: result.project ? { id: result.project.id, name: result.project.name,
            clips: result.project.clips.length, texts: result.project.texts.length, audios: result.project.audios.length } : null,
          saveStatus: result.saveStatus, job: result.job, captioning: result.captioning,
          projects: result.projects, imported: result.imported, failed: result.failed, added: result.added }));
      } else console.log(JSON.stringify(result));
    }
  } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }
  finally { await client.close(); }
}
