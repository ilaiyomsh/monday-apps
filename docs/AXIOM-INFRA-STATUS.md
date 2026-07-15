# Axiom Infrastructure — Status Report

**Date:** 2026-07-15
**Scope:** State of Axiom / error-shipping infrastructure across the monorepo, and
readiness for implementation. Status report only — no code changes made.

---

## TL;DR

The hardened Axiom transport already landed on `develop`, but **nothing is wired to
it** — and the old naive shipping path is still live in `logger.ts`. The work that
connects the pipeline end-to-end is stuck on a stale branch
(`claude/axiom-app-integration-olzagb`, **225 commits behind `develop`**) that no
longer merges cleanly. The Axiom-side setup (`app-errors` dataset + ingest token) is
confirmed ready by the owner. The only remaining blocker is code.

---

## Architecture (fixed decisions — not re-litigated)

- **One shared dataset `app-errors`** for the whole portfolio, discriminated by an
  `app` field. Client apps ship browser → `api.axiom.co` directly (the Tracker model).
- **Ingest-only token**, baked into the client bundle (accepted risk — append-only to
  `app-errors`; revoke/rotate runbook in `error-guard/references/remote-monitoring.md`).
- **Dashboards + ad-hoc `axiom-sre` queries only** — no alerting for now.
- Authority on the pattern is the **`error-guard` skill**; the full-observability
  status-hub track (per-app `<slug>-prod` datasets) stays in **`add-to-status-hub`**.

---

## What already landed on `develop`

| Component | State |
|---|---|
| `axiomTransport.ts` — hardened transport (batching, sanitizer/allowlist, circuit breaker, dedup, session cap, keepalive) | ✅ present, exported from `@axis/app-core` |
| `.claude/hooks/error-guard-check.sh` — enforcement hook | ✅ present and registered |

## What is stuck only on the branch (missing from `develop`)

Branch `claude/axiom-app-integration-olzagb` — 2 commits, **225 behind `develop`**:

| Component | On `develop` | What the branch adds |
|---|---|---|
| `errors/axiomSink.ts` — logger→transport bridge | ❌ missing | ✅ 248 lines + 172 lines of tests |
| `logger.ts` naive path (`shipAxiom` raw per-record `fetch`) | ⚠️ **still present** — no batching/breaker, serializes full record (privacy leak) | removes it, routes through the sink |
| CI injection of `VITE_AXIOM_TOKEN` in deploy workflows | ❌ none in any workflow | adds to tracker + day-off only |
| `docs/ERROR-AXIOM-STANDARD.md` | ❌ missing | ✅ the full standard |
| day-off wired to `attachAxiomSink` | ❌ | ✅ |

**Net effect on `develop` today:** the hardened transport exists but **nothing is
connected to it**, while the inferior naive path is still the live one in the logger.
Two shipping mechanisms coexist and the better one is orphaned.

---

## Per-app coverage

| App | Catch | Ship | State |
|---|---|---|---|
| **tracker** | ✅ full (boundary + global + UI sink) | ✅ hardened transport | verify dataset cutover to `app-errors` |
| **day-off** | ✅ app-core | ⚠️ branch moves to sink; on `develop` still naive | waiting on branch merge |
| **discussions** | ✅ matches model | ❌ no shipping (sink-ready) | add sink |
| **planner** | ❌ no boundary/global; bare console logger | ❌ | full retrofit |
| **sync-calender** | ⚠️ per-route try/catch; SIGTERM guards only | ✅ server SDK (own dataset) | process guards + move to `app-errors` |

---

## Two problems to know about

1. **The enforcement hook currently fails open.** `check.sh`/`audit.sh` were written
   for ESLint 8 (`--no-eslintrc --config <json>`); the apps run **ESLint 9 flat
   config**. The hook is installed and quiet — but **blocks nothing**. A quiet hook
   here is not "compliant." Fixing it is a follow-up in its own right (port to flat
   config + install kit plugins per app).

2. **The branch is stale and conflicting.** All four core files it touches
   (`logger.ts`, `day-off/core.ts`, `day-off/main.tsx`, `MondayContext.tsx`) have each
   been changed on `develop` since the branch base. A direct merge/cherry-pick is not
   safe — it needs a rebase with manual conflict resolution.

---

## Readiness verdict

**Ready to implement — the only remaining blocker is code.** The owner confirmed the
`app-errors` dataset and ingest token exist in Axiom. Verify one gate before anything
reaches prod: the GitHub secret **`AXIOM_INGEST_TOKEN`** must exist (without it the
build gate stays inert — fail-soft, does not break the build).

## Recommended sequencing

1. **Immediate — revive the sink work on a fresh branch off `develop`:** rebase the
   two commits, resolve the conflicts, land `axiomSink.ts` + tests, remove the naive
   `shipAxiom` path, wire day-off and tracker. This closes the most dangerous gap
   (orphaned transport + live privacy-leaking path).
2. **One gate before prod:** confirm the `AXIOM_INGEST_TOKEN` GitHub secret is set.
3. **Separate follow-up — fix the hook for ESLint 9**, otherwise enforcement is an
   illusion.
4. **Per-app retrofit rounds (one app per branch), following `/error-guard retrofit`:**
   discussions sink → planner full stack → sync-calender server hardening + shared
   dataset → tracker dataset cutover verification.

---

*Sources: `error-guard/references/remote-monitoring.md`, `add-to-status-hub` skill,
branch `claude/axiom-app-integration-olzagb` (`docs/ERROR-AXIOM-STANDARD.md`), and a
diff of that branch against current `develop`.*
