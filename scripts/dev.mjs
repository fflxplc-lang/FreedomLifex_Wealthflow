// Runs the API (port 5000) and the Vite dev server (port 5173) together.
import { spawn } from 'node:child_process';

const run = (name, args) => {
  const p = spawn('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  p.on('exit', (code) => { console.log(`${name} exited (${code})`); process.exit(code ?? 0); });
  return p;
};
const procs = [run('server', ['--prefix', 'server', 'run', 'dev']), run('client', ['--prefix', 'client', 'run', 'dev'])];
process.on('SIGINT', () => { procs.forEach((p) => p.kill()); process.exit(0); });
