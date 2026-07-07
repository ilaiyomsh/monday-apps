// Shared helpers for exporting / importing a user's Conditional rule set.
// Used by ImportExportDialog (self-export from Conditions tab) and by the
// owner action "Export conditions" in UsersTable.

import type { Conditional } from '../types';

export const EXPORT_VERSION = 1;

export interface ExportPayload {
  version: number;
  exportedAt: string;
  boardId: string | null;
  conditionals: Conditional[];
}

// Filesystem-safe filename: "<user>-conditions-<YYYY-MM-DD>.json". Strips
// characters that break Windows/macOS file pickers and falls back to "user"
// when the display name resolves to nothing usable (e.g. emoji-only).
export function buildConditionsFileName(userName: string | null): string {
  const safe = (userName || '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
    .trim()
    .replace(/\s+/g, '_');
  const who = safe || 'user';
  const date = new Date().toISOString().slice(0, 10);
  return `${who}-conditions-${date}.json`;
}

export function buildExportJson(conditionals: Conditional[], boardId: string | null): string {
  const payload: ExportPayload = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    boardId,
    conditionals,
  };
  return JSON.stringify(payload, null, 2);
}

// Trigger a browser download for a JSON string. Returns a promise that
// resolves once the click has been dispatched — callers can flash a "Done"
// state immediately, the actual save dialog is the browser's concern.
export function downloadJson(json: string, fileName: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Keep the URL alive long enough for Safari to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
