// A bounded MCP maintenance action: save, load a local editor build, restore its project.
// No shell commands or executable/path arguments are accepted from the caller.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { callEditor, discoveryPath } from './bridge-client.mjs';

export async function refreshEditor(args) {
  const before = await callEditor('clipo_get_project', {});
  if (before.project?.id !== args.projectId || before.revision !== args.expectedRevision) throw new Error('El proyecto cambió. Vuelve a leerlo antes de actualizar el editor.');
  if (before.captioning || before.exporting) throw new Error('Espera a que termine el trabajo antes de actualizar el editor.');
  await callEditor('clipo_save_project', args);
  const previous = JSON.parse(await readFile(discoveryPath(), 'utf8'));
  if (!Number.isSafeInteger(previous.pid) || previous.pid < 1 || previous.pid === process.pid || previous.pid === process.ppid) throw new Error('PID de Clipo inválido.');
  if (!import.meta.url.endsWith('/refresh-editor.mjs')) throw new Error('La actualización del build requiere ejecutar mcp/server.mjs desde el repositorio. En una instalación, reabre Clipo --clipo-agent.');
  const { default: electron } = await import('electron');
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  await callEditor('clipo_close_editor', args);
  for (let i = 0; i < 100; i++) {
    let alive = true; try { process.kill(previous.pid, 0); } catch { alive = false; }
    if (!alive) break;
    if (i === 99) throw new Error('Clipo no terminó de cerrar. No se forzó el cierre ni se abrió una segunda instancia.');
    await new Promise((r) => setTimeout(r, 100));
  }
  const env = { ...process.env, CLIPO_AUTOMATION: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [cwd, '--clipo-agent'], { cwd, env, detached: true, stdio: 'ignore', windowsHide: false });
  let launchError;
  child.on('error', (e) => { launchError = e; });
  child.unref();
  for (let i = 0; i < 150; i++) {
    if (launchError) throw launchError;
    await new Promise((r) => setTimeout(r, 200));
    let current;
    try { current = JSON.parse(await readFile(discoveryPath(), 'utf8')); } catch { continue; }
    if (current.token === previous.token) continue;
    const ready = await callEditor('clipo_get_project', {});
    const opened = await callEditor('clipo_open_project', { projectId: before.project.id, expectedRevision: ready.revision });
    await callEditor('clipo_seek', { projectId: opened.project.id, expectedRevision: opened.revision, time: Math.min(before.time, opened.duration) });
    return { ...(await callEditor('clipo_get_project', {})), refreshed: true };
  }
  throw new Error('Clipo guardó el proyecto, pero no terminó de abrirse en 30 segundos.');
}
