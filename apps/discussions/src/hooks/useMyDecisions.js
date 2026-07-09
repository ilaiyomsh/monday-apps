import { useState, useEffect, useCallback, useRef } from 'react';
import { החלטות1Board } from '@api/BoardSDK.js';
import { api } from '../utils/mondayApi/monday-client.js';
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
// Undo window for deferred bulk delete — matches the delete toast auto-hide
// (mirrors useMyTasks / useDecisions).
const DELETE_GRACE_MS = 6000;

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
    const baseWhere = buildMyDecisionsWhere({ subTab, userId, search });
    // STAGED LOAD (perceived speed): only on a FRESH load (nothing shown yet).
    // Phase 1 = decisions from the LAST MONTH (server-side date range on the
    // mapped decision-date column) rendered ASAP; phase 2 = the full set (incl.
    // the creator-as-decider fallback) merged in (dedupe). On a refetch that
    // already has rows (sub-tab / search change) skip to the single full query.
    const staged = itemsRef.current.length === 0;
    const dateColMapped = !!getColumns('decisions')?.decisionDateID?.id;
    let phase1Items = [];
    if (staged && dateColMapped) {
      try {
        setLoading(true);
        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const r1 = await new החלטות1Board()
          .items()
          .withColumns(RENDERED_COLUMNS)
          .withPagination({ limit: PAGE_SIZE })
          .where({ ...baseWhere, decisionDateID: { between: [ymd(from), ymd(now)] } })
          .execute();
        if (reqId !== reqIdRef.current) return;
        phase1Items = r1.items || [];
        setItems(phase1Items);
        setCursor(r1.cursor || null);
        setError(null);
        setLoading(false); // first paint done — phase 2 fills in the rest
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        logger.warn('useMyDecisions', 'staged phase-1 fetch failed; loading full set', err);
        phase1Items = [];
      }
    }
    try {
      if (!(staged && dateColMapped)) setLoading(true);
      const where = baseWhere;
      const res = await new החלטות1Board()
        .items()
        .withColumns(RENDERED_COLUMNS)
        .withPagination({ limit: PAGE_SIZE })
        .where(where)
        .execute();
      if (reqId !== reqIdRef.current) return; // a newer request superseded this one
      let list = res.items || [];
      // Round 27 — CREATOR-AS-DEFAULT-DECIDER: in the "החלטות שקיבלתי" (decider)
      // sub-tab a decision that has a creator but NO decider is treated as
      // decided BY its creator, so it must also surface for that creator. The
      // server rule above only matches the decider people column, so we
      // additionally pull the decisions THIS user created and merge in the ones
      // whose decider is EMPTY (effectiveDecider === me). Display/logic fallback
      // only — the board is never written. Skipped when the creator column is
      // unmapped; a failure here is non-fatal (the decider list still renders).
      if (subTab === 'decider' && getColumns('decisions')?.decisionCreatorID?.id) {
        try {
          const creatorWhere = { decisionCreatorID: String(userId) };
          if (search && String(search).trim()) creatorWhere.name = String(search).trim();
          const createdRes = await new החלטות1Board()
            .items()
            .withColumns(RENDERED_COLUMNS)
            .withPagination({ limit: PAGE_SIZE })
            .where(creatorWhere)
            .execute();
          if (reqId !== reqIdRef.current) return;
          const have = new Set(list.map((d) => String(d.id)));
          const fallback = (createdRes.items || []).filter(
            (d) => !have.has(String(d.id)) && (!Array.isArray(d.deciderID) || d.deciderID.length === 0)
          );
          list = [...list, ...fallback];
        } catch (creatorErr) {
          logger.warn('useMyDecisions', 'creator-fallback fetch failed', creatorErr);
        }
      }
      // Phase 2 merge: on a staged load, AUGMENT what phase 1 rendered (add the
      // rows it didn't return, preserving current order + any optimistic edits);
      // on a refetch (sub-tab / search change) the full list is authoritative.
      if (staged && dateColMapped) {
        setItems((current) => {
          const have2 = new Set(current.map((d) => String(d.id)));
          return [...current, ...list.filter((d) => !have2.has(String(d.id)))];
        });
      } else {
        setItems(list);
      }
      setCursor(res.cursor || null);
      setError(null);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      logger.error('useMyDecisions', 'Error fetching my decisions', { subTab, userId, err });
      // Keep phase-1 rows already shown; only surface an error on a fresh load.
      if (!(staged && dateColMapped && phase1Items.length)) {
        setError(err?.message || 'fetch failed');
        setItems([]);
        setCursor(null);
      }
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

  // Optimistic inline rename — mirrors useDecisions.updateDecisionName ({ name }
  // rides change_multiple_column_values' name key). Empty names are ignored.
  const updateDecisionName = useCallback(async (decisionId, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    setItems((current) =>
      current.map((d) => (String(d.id) === String(decisionId) ? { ...d, name: trimmed } : d))
    );
    try {
      await new החלטות1Board().item(decisionId).update({ name: trimmed }).execute();
    } catch (err) {
      logger.error('useMyDecisions', 'Error renaming decision', err);
      setItems(prev);
    }
  }, []);

  // Deferred bulk delete with an undo window (mirrors useMyTasks.softDeleteTasks
  // / useDecisions.softDeleteDecisions): rows vanish optimistically now, the real
  // delete_item fires only after DELETE_GRACE_MS, and the returned undo() (wired
  // to the toast's "בטל") cancels the pending delete and restores the rows.
  const softDeleteDecisions = useCallback((ids) => {
    const idList = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!idList.length) return { undo: () => {}, count: 0 };
    const idSet = new Set(idList.map(String));
    const removed = itemsRef.current.filter((i) => idSet.has(String(i.id))); // snapshot for restore
    setItems((current) => current.filter((i) => !idSet.has(String(i.id))));

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      idList.forEach((id) => {
        api(`mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`, { itemId: id }, 'useMyDecisions.softDeleteDecisions')
          .catch((err) => logger.error('useMyDecisions', 'Error deleting decision', err));
      });
    }, DELETE_GRACE_MS);

    const undo = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      setItems((current) => {
        const have = new Set(current.map((i) => String(i.id)));
        return [...current, ...removed.filter((i) => !have.has(String(i.id)))];
      });
    };
    return { undo, count: idList.length };
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
    updateDecisionName,
    softDeleteDecisions,
    refresh,
  };
}

export default useMyDecisions;
