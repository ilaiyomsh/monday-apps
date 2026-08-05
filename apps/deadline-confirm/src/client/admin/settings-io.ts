// Settings export/import (JSON) + the legacy dateColumnTitle backfill.
//
// The backfill exists because of a production incident (2026-07-27). 0.7.1 made
// reading a pre-0.6.0 config non-throwing by defaulting a missing
// section.dateColumnTitle to ''. The SERVER, however, requires that field to be
// a NON-EMPTY string, so every save of a legacy config was rejected with an
// opaque 400 invalid_config — while the panel looked perfectly complete, because
// digestIsComplete does not check the title and the date dropdown renders its
// label from dateColumnId rather than from the stored copy. The operator could
// not save at all, so the digest kept running on the old stored config and the
// preview stayed empty.
//
// The title is derivable from the selected column, so deriving it is strictly
// better than trusting a stored copy. Relaxing the server was rejected: it would
// mean weakening a locked test and letting header-less sections into storage.

import type { ConfigDraft, DigestDraft } from './draft';
import type { AppConfig, BoardColumn } from './types';
import logger from './utils/logger';

/** Header used when the date column cannot be resolved (matches the renderers). */
export const FALLBACK_DATE_TITLE = 'תאריך';

/** App id stamped into an export, and required on import. */
export const SETTINGS_EXPORT_APP = 'deadline-confirm';

/**
 * Return a digest whose every section carries a non-empty `dateColumnTitle`,
 * derived from the tasks-board columns. Never mutates the input.
 */
export function backfillDateColumnTitles(digest: DigestDraft, columns: BoardColumn[]): DigestDraft {
  const titleById = new Map(columns.map((c) => [c.id, c.title]));
  return {
    ...digest,
    // 0.14.0: clusters live in the block list, so the backfill walks the blocks
    // and leaves text blocks untouched.
    blocks: digest.blocks.map((b) => {
      if (b.type !== 'cluster') return b;
      if (b.dateColumnTitle.trim().length > 0) return b;
      const resolved = b.dateColumnId ? titleById.get(b.dateColumnId) : undefined;
      return { ...b, dateColumnTitle: resolved?.trim() || FALLBACK_DATE_TITLE };
    }),
  };
}

export interface SettingsExport {
  app: string;
  appVersion: string;
  exportedAt: string;
  savedConfig: AppConfig | null;
  draft: ConfigDraft;
}

/** Only the config-shaped fields are copied out — never a secret or a token. */
function pickConfig(c: AppConfig | null): AppConfig | null {
  if (!c) return null;
  return {
    boardId: c.boardId,
    peopleColumnId: c.peopleColumnId ?? null,
    buttons: c.buttons ?? [],
    templates: c.templates ?? [],
    ...(c.digest === undefined ? {} : { digest: c.digest }),
  };
}

/**
 * Build the export envelope. Carries BOTH what is stored server-side and what
 * is currently on screen — when a save is being rejected, the difference
 * between the two is the whole diagnosis.
 */
export function buildSettingsExport({
  savedConfig,
  draft,
  appVersion,
  now,
}: {
  savedConfig: AppConfig | null;
  draft: ConfigDraft;
  appVersion: string;
  now: string;
}): SettingsExport {
  return {
    app: SETTINGS_EXPORT_APP,
    appVersion,
    exportedAt: now,
    savedConfig: pickConfig(savedConfig),
    draft,
  };
}

export type ImportResult = { ok: true; draft: ConfigDraft } | { ok: false; error: string };

/** Parse an exported file back into a draft. Never throws — the error is the return value. */
export function parseSettingsImport(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // The user already sees the returned message; this records WHICH parse failed
    // (error-guard: a catch must log, rethrow or display — this one displays via
    // the return value and logs the cause, which the message cannot carry).
    logger.error('admin', 'settings_import_parse_failed', err);
    return { ok: false, error: 'הקובץ אינו JSON תקין.' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'הקובץ אינו קובץ הגדרות.' };
  }
  const env = parsed as Partial<SettingsExport>;
  if (env.app !== SETTINGS_EXPORT_APP) {
    return { ok: false, error: `הקובץ שייך לאפליקציה אחרת (${String(env.app ?? 'לא ידוע')}).` };
  }
  if (typeof env.draft !== 'object' || env.draft === null) {
    return { ok: false, error: 'הקובץ אינו מכיל הגדרות לייבוא.' };
  }
  return { ok: true, draft: env.draft as ConfigDraft };
}
