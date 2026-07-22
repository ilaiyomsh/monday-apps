import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// @axis/app-core is consumed as TypeScript source (standard #17). Alias the bare
// specifier straight to its src barrel so Vite/Vitest transform it, and dedupe
// react/react-dom so app-core's own copy never produces a second React instance
// ("Invalid hook call"). Tracker currently uses only app-core's plain storage
// helpers (no app-core hooks/components), but the dedupe is a cheap safety net for
// any future provider consumption.
const APP_CORE_SRC = fileURLToPath(new URL('../services/app-core/src/index.ts', import.meta.url));

// Build SHA stamped into the bundle (__BUILD_SHA__). CI injects VITE_BUILD_SHA
// (the exact commit); local builds fall back to the git short hash, with a
// -dirty suffix when the tree has uncommitted changes, so a canary build is
// distinguishable from the commit it claims to be.
// (Version layer 2026-07-14: __APP_VERSION__ is now the package.json semver —
// the hash that used to live there moved here. Axiom rows carry both.)
function resolveBuildSha() {
  if (process.env.VITE_BUILD_SHA) return process.env.VITE_BUILD_SHA;
  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() ? '-dirty' : '';
    return `${hash}${dirty}`;
  } catch {
    return 'local'; // git unavailable
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
      // Version layer (docs/monday-cicd-spec.md): package.json is the source
      // of truth; CI injects the commit SHA (draft) and the release flag (live).
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_SHA__: JSON.stringify(resolveBuildSha()),
      __IS_RELEASE__: JSON.stringify(process.env.VITE_IS_RELEASE === 'true'),
    },
    build: {
      // Emit sourcemaps as SEPARATE .map files WITHOUT the //# sourceMappingURL
      // comment ('hidden') so CI can archive them for stack symbolication
      // (axiom-sre scripts/symbolicate) while the browser never fetches them.
      // The deploy workflow archives + deletes build/**/*.map before code:push.
      // See docs/LOGGING-ARCHITECTURE.md §6.
      sourcemap: 'hidden',
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
