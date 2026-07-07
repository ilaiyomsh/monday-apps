import type { PersonalTypeOption, KindValueMap, StatusValueMap } from '../../types';

/**
 * Pure comparison helpers for the personal-type label editor (SettingsDialog).
 *
 * W1.5 (Day-off integration): saving edited labels rewrites the vacations
 * board's status column via `update_status_column` — but external consumers
 * (Planner, tracker) cache this column's label IDs in their OWN settings, so
 * any divergence between the draft and the live board labels must surface a
 * visible warning before save.
 */

/** Element-wise equality of two label lists (id, title, color, index). */
export function samePersonalTypeOptions(a: PersonalTypeOption[], b: PersonalTypeOption[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].title !== b[i].title) return false;
    if (a[i].color !== b[i].color) return false;
    if (a[i].index !== b[i].index) return false;
  }
  return true;
}

/**
 * True when the draft label list diverges from the last-known LIVE board
 * labels — i.e. saving now would rewrite the status column (rename / recolor /
 * add / remove / reorder). A `null` baseline (snapshot not loaded yet, or its
 * load failed) yields `false`: without a trusted baseline there is nothing to
 * warn about.
 */
/**
 * True when a SAVED kind label selection differs from the draft's (a semantic
 * re-pick). Planner/tracker cache these label IDs in their own settings —
 * re-picking which label means general/personal requires re-mapping there
 * (change #78). A field with no saved ID (first-time mapping, or a legacy
 * text-only blob) never warns.
 */
export function kindSelectionDiverged(
  saved: KindValueMap | undefined,
  draft: KindValueMap | undefined,
): boolean {
  const keys = ['generalLabelId', 'personalLabelId'] as const;
  return keys.some((k) => {
    const savedId = saved?.[k];
    return !!savedId && (draft?.[k] ?? '') !== savedId;
  });
}

/** Same contract as kindSelectionDiverged, for the approval-status label IDs. */
export function approvalSelectionDiverged(
  saved: StatusValueMap | undefined,
  draft: StatusValueMap | undefined,
): boolean {
  const keys = ['pending', 'approved', 'rejected'] as const;
  return keys.some((k) => {
    const savedId = saved?.labelIds?.[k];
    return !!savedId && (draft?.labelIds?.[k] ?? '') !== savedId;
  });
}
