import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const rootDir = dirname(fileURLToPath(import.meta.url));

// Dev harness: a monday-sdk-js stub with realistic fixtures so the app renders
// OUTSIDE the monday iframe (pnpm dev:mock) and tests never hit the live API.
const mockSdkPath = fileURLToPath(new URL('./src/dev-harness/monday-sdk-stub.js', import.meta.url));

function copySpaFallbacks() {
  return {
    name: 'copy-spa-route-fallbacks',
    closeBundle() {
      const distIndex = join(rootDir, 'dist', 'index.html');
      for (const route of ['picker', 'settings', 'settings-full']) {
        const targetDir = join(rootDir, 'dist', route);
        mkdirSync(targetDir, { recursive: true });
        copyFileSync(distIndex, join(targetDir, 'index.html'));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copySpaFallbacks()],
  resolve: {
    alias: process.env.VITE_MONDAY_MOCK ? { 'monday-sdk-js': mockSdkPath } : {},
  },
  server: {
    port: 8303,
    host: true,
    allowedHosts: ['.apps-tunnel.monday.app'],
  },
  preview: {
    port: 8303,
  },
  appType: 'spa',
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
  },
  define: {
    global: 'globalThis',
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(process.env.VITE_BUILD_SHA ?? 'local'),
    __IS_RELEASE__: JSON.stringify(process.env.VITE_IS_RELEASE === 'true'),
  },
  test: {
    alias: { 'monday-sdk-js': mockSdkPath },
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    passWithNoTests: true,
  },
});
