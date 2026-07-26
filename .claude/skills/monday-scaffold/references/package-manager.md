# Package-manager compatibility

## 2026-07-27 — pnpm blocks required build scripts in a fresh standalone scaffold

**Observed:** a fresh scaffold on current pnpm downloaded dependencies but ended
with `ERR_PNPM_IGNORED_BUILDS` for `@mondaycom/apps-cli`, `esbuild`, and
`postinstall-postinstall`. pnpm generated a `pnpm-workspace.yaml` containing
unresolved `allowBuilds` prompts, and Vitest could not start because the install
was incomplete.

**Resolution:** standalone scaffolds include `pnpm-workspace.yaml` with those
three package names explicitly allowed. This is package-name scoped; it does not
enable arbitrary dependency scripts.

**Verification:** `pnpm install`, `pnpm test`, and `pnpm build` must all complete
on the generated project before the scaffold is accepted.
