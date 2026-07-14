# mapps — known issues / quirks (skill's own tooling)

## 2026-07-14 — deploy-guard hook blocked `mapps code:push --help` (false positive)

**Symptom:** the PreToolUse deploy-guard blocked a pure help query
(`mapps code:push --help`) with the ship.sh redirect message. A help query
executes nothing — blocking it only forces awkward workarounds.

**Fix (same session, at source):** `deploy-guard.sh` now allows
single-segment commands ending in `--help`/`-h` and `mapps help ...`
invocations. Multi-segment commands (anything containing `;`, `&`, `|`,
backtick or newline) are still matched by the guard, so a real push cannot
hide behind a `--help` token.

## 2026-07-14 — ship.sh assumption: "single-live-version apps" is standalone-era

`ship.sh` pushes with `--force` and no `-i`, relying on the CLI resolving
the target version. That is correct ONLY for standalone apps with a single
version. **Monorepo/pipeline apps keep a standing draft on top of live** —
there `code:push --force` resolves the LATEST version (the draft!), despite
the CLI help text claiming "Force push to live version" (incident-verified
2026-07-14, see monday-cicd/references/known-issues.md). Consequences:

- ship.sh must NOT be used for apps onboarded to the monorepo pipeline —
  releases go through the pipeline (deploy-live workflows, which resolve the
  LIVE version id at run time and push pinned with `-i`).
- If a standalone app ever grows a draft version on top of live, ship.sh
  would silently push to the draft. Remedy when in doubt:
  `mapps app-version:list -i <APP_ID>` first, and push pinned with
  `-i <LIVE_VERSION_ID>`.
