import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// The dashboard is served from the app ROOT (/), not /admin — it is the whole
// app, not a settings panel. base '/' + outDir public/ matches the server's
// express.static mount in src/app.js.
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/client'),
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(process.env.VITE_BUILD_SHA ?? 'local'),
    __IS_RELEASE__: JSON.stringify(process.env.VITE_IS_RELEASE === 'true'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/client'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'public'),
    emptyOutDir: true,
    // Emit the CLIENT bundle's sourcemaps as SEPARATE .map files WITHOUT the
    // //# sourceMappingURL comment ('hidden'). The deploy workflow archives +
    // deletes public/**/*.map before code:push, so client source is never served
    // (this also fixes the prior sourcemap:true public leak). Maps are kept as a
    // CI artifact for stack symbolication if client telemetry is enabled. Server
    // code runs from source (already readable). See docs/LOGGING-ARCHITECTURE.md §6.
    sourcemap: 'hidden',
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
