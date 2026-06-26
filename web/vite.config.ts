import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Consume the shared contract straight from source (no build step).
      '@arenaze/shared': resolve(repoRoot, 'shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    // Allow Vite to read files outside web/ (notably ../shared/src/*).
    fs: { allow: [repoRoot] },
    // Backup for VITE_API_BASE: proxy /api straight to the Fastify server.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
