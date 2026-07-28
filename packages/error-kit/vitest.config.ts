import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    /*
     * QUARANTINED ON `main` ONLY — remove this whole `exclude` block, and nothing else,
     * once the next full develop→main release lands.
     *
     * Both files are intact and correct. They are inert here because they reach for
     * repo-level things that this branch does not carry: error-kit arrived on main via
     * the twyst-your-status 3.6.0 hotfix release, ahead of the apps and the root script
     * these two suites audit.
     *
     *  - drift.test.ts        static-imports the VENDORED error-kit copies from
     *                         apps/telemetry-dashboard (no such app on main) and
     *                         apps/axis/sync-calender (on main, but predating the
     *                         vendoring). A static import that cannot resolve fails
     *                         COLLECTION — the file never runs, so it cannot be skipped
     *                         from inside.
     *  - audit-script.test.ts shells out to scripts/error-wiring-audit.mjs, which is not
     *                         on main yet.
     *
     * Excluding them removes no coverage from main: error-kit itself was not on main
     * before this release, so neither suite has ever run here. The other 8 files (118
     * tests) do run and pass. Deleting them instead would have made develop's copies
     * conflict on the next release; this way the reason travels with the code.
     */
    exclude: [
      '**/node_modules/**',
      'test/drift.test.ts',
      'test/audit-script.test.ts',
    ],
  },
});
