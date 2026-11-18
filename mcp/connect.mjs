import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { callEditor } from './bridge-client.mjs';
const exists = async (file) => { try { await access(file); return true; } catch { return false; } };
let connecting;

export async function launchTarget() {
  // Test override is restricted to an explicitly isolated smoke profile.
  if (process.env.CLIPO_SMOKE === '1' && process.env.CLIPO_SMOKE_DATA && process.env.CLIPO_MCP_APP) return { command: process.env.CLIPO_MCP_APP, args: [], cwd: path.dirname(process.env.CLIPO_MCP_APP) };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packaged = process.platform === 'win32' ? path.resolve(here, '../../Clipo.exe') : process.platform === 'darwin' ? path.resolve(here, '../../MacOS/Clipo') : path.resolve(here, '../../clipo');
  if (await exists(packaged)) return { command: packaged, args: [], cwd: path.dirname(packaged) };
  const installed = process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs/Clipo/Clipo.exe') : '';
  if (installed && await exists(path.join(path.dirname(installed), 'resources/mcp/server.mjs')) && process.env.CLIPO_SMOKE !== '1') return { command: installed, args: [], cwd: path.dirname(installed) };
  if (import.meta.url.endsWith('/connect.mjs')) {
    const { default: electron } = await import('electron'); const root = path.resolve(here, '..');
    return { command: electron, args: [root], cwd: root };
  }
  throw new Error('No se encontró una instalación compatible de Clipo junto a este MCP. Instala la versión que incluye resources/mcp.');
}

/** Start a known local Clipo executable, without shell commands or caller-supplied paths. */
/** @param {{call?: (...args: any[]) => Promise<any>, target?: () => Promise<{command: string, args: string[], cwd: string}>, spawn?: (...args: any[]) => any, timeout?: number}} [deps] */
export async function connectEditor(deps = {}) {
  const call = deps.call ?? callEditor;
  const probe = () => call('clipo_status', {}, { signal: AbortSignal.timeout(1500) });
  try { return { ...await probe(), connected: true, launched: false }; }
  catch (error) { if (!/conexión|contactar|conectar|no se encontró|no es válido/i.test(error.message)) throw error; }
  if (process.env.CLIPO_AUTOMATION === '0') throw new Error('La conexión MCP está desactivada con CLIPO_AUTOMATION=0.');
  if (!connecting) connecting = (async () => {
    const target = await (deps.target ?? launchTarget)();
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = (deps.spawn ?? spawn)(target.command, target.args, { cwd: target.cwd, env, detached: true, stdio: 'ignore', windowsHide: false });
    let failed; child.on('error', (error) => { failed = error; }); child.unref();
    const end = Date.now() + (deps.timeout ?? 30000);
    do {
      if (failed) throw new Error('No se pudo iniciar Clipo: ' + failed.message);
      await new Promise((r) => setTimeout(r, 200));
      try { return { ...await probe(), connected: true, launched: true }; }
      catch (error) { if (!/conexión|contactar|conectar|no se encontró|no es válido/i.test(error.message)) throw error; }
    } while (Date.now() < end);
    throw new Error('Clipo no respondió al arranque. Una versión antigua ya abierta puede estar reteniendo la instancia: actualiza esa instalación. No se cerró ni se modificó su proyecto.');
  })().finally(() => { connecting = undefined; });
  return connecting;
}
