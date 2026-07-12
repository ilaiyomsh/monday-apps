import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { החלטות1Board } from '@api/BoardSDK.js';
import { api, formatValue } from '../utils/mondayApi/monday-client.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import { MondayContext } from '@generated/contexts/MondayContext.jsx';
import logger from '../utils/logger';
import { useOptimisticRows, isTempId, isRealId, nextTempId } from './useOptimisticRows.js';
import { useStatusOptions } from './useStatusOptions.js';

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

// How many decision items to pull per page while scanning the decisions board
// for those linked to this discussion (mirrors useMyDecisions / the aggregate paging).
const DECISIONS_PAGE_SIZE = 100;
// Hard stop on pagination so a huge/misconfigured board can't loop forever
// (mirrors BoardSDK.AggregateBuilder's guard — up to DECISIONS_PAGE_GUARD pages).
const DECISIONS_PAGE_GUARD = 20;

// Load the decisions linked to THIS discussion by reading the DECISIONS board
// and filtering on the DECISION-side link (decisions.discussionLinkID) — the
// board_relation that create actually populates.
//
// WHY the decision side (not the discussion side): a naive reload would read the
// discussions board's decisionsBoardLinkID, but the decisions board is mapped
// MANUALLY in Settings (no bidirectional reflection column), so a decision's own
// discussionLinkID write does NOT reflect into discussions.decisionsBoardLinkID —
// that column stays EMPTY. Reading it therefore returned nothing: created
// decisions "disappeared" on re-entering a discussion, and the Topics per-point
// decision counts (which intersect a point's linked ids with the LOADED
// decisions) stayed 0. The decision-side link IS populated, so we read from
// there and the reload is reliable.
//
// monday query_params can't filter a board_relation by linked item id (it
// matches by NAME, not id — see BoardSDK.ItemsQueryBuilder), so we scan the
// board page-by-page and keep, CLIENT-SIDE, only the decisions whose
// discussionLinkID links to `discussionId`. Each kept decision is deserialized
// via BoardSDK.mapItem — the SAME alias parse used everywhere (name,
// decisionStatusID, deciderID, affectedID, decisionDateID, discussionLinkID, …) —
// so the returned row shape is unchanged for the rest of the hook.
async function fetchDecisionsByDiscussion(discussionId) {
  const decisionsBoardId = getBoardId('decisions');
  const decisionColumns = getColumns('decisions') || {};
  const discussionLinkColId = decisionColumns?.discussionLinkID?.id;
  if (!decisionsBoardId || !discussionLinkColId) {
    // Graceful degradation — an unmapped decisions board / decision-side link
    // column is an EXPECTED state (decisions is mapped manually), NOT an error.
    warnUnmappedOnce({ discussionId, decisionsBoardId: decisionsBoardId || null, discussionLinkColId: discussionLinkColId || null });
    return [];
  }

  const target = String(discussionId);
  const out = [];
  let cursor = null;
  let guard = 0;
  do {
    const res = await new החלטות1Board()
      .items()
      .withPagination({ limit: DECISIONS_PAGE_SIZE, ...(cursor ? { cursor } : {}) })
      .execute();
    for (const it of res.items || []) {
      // discussionLinkID parses to { linkedItems, ids, text }; `ids` are the
      // linked discussion item ids. Keep only decisions linked to THIS discussion.
      const linkedIds = (it.discussionLinkID?.ids || []).map(String);
      if (linkedIds.includes(target)) out.push(it);
    }
    cursor = res.cursor || null;
    guard += 1;
  } while (cursor && guard < DECISIONS_PAGE_GUARD);

  return out;
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

// BEST-EFFORT mirror of the link onto the DISCUSSION side — the discussions
// board's `decisionsBoardLinkID` board_relation. Kept for completeness (so the
// discussions board shows the relation where it IS mapped), but the reload NO
// LONGER depends on it: fetchDecisionsByDiscussion reads the DECISION side
// (decisions.discussionLinkID) — see its comment.
//
// History (the "decisions vanish on re-entry" bug): the decisions board is
// mapped MANUALLY in Settings, so decisions.discussionLinkID and
// discussions.decisionsBoardLinkID are two INDEPENDENT one-way relations (no
// bidirectional reflection like the wizard-created tasks relation). The
// decision-side write does NOT populate the discussion side, so this
// discussion-side column is typically EMPTY — reading it is exactly what made
// created decisions disappear on remount. The load now reads the (populated)
// decision side; this write is a harmless extra. board_relation writes REPLACE,
// so the caller passes the FULL current linked-id set (existing + the new
// decision). Goes through api() → assertNoGraphQLErrors. No-ops (graceful
// degrade) when the board/column is unmapped.
async function linkDecisionsToDiscussion(discussionId, linkedDecisionIds) {
  const discussionsBoardId = getBoardId('discussions');
  const linkColId = getColumns('discussions')?.decisionsBoardLinkID?.id;
  if (!discussionsBoardId || !linkColId) {
    warnUnmappedOnce({ discussionId, action: 'linkDecisionsToDiscussion', discussionsBoardId: discussionsBoardId || null, linkColId: linkColId || null });
    return;
  }
  const ids = [...new Set((linkedDecisionIds || []).map(String))];
  await api(
    `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
    }`,
    {
      boardId: String(discussionsBoardId),
      itemId: String(discussionId),
      cv: JSON.stringify({ [linkColId]: formatValue('board_relation', { linkedItems: ids.map((id) => ({ id })) }) }),
    },
    'useDecisions.linkDecisionsToDiscussion'
  );
}

export function useDecisions(discussionId) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Current user id — used to stamp the decision creator (decisionCreatorID) and
  // the default decider (deciderID) on create. Read MondayContext SOFTLY
  // (useContext, not useMondayContext) so the hook still works in surfaces/tests
  // rendered without a MondayProvider; stamping simply no-ops when unavailable.
  const ctxApi = useContext(MondayContext);
  const currentUserId = ctxApi?.currentUser?.id ?? ctxApi?.context?.user?.id ?? null;

  // Optimistic-row engine (shared with useTasks): queues edits made on a
  // freshly-added row BEFORE its real id arrives, stashes create args for retry,
  // and — crucially for the eventually-consistent decisions board_relation —
  // PROTECTS a just-created real id from a refresh-merge eviction until the
  // relation index surfaces it. Protection is marked the instant the real id is
  // known (before any flush), so a concurrent create's refresh can never drop a
  // just-created decision; a deleted decision is unprotected immediately so it's
  // never resurrected. (Replaces the old per-hook recentlyCreatedRef map.)
  const {
    enqueueEdit, drainEdits, stashCreateArgs, getCreateArgs, forgetRow,
    protectRealId, unprotectRealId, mergeServerList,
  } = useOptimisticRows();
  // Local aliases so the call sites below read naturally.
  const rememberCreated = protectRealId;
  const forgetCreated = unprotectRealId;
  // Live handle to the per-field update fns so createDecision's reconcile step
  // can FLUSH queued edits through the SAME mutations a committed row uses
  // (assigned each render, just before the hook returns).
  const flushersRef = useRef({});

  // Reload-persistence (Task 1): the authoritative set of REAL decision ids
  // linked to THIS discussion. Seeded from the load (the decisions already
  // linked) and kept current as decisions are created/deleted, so a create's
  // discussion-side write (linkDecisionsToDiscussion) sends the FULL set and
  // never clobbers siblings. `linkWriteChainRef` SERIALIZES those writes per
  // hook so concurrent creates apply in order (board_relation writes REPLACE).
  const linkedIdsRef = useRef(new Set());
  const linkWriteChainRef = useRef(Promise.resolve());

  useEffect(() => {
    if (!discussionId) { setItems([]); setLoading(false); linkedIdsRef.current = new Set(); return; }
    // Fresh discussion → reset the link set; the fetch below UNIONS the server's
    // linked decisions into it (union, not replace, so a decision created during
    // the initial load isn't dropped from the set).
    linkedIdsRef.current = new Set();
    let cancelled = false;
    async function fetch() {
      try {
        setLoading(true);
        const fetchedItems = await fetchDecisionsByDiscussion(discussionId);
        if (!cancelled) {
          setItems(fetchedItems);
          // Seed the discussion-link set with the decisions ALREADY linked, so a
          // create appends to (never clobbers) them. Union — see the effect note.
          fetchedItems.forEach((i) => linkedIdsRef.current.add(String(i.id)));
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
  // after it appeared. Instead we MERGE via the shared, multi-row-safe
  // mergeServerList: server items win, every in-flight temp row is kept, and
  // every just-created (protected) real row the relation index hasn't surfaced
  // yet is kept until it does. A soft-deleted / dismissed row is already gone
  // from `current` AND unprotected, so it is never resurrected.
  const refresh = useCallback(async () => {
    if (!discussionId) return;
    try {
      const fetchedItems = await fetchDecisionsByDiscussion(discussionId);
      // Keep the discussion-link set comprehensive (union server ids); deletes
      // prune it, so a later create's discussion-side write reflects the truth.
      fetchedItems.forEach((i) => linkedIdsRef.current.add(String(i.id)));
      setItems((current) => mergeServerList(current, fetchedItems));
    } catch (err) {
      logger.error('useDecisions', 'Error refreshing decisions', { discussionId, err });
    }
  }, [discussionId, mergeServerList]);

  const updateDecisionName = async (decisionId, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    let prev = [];
    setItems((current) => {
      prev = current;
      return current.map((i) => (i.id === decisionId ? { ...i, name: trimmed } : i));
    });
    if (!isRealId(decisionId)) { enqueueEdit(decisionId, 'name', trimmed); return; }
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
    if (!isRealId(decisionId)) { enqueueEdit(decisionId, 'decisionStatusID', status); return; }
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
    if (!isRealId(decisionId)) { enqueueEdit(decisionId, 'decisionPriorityID', priority); return; }
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
    if (!isRealId(decisionId)) { enqueueEdit(decisionId, 'decisionDateID', date); return; }
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
    if (!isRealId(decisionId)) { enqueueEdit(decisionId, 'affectedID', people); return; }
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
    if (!isRealId(decisionId)) { enqueueEdit(decisionId, 'deciderID', people); return; }
    try {
      const b = new החלטות1Board();
      await b.item(decisionId).update({ deciderID: (people || []).map((p) => Number(p.id)) }).execute();
    } catch (err) { logger.error('useDecisions', 'Error updating decision', err); setItems(prev); }
  };

  const deleteDecision = useCallback(async (decisionId) => {
    if (!decisionId) return false;
    forgetCreated(decisionId); // so a later create's refresh can't resurrect it
    linkedIdsRef.current.delete(String(decisionId)); // drop from the discussion-link set (no re-link on a later create)
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
        // Now really gone: drop it from the discussion-link set so a later create
        // doesn't re-link a deleted decision. (Kept in the set until here so an
        // undo — or a create during the grace window — leaves the link intact.)
        linkedIdsRef.current.delete(String(id));
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
      // PROTECT the real id IMMEDIATELY — before ANY of the awaited link writes
      // below — so a CONCURRENT create's fire-and-forget refresh() can never
      // evict this just-created decision during the eventually-consistent
      // relation window (this is what makes rapid multi-row creation stable).
      rememberCreated(realId);
      // (1) DECISION-side link: populates the decision item's own "דיון" column
      //     (discussionLinkID) — the RELOAD source of truth
      //     (fetchDecisionsByDiscussion filters the decisions board by it).
      //     create_item ignores board_relation values, so it's set here via the
      //     verified change_multiple_column_values path.
      await b.item(realId).update({ discussionLinkID: { linkedItems: [{ id: discussionId }] } }).execute();
      // (2) DISCUSSION-side link (BEST-EFFORT): mirror onto
      //     discussions.decisionsBoardLinkID. The decisions board is mapped
      //     manually (no reflection column), so (1) does NOT populate it; the
      //     reload NO LONGER reads it (it reads the decision side above) — we
      //     still write it where mapped for a consistent discussions board.
      //     Serialize the write per hook (board_relation writes REPLACE) so
      //     concurrent creates don't clobber each other, sending the FULL
      //     linked-id set. Awaited so a hard failure still flags the row (retryable).
      linkedIdsRef.current.add(String(realId));
      {
        const myWrite = linkWriteChainRef.current
          .catch(() => {}) // ignore a PRIOR create's failure so the chain survives
          .then(() => linkDecisionsToDiscussion(discussionId, [...linkedIdsRef.current]));
        linkWriteChainRef.current = myWrite.catch(() => {}); // keep chain alive for the next create
        await myWrite; // MY rejection → this try's catch (retryable row)
      }
      // (3) POINT-side link (optional): append the decision to the topic point's
      //     pointDecisionsLinkID relation so the per-point counter reflects it.
      if (pointId) await linkDecisionToPoint(pointId, realId, existingLinkedIds);
      // RECONCILE: swap temp→real IN PLACE (the spread preserves any edits the
      // user applied while the row was still optimistic). IDEMPOTENT: if the temp
      // row is somehow gone and the real row isn't present either, RE-ADD it so a
      // freshly-created decision can never vanish.
      setItems((prev) => {
        let swapped = false;
        const next = prev.map((i) => {
          if (i.id === tempId) { swapped = true; return { ...i, id: realId, _createFailed: false }; }
          return i;
        });
        if (!swapped && !next.some((i) => String(i.id) === String(realId))) {
          next.push({ id: realId, name: trimmed, decisionStatusID: status, decisionPriorityID: priority, affectedID: affected, decisionDateID: effectiveDate, _createFailed: false });
        }
        return next;
      });
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
      // Silent refresh so the list reflects the authoritative server state —
      // fire-and-forget so it doesn't delay the caller or flash a loader. `.catch`
      // guarantees a floating refresh promise can never surface as an unhandled
      // rejection (→ global error handler → unexpected-error popup).
      Promise.resolve(refresh()).catch(() => {});
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

  // Default a NEW decision to the "בתוקף" (in-effect) status. Resolved from the
  // decisions status column's OWN labels at runtime (NOT a hardcoded index) so it
  // tracks the column; null when the label isn't found / options aren't loaded
  // yet (then no default is applied). Mounting useStatusOptions here also warms
  // that column's option cache as soon as the discussion opens, so the id is
  // ready by the time the user creates a decision.
  const { options: decisionStatusOptions } = useStatusOptions('decisions', 'decisionStatusID');
  const defaultDecisionStatusId =
    decisionStatusOptions.find((o) => (o.label || '').trim() === 'בתוקף')?.id ?? null;

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
      prepend = false,
    } = opts || {};
    // Default the decision date to today; explicit null means "no date".
    const effectiveDate = date === undefined ? new Date() : date;
    const deciderId = decider != null ? (decider?.id ?? decider) : currentUserId;
    // Default status → "בתוקף" unless the caller passed an explicit status.
    const effectiveStatus = status != null ? status : defaultDecisionStatusId;
    const norm = { status: effectiveStatus, priority, affected, effectiveDate, deciderId, pointId, existingLinkedIds };

    const tempId = nextTempId();
    stashCreateArgs(tempId, { trimmed, norm });
    // Optimistic row is APPENDED by default (bottom of its group). The top blue
    // "החלטה חדשה" button passes { prepend:true } so its new decision lands at the
    // TOP of the topmost group / list instead. `prepend` is a placement hint only
    // (not part of `norm`), so it never reaches runCreateDecision's board write.
    const optimisticRow = {
      id: tempId,
      name: trimmed,
      decisionStatusID: effectiveStatus,
      decisionPriorityID: priority,
      affectedID: affected,
      decisionDateID: effectiveDate,
    };
    setItems((prev) => (prepend ? [optimisticRow, ...prev] : [...prev, optimisticRow]));
    return runCreateDecision(tempId, trimmed, norm);
  }, [discussionId, currentUserId, runCreateDecision, stashCreateArgs, defaultDecisionStatusId]);

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
