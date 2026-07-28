# Changelog

## 3.2.9

- Picker shows a monday-style shimmer skeleton (6 label-sized bars, no loading
  copy) from the first paint while context/labels load.
- Document Dialog Design size: width `200`, height `250` (fits 6 pills, no scroll).

## 3.2.8

- Settings: teams join the people picker (no separate checklist); each label
  accordion starts closed; required-columns list collapsed by default; people-
  column gate uses a custom dropdown matching the settings chrome.

## 3.2.7

- Settings UI redesign (Vercel-style clarity): soft canvas, compact label rows,
  capped field widths, checkbox lists instead of stretched multi-selects,
  collapsible permissions, and ↑/↓ reorder.

## 3.2.6

- Per-label people-column gate: pick a People column; only actors who appear on
  that column (as a person or via a team listed there) may select the label.
  Combines with user/team allowlists as AND.

## 3.2.5

- Settings overlay ignores the tiny column-settings iframe size (root cause of
  the postcard modal). Uses the physical screen at ≥80%, floored at the
  known-good `1100×820`.

## 3.2.4

- Settings overlay opens at ≥80% of the viewport (min 720×560, capped at 94%
  on tiny screens) — no more postcard-sized `744px` dialog.

## 3.2.3

- Revert status picker to the cell-attached Dialog Design (no centered
  `openAppFeatureModal`). The previous hand-off looked wrong next to the board.
  Bind only On-Click to `/picker` — not On-Hover — so the popover stays open
  while choosing.

## 3.2.2

- Fix settings load crash: User photos query uses `photo_thumb` (API 2026-04).
  `photo_url { thumb }` is only available from 2026-07 and was rejected by GraphQL.

## 3.2.1

- Status picker no longer closes when the mouse moves: the column Dialog Design
  shell immediately opens a stable `openAppFeatureModal` (`/picker-full`) so the
  label list stays open until a choice or an intentional dismiss.

## 3.2.0

- Settings UI cleaned up to match discussions: header + scroll body + footer,
  Vibe ColorPicker (circle) and PersonPicker, no subheadings or help prose.
- Full-settings overlay size is viewport-relative (`min(744px, 94vw/vh)`), not
  a fixed 1100×820.

## 3.1.5

- Picker no longer lists the currently selected status (or shows it as a header
  chip) — only other allowed labels appear for switching.

## 3.1.4

- Fix settings save failing with monday `Colors should be unique` on
  `update_status_column`: payloads now force unique StatusColumnColors across
  active + deactivated labels (active colors stay; collisions are remapped), and
  new labels pick the first unused color instead of always `done_green`.

## 3.1.3

- Picker labels stretch edge-to-edge inside the monday Dialog Design iframe
  (removed the 20px app-shell padding and width cap that left side gaps).

## 3.1.2

- Picker UI matches discussions' monday-native status label menu: full-width
  colored pills with white centered text (same look as TaskTableRow statusMenu).

## 3.1.1

- Column settings shell is now a single button that opens a full-size nested
  overlay (`openAppFeatureModal` → `/settings-full`) for label editing and
  permissions — the native settings iframe stays minimal.

## 3.1.0

- Default when no settings are saved: **all active statuses are allowed** (removed the
  "העמודה לא הוגדרה" picker gate).
- Settings now edit board status labels in place — rename, recolor, add, and deactivate —
  via `update_status_column` (same pattern as day-off), alongside per-label permissions.

## 3.0.0

- Rewrote the app as a **client-only** Status Column surface (CDN), matching the
  `team-people-column` architecture — no monday-code server, OAuth, or webhooks.
- Routing is pathname-based: `/picker` (on-click) and `/settings` (column settings).
- Settings persist in global monday storage (`twystStatus:boardId:columnId`) with
  per-target-label allowlists (users or teams) and required board columns.
- The picker hides unauthorized and hidden labels; missing storage means open allowlists.
  Selecting a label with required fields always opens a fill form before writing
  status + columns together.

## 2.1.0

- Added governed Status workflows with transition permissions, required fields,
  protected labels, rollback enforcement, notifications, and per-item audit history
  (server-side path; superseded by 3.0.0 client-only rewrite).
