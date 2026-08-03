// Deploy bundle — the ONE reason this exists: the guard validates with the
// CLIENT's own domain modules (../src/domain/*), one source of truth for the
// rules, but `mapps code:push` archives only THIS directory. Bundling resolves
// those ../ imports at build time so the pushed artifact is self-contained —
// no vendored copies, no drift tests. npm packages (express, apps-sdk, jwt)
// stay external: the platform installs them from package.json.
//
// The monday-code buildpack re-runs `npm run build` INSIDE the deployed
// workspace (incident-verified, mapps cli.md) — where ../src/domain does not
// exist because the archive holds only server/. There the ALREADY-BUNDLED
// dist/index.js is the artifact, so this script skips instead of failing.
import { existsSync } from 'node:fs';
import { build } from 'esbuild';

const clientDomainPresent = existsSync(new URL('../src/domain/buildAvailableLabels.js', import.meta.url));

if (!clientDomainPresent) {
  if (!existsSync(new URL('./dist/index.js', import.meta.url))) {
    console.error('guard build: client domain sources absent AND no prebuilt dist/index.js — refusing to produce an empty deploy');
    process.exit(1);
  }
  console.log('guard build: deployed workspace detected (no client sources) — keeping the shipped dist/index.js');
  process.exit(0);
}

await build({
  entryPoints: ['src/index.js'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: false,
  banner: {
    // esbuild's ESM output can still emit require() for externals' interop.
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log('guard bundle written to dist/index.js');
