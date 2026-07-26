import { useCallback, useEffect, useRef, useState } from 'react';
import { החלטות1Board, דיונים1Board } from '@api/BoardSDK.js';
import { api, parseValue, cvSelection } from '../../utils/mondayApi/monday-client.js';
import { getColumns, getBoardId } from '../../utils/mondayApi/board-config-store.js';
import { ensureSubscribers } from '../../utils/mondayApi/subscribers.js';
import { pickLatestPreviousId } from './previousScope.js';
import logger from '@generated/utils/logger.js';

// yyyy-mm-dd for a Date — the wire format monday's date column expects (matches
// useDecisions.formatDate exactly).
function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/*
 * round275 — decisions side of the "דיונים קודמים" tab. Resolves which previous
 * discussion(s) to read, then returns their DECISIONS (read-only). Mirrors the
 * tasks resolution in usePreviousTasksData, but decisions link the OTHER way:
 * the decision-side `discussionLinkID` board_relation is the populated link (the
 * discussions-side reflection can be empty — see useDecisions), and monday can't
 * server-filter a board_relation by item id, so we scan the decisions board and
 * keep client-side the decisions linked to the resolved source discussion(s).
 *
 * Source resolution (same rules as the tasks scope):
 *   - linked mode: the current discussion's previousDiscussionID link (one).
 *   - by-type + scope='last': the MOST RECENT previous discussion of the type.
 *   - by-type + scope='all' : EVERY previous discussion of the type.
 *
 * `enabled` keeps the board scan dormant until the decisions mode is actually
 * shown (the tab arms it only when mode==='decisions').
 */

const DECISIONS_PAGE = 200;
const PAGE_GUARD = 30;

// Scan the decisions board, keeping decisions whose decision-side discussionLinkID
// links to ANY of `sourceIds`. Exported for the (pure-ish) membership test to be
// reasoned about; the scan itself is IO.
export function decisionLinksToAny(decision, sourceIdSet) {
  const ids = (decision?.discussionLinkID?.ids || []).map(String);
  return ids.some((id) => sourceIdSet.has(id));
}

async function fetchDecisionsForDiscussions(sourceIds) {
  const set = new Set((sourceIds || []).map(String));
  if (!set.size) return [];
  const out = [];
  let cursor = null;
  let guard = 0;
  do {
    const res = await new החלטות1Board().items()
      .withPagination({ limit: DECISIONS_PAGE, ...(cursor ? { cursor } : {}) })
      .execute();
    for (const it of res.items || []) {
      if (decisionLinksToAny(it, set)) out.push(it);
    }
    cursor = res.cursor || null;
    guard += 1;
  } while (cursor && guard < PAGE_GUARD);
  return out;
}

// Resolve the previous-discussion source id(s) for the current tab state.
async function resolveSourceIds(discussion, byType, scope) {
  if (!discussion?.id) return [];
  if (!byType) {
    const prevCol = getColumns('discussions')?.previousDiscussionID?.id;
    if (!prevCol) return [];
    const data = await api(
      `query ($id: ID!, $col: [String!]) {
         items(ids: [$id]) { column_values(ids: $col) { ${cvSelection(['board_relation'])} } }
       }`,
      { id: String(discussion.id), col: [prevCol] },
      'usePreviousDecisions.resolveLinked'
    );
    const rel = parseValue('board_relation', data?.items?.[0]?.column_values?.[0]);
    const prevId = rel?.linkedItems?.[0]?.id || rel?.ids?.[0] || null;
    return prevId ? [String(prevId)] : [];
  }
  // by-type: discussions sharing this type (id + date), excluding the current one.
  const typeText = discussion?.discussionTypeID || null;
  if (!typeText) return [];
  const res = await new דיונים1Board().items()
    .withColumns(['discussionTypeID', 'discussionDateID'])
    .withPagination({ limit: 200 })
    .execute();
  const sameType = (res.items || []).filter((d) => d.discussionTypeID === typeText);
  if (scope === 'last') {
    const lastId = pickLatestPreviousId(sameType, discussion.id);
    return lastId ? [lastId] : [];
  }
  return sameType.map((d) => String(d.id)).filter((id) => id !== String(discussion.id));
}

export function usePreviousDecisions(discussion, { byType, scope, enabled = true } = {}) {
  const [decisions, setDecisions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !discussion?.id) { setDecisions([]); return undefined; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const sourceIds = await resolveSourceIds(discussion, byType, scope);
        if (cancelled) return;
        const items = sourceIds.length ? await fetchDecisionsForDiscussions(sourceIds) : [];
        if (!cancelled) setDecisions(items);
      } catch (err) {
        if (!err?.__loggedId) logger.error('usePreviousDecisions', 'טעינת החלטות מדיונים קודמים נכשלה', err);
        if (!cancelled) setDecisions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, byType, scope, discussion?.id, discussion?.discussionTypeID]);

  // ---- Inline editing (round279) --------------------------------------------
  // Previous decisions are REAL board items (never optimistic temp rows), so the
  // updaters are the simple optimistic-with-revert shape: patch local state, write
  // to the decisions board, roll back on failure. Each mirrors the corresponding
  // useDecisions updater's write path (same board, same column aliases) — the only
  // difference is there's no temp-row edit queue to feed here. A write to the
  // shared decisions board is naturally reflected in the current-discussion tab on
  // its next scan.
  //
  // The pre-edit snapshot for the revert is read from a ref (kept in sync with the
  // committed `decisions`), NOT captured inside the setDecisions functional
  // updater — React invokes that updater lazily, so it isn't reliably set by the
  // time an async write rejects.
  const decisionsRef = useRef([]);
  useEffect(() => { decisionsRef.current = decisions; }, [decisions]);

  const writeField = useCallback(async (id, changes, buildPayload) => {
    const prev = decisionsRef.current;
    setDecisions(prev.map((d) => (String(d.id) === String(id) ? { ...d, ...changes } : d)));
    try {
      await new החלטות1Board().item(id).update(await buildPayload()).execute();
    } catch (err) {
      if (!err?.__loggedId) logger.error('usePreviousDecisions', 'עדכון החלטה מדיון קודם נכשל', err);
      setDecisions(prev);
    }
  }, []);

  const updateDecisionName = useCallback(async (id, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    await writeField(id, { name: trimmed }, async () => ({ name: trimmed }));
  }, [writeField]);

  const updateDecisionStatus = useCallback((id, status) =>
    writeField(id, { decisionStatusID: status }, async () => ({ decisionStatusID: status })), [writeField]);

  const updateDecisionPriority = useCallback((id, priority) =>
    writeField(id, { decisionPriorityID: priority }, async () => ({ decisionPriorityID: priority })), [writeField]);

  const updateDecisionTracking = useCallback((id, tracking) =>
    writeField(id, { decisionTrackingID: tracking }, async () => ({ decisionTrackingID: tracking })), [writeField]);

  const updateDecisionDate = useCallback((id, date) =>
    writeField(id, { decisionDateID: date }, async () => ({ decisionDateID: date ? formatDate(date) : null })), [writeField]);

  // People columns: monday rejects assigning a non-subscriber, so pre-subscribe the
  // account-wide people before the write (round104 pattern from useDecisions).
  const writePeople = useCallback(async (id, alias, people) => {
    await writeField(id, { [alias]: people }, async () => {
      const ids = (people || []).map((p) => Number(p.id)).filter(Number.isFinite);
      await ensureSubscribers(getBoardId('decisions'), ids);
      return { [alias]: ids };
    });
  }, [writeField]);

  const updateDecisionDecider = useCallback((id, people) => writePeople(id, 'deciderID', people), [writePeople]);
  const updateDecisionAffected = useCallback((id, people) => writePeople(id, 'affectedID', people), [writePeople]);

  return {
    decisions,
    loading,
    updateDecisionName,
    updateDecisionStatus,
    updateDecisionPriority,
    updateDecisionTracking,
    updateDecisionDate,
    updateDecisionDecider,
    updateDecisionAffected,
  };
}
