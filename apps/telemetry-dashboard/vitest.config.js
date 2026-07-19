// Vitest config for the SERVER-side test suite. The app's vite.config.ts sets
// root to src/client for the dashboard bundle, which would make vitest look
// for tests there — this file overrides that so tests in test/ are found.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
