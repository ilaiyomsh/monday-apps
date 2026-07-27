# Changelog

## 3.0.0

- Rewrote the app as a **client-only** Status Column surface (CDN), matching the
  `team-people-column` architecture — no monday-code server, OAuth, or webhooks.
- Routing is pathname-based: `/picker` (on-click) and `/settings` (column settings).
- Settings persist in global monday storage (`twystStatus:boardId:columnId`) with
  per-target-label allowlists (users or teams) and required board columns.
- The picker hides unauthorized and hidden labels, shows an unconfigured state when
  settings are missing, and always opens a required-fields form before writing
  status + columns together.

## 2.1.0

- Added governed Status workflows with transition permissions, required fields,
  protected labels, rollback enforcement, notifications, and per-item audit history
  (server-side path; superseded by 3.0.0 client-only rewrite).
