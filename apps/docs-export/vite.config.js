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
  // RELATIVE asset base. The monday CDN serves the bundle from a versioned
  // sub-path, and GitHub Pages project sites serve from /<repo>/ — a relative
  // base is the one value that works on both without knowing the prefix at
  // build time. Do NOT change this to an absolute '/' path.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
      '@services': fileURLToPath(new URL('./src/services', import.meta.url)),
      // VITE_MONDAY_MOCK=1 (pnpm dev:mock) → the whole app uses the stub.
      // Unset (tunnel / production build) → the real SDK.
      ...(process.env.VITE_MONDAY_MOCK ? { 'monday-sdk-js': mockSdkPath } : {}),
    },
  },
  server: {
    port: 8304,
    host: true,
    allowedHosts: ['.apps-tunnel.monday.app'],
  },
  build: {
    outDir: 'dist',
    // Emit sourcemaps as SEPARATE .map files WITHOUT the //# sourceMappingURL
    // comment ('hidden') so CI can archive them for stack symbolication
    // (axiom-sre scripts/symbolicate) while the browser never fetches them.
    // The deploy workflow archives + deletes dist/**/*.map before code:push and
    // hard-fails if any survive. See docs/ERROR-AXIOM-STANDARD.md.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // MUST stay a FUNCTION — Vite 8 / rolldown rejects the object form.
        // Stable vendor chunks keep a CDN cache hit across app-code changes.
        // react/react-dom ride inside the vibe chunk (vibe re-exports them, so a
        // separate react chunk comes out empty).
        manualChunks(id) {
          if (id.includes('node_modules/@vibe/')) return 'vendor-vibe';
          if (id.includes('node_modules/monday-sdk-js')) return 'vendor-monday';
          // docx / fflate / file-saver are reached ONLY through the dynamic
          // import in utils/docx/download.js — leaving them unnamed keeps them
          // in their own lazy chunk instead of on the boot path.
          return undefined;
        },
      },
    },
  },
  define: {
    global: 'globalThis',
    // Version layer (docs/monday-cicd-spec.md): package.json is the source of
    // truth; CI injects the commit SHA (draft) and the release flag (live).
    // __APP_VERSION__ also stamps remote error records (attachAxiomSink wiring).
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(process.env.VITE_BUILD_SHA ?? 'local'),
    __IS_RELEASE__: JSON.stringify(process.env.VITE_IS_RELEASE === 'true'),
  },
  test: {
    // vitest ALWAYS uses the stub — tests must run against harness fixtures.
    alias: { 'monday-sdk-js': mockSdkPath },
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    globals: true,
    css: { modules: { classNameStrategy: 'non-scoped' } },
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
});
