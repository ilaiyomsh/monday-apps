import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 8301,
    strictPort: true,
    host: true,
    allowedHosts: [".monday.app", ".apps-tunnel.monday.app"],
  },
  define: {
    global: 'globalThis',
    // Version layer (docs/monday-cicd-spec.md): package.json is the source of
    // truth; CI injects the commit SHA (draft) and the release flag (live).
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(process.env.VITE_BUILD_SHA ?? 'local'),
    __IS_RELEASE__: JSON.stringify(process.env.VITE_IS_RELEASE === 'true'),
  },
  build: {
    outDir: 'dist',
    // The app runs only inside the monday iframe (modern Chrome), so skip
    // legacy transpilation — smaller output + faster parse on boot.
    target: 'esnext',
    rollupOptions: {
      output: {
        // Carve the stable React runtime into its own chunk so app-code
        // redeploys don't invalidate it (cross-deploy browser caching).
        // Scoped to react/react-dom/scheduler ONLY — must NOT pull in @vibe/core
        // or its date-picker deps (downshift/react-day-picker/popper), which
        // stay in the async DatePicker chunk (see #92).
        manualChunks(id) {
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'react-vendor';
          }
        },
      },
    },
  },
})
