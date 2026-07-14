import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const useMock = process.env.VITE_MOCK === '1';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/client/admin'),
  base: '/admin/',
  define: {
    // @vibe/core pulls in react-dates → global-cache which expects Node's
    // `global`. Harmless in prod (Vite tree-shakes react-dates for unused
    // components) but dev pre-bundles everything, so we need the shim here.
    global: 'globalThis',
    // Version layer (docs/monday-cicd-spec.md): package.json is the source of
    // truth; CI injects the commit SHA (draft) and the release flag (live).
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(process.env.VITE_BUILD_SHA ?? 'local'),
    __IS_RELEASE__: JSON.stringify(process.env.VITE_IS_RELEASE === 'true'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/client/admin'),
      ...(useMock
        ? {
            'monday-sdk-js': path.resolve(
              __dirname,
              'src/client/admin/_mock/monday-sdk-mock.ts'
            ),
          }
        : {}),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'public/admin'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/oauth': 'http://localhost:8080',
      '/auth': 'http://localhost:8080',
    },
  },
});
