import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Dev harness: a monday-sdk-js stub with realistic fixtures so the app renders
// OUTSIDE the monday iframe (pnpm dev:mock) and tests never hit the live API.
// See src/dev-harness/README.md.
const mockSdkPath = fileURLToPath(new URL('./src/dev-harness/monday-sdk-stub.js', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // VITE_MONDAY_MOCK=1 (pnpm dev:mock) ג†’ the whole app uses the stub.
    // Unset (tunnel / production build) ג†’ the real SDK.
    alias: process.env.VITE_MONDAY_MOCK ? { 'monday-sdk-js': mockSdkPath } : {},
  },
  server: {
    port: 8303,
    host: true,
    allowedHosts: ['.apps-tunnel.monday.app'],
    proxy: {
      '/api': 'http://localhost:8080',
      '/oauth': 'http://localhost:8080',
      '/webhooks': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  define: {
    global: 'globalThis',
    // Version stamp for remote error records (utils/axiomErrorSink.js ג†’ `ver` field).
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(process.env.VITE_BUILD_SHA ?? 'local'),
    __IS_RELEASE__: JSON.stringify(process.env.VITE_IS_RELEASE === 'true'),
  },
  test: {
    // vitest ALWAYS uses the stub ג€” tests must run against harness fixtures.
    alias: { 'monday-sdk-js': mockSdkPath },
    environment: 'jsdom',
  },
});

