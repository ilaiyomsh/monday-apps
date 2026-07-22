import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// monday client-side apps are served from a CDN sub-path → relative base.
export default defineConfig({
  base: './',
  plugins: [react()],
  // Version layer (docs/monday-cicd-spec.md): package.json is the source of
  // truth; CI injects the commit SHA (draft) and the release flag (live).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(process.env.VITE_BUILD_SHA ?? 'local'),
    __IS_RELEASE__: JSON.stringify(process.env.VITE_IS_RELEASE === 'true'),
  },
  // @axis/app-core is consumed as source via `link:` and carries its own
  // node_modules copy of react/react-dom. Without dedupe, vite bundles two React
  // instances → "Invalid hook call" the moment an app-core component (e.g.
  // MondayProvider) calls a hook. Force a single copy from this project's root.
  resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'] },
  build: {
    // Emit sourcemaps as SEPARATE .map files WITHOUT the //# sourceMappingURL
    // comment ('hidden') so CI can archive them for stack symbolication
    // (axiom-sre scripts/symbolicate) while the browser never fetches them.
    // The deploy workflow archives + deletes dist/**/*.map before code:push.
    // See docs/LOGGING-ARCHITECTURE.md §6.
    sourcemap: 'hidden',
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
  },
});
