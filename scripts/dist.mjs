// Builds the Windows installers outside the project folder (OneDrive and antivirus scanners lock
// files while electron-builder renames them) and copies the finished .exe files to release/<version>/.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const out = join(tmpdir(), 'clipo-build', version);
await rm(out, { recursive: true, force: true });
const bin = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
execFileSync(join('node_modules', '.bin', bin), ['--win', `-c.directories.output=${out}`], { stdio: 'inherit', shell: process.platform === 'win32' });
const dest = join('release', version);
await mkdir(dest, { recursive: true });
for (const f of await readdir(out)) if (f.endsWith('.exe')) await copyFile(join(out, f), join(dest, f));
console.log(`Instaladores en ${dest}`);
