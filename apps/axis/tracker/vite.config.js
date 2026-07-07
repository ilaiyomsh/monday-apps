import { execSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// @axis/app-core is consumed as TypeScript source (standard #17). Alias the bare
// specifier straight to its src barrel so Vite/Vitest transform it, and dedupe
// react/react-dom so app-core's own copy never produces a second React instance
// ("Invalid hook call"). Tracker currently uses only app-core's plain storage
// helpers (no app-core hooks/components), but the dedupe is a cheap safety net for
// any future provider consumption.
const APP_CORE_SRC = fileURLToPath(new URL('../services/app-core/src/index.ts', import.meta.url));

// Version stamped into Axiom log rows (__APP_VERSION__): git short hash, with a
// -dirty suffix when the tree has uncommitted changes, so a canary build is
// distinguishable from the commit it claims to be. package.json version as fallback.
function resolveAppVersion() {
  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() ? '-dirty' : '';
    return `${hash}${dirty}`;
  } catch {
    return '0.0.1'; // git unavailable — package.json version
  }
}

export default defineConfig(({ command, mode }) => {
  // Warning, not failure: a production build without the Axiom vars is valid
  // (ships no logs) — but it must never happen silently.
  if (command === 'build' && mode === 'production') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    if (!env.VITE_AXIOM_DATASET || !env.VITE_AXIOM_TOKEN) {
      console.warn('[build] VITE_AXIOM_DATASET/VITE_AXIOM_TOKEN missing — this production build will NOT ship logs to Axiom');
    }
  }
  return {
    define: {
      __APP_VERSION__: JSON.stringify(resolveAppVersion()),
    },
    build: {
      outDir: 'build',
      rollupOptions: {
        output: {
          manualChunks: {
            'calendar': ['react-big-calendar', 'date-fns'],
            'vibe': ['@vibe/core', '@vibe/icons'],
            'charts': ['recharts'],
            'excel': ['exceljs'],
          }
        }
      }
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@axis/app-core': APP_CORE_SRC,
      },
    },
    plugins: [react()],
    server: {
      port: 8301,
      allowedHosts: ['.apps-tunnel.monday.app']
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.js'],
      globals: true,
      css: { modules: { classNameStrategy: 'non-scoped' } },
      // Transform @axis/app-core TS source rather than externalizing it.
      server: { deps: { inline: [/@axis[\\/]app-core/] } }
    }
  };
});
