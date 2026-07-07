import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// monday client-side apps are served from a CDN sub-path → relative base.
export default defineConfig({
  base: './',
  plugins: [react()],
  // @axis/app-core is consumed as source via `link:` and carries its own
  // node_modules copy of react/react-dom. Without dedupe, vite bundles two React
  // instances → "Invalid hook call" the moment an app-core component (e.g.
  // MondayProvider) calls a hook. Force a single copy from this project's root.
  resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'] },
  build: { outDir: 'dist' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
  },
});
