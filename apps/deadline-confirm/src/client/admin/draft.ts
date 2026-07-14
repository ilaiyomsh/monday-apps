// The in-progress config the admin is editing — AppConfig with the
// not-yet-chosen fields nullable. Labels (fromLabel/toLabel) are resolved
// from the picked column's settings at save time.

import type { AppConfig, BoardColumn } from './types';

export interface ConfigDraft {
  boardId: string | null;
  statusColumnId: string | null;
  fromIndex: number | null;
  toIndex: number | null;
  peopleColumnId: string | null;
  expiryDateColumnId: string | null;
  expiryGraceDays: number;
}

export function draftFromConfig(config: AppConfig | null): ConfigDraft {
  return {
    boardId: config?.boardId ?? null,
    statusColumnId: config?.statusColumnId ?? null,
    fromIndex: config?.fromIndex ?? null,
    toIndex: config?.toIndex ?? null,
    peopleColumnId: config?.peopleColumnId ?? null,
    expiryDateColumnId: config?.expiryDateColumnId ?? null,
    expiryGraceDays: config?.expiryGraceDays ?? 0,
  };
}

export function draftIsComplete(draft: ConfigDraft): boolean {
  return (
    draft.boardId !== null &&
    draft.statusColumnId !== null &&
    draft.fromIndex !== null &&
    draft.toIndex !== null &&
    draft.fromIndex !== draft.toIndex
  );
}

/**
 * Resolve the draft into the §4 config payload, looking the from/to label
 * texts up by label id on the selected status column. Returns null while the
 * draft is incomplete or the labels can't be resolved (e.g. stale column).
 */
export function draftToConfig(draft: ConfigDraft, columns: BoardColumn[]): AppConfig | null {
  if (!draftIsComplete(draft)) return null;
  const statusColumn = columns.find((c) => c.id === draft.statusColumnId);
  const fromLabel = statusColumn?.labels.find((l) => l.id === draft.fromIndex)?.label;
  const toLabel = statusColumn?.labels.find((l) => l.id === draft.toIndex)?.label;
  if (!fromLabel || !toLabel) return null;
  return {
    boardId: draft.boardId as string,
    statusColumnId: draft.statusColumnId as string,
    fromIndex: draft.fromIndex as number,
    fromLabel,
    toIndex: draft.toIndex as number,
    toLabel,
    peopleColumnId: draft.peopleColumnId,
    expiryDateColumnId: draft.expiryDateColumnId,
    expiryGraceDays: draft.expiryDateColumnId ? draft.expiryGraceDays : 0,
  };
}
