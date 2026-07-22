import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  // Version layer (docs/monday-cicd-spec.md): package.json is the source of
  // truth; CI injects the commit SHA (draft) and the release flag (live).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(process.env.VITE_BUILD_SHA ?? 'local'),
    __IS_RELEASE__: JSON.stringify(process.env.VITE_IS_RELEASE === 'true'),
  },
  resolve: {
    alias: {
      // App source root (formerly the Vibe export; now owned code)
      '@generated': fileURLToPath(new URL('./src', import.meta.url)),
      // UI components (temporary shadcn stand-ins under ui/, migrating to @vibe/core)
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
      // monday board SDK layer (real monday-sdk-js)
      '@api': fileURLToPath(new URL('./src/utils/mondayApi', import.meta.url)),
    },
  },
  build: {
    outDir: 'build',
    // Emit sourcemaps as SEPARATE .map files WITHOUT the //# sourceMappingURL
    // comment ('hidden'). This lets CI archive the maps as a build artifact for
    // stack symbolication (axiom-sre `scripts/symbolicate`) WITHOUT the browser
    // ever fetching them. The maps must NOT reach the CDN — the deploy workflow
    // uploads them as an artifact and deletes build/**/*.map before code:push.
    // See docs/LOGGING-ARCHITECTURE.md §6.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // vite 8 / rolldown expects a function (object form is rejected)
        manualChunks(id) {
          if (id.includes('node_modules/@vibe/')) return 'vibe';
          // round135 — the old `recharts -> 'charts'` manual chunk is GONE:
          // pinning recharts manually fused shared vendor modules (a React
          // CJS copy among them) into that chunk, which made the boot bundle
          // statically import the whole ~360KB chunk even after
          // EffectivenessTab went lazy. With no pin, the bundler splits
          // recharts on the dynamic-import boundary by itself, so the charts
          // code loads only when the effectiveness tab is first opened.
          if (id.includes('node_modules/@dnd-kit')) return 'dnd';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5180,
    allowedHosts: ['.apps-tunnel.monday.app'],
    proxy: {
      '/11457413-f9abf86ef07f.apps-tunnel.monday.app': {
        target: 'https://11457413-f9abf86ef07f.apps-tunnel.monday.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/11457413-f9abf86ef07f.apps-tunnel.monday.app/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    globals: true,
    css: { modules: { classNameStrategy: 'non-scoped' } },
    // Don't scan stale git worktrees under .claude/worktrees — they hold old
    // copies of test files that resolve `@generated` back to THIS src, so they
    // fail spuriously after a refactor. They are not part of this project's suite.
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.claude/**'],
  },
});
