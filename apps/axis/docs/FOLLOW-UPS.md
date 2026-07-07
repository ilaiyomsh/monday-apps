# Axis — Follow-up Backlog

> Deferred tasks explicitly agreed with the user. None of these block the Day-off W5 cutover.
> Created 2026-06-10 (post W1/W3/W4 completion). When picking one up: open a change via the
> change-tracker skill, and if it touches the Day-off integration, follow
> `DAY-OFF-INTEGRATION-EXECUTION.md` §4 and log there too.

| # | App | Task | Context / where to start | Deferred |
|---|---|---|---|---|
| F1 | tracker | Fix the 2 pre-existing red tests in `__tests__/integration/networkErrorOnCreate.test.jsx` (toast-assertion timeouts) | Broken by pre-integration commit `dcf17e0` ("Improve column option loading and modal resilience"); flagged by 9 consecutive sessions; the ONLY red tests in the whole system (tracker 947/949). Standalone bugfix — not integration-related | user, 2026-06-10 ("save for later") |
| F2 | Services (new) | **W1.7** — extract the shared vacations-board reader module (query building, kind fallback, label-ID matching, item parsing) as a plain non-React TS package | Decision DEFERRED until after W5 cutover (user, 2026-06-10). Preferred home: a NEW sibling package, e.g. `Services/axis-dayoff-reader`, with its OWN git repo — NOT `axis-app-core` (it has no git repo and an infrastructure-only charter). Planner must first adopt the `link:` + Vite alias + `resolve.dedupe` pattern (consumes nothing from Services today). Value: prevents three-way drift of the CONTRACT.md read semantics across Day-off/Planner/tracker | user, 2026-06-10 |
| F3 | Day-off | Switch kind/approval **writes** from label text (`create_labels_if_missing`) to label ID | Reads are ID-first since W1.2; CONTRACT.md §9 records the write-side asymmetry. Flagged as follow-up since W1.2 | agent finding, endorsed in audit |
| F4 | tracker | Delete dead `SettingsWizard` leftovers: `BOARD_TEMPLATES` / `useBoardCreation` remnants | W4.6 finding — dead code the wizard no longer reaches | agent finding |
| F5 | Day-off | Repo-wide lint cleanup (12 pre-existing errors) | Pre-date the integration; deserve their own change | agent finding |
| F6 | Planner | Surface the `dayoff_misconfigured` runtime error in the Gantt UI | `GanttProvider` ignores both day-off hooks' error fields — a misconfigured board currently fails loudly only in settings validation, not at runtime read. Audit flagged as acceptance-gap candidate; most relevant at/after W5.4 | audit finding |
| F7 | Planner | Decide fate of unmerged remote branch `claude/list-prs-8Gi28` (2 docs commits: PR #8 i18n review notes) | Only unmerged branch left after the 2026-06-10 cleanup (20 merged branches deleted across all repos) | pending user call |
| F8 | tracker | At W5.5 (legacy write-path decommission): consciously retire or re-gate the legacy all-day suites that W4.8 pinned to `absenceSource='tracker'` | Part of W5.5 scope — recorded here so it isn't forgotten | plan |
| F9 | Planner | Migrate settings storage off `monday.storage.instance` (fixed key) to the global-by-instanceId standard (#17) | Long-standing standards divergence, unrelated to the integration | standards backlog |
| F10 | tracker | Add `-a 10684862` to the `deploy:push` script in `package.json` | Without it, `mapps code:push` opens an interactive app picker and fails in non-TTY runs (discovered during the 2026-06-10 deploy; pushed manually with the explicit id) | agent finding |
| F11 | tracker+Planner (Axiom) | **Severity-gated user-contact channel** — for SEVERE errors only, an explicit path to identify and follow up with the affected user | User requirement (2026-07-02): "we'll attach to severe errors an option to send personal details so we can get back to and update the user." Two candidate designs when picked up: (a) triage-time lookup — ship only `acc`/`usr` ids (already in the envelope today) and resolve name/email via monday API `users(ids:)` when handling the incident (zero PII in Axiom, preferred per the id-over-name standard); (b) severity+allowlist exception in the transport sanitizer that lets an explicit `contact_email`-style field through on ERROR-level events only (requires amending the unconditional PII drop + plan revision + PII-retention note in the runbook). Decide (a) vs (b) in its own change; do NOT weaken the sanitizer as a side effect of other work | user, 2026-07-02 |

## Decisions recorded 2026-06-10 (for context)

- **`dayOffApprovalRequired` default = OFF** in both Planner and tracker (matches shipped code:
  `useMondaySettings.ts:63` / `SettingsContext.jsx:129` both `false`). Policy is flipped
  per-deployment in each app's settings dialog (D2).
- **Vacations-board permissions posture: view-all / edit-own** — every consumer user can VIEW all
  items (required: general items have no person column; Day-off Team Gantt; Planner capacity math),
  item EDITING restricted to own items, managers edit all. Set on the monday board itself (not in
  the apps) during W5.1 mapping, per `Day-off/CONTRACT.md` §8.
- **W1.7 deferred** — see F2.

## Onboarding debt (2026-07-07)
- **planner**: `lint` stubbed in the monorepo copy — 268 pre-existing eslint errors (mostly `no-explicit-any`). Re-enable `eslint .` after a cleanup pass.
- **sync-calender**: new app 11666315 created at onboarding (old 11119011 was stale). Server env vars (MONDAY_SIGNING_SECRET, Google/Microsoft OAuth, Axiom keys) are NOT in the repo — set them once via `mapps code:env -i 11666315` before first real run. Feature setup (views/webhooks) still needs Developer Center configuration.
