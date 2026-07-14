# Changelog - team-people-column

## 2.1.1 — 2026-07-14

- On-click dialog: skeleton-first loading. The dialog holds a skeleton
  (title-row + search-box shapes) from first paint until the settings read and
  the allowed-set resolve chain are both resolved, then reveals the real title
  (avatar + name) and search input together in one shot — no more live search
  box sitting next to still-missing team details (read as incomplete UI).

## 2.1.0 — 2026-07-14

- Version-layer baseline (docs/monday-cicd-spec.md): all monorepo apps started
  at 2.1.0 (owner decision 2026-07-14). Version + build SHA are now injected at
  build time and displayed in the column settings UI.
- Prior history predates the version layer — see git log and the change-tracker
  records for this app.
