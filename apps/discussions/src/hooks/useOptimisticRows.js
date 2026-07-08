
import { useRef, useCallback } from 'react';

/*
 * Shared optimistic-row engine for the create hooks (useTasks / useDecisions /
 * useTopics). It is the SINGLE SOURCE OF TRUTH for the bookkeeping that keeps a
 * freshly-added row stable while its real monday id hasn't arrived yet.
 *
 * A row is inserted with a `temp-…` id the instant the user adds it; create_item
 * runs in the background, then RECONCILE swaps the temp id for the real monday id.
 * Four concerns arise and this helper owns all four so the three entity types
 * share ONE well-tested implementation instead of diverging copies:
 *
 *  1. PENDING EDITS — the row is fully editable immediately, so the user can
 *     change name / status / assignee / deadline BEFORE the real id exists. We
 *     must never fire an update against a temp/undefined id (the API layer warns
 *     on that and monday would reject it). Each edit is stored here
 *     (temp id → { field: value }, LAST-WRITE-WINS per field) and FLUSHED through
 *     the normal update mutations the moment the real id is known.
 *
 *  2. RETRY — if the create fails we keep the row (never silently drop it) in an
 *     error state; retrying re-runs the create with the SAME arguments, stored
 *     here keyed by the temp id.
 *
 *  3. PROTECTED IDS — the moment a create reconciles to a real id, that id is
 *     PROTECTED for a short window. A silent refresh() whose server read hasn't
 *     surfaced the row yet (monday's board_relation index is eventually
 *     consistent) MUST NOT drop it. Protection is marked BEFORE any async flush,
 *     so a CONCURRENT create's refresh can never evict a just-reconciled row —
 *     this is what makes rapid multi-row creation stable (no vanish/reappear).
 *
 *  4. MERGE — mergeServerList() folds an authoritative server snapshot into the
 *     current optimistic list, preserving EVERY in-flight temp row and EVERY
 *     recently-protected real row the server hasn't returned yet. Multi-row safe:
 *     any number of overlapping creates are preserved, not just the latest one.
 *
 * It is deliberately id-agnostic (works for any `temp-…` id).
 */

// A row is "optimistic / not yet on the board" while it still carries a temp id.
// Tolerant of non-string ids (numbers) and null/undefined (→ not a temp id).
export function isTempId(id) {
  return id != null && String(id).startsWith('temp-');
}

// A real, writable monday id: present, and not a temp placeholder. Guarding
// writes with this (instead of only `!isTempId`) means an undefined/null/empty
// id is treated as "not ready" and enqueued rather than fired at the API as a
// bogus mutation (which is exactly what surfaced as an unexpected-error popup).
export function isRealId(id) {
  return id != null && id !== '' && !isTempId(id);
}

// Monotonic temp-id factory — Date.now() alone collides when the user adds rows
// in the same millisecond (rapid entry), which would make two optimistic rows
// share a key and reconcile ambiguously. The counter guarantees uniqueness.
let tempSeq = 0;
export function nextTempId(prefix = 'temp') {
  tempSeq += 1;
  return `${prefix}-${Date.now()}-${tempSeq}`;
}

// How long (ms) a just-reconciled real id is protected from a refresh-merge
// eviction, covering monday's eventually-consistent board_relation index. Also
// bounds the map so a create whose row was later deleted can't be resurrected
// forever (delete unprotects it immediately regardless).
export const PROTECT_MS = 15000;

export function useOptimisticRows() {
  // temp id → { field: value }. Coalesced (last write per field wins), so a
  // flush issues at most one write per field regardless of how fast the user typed.
  const pendingEdits = useRef(new Map());
  // temp id → the original create arguments, so a failed create can be retried
  // against the very same optimistic row.
  const createArgs = useRef(new Map());
  // real id → expiry timestamp. A row whose id is here survives a refresh-merge
  // even when the server hasn't returned it yet (eventual consistency window).
  const protectedIds = useRef(new Map());

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

  // Protect a real id from refresh-merge eviction for PROTECT_MS. Call the INSTANT
  // the real id is known (before any flush await) so a concurrent refresh can't
  // drop the just-created row.
  const protectRealId = useCallback((id) => {
    if (isRealId(id)) protectedIds.current.set(String(id), Date.now() + PROTECT_MS);
  }, []);

  // Stop protecting an id — call on delete so a later create's refresh can't
  // resurrect a row the user just removed.
  const unprotectRealId = useCallback((id) => {
    if (id != null) protectedIds.current.delete(String(id));
  }, []);

  // Fold an authoritative server snapshot into the current optimistic list.
  // Server copies win for ids the server returned; any local row the server did
  // NOT return is KEPT when it is either (a) a still-in-flight temp row (no real
  // id exists yet, so the server CANNOT return it — a concurrent create's refresh
  // must never drop it) or (b) a recently-protected real row whose relation index
  // hasn't surfaced yet. Everything else (e.g. a deleted row, already gone from
  // `current` and unprotected) falls away. Order: server items first, then the
  // preserved local rows in their existing relative order — stable, no reshuffle.
  // `getId` extracts a row's id (default `row.id`).
  const mergeServerList = useCallback((current, serverItems, getId = (i) => i.id) => {
    const server = Array.isArray(serverItems) ? serverItems : [];
    const serverIds = new Set(server.map((i) => String(getId(i))));
    const now = Date.now();
    // Prune expired protections so the map can't grow unbounded.
    for (const [id, expiry] of protectedIds.current) {
      if (expiry < now) protectedIds.current.delete(id);
    }
    const preserved = (current || []).filter((i) => {
      const sid = String(getId(i));
      if (serverIds.has(sid)) return false;      // server returned it — use its copy
      if (isTempId(sid)) return true;            // in-flight optimistic create — always keep
      return protectedIds.current.has(sid);      // just-created real row not yet surfaced
    });
    return [...server, ...preserved];
  }, []);

  return {
    enqueueEdit,
    drainEdits,
    stashCreateArgs,
    getCreateArgs,
    forgetRow,
    protectRealId,
    unprotectRealId,
    mergeServerList,
  };
}

export default useOptimisticRows;
