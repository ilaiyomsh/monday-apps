# monday-apps — Monorepo Rules

All monday.com client-side apps live here, wired to one CI/CD pipeline.
Full model + onboarding procedures: the `monday-cicd` skill in
`.claude/skills/monday-cicd/` in this repo.

## Branch rules (non-negotiable)

- `feature/*` branches from `develop`; PR back into `develop` (CI must pass).
- `main` is merged ONLY via an approved PR from `develop`. Never push to `main`.
- **Release freeze:** while a `develop` → `main` PR is open, nothing merges
  into `develop`. Merge or close the release PR first.
- Hotfix: `hotfix/*` from `main` → approved PR to `main` → immediately merge
  `main` back into `develop`.
- `develop` and `main` are permanent — never delete or close them.

## Deploy rules

- Deploys happen ONLY on GitHub Actions runners, triggered by merges:
  merge to `develop` → app's **latest draft** version;
  merge to `main` → **force deploy to latest live** (production).
- Never run `mapps code:push --force` from a laptop. Never.
- No version IDs anywhere — only `APP_<NAME>_ID` secrets. The CLI resolves
  the latest draft/live itself.
- `MONDAY_TOKEN` lives in GitHub Secrets only. Never print or commit it.

## Structure

- `apps/<name>/` — one app per directory, its own App ID, its own README.
- `packages/shared/` — code shared across apps. A change here affects EVERY
  app that imports it; CI builds all apps on every PR for exactly this reason.
- Per-app deploy workflows: `.github/workflows/deploy-{draft,live}-<name>.yml`.
