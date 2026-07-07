import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
