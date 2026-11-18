import { spawn } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env, CLIPO_AUTOMATION: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', '--clipo-agent'], { env, stdio: 'inherit', windowsHide: false });
child.on('error', (e) => { console.error(e.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
