import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export function discoveryPath() {
  if (process.env.CLIPO_BRIDGE_FILE) return process.env.CLIPO_BRIDGE_FILE;
  const base = process.platform === 'win32' ? process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming')
    : process.platform === 'darwin' ? path.join(homedir(), 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(base, 'clipo', 'automation.json');
}

export async function callEditor(tool, args, options = {}) {
  let connection;
  try { connection = JSON.parse(await readFile(options.discoveryFile || discoveryPath(), 'utf8')); }
  catch { throw new Error('No hay una conexión activa. Usa clipo_connect o clipo_status para abrir y conectar Clipo automáticamente.'); }
  if (connection.version !== 1 || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535 || !/^[a-f0-9]{64}$/.test(connection.token)) throw new Error('El archivo de conexión de Clipo no es válido. Reinicia Clipo en modo agente.');
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${connection.port}/command`, {
      method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args }), redirect: 'error', signal: options.signal || AbortSignal.timeout(tool === 'clipo_import_media' && args.normalize === true ? 605000 : 125000),
    });
  } catch { throw new Error('No se pudo contactar con Clipo. Comprueba que sigue abierto; consulta el proyecto antes de repetir cambios.'); }
  const payload = await response.json();
  if (!response.ok || payload.error) throw Object.assign(new Error(payload.error || `Clipo respondió HTTP ${response.status}.`), payload.errorDetails ?? {});
  return payload.result;
}
