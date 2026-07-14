# CI/CD & Version Management Spec — monday.com apps monorepo
## Document version 2.1 — unified · 2026-07-14

**This file is the single source of truth for the pipeline.** It merges the two
v2.0 documents (`monday-cicd-spec-en.md` — CI/CD, and `version-management-en.md`
— versioning) with every owner decision taken on 2026-07-14 and the verified
lessons of the 2026-07-13/14 incidents. Where v2.0 said something this document
contradicts, **this document wins** (v2.0 predates the incident forensics).

The condensed agent-operating model derived from this spec is
`.claude/skills/monday-cicd/references/pipeline-model.md` — keep the two in
sync; on conflict, this spec wins.

---

## 1. Current State and Goals

**Team:** one developer (owner), a second developer (Ido), one non-technical
person joining. Deployment is fully automated from GitHub; nobody runs `mapps`
against production from a laptop.

**The apps (real, not the v2.0 idealization):** six apps in one pnpm monorepo —
four of them a nested system (`apps/axis/*`) sharing service packages, five
client-side (CDN) React apps and one **hybrid server app**
(`axis-sync-calender`: Express on monday-code + a Vite admin client).
`packages/shared` exists as a stub. Build output dirs differ per app (`dist` /
`build` / `public/admin`) — never assume.

---

## 2. Key Decisions (with dates — newest override oldest)

| Topic | Decision | Date |
|---|---|---|
| Repo structure | Single monorepo for all apps (`ilaiyomsh/monday-apps`) | 2026-07 |
| monday environments | One app per application, **two standing versions** (draft + live), no dev app | 2026-07 |
| Branching | `feature/*` → `develop` → `main` (Git Flow), both permanent | 2026-07 |
| Release mechanism | **Pinned-id push into the standing live version** — resolve the live id at run time, `code:push --force -i` | **2026-07-14** |
| Promotes | **BANNED as a release mechanism** (id churn, lands badly in customer accounts). Rare deliberate events only: scope/manifest changes, first-ever go-live — always followed by recreating a standing draft | **2026-07-14** (settled with Ido) |
| Version IDs | **Never stored** (not secrets, not YAML) — resolved at run time; self-heals after a sanctioned promote | **2026-07-14** (v2.0's stored-secrets approach rejected) |
| Flow model | **Accumulation** (develop accumulates, release on demand) — the corridor model is **deferred**; accumulation is bounded by the release-debt backstop (§4.3) | **2026-07-14** |
| Merge strategy | **Hybrid**: merge commits everywhere for now; IF the corridor is adopted → squash on `feature→develop`, merge commit on `develop→main` | **2026-07-14** |
| Enforcement | **Discipline only** (private repo, GitHub Free — no real branch protection). Guards report red but cannot physically block; the agent is the enforcement layer. No upgrade to Team / no public repo for now | **2026-07-14** (reaffirmed 2026-07-07) |
| Version layer | Full implementation: bump at develop entry, burn on main, guards, tags, changelog, in-app display. **Baseline: every app starts at 2.1.0** | **2026-07-14** |
| Non-technical person | Merges to `develop` freely, never to `main` | 2026-07 |
| Quality gates | Gate 1 = CI (automated) · Gate 2 = human approval on `main` (process-level, see Enforcement) | 2026-07 |

---

## 3. Monorepo Structure (real)

```
monday-apps/
├── apps/
│   ├── axis/                     # nested multi-app system
│   │   ├── planner/              # client · TS · builds to dist/
│   │   ├── tracker/              # client · JS · builds to build/
│   │   ├── day-off/              # client · TS · builds to dist/
│   │   ├── sync-calender/        # HYBRID: Express server (monday-code) + admin client → public/admin
│   │   ├── services/             # system-shared packages (@axis/app-core …)
│   │   └── docs/                 # system docs (architecture, standards, follow-ups)
│   ├── discussions/              # client · JS · builds to build/
│   └── team-people-column/       # client · JS · builds to dist/
├── packages/shared/              # cross-app shared code (stub today)
├── scripts/                      # version layer: apps.sh · bump.sh · corridor-guard.sh · release-guard.sh · release-debt.sh
├── docs/                         # THIS SPEC
├── .github/workflows/            # ci.yml · release-debt.yml · tag-release.yml · deploy-{draft,live}-<slug>.yml ×12
└── .claude/                      # checked-in agent skills + hooks (incl. release-debt nudge)
```

`scripts/apps.sh` is the single source of the app list (slug ↔ path). Adding an
app = onboard-app.sh + one entry there.

**Nested-system rules** (first consumer: Axis): each app's workflows trigger on
its own path AND on the system's `services/**` globs; `pnpm-workspace.yaml`
must carry the nested globs BEFORE first onboarding; `link:` deps become
`workspace:*` at onboarding; secret naming stays flat (`APP_AXIS_PLANNER_ID`).

---

## 4. Branch Model and Flow

```
feature/* --(PR, Gate1+guards)--> develop --(PR, Gate1+guards+Gate2)--> main
   ^ branched from develop            |                                    |
   |                                  v                                    v
   |                        auto-deploy DRAFT                 auto-deploy LIVE (pinned -i)
   |                                                                       |
   +--------------------- main merged back into develop -------------------+ (hotfix + post-release)
```

1. Every task opens `feature/*` from `develop`; the **version bump happens in
   the task branch** (§9.4).
2. PR into `develop`: Gate 1 (CI) + corridor guard. Merge → auto-deploy to the
   app's standing **draft**.
3. `develop` accumulates draft-tested changes (accumulation model).
4. Release: PR `develop` → `main`. Gate 2 (human approval) + release guard.
   **Release freeze:** while this PR is open, nothing merges into `develop`.
5. Merge to `main` → rebuild from `main` → **pinned push into the standing
   live version** → tag + GitHub release per bumped app (§9.7).
6. **Hotfix** (only downward flow): `hotfix/*` from `main`, bumps its own
   version, PR to `main` (approved), then **immediately** merge `main` back
   into `develop`.

### 4.1 Merge strategy (hybrid decision 2026-07-14)
Merge commits everywhere, for now. If the corridor model is ever adopted:
squash on `feature→develop` (clean candidate identity), merge commit on
`develop→main` (preserves the release point; `tag-release.yml` relies on
first-parent comparison).

### 4.2 Corridor model — deferred, not rejected
The corridor (one candidate at a time, `develop == main` at rest, release
within the hour) neutralizes the shared-paths landmine (§7.6) by construction.
Deferred on 2026-07-14 until the version layer produces field data. The
corridor occupancy lock is **already implemented** in `corridor-guard.sh`
behind `CORRIDOR_MODE` (default `off` — flip the env in `ci.yml` to adopt).

### 4.3 The accumulation backstop — release debt (owner decision 2026-07-14)
Accumulation has no natural brake (the #103 backlog reached 176 commits).
`scripts/release-debt.sh` counts, per app, commits on `develop` not yet on
`main`; **above 10** it emits a friendly nudge to release. It runs in BOTH
places: CI (`release-debt.yml`, every push to develop — warning annotation +
job summary) and agent sessions (checked-in PostToolUse hook after any
commit/merge command). Advisory by design — the nudge, not a block, is the
mechanism.

---

## 5. Gate 1 — CI (`ci.yml`, every PR into develop/main)

| Job | What | Blocking? |
|---|---|---|
| `guards` | corridor guard (PRs→develop) / release guard (PRs→main), full fetch depth | red = violation, but see Enforcement |
| `ci` | `pnpm -r --if-present` type-check · lint · build | yes (process-level) |
| `tests` | full workspace suites, **non-blocking visibility** (known-red baseline: tracker ×2, FOLLOW-UPS F1); test enforcement lives in the test-guard hooks | no |

**Monorepo test caveat** (known-issues, 2026-07-08): CI Gate 1 does NOT run
tests as a gate; run the app's suite inside the monorepo before merging.

## 6. Gate 2 — Human approval on `main` + Enforcement honesty

Target configuration (the 5 branch-protection rules: PR-only, 1 approval,
status checks, up-to-date, no admin bypass) **cannot be enforced today**:
private repo on GitHub Free. Owner decision (2026-07-07, reaffirmed
2026-07-14): **discipline for now** — no plan upgrade, no public repo.
Consequences:
- Gate 2 exists as process; the agent treats `main`-only-via-approved-PR as
  absolute even though GitHub won't block a violation.
- The guards (§9.5–9.6) report red but cannot physically block a merge.
- The no-promotes rule is a **team agreement, settled with Ido (2026-07-14)**
  after the 2026-07-13 Dev Center bypass incident.
- Revisit criterion: when the non-technical person joins actively.

---

## 7. Deployment (verified mechanics)

### 7.1 What `code:push` actually does (incident-verified 2026-07-14)
`mapps code:push [-c]` targets the app's **LATEST version, period**. Without
`--force` it FAILS if that version is live; `--force` only bypasses that guard
— despite the CLI help text, it does **not** seek out the live version. While
a draft exists on top of live (the normal state), an unpinned "live" push
lands in the DRAFT and never reaches customers.

### 7.2 Draft deploy (`deploy-draft-<slug>.yml`, push to develop, per-app paths)
Build (with `VITE_BUILD_SHA` injected, §9.8) → `mapps init -t "$MONDAY_TOKEN"`
→ `mapps code:push [-c] -d <outDir> -a "$APP_ID"`.
**Standing-draft precondition:** a draft version must exist on top of live or
the push fails ("The latest app version is live…"). No `app-version:create`
CLI — create via manifest round-trip (`manifest:export` → `manifest:import
-a`) or Developer Center.

### 7.3 Live deploy (`deploy-live-<slug>.yml`, push to main, same paths)
Build (with `VITE_BUILD_SHA` + `VITE_IS_RELEASE=true`) → resolve the live id at
run time (`mapps app-version:list -i "$APP_ID"`, parse the `live` row) →
`mapps code:push [-c] --force -i "$LIVE_ID" -d <outDir>`.
Fails loudly when no live version exists — **first-ever go-live is a
deliberate, separately-gated promote**, never this workflow.

### 7.4 Client vs server apps
`-c/--client-side` for CDN apps only; server-side (monday-code, e.g.
axis-sync-calender) uses the exact same pipeline **without** `-c` — the only
difference. **Red run ≠ failed deploy** on server pushes: the CLI wait-loop
can exit 1 while the remote build succeeds (~10 min); check
`mapps code:status -i <VERSION_ID>` before rerunning.

### 7.5 Promote — sanctioned uses only
Scope/manifest changes requiring a new version, and first go-live. Always:
promote → immediately recreate a standing draft (manifest round-trip) →
expect draft deploys to fail in the **post-promote dead window** between.
Detection of out-of-band promotes: `app-version:list` forensics + the
"latest version is live" draft-failure signature.

### 7.6 The shared-paths landmine (why release discipline is load-bearing)
Every deploy-live workflow also triggers on `packages/shared/**` (axis apps:
plus `apps/axis/services/**`). A merge to `main` touching those paths
rebuilds EVERY app from `main`. With pinned-id pushes the clobber modes are
gone ONLY if promotes actually stop; a stale `main` still overwrites live
content on shared-touching merges — so release freeze + immediate
main-back-merge remain mandatory.

---

## 8. Secrets

| Secret | Purpose |
|---|---|
| `MONDAY_TOKEN` | Deploy-permission token; never exposed to fork PRs; never on the non-technical person's machine |
| `APP_<NAME>_ID` (per app, flat naming) | App ID only — **no version IDs are ever stored** |

---

## 9. The Version Layer (implemented 2026-07-14)

### 9.1 The core model
| Question | Decision |
|---|---|
| When is the bump? | **At entry into `develop`** — inside the task branch, part of the PR |
| When is a number burned? | **Only when it touches `main`** (release). A develop-only number is a candidate — it may return to the workbench and keep its number |
| Manual or automatic? | Hybrid: timing fixed, magnitude human (default patch), enforcement automatic |
| Baseline | **Every app starts at 2.1.0** (owner decision 2026-07-14) |

Why bump-at-develop-entry: the number is baked into the draft build (the
tester must see the right number); content identity between develop and main
legitimizes rebuild-and-push-to-live; the release PR stays decision-free.

### 9.2 The shared language
`MAJOR.MINOR.PATCH` — whole counters, not decimal (after 2.1.9 comes 2.1.10).
- **Major** — the customer must relearn something / be notified in advance
- **Minor** — a new customer-visible capability
- **Patch** — everything else (bugs, design, wording)
- **The ten-second rule:** deliberating longer than ten seconds → it's a patch.

### 9.3 Source of truth
`apps/<path>/package.json → "version"`. Edited **only in task branches**, only
via `scripts/bump.sh <slug> [patch|minor|major]`. Everything else — tags,
display, changelog — derives from this field.

### 9.4 Changelog
Per-app `CHANGELOG.md`, entry written in the same task branch/PR as the bump;
a candidate's entry survives its fix iterations. (Historical note: five apps'
changelogs are change-tracker-generated; the version entry discipline applies
on top of that going forward.)

### 9.5 Corridor guard (`scripts/corridor-guard.sh`, PRs → develop)
Always enforced: one app per PR (or the `shared-change` label, which makes
ALL apps targets since a shared change redeploys everything); every touched
app bumped **strictly above main**; never backwards vs develop; no bump
without code changes. `CORRIDOR_MODE=on` additionally enforces the occupancy
lock (§4.2) — off today.

### 9.6 Release guard (`scripts/release-guard.sh`, PRs → main)
Consistency only: changed-since-main (incl. shared paths) ⇒ version bumped;
unchanged ⇒ version untouched; versions only increase. **No quiet fixes:**
once a number touched `main`, every change — even one character — needs a new
number. The hotfix path passes the same guard.

### 9.7 Tagging (`tag-release.yml`, push to main)
For every app whose version changed vs `HEAD^` (first parent = previous main):
tag `<slug>@<version>` + GitHub release pointing at the app's changelog.
Closed loop: tag → exact commit (`git checkout axis-planner@2.1.3`); app →
commit via the displayed SHA; "what's live right now" → the settings box (the
code reporting on itself) or the latest release record.

### 9.8 Build-time embedding
Every vite config defines `__APP_VERSION__` (package.json), `__BUILD_SHA__`
(`VITE_BUILD_SHA` from CI = the exact commit; `local` otherwise; tracker falls
back to local git hash with `-dirty`), `__IS_RELEASE__`
(`VITE_IS_RELEASE === 'true'`, set only by deploy-live). Draft workflows
inject the SHA; live workflows add the release flag.

### 9.9 The display — with one hard rule
```
live:   v2.1.0
draft:  v2.1.0 · draft · a1b2c3f
```
Small muted caption at the bottom of each app's settings UI (dir="ltr" inside
the RTL layouts), same string logged to the console at load. **In draft
builds the SHA is mandatory, not decoration:** under burn-on-main, a returning
candidate keeps its number — the first 2.1.7 and the fixed 2.1.7 are different
code with the same number; only the SHA tells them apart. The hybrid server
app logs its version at server startup instead; its admin client displays like
the rest. Axiom-wired apps stamp `version+sha` into remote log/error records.

### 9.10 Abandoning a candidate
A revert on `develop` empties the debt, the draft redeploys and realigns, and
the number is freed for later adoption. Rare; identifiable via commit SHA.

---

## 10. monday's Three Version Mechanisms (do not conflate)

1. **Promote (draft→live)** — global; BANNED as release mechanism (§7.5).
2. **Active Version ("Set as active for me")** — per-developer, manual click
   only, no CLI/API, an agent cannot do it. Mitigation: fix a single standing
   draft, set active once.
3. **Gradual Release** — expose a version to a defined account group; short
   preview cycles; requires ≥1 live version.

**MCP rule:** never for pipeline deploys (deterministic, Git-tracked,
PR-triggered only); fine for ad-hoc queries and sanctioned emergency
operations. The MCP token carries promote permission → developers only, never
the non-technical person.

---

## 11. Release Semantics (monorepo)

The release unit is the **branch state**, not an app. Routine release ships
every app changed since the last release. Selective release ("only app X"):
`hotfix/release-<app>-<date>` from `main` → cherry-pick only that app's
commits (+shared if needed) → PR to main → merge → **immediately merge main
back into develop**. Entangled commits release together or get split by a
developer — never partial-file cherry-picks. Direct push to `main` is never
the answer. Frequent selective releases are a smell: fix merge discipline,
not the release mechanism.

---

## 12. Dev-Live (tunnel to the draft) — verified 2026-07-07

Rebind the draft feature to a local dev server: `app-features:build …
--buildType custom_url --customUrl=<tunnel-url>` (long form required).
A pipeline redeploy does NOT clear the binding — detach explicitly with
`--buildType monday_code_cdn --customUrl=/` (never omit the flag; it hangs).
`verify-pipeline.sh` fails an app left pointing at a tunnel.

---

## 13. End-to-End Flow (one change, start to customer)

1. `feature/x` from `develop`.
2. Code + **`scripts/bump.sh <app>`** + changelog entry + commit.
3. PR → develop: CI + corridor guard. Merge (non-tech person may) →
   draft deploy, stamped `v2.1.4 · draft · <sha>`.
4. Test on the draft (standing active version).
5. Accumulate — the debt nudge fires above 10 unreleased commits per app.
6. PR → main (release freeze begins): CI + release guard + human approval.
7. Merge → live deploy into the pinned standing live version, stamped
   `v2.1.4` → tag `<app>@2.1.4` + GitHub release.
8. Verify: the settings box in a customer account shows the new number.

---

## 14. Status & Open Items (as of 2026-07-14)

**Done:** monorepo + 6 apps onboarded · pinned-id live deploys · promote ban
(settled with Ido) · version layer (baseline 2.1.0, bump, guards, debt
backstop, tags, SHA injection, in-app display) · release-freeze discipline ·
#103 backlog flushed.

**Open:**
- Corridor adoption — revisit with field data from the version layer (§4.2).
- Real branch protection — revisit when the non-technical person joins (§6).
- `packages/shared` is a stub — populate deliberately (shared-change label +
  all-apps bump when it happens).
- The non-technical person's Claude skill set (v2.0 §13) — spec separately.
