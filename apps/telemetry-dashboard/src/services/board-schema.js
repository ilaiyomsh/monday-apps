// The SINGLE source of truth for the lifecycle events board's shape — the 9
// columns and their monday column types. Used by the board provisioner
// (services/board-provisioner.js) to create the board from the Settings UI,
// and mirrored by events-board.js's column keys when it writes items.
//
// Historically this shape lived in scripts/create-events-board.mjs (a manual
// CLI). That script is now superseded by in-app provisioning; this module is
// the authoritative definition both would share.
//
// This module has NO imports and NO side effects.

export const DEFAULT_BOARD_NAME = 'App Lifecycle Events';

/**
 * The logical event fields, in board column order. `key` is the logical name
 * events-board.js maps by; `title` is the human column header; `type` is the
 * monday ColumnType; `defaults` (optional) seeds the column (the status labels).
 * @type {ReadonlyArray<{ key: string, title: string, type: string, defaults?: object }>}
 */
export const BOARD_COLUMNS = Object.freeze([
  { key: 'event_time', title: 'Event Time', type: 'date' },
  {
    key: 'category',
    title: 'Category',
    type: 'status',
    defaults: { labels: { 1: 'Lifecycle', 2: 'Install', 3: 'Subscription' } },
  },
  { key: 'event_type', title: 'Event Type', type: 'text' },
  { key: 'app', title: 'App', type: 'text' },
  { key: 'feature', title: 'Feature', type: 'text' },
  { key: 'account_id', title: 'Account ID', type: 'text' },
  { key: 'user_id', title: 'User ID', type: 'text' },
  // #145 enrichment — user identity arrives natively on install/subscription
  // events; feature events carry ids only (owner decision: no API lookup).
  { key: 'user_name', title: 'User Name', type: 'text' },
  { key: 'user_email', title: 'User Email', type: 'text' },
  { key: 'workspace', title: 'Workspace', type: 'text' },
  { key: 'object_name', title: 'Object Name', type: 'text' },
  { key: 'object_url', title: 'Object URL', type: 'link' },
  { key: 'app_version', title: 'App Version', type: 'text' },
  { key: 'details', title: 'Details', type: 'long_text' },
  { key: 'event_id', title: 'Event ID', type: 'text' },
]);

/** The logical column keys, for validating a stored/loaded column map. */
export const COLUMN_KEYS = Object.freeze(BOARD_COLUMNS.map((c) => c.key));
