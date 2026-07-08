import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
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
    rollupOptions: {
      output: {
        // vite 8 / rolldown expects a function (object form is rejected)
        manualChunks(id) {
          if (id.includes('node_modules/@vibe/')) return 'vibe';
          if (id.includes('node_modules/recharts')) return 'charts';
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
