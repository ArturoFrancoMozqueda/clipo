// Starts the desktop app hidden, checks that the editor loads from app:// and quits.
import { spawn } from 'node:child_process';
import electron from 'electron';

const child = spawn(electron, ['.'], { env: { ...process.env, CLIPO_SMOKE: '1' }, stdio: 'inherit' });
const timer = setTimeout(() => {
  console.log('SMOKE TIMEOUT');
  child.kill();
  process.exit(1);
}, 30000);
child.on('exit', (code) => {
  clearTimeout(timer);
  process.exit(code ?? 1);
});
