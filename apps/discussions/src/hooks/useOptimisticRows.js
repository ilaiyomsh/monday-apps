import { useRef, useCallback } from 'react';

/*
 * Shared optimistic-row bookkeeping for the create hooks (useTasks / useDecisions).
 *
 * These hooks insert a row with a `temp-…` id the instant the user adds it, run
 * create_item in the background, then RECONCILE by swapping the temp id for the
 * real monday id. Two problems arise while the real id hasn't arrived yet, and
 * this helper owns both:
 *
 *  1. PENDING EDITS — the row is fully editable immediately, so the user can
 *     change name / status / assignee / deadline BEFORE the real id exists. We
 *     must never fire an update against a temp/undefined id (the API layer warns
 *     on that and monday would reject it). Instead each edit is stored here
 *     (temp id → { field: value }, LAST-WRITE-WINS per field) and FLUSHED through
 *     the normal update mutations the moment the real id is known.
 *
 *  2. RETRY — if the create fails we keep the row (never silently drop it) in an
 *     error state; retrying re-runs the create with the SAME arguments, stored
 *     here keyed by the temp id.
 *
 * It is deliberately id-agnostic (works for any `temp-…` id) so the three entity
 * types share ONE implementation instead of diverging copies.
 */

// A row is "optimistic / not yet on the board" while it still carries a temp id.
export function isTempId(id) {
  return String(id).startsWith('temp-');
}

// Monotonic temp-id factory — Date.now() alone collides when the user adds rows
// in the same millisecond (rapid entry), which would make two optimistic rows
// share a key and reconcile ambiguously. The counter guarantees uniqueness.
let tempSeq = 0;
export function nextTempId(prefix = 'temp') {
  tempSeq += 1;
  return `${prefix}-${Date.now()}-${tempSeq}`;
}

export function useOptimisticRows() {
  // temp id → { field: value }. Coalesced (last write per field wins), so a
  // flush issues at most one write per field regardless of how fast the user typed.
  const pendingEdits = useRef(new Map());
  // temp id → the original create arguments, so a failed create can be retried
  // against the very same optimistic row.
  const createArgs = useRef(new Map());

  // Record an edit made on a still-optimistic row (does NOT touch the API).
  const enqueueEdit = useCallback((tempId, field, value) => {
    const key = String(tempId);
    const cur = pendingEdits.current.get(key) || {};
    cur[field] = value; // last-write-wins per field
    pendingEdits.current.set(key, cur);
  }, []);

  // Take (and clear) the queued edits for a row — called on reconcile, right
  // before flushing them through the real update mutations. null = nothing queued.
  const drainEdits = useCallback((tempId) => {
    const key = String(tempId);
    const edits = pendingEdits.current.get(key);
    pendingEdits.current.delete(key);
    return edits || null;
  }, []);

  const stashCreateArgs = useCallback((tempId, args) => {
    createArgs.current.set(String(tempId), args);
  }, []);

  const getCreateArgs = useCallback((tempId) => createArgs.current.get(String(tempId)) || null, []);

  // Forget everything about a temp row — on successful reconcile (edits already
  // drained; drop the retry args) or when the user dismisses a failed row.
  const forgetRow = useCallback((tempId) => {
    const key = String(tempId);
    pendingEdits.current.delete(key);
    createArgs.current.delete(key);
  }, []);

  return { enqueueEdit, drainEdits, stashCreateArgs, getCreateArgs, forgetRow };
}

export default useOptimisticRows;
