import { useEffect, useState } from 'react';
import { החלטות1Board, דיונים1Board } from '@api/BoardSDK.js';
import { api, parseValue, cvSelection } from '../../utils/mondayApi/monday-client.js';
import { getColumns } from '../../utils/mondayApi/board-config-store.js';
import { pickLatestPreviousId } from './previousScope.js';
import logger from '@generated/utils/logger.js';

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

  return { decisions, loading };
}
