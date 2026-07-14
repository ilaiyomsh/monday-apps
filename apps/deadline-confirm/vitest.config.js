// Vitest picks this file over vite.config.ts (whose `root` points at the
// admin SPA dir and hides tests/ from discovery). Server tests are plain
// node — no vite plugins needed.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Server suites live in tests/; client logic retrofit tests sit next to
    // their sources under src/client/ (test-guard gate mapping convention).
    include: ['tests/**/*.test.js', 'src/client/**/*.test.ts'],
  },
});
