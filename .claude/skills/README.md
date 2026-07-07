# Shared Claude Code Skills

Portable copies of the team's monday.com development skills. They work from any
clone of this repo, on any machine — paths are derived from the skill's own
location or the repo root, never hardcoded.

| Skill | What it owns |
|---|---|
| `mapps` | Deploy/ship procedure, tunnels, logs, versions, manifest, `mapps-api.sh` (the canonical API-call helper) |
| `monday-api` | API correctness: GraphQL, column formats, pagination, webhooks, typed codegen, `/monday-api check` |
| `monday-ops` | Workspace/board provisioning, seeding, schema validation |
| `monday-scaffold` | New client-side app skeletons (React 18 + Vite + Vibe, RTL-first) |
| `integration-scaffold` | New integration app skeletons (triggers/actions/custom fields) |
| `monday-cicd` | THIS repo's pipeline: onboarding apps, verifying wiring, releasing to customers |
| `test-guard` | Testing standard: tests must be seen failing; mutation-proven retrofits |
| `error-guard` | Error-catching standard: no silent catches; templates + rule kit |
| `add-to-status-hub` | Wiring an app into the multi-app status hub / Axiom observability |
| `axiom-sre` | Incident investigation across Axiom/Grafana/Pyroscope/Sentry |

## One-time setup per developer

1. Install the monday CLI and authenticate: `npm i -g @mondaycom/apps-cli && mapps init -t <your-token>`
   (personal token from monday.com → Developer → My access tokens).
2. `mapps-api.sh` reads the token from `~/.config/mapps/.mappsrc` — no token ever
   goes into the repo or the chat context.
3. `gh auth login` for PR/merge flows.

## Not included (per-machine, by design)

- **Hook wiring** (`settings.json` PreToolUse/PostToolUse/Stop entries for
  test-guard/error-guard enforcement) — configure per machine; the hook scripts
  themselves live inside the skills.
- **Secrets/env** — each app's `.env` and the `MONDAY_TOKEN` GitHub secret are
  never part of the skills.

## Ground rules carried by these skills

- Production deploys go ONLY through the pipeline (merge to `main`) — see `monday-cicd`.
- API probes/destructive tests run ONLY in the agent test workspace (`TEST_WORKSPACE_ID=16291824`), scratch objects prefixed `WZ-`.
- Platform quirks discovered while working get recorded in the owning skill's `references/` in the same session.
