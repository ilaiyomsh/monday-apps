import { useState, useEffect, useCallback, useRef } from 'react';
import { החלטות1Board } from '@api/BoardSDK.js';
import { api } from '../utils/mondayApi/monday-client.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import { ensureSubscribers } from '../utils/mondayApi/subscribers.js';
import { makeViewCacheKey, readViewCache, writeViewCache, reconcileSeeded } from '../utils/viewCache.js';
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

// The My-Decisions first-page query, factored out so the hook AND the background
// prefetch build byte-identical queries (same columns / page size).
function decisionsItemsQuery(where) {
  return new החלטות1Board()
    .items()
    .withColumns(RENDERED_COLUMNS)
    .withPagination({ limit: PAGE_SIZE })
    .where(where);
}

export function useMyDecisions(subTab = 'decider', { currentUser, context, search = '' } = {}) {
  const userId = resolveUserId(currentUser, context);
  const configured = isMyDecisionsConfigured(subTab);
  // Instant-cache seed (stale-while-revalidate): on the FIRST mount only, seed
  // state SYNCHRONOUSLY from the versioned view cache — keyed by SUB-TAB, since
  // the two sub-tabs hold different lists — for an instant first paint. Only the
  // DEFAULT query (no search) is cached. The seed is ALWAYS revalidated by the
  // fetch below (which overwrites the cache); a cache miss ⇒ behavior is exactly
  // as before (empty list + loading:true).
  const isDefaultQuery = !(search && String(search).trim());
  const cacheKey = (isDefaultQuery && configured)
    ? makeViewCacheKey('myDecisions', { userId, boardId: getBoardId('decisions'), subTab })
    : null;
  const seedRef = useRef(undefined);
  if (seedRef.current === undefined) {
    const hit = cacheKey ? readViewCache(cacheKey) : null;
    seedRef.current = hit && Array.isArray(hit.items) && hit.items.length ? hit : null;
  }
  const seed = seedRef.current;

  const [items, setItems] = useState(() => (seed ? seed.items : []));
  const [loading, setLoading] = useState(() => (seed ? false : true));
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState(() => (seed ? seed.cursor || null : null));
  const [error, setError] = useState(null);
  // The first fetch after a seed is a SILENT background revalidate (keep the
  // seeded rows visible, no spinner); every later fetch behaves as before.
  const silentSeedRef = useRef(!!seed);
  // Ids the user has locally mutated this session — the silent seeded revalidate
  // PROTECTS these so a fresh page never clobbers an in-flight change or re-adds
  // a just-deleted (deferred) row.
  const dirtyIdsRef = useRef(new Set());

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
    // Consume the one-shot "silent seeded revalidate" flag: the first fetch
    // after a cache seed keeps the seeded rows visible (no spinner) and
    // reconciles the fresh set onto them; every later fetch is unchanged.
    const silentSeeded = silentSeedRef.current;
    silentSeedRef.current = false;
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
        const r1 = await decisionsItemsQuery({ ...baseWhere, decisionDateID: { between: [ymd(from), ymd(now)] } }).execute();
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
      // A SILENT cache-seeded revalidate keeps the seeded rows on screen (no
      // spinner); a real refetch (sub-tab / search change) shows loading as before.
      if (!(staged && dateColMapped) && !silentSeeded) setLoading(true);
      const where = baseWhere;
      const res = await decisionsItemsQuery(where).execute();
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
          const createdRes = await decisionsItemsQuery(creatorWhere).execute();
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
      // a silent cache seed reconciles on id (fresh authoritative, local edits
      // protected); on a refetch (sub-tab / search change) the full list wins.
      if (staged && dateColMapped) {
        setItems((current) => {
          const have2 = new Set(current.map((d) => String(d.id)));
          return [...current, ...list.filter((d) => !have2.has(String(d.id)))];
        });
      } else if (silentSeeded) {
        setItems((current) => reconcileSeeded(current, list, dirtyIdsRef.current));
      } else {
        setItems(list);
      }
      setCursor(res.cursor || null);
      setError(null);
      // Refresh the DEFAULT-query cache (this sub-tab) so the next entry seeds fresh.
      if (cacheKey) writeViewCache(cacheKey, list, res.cursor || null);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      logger.error('useMyDecisions', 'Error fetching my decisions', { subTab, userId, err });
      // Keep already-visible rows: a staged phase-1 paint OR a cache seed must
      // NOT be cleared by a failed (re)validate — only surface an error when
      // nothing is on screen yet.
      if (!((staged && dateColMapped && phase1Items.length) || silentSeeded)) {
        setError(err?.message || 'fetch failed');
        setItems([]);
        setCursor(null);
      }
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [subTab, userId, search, configured, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
    dirtyIdsRef.current.add(String(decisionId)); // protect this row from a seeded revalidate
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

  // Optimistic inline edit of a PEOPLE column (מחליט / מושפעים) — revert on
  // error. `people` is the PersonPicker selection ([{id, name, ...}]); the
  // write sends numeric user ids (the verified BoardSDK people format, same as
  // the in-discussion DecisionsTab editors). Owner report 2026-07-14: these
  // columns were display-only in "ההחלטות שלי" while editable in the
  // in-discussion tab — this closes that gap.
  const updatePeopleColumn = useCallback((alias) => async (decisionId, people) => {
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    dirtyIdsRef.current.add(String(decisionId)); // protect this row from a seeded revalidate
    const arr = Array.isArray(people) ? people : [];
    setItems((current) =>
      current.map((d) => (String(d.id) === String(decisionId) ? { ...d, [alias]: arr } : d))
    );
    try {
      const ids = arr.map((p) => Number(p.id)).filter(Number.isFinite);
      // round104: monday rejects assigning a non-subscriber to a people column
      // (the מושפעים picker is account-wide since round79). Add the assignees as
      // board subscribers first, like monday's native UI. Best-effort (ensureSubscribers
      // logs & continues), so the write below still surfaces any real error.
      await ensureSubscribers(getBoardId('decisions'), ids);
      await new החלטות1Board().item(decisionId).update({ [alias]: ids }).execute();
    } catch (err) {
      logger.error('useMyDecisions', `Error updating decision ${alias}`, err);
      setItems(prev);
    }
  }, []);
  const updateDecisionDecider = useCallback(
    (decisionId, people) => updatePeopleColumn('deciderID')(decisionId, people),
    [updatePeopleColumn]
  );
  const updateDecisionAffected = useCallback(
    (decisionId, people) => updatePeopleColumn('affectedID')(decisionId, people),
    [updatePeopleColumn]
  );

  // Optimistic inline date edit — `date` is a Date or null (clear). Write shape
  // mirrors useDecisions.updateDecisionDate (local Y-M-D string).
  const updateDecisionDate = useCallback(async (decisionId, date) => {
    const prev = itemsRef.current; // synchronous pre-edit snapshot for revert
    dirtyIdsRef.current.add(String(decisionId)); // protect this row from a seeded revalidate
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
    dirtyIdsRef.current.add(String(decisionId)); // protect this row from a seeded revalidate
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
    idList.forEach((id) => dirtyIdsRef.current.add(String(id))); // keep them removed through a seeded revalidate
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
    updateDecisionDecider,
    updateDecisionAffected,
    updateDecisionName,
    softDeleteDecisions,
    refresh,
  };
}

// Warm the My-Decisions view cache in the background (used by App.jsx's
// post-boot prefetch). Runs the SAME default first-page query the hook seeds
// from — including the decider creator-as-default-decider fallback — and writes
// it into the sub-tab's view cache. Never touches React state; swallows + logs
// its own errors so it can never crash the UI. No-ops (returns false) when the
// board / user / sub-tab column aren't mapped yet.
export async function prefetchMyDecisions(subTab = 'decider', { currentUser, context } = {}) {
  try {
    const userId = resolveUserId(currentUser, context);
    const boardId = getBoardId('decisions');
    if (!userId || !boardId || !isMyDecisionsConfigured(subTab)) return false;
    const key = makeViewCacheKey('myDecisions', { userId, boardId, subTab });
    if (!key) return false;
    const res = await decisionsItemsQuery(buildMyDecisionsWhere({ subTab, userId })).execute();
    let list = res.items || [];
    // Mirror the hook's creator-as-default-decider fallback so the warmed cache
    // matches what the view shows (decider sub-tab only).
    if (subTab === 'decider' && getColumns('decisions')?.decisionCreatorID?.id) {
      try {
        const createdRes = await decisionsItemsQuery({ decisionCreatorID: String(userId) }).execute();
        const have = new Set(list.map((d) => String(d.id)));
        const fallback = (createdRes.items || []).filter(
          (d) => !have.has(String(d.id)) && (!Array.isArray(d.deciderID) || d.deciderID.length === 0)
        );
        list = [...list, ...fallback];
      } catch (creatorErr) {
        logger.warn('useMyDecisions', 'prefetch creator-fallback failed', creatorErr);
      }
    }
    writeViewCache(key, list, res.cursor || null);
    return true;
  } catch (err) {
    logger.warn('useMyDecisions', 'prefetch failed', err);
    return false;
  }
}

export default useMyDecisions;
