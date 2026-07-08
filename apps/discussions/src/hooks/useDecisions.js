import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { החלטות1Board } from '@api/BoardSDK.js';
import { api, parseValue, cvSelection, formatValue } from '../utils/mondayApi/monday-client.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import { MondayContext } from '@generated/contexts/MondayContext.jsx';
import logger from '../utils/logger';
import { useOptimisticRows, isTempId, nextTempId } from './useOptimisticRows.js';

// Undo window for deferred decision deletion — must match the delete toast's
// auto-hide duration so the real delete fires exactly when "בטל" disappears.
// (Mirrors useTasks' DELETE_GRACE_MS.)
const DELETE_GRACE_MS = 6000;

// The decisions board is mapped MANUALLY in Settings (not wizard-created), so an
// unmapped board/relation is an EXPECTED state, not an error — every surface
// degrades to an empty view. Warn once per session (not per fetch) so the log
// isn't flooded while the owner hasn't mapped the board yet.
let warnedUnmapped = false;
function warnUnmappedOnce(detail) {
  if (warnedUnmapped) return;
  warnedUnmapped = true;
  logger.warn('useDecisions', 'לוח ההחלטות או עמודת "לוח החלטות" אינם ממופים — מפו אותם בהגדרות', detail);
}

// yyyy-mm-dd for monday date columns (local date, mirrors useTasks).
function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Discussion-side fetch: from the discussion id we read the decisionsBoardLinkID
// board_relation column and pull its linked_items (the decisions), deserializing
// ALL configured decisions columns. Server-side query_params filtering on a
// board_relation column does NOT work (it matches by item NAME, not id), so we
// always read the relation FROM the discussion side — exactly like
// useTasks.fetchTasksByDiscussion.
async function fetchDecisionsByDiscussion(discussionId) {
  const decisionsBoardId = getBoardId('decisions');
  const discussionColumns = getColumns('discussions') || {};
  const decisionsLinkColId = discussionColumns?.decisionsBoardLinkID?.id;
  if (!decisionsBoardId || !decisionsLinkColId) {
    // Graceful degradation — unmapped board/relation is NOT an error.
    warnUnmappedOnce({ discussionId, decisionsBoardId: decisionsBoardId || null, decisionsLinkColId: decisionsLinkColId || null });
    return [];
  }

  const decisionColumns = getColumns('decisions') || {};
  const mapped = Object.entries(decisionColumns).filter(([, col]) => col?.id);
  const decisionCols = mapped.map(([, col]) => col.id);
  const decisionCv = cvSelection(mapped.map(([, col]) => col.type));

  const data = await api(
    `query ($discussionId: [ID!], $decisionsLinkCol: [String!], $decisionCols: [String!]) {
      items(ids: $discussionId) {
        column_values(ids: $decisionsLinkCol) {
          ... on BoardRelationValue {
            linked_items {
              id
              name
              created_at
              column_values(ids: $decisionCols) { ${decisionCv} }
            }
          }
        }
      }
    }`,
    {
      discussionId: [String(discussionId)],
      decisionsLinkCol: [String(decisionsLinkColId)],
      decisionCols,
    },
    'useDecisions.fetchDecisionsByDiscussion'
  );

  const linkedItems = data?.items?.[0]?.column_values?.[0]?.linked_items || [];
  return linkedItems.map((item) => {
    const byId = {};
    (item.column_values || []).forEach((cv) => {
      byId[cv.id] = cv;
    });
    const out = { id: String(item.id), name: item.name, created_at: item.created_at };
    Object.entries(decisionColumns).forEach(([alias, col]) => {
      if (!col?.id) return;
      out[alias] = parseValue(col.type, byId[col.id]);
    });
    return out;
  });
}

// Write a newly-created item's id into a topic POINT's (subitem's)
// board_relation link column (pointDecisionsLinkID / pointTasksLinkID). Uses
// the SUBITEMS board id (resolved from the point item — subitem columns are
// written with the subitem board's own id, same path as useTopics'
// pointCheckedID writes) and APPENDS to the existing linked ids —
// board_relation writes REPLACE, so the caller passes the current ids via
// `existingLinkedIds` to avoid an extra query.
async function linkItemToPoint(alias, pointId, itemId, existingLinkedIds = []) {
  const linkCol = getColumns('topics')?.[alias];
  if (!linkCol?.id) {
    logger.warn('useDecisions', 'לא ניתן לקשר פריט לנקודה — עמודת הקישור אינה ממופה בהגדרות', { alias, pointId, itemId });
    return;
  }
  const data = await api(
    `query ($ids: [ID!]) { items(ids: $ids) { id board { id } } }`,
    { ids: [String(pointId)] },
    'useDecisions.linkItemToPoint.resolveBoard'
  );
  const subBoardId = data?.items?.[0]?.board?.id;
  if (!subBoardId) {
    logger.warn('useDecisions', 'לא ניתן לקשר פריט לנקודה — לוח הסאב־אייטמים לא נמצא', { alias, pointId, itemId });
    return;
  }
  const ids = [...new Set([...(existingLinkedIds || []).map(String), String(itemId)])];
  await api(
    `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
    }`,
    {
      boardId: String(subBoardId),
      itemId: String(pointId),
      cv: JSON.stringify({ [linkCol.id]: formatValue('board_relation', { linkedItems: ids.map((id) => ({ id })) }) }),
    },
    'useDecisions.linkItemToPoint'
  );
}

// Decision → point link (used by createDecision's pointId option).
const linkDecisionToPoint = (pointId, decisionId, existingLinkedIds = []) =>
  linkItemToPoint('pointDecisionsLinkID', pointId, decisionId, existingLinkedIds);

// Task → point link — the SAME code path, over pointTasksLinkID. Exported for
// DiscussionCard's point-scoped quick-create task flow (useTasks.createTask
// knows nothing about points).
export const linkTaskToPoint = (pointId, taskId, existingLinkedIds = []) =>
  linkItemToPoint('pointTasksLinkID', pointId, taskId, existingLinkedIds);

export function useDecisions(discussionId) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Current user id — used to stamp the decision creator (decisionCreatorID) and
  // the default decider (deciderID) on create. Read MondayContext SOFTLY
  // (useContext, not useMondayContext) so the hook still works in surfaces/tests
  // rendered without a MondayProvider; stamping simply no-ops when unavailable.
  const ctxApi = useContext(MondayContext);
  const currentUserId = ctxApi?.currentUser?.id ?? ctxApi?.context?.user?.id ?? null;

  // Ids created VERY recently (real monday ids), each with an expiry timestamp.
  // The disappearing-row fix uses this to preserve a just-created decision in a
  // silent refresh whose eventually-consistent relation read hasn't caught up
  // yet — WITHOUT resurrecting rows that were deleted (delete forgets the id).
  const recentlyCreatedRef = useRef(new Map());
  const RECENT_CREATE_MS = 15000;
  const rememberCreated = (id) => { recentlyCreatedRef.current.set(String(id), Date.now() + RECENT_CREATE_MS); };
  const forgetCreated = (id) => { recentlyCreatedRef.current.delete(String(id)); };

  // Optimistic-row bookkeeping shared with useTasks: queue edits made on a
  // freshly-added row BEFORE its real id arrives + stash create args for retry
  // (see useOptimisticRows).
  const { enqueueEdit, drainEdits, stashCreateArgs, getCreateArgs, forgetRow } = useOptimisticRows();
  // Live handle to the per-field update fns so createDecision's reconcile step
  // can FLUSH queued edits through the SAME mutations a committed row uses
  // (assigned each render, just before the hook returns).
  const flushersRef = useRef({});

  useEffect(() => {
    if (!discussionId) { setItems([]); setLoading(false); return; }
    let cancelled = false;
    async function fetch() {
      try {
        setLoading(true);
        const fetchedItems = await fetchDecisionsByDiscussion(discussionId);
        if (!cancelled) {
          setItems(fetchedItems);
          logger.info('useDecisions', 'Decisions fetch completed', { discussionId, count: fetchedItems.length });
        }
      } catch (err) {
        logger.error('useDecisions', 'Error fetching decisions', { discussionId, err });
      }
      finally { if (!cancelled) setLoading(false); }
    }
    fetch();
    return () => { cancelled = true; };
  }, [discussionId]);

  // Silent refetch — re-pulls the discussion's decisions WITHOUT toggling
  // `loading` (no skeleton flash). Used after a create so the list reflects the
  // authoritative server state.
  //
  // IMPORTANT (disappearing-row fix): a decision's discussion link
  // (discussionLinkID board_relation) is written AFTER create_item in a separate
  // mutation, and monday's board_relation index is eventually-consistent — so an
  // immediate refetch here often does NOT yet return a just-created decision.
  // Replacing the list with that stale result made the new row vanish moments
  // after it appeared. Instead we MERGE: server items win, and any locally-known
  // row the server hasn't returned yet is KEPT **only if it was created in the
  // last RECENT_CREATE_MS** (tracked in recentlyCreatedRef). Time-bounding it to
  // fresh creates means a soft-deleted decision (whose id is forgotten on delete)
  // is NOT resurrected by a later create's refresh, and a genuinely-removed row
  // isn't kept forever. The next refetch reconciles everything.
  const refresh = useCallback(async () => {
    if (!discussionId) return;
    try {
      const fetchedItems = await fetchDecisionsByDiscussion(discussionId);
      setItems((current) => {
        const serverIds = new Set(fetchedItems.map((i) => String(i.id)));
        const now = Date.now();
        // Prune expired create-markers so the map can't grow unbounded.
        for (const [id, expiry] of recentlyCreatedRef.current) {
          if (expiry < now) recentlyCreatedRef.current.delete(id);
        }
        // Keep a locally-known row the server's (eventually-consistent) relation
        // read hasn't returned yet when it is EITHER:
        //   • a still-optimistic temp row — an in-flight create that hasn't
        //     reconciled to its real id yet. The server CANNOT return it (no real
        //     id exists), so a CONCURRENT create's refresh must NEVER drop it.
        //     Dropping temp rows here was the "second rapid create disappears"
        //     bug: creating a decision and immediately creating a second one fired
        //     the first create's fire-and-forget refresh() while the second row was
        //     still temp; that refresh removed it, and the second create's reconcile
        //     then found no temp row to swap (temp→real) — so the freshly-created
        //     decision vanished from the UI even though it existed on the board.
        //   • a still-fresh create (real id) made in the last RECENT_CREATE_MS
        //     whose relation index hasn't surfaced it yet (the original
        //     single-create disappearing-row fix).
        // A soft-deleted / dismissed row is already gone from `current` (and its
        // create-marker forgotten), so neither branch can resurrect it.
        const missing = current.filter((i) => {
          const sid = String(i.id);
          if (serverIds.has(sid)) return false;   // server returned it — use its copy
          if (sid.startsWith('temp-')) return true; // in-flight optimistic create — always keep
          return recentlyCreatedRef.current.has(sid);
        });
        return [...fetchedItems, ...missing];
      });
    } catch (err) {
      logger.error('useDecisions', 'Error refreshing decisions', { discussionId, err });
    }
  }, [discussionId]);

  const updateDecisionName = async (decisionId, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (i.id === decisionId ? { ...i, name: trimmed } : i));
    });
    if (isTempId(decisionId)) { enqueueEdit(decisionId, 'name', trimmed); return; }
    try {
      const b = new החלטות1Board();
      await b.item(decisionId).update({ name: trimmed }).execute();
    } catch (err) { logger.error('useDecisions', 'Error updating decision', err); setItems(prev); }
  };

  const updateDecisionStatus = async (decisionId, status) => {
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (i.id === decisionId ? { ...i, decisionStatusID: status } : i));
    });
    if (isTempId(decisionId)) { enqueueEdit(decisionId, 'decisionStatusID', status); return; }
    try {
      const b = new החלטות1Board();
      await b.item(decisionId).update({ decisionStatusID: status }).execute();
    } catch (err) { logger.error('useDecisions', 'Error updating decision', err); setItems(prev); }
  };

  const updateDecisionPriority = async (decisionId, priority) => {
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (i.id === decisionId ? { ...i, decisionPriorityID: priority } : i));
    });
    if (isTempId(decisionId)) { enqueueEdit(decisionId, 'decisionPriorityID', priority); return; }
    try {
      const b = new החלטות1Board();
      await b.item(decisionId).update({ decisionPriorityID: priority }).execute();
    } catch (err) { logger.error('useDecisions', 'Error updating decision', err); setItems(prev); }
  };

  const updateDecisionDate = async (decisionId, date) => {
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (i.id === decisionId ? { ...i, decisionDateID: date } : i));
    });
    if (isTempId(decisionId)) { enqueueEdit(decisionId, 'decisionDateID', date); return; }
    try {
      const b = new החלטות1Board();
      const f = date ? formatDate(date) : null;
      await b.item(decisionId).update({ decisionDateID: f }).execute();
    } catch (err) { logger.error('useDecisions', 'Error updating decision', err); setItems(prev); }
  };

  const updateDecisionAffected = async (decisionId, people) => {
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (i.id === decisionId ? { ...i, affectedID: people } : i));
    });
    if (isTempId(decisionId)) { enqueueEdit(decisionId, 'affectedID', people); return; }
    try {
      const b = new החלטות1Board();
      await b.item(decisionId).update({ affectedID: (people || []).map((p) => Number(p.id)) }).execute();
    } catch (err) { logger.error('useDecisions', 'Error updating decision', err); setItems(prev); }
  };

  // Change the decider (מחליט) AFTER creation — a people column, single person by
  // convention but written as an id array like affected. Optimistic + revert.
  // (Round 7: the decider cell used to be display-only, so this was missing.)
  const updateDecisionDecider = async (decisionId, people) => {
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (i.id === decisionId ? { ...i, deciderID: people } : i));
    });
    if (isTempId(decisionId)) { enqueueEdit(decisionId, 'deciderID', people); return; }
    try {
      const b = new החלטות1Board();
      await b.item(decisionId).update({ deciderID: (people || []).map((p) => Number(p.id)) }).execute();
    } catch (err) { logger.error('useDecisions', 'Error updating decision', err); setItems(prev); }
  };

  const deleteDecision = useCallback(async (decisionId) => {
    if (!decisionId) return false;
    forgetCreated(decisionId); // so a later create's refresh can't resurrect it
    const prev = [...items];
    setItems((current) => current.filter((i) => i.id !== decisionId));
    // A temp row never reached the board — local removal is enough.
    if (isTempId(decisionId)) { forgetRow(decisionId); return true; }
    try {
      await api(`mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`, { itemId: decisionId }, 'useDecisions.deleteDecision');
      return true;
    } catch (err) {
      logger.error('useDecisions', 'Error deleting decision', err);
      setItems(prev);
      return false;
    }
  }, [items, forgetRow]);

  // Deferred ("soft") delete with an undo window: the rows vanish from the UI
  // immediately, but the real delete_item fires only after DELETE_GRACE_MS — so
  // the returned `undo()` (wired to the toast's "בטל" button) can cancel the
  // pending delete and restore the rows. (Mirrors useTasks.softDeleteTasks.)
  const softDeleteDecisions = useCallback((ids) => {
    const idList = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!idList.length) return { undo: () => {}, count: 0 };
    const idSet = new Set(idList.map(String));
    // Forget any fresh-create markers so a create's refresh during this undo
    // window can't resurrect a row the user just (soft-)deleted.
    idList.forEach((id) => forgetCreated(id));
    const removed = items.filter((i) => idSet.has(String(i.id))); // snapshot for restore
    setItems((current) => current.filter((i) => !idSet.has(String(i.id))));

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      idList.forEach((id) => {
        // Temp rows never reached the board — just drop their bookkeeping.
        if (isTempId(id)) { forgetRow(id); return; }
        api(`mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`, { itemId: id }, 'useDecisions.softDeleteDecisions')
          .catch((err) => logger.error('useDecisions', 'Error deleting decision', err));
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
  }, [items]);

  // Create a decision linked to this discussion and add it to the list
  // optimistically. `text` is the decision wording (= the item NAME). `opts`:
  //   { status, priority, affected: people[], date: Date|null, decider,
  //     pointId, existingLinkedIds }
  //   - date: omitted → today; explicit null → no date.
  //   - decider: defaults to the current user.
  //   - pointId + existingLinkedIds: also APPEND the new decision to the topic
  //     point's (subitem's) pointDecisionsLinkID relation. The caller passes the
  //     point's current linked ids to avoid an extra read (relation writes replace).
  // Run (or RE-run, on retry) the background create for ONE optimistic decision
  // row. Extracted from createDecision so a failed create can be retried against
  // the SAME temp row. `norm` = the normalized create fields (see createDecision).
  const runCreateDecision = useCallback(async (tempId, trimmed, norm) => {
    const { status, priority, affected, effectiveDate, deciderId, pointId, existingLinkedIds } = norm;
    // Clear any prior error flag (retry path).
    setItems((prev) => prev.map((i) => (i.id === tempId ? { ...i, _createFailed: false } : i)));
    try {
      const b = new החלטות1Board();
      const decisionCols = getColumns('decisions') || {};
      // monday's create_item IGNORES board_relation values, so the discussion
      // link (discussionLinkID) — and the point link — are set AFTER creation
      // via change_multiple_column_values (the verified write path).
      const data = { name: trimmed };
      if (status != null) data.decisionStatusID = status; // status is a label id; 0 is valid
      if (priority != null) data.decisionPriorityID = priority;
      // Stamp the decision creator with the current user (drives the decision-tier
      // "creator" role for the permissions matrix). Skipped when unmapped / no user.
      if (currentUserId != null && decisionCols?.decisionCreatorID?.id) {
        data.decisionCreatorID = [Number(currentUserId)];
      }
      // Decider defaults to the current user (opts.decider overrides).
      if (deciderId != null && decisionCols?.deciderID?.id) {
        data.deciderID = [Number(deciderId)];
      }
      if (affected.length && decisionCols?.affectedID?.id) {
        data.affectedID = affected.map((p) => Number(p?.id ?? p));
      }
      if (effectiveDate) data.decisionDateID = formatDate(effectiveDate);
      const created = await b.item().create(data, { createLabelsIfMissing: true }).execute();
      const realId = created.id;
      await b.item(realId).update({ discussionLinkID: { linkedItems: [{ id: discussionId }] } }).execute();
      if (pointId) await linkDecisionToPoint(pointId, realId, existingLinkedIds);
      // RECONCILE: swap temp→real IN PLACE; the spread preserves any edits the
      // user already applied to the row while it was still optimistic.
      setItems((prev) => prev.map((i) => (i.id === tempId ? { ...i, id: realId, _createFailed: false } : i)));
      // FLUSH edits queued while the row had no real id, through the SAME update
      // mutations a committed row uses (last-write-wins per field). Awaited so the
      // silent refresh below reads the persisted values (never clobbers a flush).
      const edits = drainEdits(tempId);
      if (edits) {
        const f = flushersRef.current;
        const jobs = [];
        if ('name' in edits) jobs.push(f.updateDecisionName(realId, edits.name));
        if ('decisionStatusID' in edits) jobs.push(f.updateDecisionStatus(realId, edits.decisionStatusID));
        if ('decisionPriorityID' in edits) jobs.push(f.updateDecisionPriority(realId, edits.decisionPriorityID));
        if ('decisionDateID' in edits) jobs.push(f.updateDecisionDate(realId, edits.decisionDateID));
        if ('affectedID' in edits) jobs.push(f.updateDecisionAffected(realId, edits.affectedID));
        if ('deciderID' in edits) jobs.push(f.updateDecisionDecider(realId, edits.deciderID));
        await Promise.allSettled(jobs);
      }
      forgetRow(tempId);
      // Mark this id as freshly created so the silent refresh below (and any that
      // fire during the eventual-consistency window) preserve the row even if the
      // relation index hasn't surfaced it yet — the disappearing-row fix.
      rememberCreated(realId);
      // Silent refresh so the list reflects the authoritative server state —
      // fire-and-forget so it doesn't delay the caller or flash a loader.
      refresh();
      return { id: realId };
    } catch (err) {
      logger.error('useDecisions', 'Error creating decision', err);
      // Keep the row in a clear ERROR state (never silently drop it) so the user
      // can retry or dismiss it; the Hebrew error toast is raised via the logger
      // sink. Queued edits + create args are kept so a retry can still flush them.
      setItems((prev) => prev.map((i) => (i.id === tempId ? { ...i, _createFailed: true } : i)));
      return null;
    }
  }, [discussionId, refresh, currentUserId, drainEdits, forgetRow]);

  // Create a decision linked to this discussion, inserting an OPTIMISTIC row that
  // shows immediately AND is fully editable right away. `text` is the wording
  // (= the item NAME). See the header comment for the `opts` shape.
  const createDecision = useCallback((text, opts = {}) => {
    const trimmed = (text || '').trim();
    if (!trimmed || !discussionId) return null;
    if (!getBoardId('decisions')) {
      // Graceful degradation — never fire a query when the board is unmapped.
      warnUnmappedOnce({ discussionId, action: 'createDecision' });
      return null;
    }
    const {
      status = null,
      priority = null,
      affected = [],
      date = undefined,
      decider = null,
      pointId = null,
      existingLinkedIds = [],
    } = opts || {};
    // Default the decision date to today; explicit null means "no date".
    const effectiveDate = date === undefined ? new Date() : date;
    const deciderId = decider != null ? (decider?.id ?? decider) : currentUserId;
    const norm = { status, priority, affected, effectiveDate, deciderId, pointId, existingLinkedIds };

    const tempId = nextTempId();
    stashCreateArgs(tempId, { trimmed, norm });
    setItems((prev) => [...prev, {
      id: tempId,
      name: trimmed,
      decisionStatusID: status,
      decisionPriorityID: priority,
      affectedID: affected,
      decisionDateID: effectiveDate,
    }]);
    return runCreateDecision(tempId, trimmed, norm);
  }, [discussionId, currentUserId, runCreateDecision, stashCreateArgs]);

  // Retry a failed create against the same optimistic row (row error affordance).
  const retryCreate = useCallback((tempId) => {
    const args = getCreateArgs(tempId);
    if (!args) return null;
    return runCreateDecision(tempId, args.trimmed, args.norm);
  }, [getCreateArgs, runCreateDecision]);

  // Dismiss a failed optimistic row: it never reached the board, so just remove
  // it locally and drop its bookkeeping (no API call).
  const dismissRow = useCallback((tempId) => {
    forgetRow(tempId);
    forgetCreated(tempId);
    setItems((prev) => prev.filter((i) => i.id !== tempId));
  }, [forgetRow]);

  // Expose the latest per-field update fns to the create-reconcile flush step
  // (read lazily at flush time — no stale closures, no createDecision churn).
  flushersRef.current = {
    updateDecisionName, updateDecisionStatus, updateDecisionPriority,
    updateDecisionDate, updateDecisionAffected, updateDecisionDecider,
  };

  return {
    items,
    loading,
    refresh,
    createDecision,
    retryCreate,
    dismissRow,
    updateDecisionName,
    updateDecisionStatus,
    updateDecisionPriority,
    updateDecisionDate,
    updateDecisionAffected,
    updateDecisionDecider,
    deleteDecision,
    softDeleteDecisions,
  };
}

export { fetchDecisionsByDiscussion };
