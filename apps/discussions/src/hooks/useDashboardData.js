import { useEffect, useMemo, useRef, useState } from 'react';
import { דיונים1Board, משימות1Board, החלטות1Board } from '@api/BoardSDK.js';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { useSettings } from '@generated/contexts/SettingsContext.jsx';
import { resolveDoneStatusIds } from '@generated/components/EffectivenessTab/effectiveness.js';
import logger from '@generated/utils/logger.js';

// round152 — the discussions dashboard reads the THREE boards whole (mirrors the
// My Tasks "read the tasks board client-side" pattern) and hands the raw,
// parse-close rows to the pure aggregator. Filtering/metrics/time-range all run
// client-side over these arrays, so switching a filter never re-fetches.

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

/**
 * Loads + shapes the dashboard's raw data. Returns
 * { data: { discussions, tasks, decisions, doneStatusIds }, loading, error, reload }.
 * The three loads run in parallel; a refresh token forces a reload.
 */
export function useDashboardData() {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [nonce, setNonce] = useState(0);
  const runIdRef = useRef(0);

  const { doneId } = useStatusOptions('tasks');
  const { settings } = useSettings();
  const prefDoneIds = settings?.preferences?.delayedDoneStatusIds;
  const doneStatusIds = useMemo(() => resolveDoneStatusIds(prefDoneIds, doneId), [prefDoneIds, doneId]);

  useEffect(() => {
    const runId = ++runIdRef.current;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const [rawDiscussions, rawTasks, rawDecisions] = await Promise.all([
          loadAll((cursor) => new דיונים1Board().items()
            .withColumns(['discussionDateID', 'discussionTypeID', 'discussionLeadID', 'participantsID'])
            .withPagination(cursor ? { cursor } : { limit: PAGE_LIMIT }), 'discussions'),
          loadAll((cursor) => new משימות1Board().items()
            .withColumns(['statusID', 'deadlineID', 'discussionLinkID'])
            .withPagination(cursor ? { cursor } : { limit: PAGE_LIMIT }), 'tasks'),
          loadAll((cursor) => new החלטות1Board().items()
            .withColumns(['discussionLinkID'])
            .withPagination(cursor ? { cursor } : { limit: PAGE_LIMIT }), 'decisions'),
        ]);
        if (cancelled || runId !== runIdRef.current) return;

        const discussions = rawDiscussions.map((d) => ({
          id: String(d.id),
          name: d.name,
          date: d.discussionDateID instanceof Date ? d.discussionDateID : null,
          type: d.discussionTypeID || null,
          lead: Array.isArray(d.discussionLeadID) ? d.discussionLeadID : [],
          participants: Array.isArray(d.participantsID) ? d.participantsID : [],
        }));
        const tasks = rawTasks.map((t) => ({
          id: String(t.id),
          discussionId: firstLinkedId(t.discussionLinkID),
          statusID: t.statusID ?? null,
          deadlineID: t.deadlineID instanceof Date ? t.deadlineID : null,
        }));
        const decisions = rawDecisions.map((d) => ({
          id: String(d.id),
          discussionId: firstLinkedId(d.discussionLinkID),
        }));

        setState({ data: { discussions, tasks, decisions, doneStatusIds }, loading: false, error: null });
      } catch (err) {
        logger.error('useDashboardData', 'טעינת נתוני הדשבורד נכשלה', err);
        if (!cancelled && runId === runIdRef.current) setState({ data: null, loading: false, error: err });
      }
    })();

    return () => { cancelled = true; };
  }, [nonce, doneStatusIds]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

export default useDashboardData;
