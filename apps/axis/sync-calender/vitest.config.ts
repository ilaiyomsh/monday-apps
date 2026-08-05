import path from 'node:path';

// Client-only test config (scoped to src/client). The server is plain ESM JS with no
// vitest suite, so `include` deliberately never reaches src/routes, src/services, etc.
// Kept separate from vite.config.ts so `vite build` is untouched, and placed at the app
// root only so the nearest-package-json runner resolution (test-guard's redgreen.sh) works.
//
// A plain object (no defineConfig) — this app's client bundle cannot resolve 'vitest/config'
// from the workspace, and vitest reads the `test` field either way.
export default {
  test: {
    include: ['src/client/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    globals: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src/client/admin') },
  },
};
