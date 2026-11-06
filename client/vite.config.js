import fs from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH (e.g. /wealthflow) runs the app under a folder of an existing domain. It is read from
// the environment or from server/.env, so one setting covers both the server and this build.
function basePath() {
  let v = process.env.BASE_PATH;
  if (v === undefined) {
    try { v = fs.readFileSync(new URL('../server/.env', import.meta.url), 'utf8').match(/^BASE_PATH=(.*)$/m)?.[1]; } catch { /* no .env */ }
  }
  v = (v || '').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
  return v && !v.startsWith('/') ? `/${v}` : v;
}

export default defineConfig({
  base: `${basePath()}/`,
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:5000' } },
});
