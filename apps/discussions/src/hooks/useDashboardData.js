import { useEffect, useMemo, useRef, useState } from 'react';
import { דיונים1Board, משימות1Board, החלטות1Board } from '@api/BoardSDK.js';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { useSettings } from '@generated/contexts/SettingsContext.jsx';
import { useMondayContext } from '@generated/contexts/MondayContext.jsx';
import { resolveUserId } from '@generated/hooks/useMyTasks.js';
import { resolveDoneStatusIds } from '@generated/components/EffectivenessTab/effectiveness.js';
import { getBoardId } from '@generated/utils/mondayApi/board-config-store.js';
import { makeViewCacheKey, readViewCache, writeViewCache } from '@generated/utils/viewCache.js';
import logger from '@generated/utils/logger.js';

// round152 — the discussions dashboard reads the THREE boards whole (mirrors the
// My Tasks "read the tasks board client-side" pattern) and hands the raw,
// parse-close rows to the pure aggregator. Filtering/metrics/time-range all run
// client-side over these arrays, so switching a filter never re-fetches.
//
// round181b — the dashboard now shares the personal-view instant-cache pattern
// (viewCache): the hook SEEDS synchronously from a versioned localStorage entry
// for an instant first paint, then revalidates silently; the app also PRE-WARMS
// that entry at boot (prefetchDashboard) so the first open is instant too. The
// three datasets are stored as a single wrapped payload (`items: [{…}]`) — the
// cache's date-tagging handles the nested Date fields (discussion date / deadline).

const PAGE_LIMIT = 500;
const MAX_PAGES = 20; // hard backstop (≤10k items/board) so a bad cursor can't loop forever

// Follow the pagination cursor to the end and return every item.
async function loadAll(makeQuery, label) {
  let all = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const q = makeQuery(cursor);
    // eslint-disable-next-line no-await-in-loop
    const res = await q.execute();
    all = all.concat(res.items || []);
    cursor = res.cursor || null;
    if (!cursor) return all;
  }
  logger.warn('useDashboardData', `${label}: hit MAX_PAGES — results may be truncated`, { loaded: all.length });
  return all;
}

const firstLinkedId = (rel) => {
  const id = rel?.ids?.[0] ?? rel?.linkedItems?.[0]?.id;
  return id != null ? String(id) : null;
};

// The three whole-board queries, factored out so the hook AND the background
// prefetch build byte-identical reads (same narrowed columns / page size).
const dashboardQueries = {
  discussions: (cursor) => new דיונים1Board().items()
    .withColumns(['discussionDateID', 'discussionTypeID', 'discussionLeadID', 'participantsID'])
    .withPagination(cursor ? { cursor } : { limit: PAGE_LIMIT }),
  tasks: (cursor) => new משימות1Board().items()
    .withColumns(['statusID', 'deadlineID', 'discussionLinkID'])
    .withPagination(cursor ? { cursor } : { limit: PAGE_LIMIT }),
  decisions: (cursor) => new החלטות1Board().items()
    .withColumns(['discussionLinkID'])
    .withPagination(cursor ? { cursor } : { limit: PAGE_LIMIT }),
};

// Pure: shape the three raw board reads into the parse-close arrays the pure
// aggregator consumes. Exported for unit tests (no live board / React needed).
export function shapeDashboardData(rawDiscussions, rawTasks, rawDecisions) {
  const discussions = (rawDiscussions || []).map((d) => ({
    id: String(d.id),
    name: d.name,
    date: d.discussionDateID instanceof Date ? d.discussionDateID : null,
    type: d.discussionTypeID || null,
    lead: Array.isArray(d.discussionLeadID) ? d.discussionLeadID : [],
    participants: Array.isArray(d.participantsID) ? d.participantsID : [],
  }));
  const tasks = (rawTasks || []).map((t) => ({
    id: String(t.id),
    discussionId: firstLinkedId(t.discussionLinkID),
    statusID: t.statusID ?? null,
    deadlineID: t.deadlineID instanceof Date ? t.deadlineID : null,
  }));
  const decisions = (rawDecisions || []).map((d) => ({
    id: String(d.id),
    discussionId: firstLinkedId(d.discussionLinkID),
  }));
  return { discussions, tasks, decisions };
}

// Load + shape all three boards (parallel). Shared by the hook and the prefetch.
async function loadDashboardDatasets() {
  const [rawDiscussions, rawTasks, rawDecisions] = await Promise.all([
    loadAll(dashboardQueries.discussions, 'discussions'),
    loadAll(dashboardQueries.tasks, 'tasks'),
    loadAll(dashboardQueries.decisions, 'decisions'),
  ]);
  return shapeDashboardData(rawDiscussions, rawTasks, rawDecisions);
}

// Cache key for the dashboard's raw datasets. The data is board-global (not
// user-specific), but we namespace by user like the other views for a stable,
// per-instance key. Null until the board id + user resolve.
function dashboardCacheKey(userId) {
  return makeViewCacheKey('dashboard', { userId, boardId: getBoardId('discussions') });
}

/**
 * Background pre-warm (App boot / idle): run the SAME whole-board reads the hook
 * seeds from and write the wrapped payload into the view cache. Never touches
 * React state; swallows + logs its own errors. No-ops when boards/user aren't
 * ready. Mirrors prefetchMyTasks / prefetchMyDecisions.
 */
export async function prefetchDashboard({ currentUser, context } = {}) {
  try {
    const userId = resolveUserId(currentUser, context);
    const key = dashboardCacheKey(userId);
    if (!key || !getBoardId('discussions')) return false;
    const data = await loadDashboardDatasets();
    writeViewCache(key, [data], null);
    return true;
  } catch (err) {
    logger.warn('useDashboardData', 'prefetch failed', err);
    return false;
  }
}

/**
 * Loads + shapes the dashboard's raw data. Returns
 * { data: { discussions, tasks, decisions, doneStatusIds }, loading, error, reload }.
 * Seeds instantly from the view cache when warm; the three loads run in parallel;
 * a refresh token forces a reload.
 */
export function useDashboardData() {
  const { context, currentUser } = useMondayContext();
  const userId = resolveUserId(currentUser, context);
  const cacheKey = dashboardCacheKey(userId);

  // Instant-cache seed (stale-while-revalidate): on the FIRST mount only, seed
  // SYNCHRONOUSLY from the versioned view cache for an instant first paint. A
  // miss ⇒ behavior is exactly as before (loading:true). The seed is ALWAYS
  // revalidated by the fetch below, which overwrites the cache.
  const seedRef = useRef(undefined);
  if (seedRef.current === undefined) {
    const hit = cacheKey ? readViewCache(cacheKey) : null;
    const payload = hit && Array.isArray(hit.items) && hit.items[0] ? hit.items[0] : null;
    seedRef.current = payload && Array.isArray(payload.discussions) ? payload : null;
  }
  const seed = seedRef.current;

  const [state, setState] = useState({ data: seed || null, loading: seed ? false : true, error: null });
  const [nonce, setNonce] = useState(0);
  const runIdRef = useRef(0);
  // The first fetch after a seed is a SILENT background revalidate (keep the
  // seeded data visible, no loader); consumed on the first run.
  const silentSeedRef = useRef(!!seed);

  const { doneId } = useStatusOptions('tasks');
  const { settings } = useSettings();
  const prefDoneIds = settings?.preferences?.delayedDoneStatusIds;
  const doneStatusIds = useMemo(() => resolveDoneStatusIds(prefDoneIds, doneId), [prefDoneIds, doneId]);

  useEffect(() => {
    const runId = ++runIdRef.current;
    let cancelled = false;
    const silent = silentSeedRef.current;
    silentSeedRef.current = false;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const data = await loadDashboardDatasets();
        if (cancelled || runId !== runIdRef.current) return;
        setState({ data, loading: false, error: null });
        if (cacheKey) writeViewCache(cacheKey, [data], null);
      } catch (err) {
        logger.error('useDashboardData', 'טעינת נתוני הדשבורד נכשלה', err);
        if (!cancelled && runId === runIdRef.current) {
          // A silent revalidate failure keeps the seeded data on screen; a cold
          // failure (no seed) surfaces the error.
          setState((s) => (silent && s.data ? { ...s, loading: false } : { data: null, loading: false, error: err }));
        }
      }
    })();

    return () => { cancelled = true; };
    // round181 — depend on `nonce` (explicit reload) + `cacheKey` (resolves once
    // when the board/user are known). doneStatusIds is an AGGREGATION-only input
    // (never referenced by the queries), so it must NOT trigger a refetch; it is
    // merged into the returned data below via a cheap memo instead.
  }, [nonce, cacheKey]);

  const data = useMemo(
    () => (state.data ? { ...state.data, doneStatusIds } : null),
    [state.data, doneStatusIds]
  );

  return { data, loading: state.loading, error: state.error, reload: () => setNonce((n) => n + 1) };
}

export default useDashboardData;
