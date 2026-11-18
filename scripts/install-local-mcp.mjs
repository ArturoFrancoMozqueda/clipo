// Local development deployment, explicitly run after the packaged MCP smoke test.
// Application binaries only; never copies, deletes or changes the user's project profile.
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new Error('Esta instalación local está validada para Windows.');
const install = path.resolve(process.env.LOCALAPPDATA, 'Programs/Clipo');
const executable = path.join(install, 'Clipo.exe');
// An explicit build directory prevents silently installing an older validation build.
const source = path.resolve(process.argv[2] ?? 'release/mcp-packaged-validation/win-unpacked');
const report = JSON.parse(await readFile('release/mcp-validation/latest.json', 'utf8'));
if (report.status !== 'passed' || !report.flows.some((f) => f.name.includes('MCP status launches normal Clipo') && f.status === 'passed')) throw new Error('Falta la prueba E2E satisfactoria del arranque normal.');
await access(executable); await access(path.join(source, 'resources/mcp/server.mjs'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.resolve('release/mcp-validation/backups', 'clipo-' + stamp);
if (install === path.parse(install).root || !install.toLowerCase().endsWith('programs' + path.sep + 'clipo')) throw new Error('Ruta de instalación inesperada.');
await mkdir(path.dirname(backup), { recursive: true });
await cp(install, backup, { recursive: true, errorOnExist: true, force: false });
// Graceful WM_CLOSE, with the app's normal save/close behavior. Never force-kill it.
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
$target = $env:CLIPO_INSTALL_TARGET
$apps = @(Get-Process -Name Clipo -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target -and $_.MainWindowHandle -ne 0 })
foreach ($item in $apps) {
  if (-not $item.CloseMainWindow()) { throw 'Clipo no aceptó el cierre normal.' }
  if (-not $item.WaitForExit(15000)) { throw 'Clipo sigue abierto. No se forzará el cierre ni se sustituirán archivos.' }
}
$end = (Get-Date).AddSeconds(5)
do {
  $left = @(Get-Process -Name Clipo -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target })
  if ($left.Count -eq 0) { break }
  Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $end)
if ($left.Count -gt 0) { throw 'La instalación sigue en uso. No se sustituirán archivos.' }
`], { env: { ...process.env, CLIPO_INSTALL_TARGET: executable }, windowsHide: true, stdio: 'pipe', timeout: 25000 });
const sha = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
try {
  await cp(source, install, { recursive: true, force: true });
  for (const file of ['Clipo.exe', 'resources/app.asar', 'resources/mcp/server.mjs']) if (await sha(path.join(source, file)) !== await sha(path.join(install, file))) throw new Error('La copia no coincide: ' + file);
} catch (error) { await cp(backup, install, { recursive: true, force: true }); throw error; }
// Keep other servers/settings unchanged and back up the original config first.
const config = path.join(process.env.USERPROFILE, '.codex/config.toml');
const original = await readFile(config, 'utf8');
const configBackup = config + '.before-clipo-installed-' + stamp;
await writeFile(configBackup, original, { flag: 'wx' });
let inside = false; let changed = false;
const server = path.join(install, 'resources/mcp/server.mjs').replaceAll('\\', '/');
const updated = original.split(/\r?\n/).map((line) => {
  if (/^\[/.test(line)) inside = line.trim() === '[mcp_servers.clipo]';
  if (inside && /^args\s*=/.test(line.trim())) { changed = true; return 'args = [' + JSON.stringify(server) + ']'; }
  return line;
}).join('\n');
if (!changed) throw new Error('La app se actualizó, pero falta la sección MCP de Clipo en Codex.');
await writeFile(config, updated);
const receipt = { at: new Date().toISOString(), source, install, executable, backup, configBackup, server, sha256: await sha(path.join(install, 'resources/app.asar')), verified: true };
await writeFile('release/mcp-validation/installation.json', JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
