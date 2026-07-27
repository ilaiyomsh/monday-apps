# Changelog

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
