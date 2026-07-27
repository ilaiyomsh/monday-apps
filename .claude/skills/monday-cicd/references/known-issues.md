# monday-cicd — known issues / quirks (discovered in the field)

## 2026-07-14 — skill guidance defect: `--force` ≠ "push to live" (refuted by incident forensics)

**Wrong guidance (spec 2026-07-07 + this skill's pipeline-model.md §3 until today):**
"`mapps code:push -c --force` pushes directly to the latest live version."

**Reality (verified from both live-run logs ever executed):** `code:push`
always resolves the app's LATEST version; `--force` merely bypasses the
"latest is live" guard. With a draft standing on top of live (the normal
state), a "Deploy LIVE" run pushes into the DRAFT and customers get nothing.
Discussions 2026-07-08 run → pushed 15886357 (then-latest v6);
team-people-column 2026-07-13 run → pushed 16006370 (v3 draft — never live).

**Consequence:** the pipeline's release-to-live mechanism never worked as
designed; all real releases were manual Developer Center promotes. The
deploy-live workflows are also a clobber landmine via their
`packages/shared/**` triggers (pipeline-model.md §4b).

**Fix at source:** pipeline-model.md corrected same-session (2026-07-14);
owner decided the release flow the same day: promotes BANNED as a release
mechanism, live deploys resolve the live version id at run time and push
pinned (`--force -i`). **RESOLVED 2026-07-14 (later session):** the unified
spec v2.1 (`docs/monday-cicd-spec.md` at the monorepo root) supersedes
`monday-cicd-spec-en.md` and carries the corrected model; the no-promotes
rule was settled with the second developer (Ido) — the 2026-07-13 bypass
loop is closed.

## 2026-07-08 — pnpm workspace: dual vitest majors break jest-dom matchers

**Symptom:** tests that pass in an app's standalone directory fail in the
monorepo with `Error: Invalid Chai property: toBeInTheDocument` — only in
files using jest-dom matchers.

**Root cause:** the workspace hosts two vitest majors (discussions: 3.x,
axis apps: 4.x). `import '@testing-library/jest-dom/vitest'` resolves
`vitest` from the *package's own* context, which in pnpm falls back to the
hoisted copy (`node_modules/.pnpm/node_modules/vitest` — the 4.x one), so
matchers are registered on the wrong `expect` instance.

**Fix (per app, in `setupTests.js`):** register matchers explicitly on the
app's own vitest:

```js
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';
expect.extend(jestDomMatchers);
```

**Lesson for onboarding/sync:** CI Gate 1 does NOT run tests — a green gate
says nothing about the suite. When syncing an app into the monorepo, run its
test suite once *inside* the monorepo before merging; dependency resolution
differs (lockfile drift + pnpm hoisting) and can break what passes locally.
Related: lockfile drift silently resolved `@vibe/core` ^4.2.5 → 4.5.2 and
`@tiptap/*` ^3.26.0 → 3.27.3, breaking render smoke tests — pinned exact
tested versions in the app's package.json as the remedy.

## 2026-07-27 — onboarding depended on the blocked Windows python3 alias

`onboard-app.sh` used three inline Python programs for package normalization,
dist detection, and workflow generation. On Windows Git Bash, `python3` resolved
to the non-executable WindowsApps alias. These steps now use Node.js, which is
already a hard dependency of every pnpm app in this monorepo. The same update
also added worktree detection and a `--no-push` mode for gated local onboarding.
The same Windows preflight found that Git for Windows ships without `rsync`, so
source copying now uses Node's recursive copy API with the original exclusions
and an explicit guard that the replacement target remains under `apps/`.
When GitHub CLI authentication is unavailable, `--no-secret` now lets the local
copy/build/commit finish while printing the exact secret that must be set before
merge; it does not silently pretend pipeline wiring is complete.
`verify-pipeline.sh --local-only` now performs the corresponding local wiring
and monday-version checks while explicitly warning which GitHub checks were
skipped; worktree detection uses `git rev-parse` instead of requiring `.git` to
be a directory.

The current pnpm also requires a root `allowBuilds` policy for native build
tools. The monorepo allows `@parcel/watcher` and `esbuild`. Do not allow
`@mondaycom/apps-cli` or `postinstall-postinstall`: the CLI's published
`patch-package` lifecycle hook fails under pnpm isolation because its
`parse-gitignore` patch target is not linked at the location the hook assumes.
The packaged `mapps` executable remains usable with that lifecycle hook blocked.
