# Changelog - team-people-column

## 2.1.3 — 2026-07-14

- Picker: removed the hover highlight on the assignee rows — the list stays
  visually flat (clicking a row is the only feedback).
- Settings: removed the redundant app-level heading (monday already shows the
  "<column> - … column settings" popover title) and tightened vertical spacing
  (smaller field heights, margins, and button padding; removed dead
  policy-control styles), so the pane fits with no scroll and the Save/Cancel
  row is not clipped at the bottom of monday's settings dialog.

## 2.1.2 — 2026-07-14

- Picker is now single-assignee only: one person at a time; picking another
  replaces the current one (the stored multi/single policy is ignored).
- The selected person shows as a removable chip at the top (with an ✕ to clear)
  and is dropped from the suggestions list; the redundant ✓ indicator is gone.
- Search matches any part of a name — first name OR last name ("עילי שלם"
  surfaces for both "ע" and "ש").
- Settings dialog stripped to one no-scroll box: just the two column mappings
  (board-relation + people column) and Save. Removed the sub-heading/explanations
  and the selection-mode, union/intersection, and include-listed controls — the
  policy is now fixed (single / union / directly-listed people always included).

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
