import { useState, useEffect, useCallback, useRef } from 'react';
import { החלטות1Board } from '@api/BoardSDK.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import logger from '../utils/logger.js';

/*
 * "My Decisions" data hook (client-only) — mirrors useMyTasks, but over the
 * DECISIONS board (mapped MANUALLY in Settings, never wizard-created).
 *
 * Reads decisions straight off the decisions board, filtered SERVER-SIDE to the
 * current user via ONE of the two people columns, chosen by `subTab`:
 *   'decider'  → deciderID  ("מחליט")   — decisions I decide
 *   'affected' → affectedID ("מושפעים") — decisions that affect me
 * BoardSDK's `where` formats the people compare_value as "person-<id>" (a bare
 * user id is silently ignored by monday). Switching the sub-tab re-fetches
 * server-side (the filter key changes).
 *
 * Graceful degradation: when the decisions board or the sub-tab's people column
 * is UNMAPPED, the hook NEVER fires a query — it reports `configured: false`
 * and the view renders the "לוח ההחלטות טרם הוגדר" empty state.
 *
 * Cursor pagination: first page via boards.items_page, "load more" follows the
 * returned cursor (BoardSDK withPagination({ cursor })). Filter/Sort/Group all
 * run CLIENT-SIDE in the view over the loaded page (no re-fetch).
 *
 * Each decision is mapped through BoardSDK.mapItem, so rows carry the alias
 * shape used everywhere: { id, name, created_at, decisionStatusID (label id),
 * decisionPriorityID (label id), decisionDateID (Date|null), deciderID /
 * affectedID / decisionCreatorID (people[]), discussionLinkID (board_relation
 * { linkedItems, ids, text } — the "דיון מקור" chip reads linkedItems[0]) }.
 * decisionCreatorID is fetched for PERMISSION resolution only (the decision-tier
 * "creator" role), not rendered as a column.
 *
 * Inline edits (status / priority / date) are optimistic and revert on error,
 * writing through BoardSDK .item(id).update() — same shapes as useDecisions.
 */

const PAGE_SIZE = 100;

// Columns the "My Decisions" view renders / permission-gates on.
const RENDERED_COLUMNS = [
  'decisionCreatorID',
  'deciderID',
  'affectedID',
  'decisionStatusID',
  'decisionPriorityID',
  'decisionDateID',
  'discussionLinkID',
];

export const MY_DECISIONS_SUB_TABS = ['decider', 'affected'];

// The people column each sub-tab filters on.
const SUB_TAB_FILTER_ALIAS = {
  decider: 'deciderID',
  affected: 'affectedID',
};

// Resolve the current user's person id as a string (mirrors useMyTasks).
export function resolveUserId(currentUser, context) {
  const raw = currentUser?.id ?? context?.user?.id ?? context?.userId ?? null;
  if (raw == null || raw === '') return null;
  return String(raw);
}

// Build the BoardSDK `where` clause for the My Decisions query. Exported so the
// query shape can be unit-tested without a live board.
export function buildMyDecisionsWhere({ subTab, userId, search }) {
  const where = {};
  const alias = SUB_TAB_FILTER_ALIAS[subTab] || SUB_TAB_FILTER_ALIAS.decider;
  if (userId) where[alias] = String(userId);
  if (search && String(search).trim()) where.name = String(search).trim();
  return where;
}

// Is the decisions surface usable for this sub-tab? Requires the decisions
// board AND the sub-tab's people filter column to be mapped in Settings.
export function isMyDecisionsConfigured(subTab) {
  const alias = SUB_TAB_FILTER_ALIAS[subTab] || SUB_TAB_FILTER_ALIAS.decider;
  return !!(getBoardId('decisions') && getColumns('decisions')?.[alias]?.id);
}

export function useMyDecisions(subTab = 'decider', { currentUser, context, search = '' } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState(null);

  const userId = resolveUserId(currentUser, context);
  const configured = isMyDecisionsConfigured(subTab);
  // Stable filter key so the fetch effect only re-runs on a real change
  // (sub-tab switch, user change, search change).
  const filterKey = JSON.stringify({ subTab, userId, search: (search || '').trim(), configured });
  const reqIdRef = useRef(0);
  // Synchronous mirror of `items` for optimistic-edit revert snapshots (an edit
  // captures the pre-edit list at call time; reading state inside a setItems
  // updater is unreliable for that). Mirrors useMyTasks.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const fetchPage = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    // Unmapped board/column (expected state — decisions is mapped manually in
    // Settings) or no resolvable user → empty, and NEVER fire a query.
    if (!configured || !userId) {
      setItems([]);
      setCursor(null);
      setError(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const where = buildMyDecisionsWhere({ subTab, userId, search });
      const res = await new החלטות1Board()
        .items()
        .withColumns(RENDERED_COLUMNS)
        .withPagination({ limit: PAGE_SIZE })
        .where(where)
        .execute();
      if (reqId !== reqIdRef.current) return; // a newer request superseded this one
      setItems(res.items || []);
      setCursor(res.cursor || null);
      setError(null);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      logger.error('useMyDecisions', 'Error fetching my decisions', { subTab, userId, err });
      setError(err?.message || 'fetch failed');
      setItems([]);
      setCursor(null);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [subTab, userId, search, configured]);

  useEffect(() => {
    fetchPage();
    // filterKey collapses the dependency set into one stable string.
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    try {
      setLoadingMore(true);
      const res = await new החלטות1Board()
        .items()
        .withColumns(RENDERED_COLUMNS)
        .withPagination({ cursor })
        .execute();
      setItems((prev) => {
        const have = new Set(prev.map((d) => String(d.id)));
        const fresh = (res.items || []).filter((d) => !have.has(String(d.id)));
        return [...prev, ...fresh];
      });
      setCursor(res.cursor || null);
    } catch (err) {
      logger.error('useMyDecisions', 'Error loading more my decisions', err);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  // Optimistic inline edit of a status-shaped column — revert on error. Used for
  // both decisionStatusID and decisionPriorityID; both store the stable label id
  // (id 0 is valid — callers guard on null/'' upstream).
  const updateStatusColumn = useCallback((alias) => async (decisionId, value) => {
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    setItems((current) =>
      current.map((d) => (String(d.id) === String(decisionId) ? { ...d, [alias]: value } : d))
    );
    try {
      await new החלטות1Board().item(decisionId).update({ [alias]: value }).execute();
    } catch (err) {
      logger.error('useMyDecisions', `Error updating decision ${alias}`, err);
      setItems(prev);
    }
  }, []);

  const updateDecisionStatus = useCallback(
    (decisionId, status) => updateStatusColumn('decisionStatusID')(decisionId, status),
    [updateStatusColumn]
  );
  const updateDecisionPriority = useCallback(
    (decisionId, priority) => updateStatusColumn('decisionPriorityID')(decisionId, priority),
    [updateStatusColumn]
  );

  // Optimistic inline date edit — `date` is a Date or null (clear). Write shape
  // mirrors useDecisions.updateDecisionDate (local Y-M-D string).
  const updateDecisionDate = useCallback(async (decisionId, date) => {
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    setItems((current) =>
      current.map((d) => (String(d.id) === String(decisionId) ? { ...d, decisionDateID: date || null } : d))
    );
    try {
      const f = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        : null;
      await new החלטות1Board().item(decisionId).update({ decisionDateID: f }).execute();
    } catch (err) {
      logger.error('useMyDecisions', 'Error updating decision date', err);
      setItems(prev);
    }
  }, []);

  const refresh = useCallback(() => fetchPage(), [fetchPage]);

  return {
    items,
    loading,
    loadingMore,
    cursor,
    hasMore: !!cursor,
    error,
    userId,
    configured,
    loadMore,
    updateDecisionStatus,
    updateDecisionPriority,
    updateDecisionDate,
    refresh,
  };
}

export default useMyDecisions;
