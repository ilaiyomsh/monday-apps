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
    // VITE_MONDAY_MOCK=1 (pnpm dev:mock) → the whole app uses the stub.
    // Unset (tunnel / production build) → the real SDK.
    alias: process.env.VITE_MONDAY_MOCK ? { 'monday-sdk-js': mockSdkPath } : {},
  },
  server: {
    port: 8302,
    host: true,
    allowedHosts: ['.apps-tunnel.monday.app'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Stable vendor chunks: the dialog iframe reloads on every cell click,
        // so splitting react/vibe/sdk into content-hashed chunks lets the
        // browser HTTP-cache them across opens — only the (small) app chunk
        // re-parses. Also keeps any app-code change from invalidating the
        // (much larger) vendor bytes on the CDN.
        // react/react-dom ride inside vendor-vibe (vibe re-exports them, so a
        // separate react chunk comes out empty).
        manualChunks: {
          'vendor-vibe': ['react', 'react-dom', '@vibe/core', '@vibe/icons'],
          'vendor-monday': ['monday-sdk-js'],
        },
      },
    },
  },
  define: {
    global: 'globalThis',
    // Version layer (docs/monday-cicd-spec.md): package.json is the source of
    // truth; CI injects the commit SHA (draft) and the release flag (live).
    // __APP_VERSION__ also stamps remote error records (utils/axiomErrorSink.js).
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(process.env.VITE_BUILD_SHA ?? 'local'),
    __IS_RELEASE__: JSON.stringify(process.env.VITE_IS_RELEASE === 'true'),
  },
  test: {
    // vitest ALWAYS uses the stub — tests must run against harness fixtures.
    alias: { 'monday-sdk-js': mockSdkPath },
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    // Scaffold ships no test files; keep `pnpm test` green until real tests land
    // (added in the app copy — template-shipped `vitest run` otherwise exits 1).
    passWithNoTests: true,
  },
});
