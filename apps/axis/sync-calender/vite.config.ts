import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

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
