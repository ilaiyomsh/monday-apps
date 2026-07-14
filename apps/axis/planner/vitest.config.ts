import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-utils/setup.ts'],
    css: false,
  },
  define: {
    global: 'globalThis',
    // Mirror vite.config.ts's build-time version constants so modules that read
    // them (src/utils/versionLabel.ts, imported transitively by SettingsDialog)
    // don't throw "__IS_RELEASE__ is not defined" under vitest, which has no
    // vite `define` pass. Test-env literals — the real values are injected at build.
    __APP_VERSION__: JSON.stringify('test'),
    __BUILD_SHA__: JSON.stringify('test'),
    __IS_RELEASE__: JSON.stringify(false),
  },
});
