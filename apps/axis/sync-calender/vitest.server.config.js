// Server test config (node), kept separate from the client agent's
// vitest.config.ts (jsdom, src/client-only). Two configs coexist because the
// server is plain ESM JS and the admin SPA is React/tsx with different needs.
// Plain object (no `vitest/config` import): the vitest package is hoisted for
// its binary but not symlinked into this app, so importing `vitest/config` here
// would not resolve. Run with: vitest run --config vitest.server.config.js
export default {
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js', 'src/**/*.test.js'],
    exclude: ['src/client/**', 'node_modules/**', 'legacy/**'],
  },
};
