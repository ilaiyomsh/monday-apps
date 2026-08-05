# Package-manager compatibility

## 2026-07-27 — monday CLI postinstall is incompatible with pnpm isolation

**Observed:** allowing `@mondaycom/apps-cli` and `postinstall-postinstall` in a
fresh pnpm install executes the CLI package's bundled `patch-package` hook. The
hook then fails with `Patch file found for package parse-gitignore which is not
present at node_modules/parse-gitignore` under pnpm's isolated dependency
layout. The packaged CLI executable does not require that lifecycle hook to run.

**Resolution:** standalone scaffolds allow only `esbuild`. Keep the monday CLI
and `postinstall-postinstall` lifecycle scripts blocked; do not approve them in
`allowBuilds`. The monorepo additionally allows its existing native
`@parcel/watcher` build.

**Verification:** a fresh frozen install must complete, `pnpm exec mapps
--version` must start, and `pnpm test` plus `pnpm build` must pass before the
scaffold is accepted.
