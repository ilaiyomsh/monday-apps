import { useState, useEffect, useCallback, useRef } from 'react';
import { api, formatValue } from '../utils/mondayApi/monday-client.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import { loadOrder, saveTopicOrder, savePointOrder, applyOrder } from '../utils/topicOrder.js';
import { loadDiscussedPointIds, saveDiscussedPointIds } from '../utils/discussedStore.js';
import { useMondayContext } from '../contexts/MondayContext.jsx';
import { useOptimisticRows } from './useOptimisticRows.js';
import logger from '../utils/logger.js';

// Undo window for the deferred point (subitem) delete — matches the delete
// toast's auto-hide, so the real delete_item fires exactly when "בטל" disappears.
const DELETE_GRACE_MS = 6000;

/*
 * Model (confirmed with the user):
 *   TOPIC  = an item on the topics board   -> a collapsible section in the UI.
 *   POINTS = that topic item's SUBITEMS    -> the rows under the section.
 *
 * Two independent markers (product decision):
 *   - "discussed" (נדון): a LIVE, DISPLAY-ONLY tick used while running a meeting.
 *     NOT a board column — kept app-local in monday.storage (discussedStore) and
 *     has zero effect on the export.
 *   - "not for discussion" (לא לדיון): a PERSISTED board checkbox, settable on a
 *     TOPIC (topicNotForDiscussionID) or a POINT (pointNotForDiscussionID, on the
 *     subitems board). This is the real flag the export filters on (export keeps
 *     only items NOT marked).
 * Topics are read off the discussion's topicsBoardLinkID relation (bidirectional).
 */
function readCheckbox(columnValues, columnId) {
  if (!columnId) return false;
  const cv = (columnValues || []).find((c) => c.id === columnId);
  return cv?.checked === true;
}

// Read the FIRST person id off a people column's value (the item/point creator we
// stamp on create). Returns a string id or null.
function readFirstPersonId(columnValues, columnId) {
  if (!columnId) return null;
  const cv = (columnValues || []).find((c) => c.id === columnId);
  const first = (cv?.persons_and_teams || [])[0];
  return first?.id != null ? String(first.id) : null;
}

// Read a long_text/text column's value (generic `text` field). Empty string when
// unset/unmapped.
function readText(columnValues, columnId) {
  if (!columnId) return '';
  const cv = (columnValues || []).find((c) => c.id === columnId);
  return cv?.text || '';
}

// Read a status column's stable label id (StatusValue.index) off an item's
// column_values. null = no value selected. (id 0 is a valid label.)
function readStatus(columnValues, columnId) {
  if (!columnId) return null;
  const cv = (columnValues || []).find((c) => c.id === columnId);
  return cv && cv.index != null ? cv.index : null;
}

// Read a board_relation column's linked item ids off column_values. [] when the
// column is unmapped / the value is empty. Used for the per-point decisions /
// tasks link counters (pointDecisionsLinkID / pointTasksLinkID).
function readLinkedIds(columnValues, columnId) {
  if (!columnId) return [];
  const cv = (columnValues || []).find((c) => c.id === columnId);
  return (cv?.linked_item_ids || []).map(String);
}

export function useTopics(discussionId, { onSuccess, onLoading, onDismiss } = {}) {
  const { currentUser } = useMondayContext();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // The set of "discussed" point ids — FALLBACK only, used when the board's
  // pointCheckedID checkbox is NOT mapped (app-local, persisted in monday.storage).
  const discussedRef = useRef(new Set());
  // Live mirror of items so id-resolution can read the latest optimistic→real
  // id mapping without sitting in a callback's dependency array.
  const itemsRef = useRef([]);
  // Optimistic creates in flight: temp id -> Promise<real monday id | null>.
  // Lets a follow-up action (e.g. add a point under a just-created topic) wait
  // for the real id instead of firing against the bogus temp id.
  const pendingCreates = useRef(new Map());
  // Monotonic temp-id seq — Date.now() collides when the user types fast.
  const tempSeq = useRef(0);
  // Request-supersede guard: each fetchTopics bumps this and captures the value;
  // a response only commits if it's still the latest. Without it, switching from
  // a slow discussion to a fast one lets the slow response land last and render
  // its topics (and its saved drag-order) under the wrong discussion's card.
  const reqIdRef = useRef(0);
  // tempId -> already-created real topic id. create_item and the follow-up order
  // save are two steps; if the order save fails, the topic already exists on the
  // board. Remembering its id lets a retry RESUME from the order save instead of
  // calling create_item again (which would leave a duplicate topic).
  const createdRealIdRef = useRef(new Map());
  // Retry bookkeeping for failed optimistic creates. Topics flushes pending EDITS
  // via resolveRealId (await), so only the create-args stash is used here.
  const { stashCreateArgs, getCreateArgs, forgetRow } = useOptimisticRows();

  const fetchTopics = useCallback(async (options = {}) => {
    const { showLoader = true } = options;
    if (!discussionId) { setItems([]); setLoading(false); return; }
    // Claim this request; a later fetchTopics (e.g. switching discussions) bumps
    // reqIdRef, and any commit below is skipped once superseded.
    const reqId = ++reqIdRef.current;
    try {
      if (showLoader) setLoading(true);

      const topicsBoardLinkId = getColumns('discussions')?.topicsBoardLinkID?.id;
      if (!topicsBoardLinkId) { setItems([]); return; }
      const topicCols = getColumns('topics') || {};
      const topicNfdId = topicCols.topicNotForDiscussionID?.id || null;
      const topicPriorityId = topicCols.topicPriorityID?.id || null;
      const topicCreatorId = topicCols.topicCreatorID?.id || null;
      const pointNfdId = topicCols.pointNotForDiscussionID?.id || null;
      const pointCheckedId = topicCols.pointCheckedID?.id || null; // "האם נידונה"
      const pointCreatorId = topicCols.pointCreatorID?.id || null;
      const pointResponsesId = topicCols.pointResponsesID?.id || null;
      // Per-point board_relation links to the decisions/tasks created FROM that
      // point (SUBITEM columns) — drive the החלטות/משימות counters in TopicsTab.
      const pointDecisionsLinkId = topicCols.pointDecisionsLinkID?.id || null;
      const pointTasksLinkId = topicCols.pointTasksLinkID?.id || null;
      // Mapped topic-item column ids to fetch; empty is fine (monday returns []),
      // so an unmapped column reads back empty.
      const topicReadCols = [topicNfdId, topicPriorityId, topicCreatorId].filter(Boolean);
      const pointReadCols = [pointNfdId, pointCheckedId, pointCreatorId, pointResponsesId, pointDecisionsLinkId, pointTasksLinkId].filter(Boolean);

      // Load the app-local "discussed" set alongside the board read (fallback when
      // the pointCheckedID board column isn't mapped).
      const [data, discussedSet] = await Promise.all([
        api(
          `query ($discussionId: ID!, $relationCol: [String!], $topicCols: [String!], $pointCols: [String!]) {
            items(ids: [$discussionId]) {
              column_values(ids: $relationCol) {
                ... on BoardRelationValue {
                  linked_items {
                    id
                    name
                    column_values(ids: $topicCols) { id text ... on CheckboxValue { checked } ... on StatusValue { index } ... on PeopleValue { persons_and_teams { id } } }
                    subitems {
                      id
                      name
                      board { id }
                      column_values(ids: $pointCols) { id text ... on CheckboxValue { checked } ... on PeopleValue { persons_and_teams { id } } ... on BoardRelationValue { linked_item_ids } }
                    }
                  }
                }
              }
            }
          }`,
          { discussionId, relationCol: [topicsBoardLinkId], topicCols: topicReadCols, pointCols: pointReadCols }
        ),
        loadDiscussedPointIds(discussionId),
      ]);

      discussedRef.current = discussedSet;
      // discussed is board-backed when pointCheckedID is mapped; otherwise it falls
      // back to the app-local storage set.
      const discussedFromBoard = !!pointCheckedId;
      const linkedTopics = data?.items?.[0]?.column_values?.[0]?.linked_items || [];
      const topicItems = linkedTopics.map((topic) => ({
        id: String(topic.id),
        name: topic.name,
        // Board column is "האם להציג?" — CHECKED means show. `notForDiscussion`
        // here means "hidden/dimmed", so it's the inverse of the board checkbox.
        notForDiscussion: !readCheckbox(topic.column_values, topicNfdId),
        priority: readStatus(topic.column_values, topicPriorityId),
        creatorId: readFirstPersonId(topic.column_values, topicCreatorId),
        _subitems: (topic.subitems || []).map((sub) => ({
          id: String(sub.id),
          name: sub.name,
          boardId: sub.board?.id ? String(sub.board.id) : null,
          notForDiscussion: !readCheckbox(sub.column_values, pointNfdId),
          discussed: discussedFromBoard
            ? readCheckbox(sub.column_values, pointCheckedId)
            : discussedSet.has(String(sub.id)),
          creatorId: readFirstPersonId(sub.column_values, pointCreatorId),
          responses: readText(sub.column_values, pointResponsesId),
          // Linked decision/task ids created FROM this point ([] when the link
          // column is unmapped) — counter = ids.length in TopicsTab.
          decisionIds: readLinkedIds(sub.column_values, pointDecisionsLinkId),
          taskIds: readLinkedIds(sub.column_values, pointTasksLinkId),
        })),
      }));

      // Apply the user's saved drag order (topics + points per topic).
      const order = await loadOrder(discussionId);
      if (reqId !== reqIdRef.current) return; // a newer fetch superseded this one
      setItems(applyOrder(topicItems, order));
    } catch (err) {
      if (!err?.__loggedId) logger.error('useTopics', 'טעינת הנושאים נכשלה', err);
    } finally {
      // Only the latest request controls the shared loading flag.
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [discussionId]);

  useEffect(() => {
    let cancelled = false;
    fetchTopics({ showLoader: true });
    return () => { cancelled = true; };
  }, [fetchTopics]);

  // Keep the items mirror current for the id resolver below.
  useEffect(() => { itemsRef.current = items; }, [items]);

  // Resolve a possibly-optimistic id to its real monday id. Awaits the in-flight
  // create when the item is still being saved; falls back to the items mirror.
  // Returns null when the item has no real id yet (never created / failed).
  const resolveRealId = useCallback(async (maybeTempId) => {
    const sid = String(maybeTempId);
    if (!sid.startsWith('temp-')) return sid;
    const pending = pendingCreates.current.get(sid);
    if (pending) {
      try { return await pending; } catch (err) {
        if (!err?.__loggedId) logger.error('useTopics', 'המתנה ליצירת פריט נכשלה', err);
        return null;
      }
    }
    for (const t of itemsRef.current) {
      if (String(t.id) === sid) return t._realId ? String(t._realId) : null;
      for (const s of (t._subitems || [])) {
        if (String(s.id) === sid) return s._realId ? String(s._realId) : null;
      }
    }
    return null;
  }, []);

  // Resolve a POINT to its real write target for an edit: await any in-flight
  // create (so an edit made BEFORE the subitem id arrived still lands) and read
  // the FRESH boardId from the live items (the captured `point` keeps a stale
  // null boardId until the create resolves). Returns null when the point has no
  // real id yet (create still pending/failed) — the caller keeps the optimistic
  // local value. This is what flushes queued point edits on reconcile.
  const resolvePointTarget = useCallback(async (point) => {
    const realId = await resolveRealId(point?.id);
    if (!realId) return null;
    let boardId = point?.boardId || null;
    if (!boardId) {
      for (const t of itemsRef.current) {
        const s = (t._subitems || []).find(
          (x) => String(x.id) === String(point?.id) || String(x._realId) === String(realId),
        );
        if (s) { boardId = s.boardId || null; break; }
      }
    }
    return boardId ? { itemId: realId, boardId } : null;
  }, [resolveRealId]);

  // Background create for ONE optimistic topic row. Extracted from addTopic so a
  // FAILED create can be re-run (retry) against the same temp row (the temp id
  // stays the React key + color seed, so nothing flashes or jumps).
  const runTopicCreate = useCallback((tempId, trimmed, creatorId, position = 'top') => {
    // Clear any prior error flag (retry path) + mark saving.
    setItems((prev) => prev.map((t) => (t.id === tempId ? { ...t, _pending: true, _createFailed: false } : t)));

    const promise = (async () => {
      // RESUME GUARD: on a retry where create_item already succeeded (only the
      // order save failed), reuse the existing real id instead of creating a
      // second topic.
      let createdId = createdRealIdRef.current.get(tempId) || '';
      if (!createdId) {
        const boardId = getBoardId('topics');
        const relation = getColumns('topics')?.discussionLinkID;
        const dispCol = getColumns('topics')?.topicNotForDiscussionID;
        const creatorCol = getColumns('topics')?.topicCreatorID;
        const columnValues = {};
        if (relation?.id) {
          columnValues[relation.id] = formatValue(relation.type || 'board_relation', { linkedItems: [{ id: discussionId }] });
        }
        // "האם להציג?" CHECKED = show; default a new topic to shown.
        if (dispCol?.id) {
          columnValues[dispCol.id] = formatValue('checkbox', true);
        }
        // Stamp the creator (avatar) into the mapped people column.
        if (creatorCol?.id && creatorId) {
          columnValues[creatorCol.id] = formatValue('people', [creatorId]);
        }
        // round115 — stamp the creation date (today) into the mapped date column.
        const topicCreatedCol = getColumns('topics')?.topicCreationDateID;
        if (topicCreatedCol?.id) {
          columnValues[topicCreatedCol.id] = formatValue('date', new Date());
        }
        const created = await api(
          `mutation ($boardId: ID!, $name: String!, $columnValues: JSON!) {
            create_item(board_id: $boardId, item_name: $name, column_values: $columnValues) { id }
          }`,
          { boardId, name: trimmed, columnValues: JSON.stringify(columnValues) }
        );
        createdId = String(created?.create_item?.id || '');
        if (!createdId) throw new Error('create_item returned no id');
        createdRealIdRef.current.set(tempId, createdId);
      }
      // round201 — persist the ON-SCREEN order (the optimistic row already sits
      // where the user added it: the toolbar button prepends, the bottom button
      // appends), mapping this temp row to its new real id and skipping other
      // still-saving temp rows. The previous `[createdId, ...saved]` save pinned
      // every new topic to the TOP regardless of where it was inserted, which
      // made the bottom "נושא חדש" button's topic jump above the first group.
      const orderedIds = itemsRef.current
        .map((t) => {
          const id = String(t.id);
          if (id === tempId) return createdId;
          if (t._realId) return String(t._realId);
          return id.startsWith('temp-') ? null : id;
        })
        .filter(Boolean);
      // Safety net: the items mirror updates post-render, so if this row isn't
      // in it yet, fall back to inserting by the requested position.
      if (!orderedIds.includes(createdId)) {
        if (position === 'bottom') orderedIds.push(createdId);
        else orderedIds.unshift(createdId);
      }
      await saveTopicOrder(discussionId, orderedIds);
      return createdId;
    })();
    pendingCreates.current.set(tempId, promise);

    promise
      .then((createdId) => {
        // Swap in the real id in place — no full refetch (avoids the flash/jump).
        setItems((prev) => prev.map((t) => (t.id === tempId ? { ...t, _realId: createdId, _pending: false, _createFailed: false } : t)));
        forgetRow(tempId);
        createdRealIdRef.current.delete(tempId); // fully committed — drop the resume marker
      })
      .catch((err) => {
        if (!err?.__loggedId) logger.error('useTopics', 'הוספת נושא נכשלה', err);
        // Keep the row in a clear ERROR state (never silently drop it); the toast
        // is raised via the logger sink and the row exposes retry/delete.
        setItems((prev) => prev.map((t) => (t.id === tempId ? { ...t, _pending: false, _createFailed: true } : t)));
      })
      .finally(() => { pendingCreates.current.delete(tempId); })
      .catch((err) => { if (!err?.__loggedId) logger.error('useTopics', 'טיפול בתוצאת יצירת נושא נכשל', err); });
  }, [discussionId, forgetRow]);

  // Add a new TOPIC (item) linked to the discussion. Fully optimistic: the row
  // appears INSTANTLY as a normal topic (no fade/lock/spinner) and is editable
  // right away; the board write runs in the background (runTopicCreate).
  // round201 — options.position ('top' default | 'bottom') controls where the
  // optimistic row lands AND where the persisted order puts it: the toolbar
  // button keeps prepending, the bottom "נושא חדש" button appends below the
  // last group.
  const addTopic = useCallback((name, options = {}) => {
    if (!discussionId || !name?.trim()) return;
    const position = options.position === 'bottom' ? 'bottom' : 'top';
    const tempId = `temp-${++tempSeq.current}`;
    const trimmed = name.trim();
    const creatorId = currentUser?.id != null ? String(currentUser.id) : null;
    const row = { id: tempId, _realId: null, name: trimmed, notForDiscussion: false, creatorId, _subitems: [], _pending: true };
    setItems((prev) => (position === 'bottom' ? [...prev, row] : [row, ...prev]));
    stashCreateArgs(tempId, { kind: 'topic', name: trimmed, position });
    runTopicCreate(tempId, trimmed, creatorId, position);
  }, [discussionId, currentUser, stashCreateArgs, runTopicCreate]);

  // Background create for ONE optimistic point (subitem). Extracted from addPoint
  // so a FAILED create can be re-run (retry) against the same temp row. Resolves
  // the parent topic's real id first — a point added under a still-creating topic
  // waits for that id instead of failing.
  const runPointCreate = useCallback((topicId, tempId, trimmed) => {
    const creatorId = currentUser?.id != null ? String(currentUser.id) : null;
    // Clear any prior error flag (retry path) + mark saving.
    setItems((prev) => prev.map((topic) => ({
      ...topic,
      _subitems: (topic._subitems || []).map((s) => (s.id === tempId ? { ...s, _pending: true, _createFailed: false } : s)),
    })));

    const promise = (async () => {
      const parentRealId = await resolveRealId(topicId);
      if (!parentRealId) throw new Error('parent topic id unresolved');
      // "האם להציג?" CHECKED = show; default a new point to shown.
      const dispCol = getColumns('topics')?.pointNotForDiscussionID;
      const creatorCol = getColumns('topics')?.pointCreatorID;
      const cv = dispCol?.id ? { [dispCol.id]: formatValue('checkbox', true) } : {};
      // Stamp the point creator (avatar) into the mapped people column.
      if (creatorCol?.id && creatorId) {
        cv[creatorCol.id] = formatValue('people', [creatorId]);
      }
      // round115 — stamp the point's creation date (today) on the SUBITEMS board.
      const pointCreatedCol = getColumns('topics')?.pointCreationDateID;
      if (pointCreatedCol?.id) {
        cv[pointCreatedCol.id] = formatValue('date', new Date());
      }
      const res = await api(
        `mutation ($parentId: ID!, $name: String!, $cv: JSON!) {
          create_subitem(parent_item_id: $parentId, item_name: $name, column_values: $cv) { id board { id } }
        }`,
        { parentId: parentRealId, name: trimmed, cv: JSON.stringify(cv) }
      );
      const sub = res?.create_subitem;
      const subId = String(sub?.id || '');
      if (!subId) throw new Error('create_subitem returned no id');
      return { subId, boardId: sub?.board?.id ? String(sub.board.id) : null };
    })();
    // Expose the real id (not the {subId,boardId} pair) to resolveRealId.
    pendingCreates.current.set(tempId, promise.then((r) => r.subId, () => null));

    promise
      .then(({ subId, boardId }) => {
        setItems((prev) => prev.map((topic) => (
          topic.id === topicId
            ? { ...topic, _subitems: (topic._subitems || []).map((s) => (s.id === tempId ? { ...s, _realId: subId, boardId, _pending: false, _createFailed: false } : s)) }
            : topic
        )));
        forgetRow(tempId);
      })
      .catch((err) => {
        if (!err?.__loggedId) logger.error('useTopics', 'הוספת נקודה נכשלה', err);
        // Keep the point in a clear ERROR state (never silently drop it); the row
        // exposes retry/delete and the toast is raised via the logger sink.
        setItems((prev) => prev.map((topic) => (
          topic.id === topicId
            ? { ...topic, _subitems: (topic._subitems || []).map((s) => (s.id === tempId ? { ...s, _pending: false, _createFailed: true } : s)) }
            : topic
        )));
      })
      .finally(() => { pendingCreates.current.delete(tempId); })
      .catch((err) => { if (!err?.__loggedId) logger.error('useTopics', 'טיפול בתוצאת יצירת נקודה נכשל', err); });
  }, [resolveRealId, currentUser, forgetRow]);

  // Add a discussion POINT = a subitem under the topic. Fully optimistic: the
  // point appears INSTANTLY (no fade/lock/spinner) and is editable right away;
  // the board write runs in the background (runPointCreate).
  const addPoint = useCallback((topicId, pointName) => {
    if (!pointName?.trim()) return;
    const tempId = `temp-sub-${++tempSeq.current}`;
    const trimmed = pointName.trim();
    const creatorId = currentUser?.id != null ? String(currentUser.id) : null;
    setItems((prev) => prev.map((topic) => (
      topic.id === topicId
        ? { ...topic, _subitems: [...(topic._subitems || []), { id: tempId, _realId: null, name: trimmed, notForDiscussion: false, discussed: false, creatorId, responses: '', decisionIds: [], taskIds: [], boardId: null, _pending: true }] }
        : topic
    )));
    stashCreateArgs(tempId, { kind: 'point', name: trimmed, topicId });
    runPointCreate(topicId, tempId, trimmed);
  }, [currentUser, stashCreateArgs, runPointCreate]);

  // Retry a failed optimistic create (topic OR point) against the SAME temp row.
  // Reads the stashed create args; no-op if they were already forgotten (success
  // or dismissed). The row's error affordance calls this.
  const retryCreate = useCallback((id) => {
    const args = getCreateArgs(id);
    if (!args) return;
    if (args.kind === 'topic') {
      const creatorId = currentUser?.id != null ? String(currentUser.id) : null;
      runTopicCreate(id, args.name, creatorId, args.position || 'top');
    } else if (args.kind === 'point') {
      runPointCreate(args.topicId, id, args.name);
    }
  }, [getCreateArgs, runTopicCreate, runPointCreate, currentUser]);

  // Toggle the "discussed" (האם נידונה) flag on a POINT. Board-backed when the
  // pointCheckedID checkbox is mapped (persists to the subitems board); otherwise
  // falls back to the app-local monday.storage set. Optimistic either way.
  const togglePoint = useCallback(async (point, discussed) => {
    // Optimistic UI first (instant tick) — applies to both paths.
    setItems((prev) => prev.map((topic) => ({
      ...topic,
      _subitems: (topic._subitems || []).map((sub) => (sub.id === point.id ? { ...sub, discussed } : sub)),
    })));

    const checkedCol = getColumns('topics')?.pointCheckedID?.id;
    if (checkedCol) {
      // Board path — resolve the real write target (awaits an in-flight create so
      // a tick made before the subitem id arrived still persists).
      const target = await resolvePointTarget(point);
      if (!target) return; // create still pending/failed — keep the optimistic tick
      try {
        await api(
          `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
            change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
          }`,
          { boardId: target.boardId, itemId: target.itemId, cv: JSON.stringify({ [checkedCol]: formatValue('checkbox', discussed) }) }
        );
      } catch (err) {
        if (!err?.__loggedId) logger.error('useTopics', 'סימון נקודה כ"נידונה" נכשל', err);
        setItems((prev) => prev.map((topic) => ({
          ...topic,
          _subitems: (topic._subitems || []).map((sub) => (sub.id === point.id ? { ...sub, discussed: !discussed } : sub)),
        })));
      }
      return;
    }

    // Fallback: app-local storage set, keyed by the REAL id (await the create so a
    // tick on a still-saving point isn't stored under a temp id that never reconciles).
    const realId = await resolveRealId(point.id);
    const persistId = String(realId || point._realId || point.id);
    const set = new Set(discussedRef.current);
    if (discussed) set.add(persistId); else set.delete(persistId);
    discussedRef.current = set;
    saveDiscussedPointIds(discussionId, set);
  }, [discussionId, resolvePointTarget, resolveRealId]);

  // Edit a POINT's free-text "responses" (התייחסויות) — long_text on the subitems
  // board. Optimistic + revert; no-op (warn) when the column isn't mapped or the
  // point isn't on the board yet.
  const updatePointResponses = useCallback(async (point, text) => {
    const colId = getColumns('topics')?.pointResponsesID?.id;
    const next = text == null ? '' : String(text);
    let prevVal = '';
    setItems((prev) => prev.map((topic) => ({
      ...topic,
      _subitems: (topic._subitems || []).map((sub) => {
        if (sub.id !== point.id) return sub;
        prevVal = sub.responses || '';
        return { ...sub, responses: next };
      }),
    })));
    if (!colId) { logger.warn('useTopics', 'לא ניתן לשמור התייחסות — עמודת ההתייחסויות אינה ממופה בהגדרות', point); return; }
    // Resolve the real write target (awaits an in-flight create so an edit made
    // before the subitem id arrived is flushed once it does).
    const target = await resolvePointTarget(point);
    if (!target) return; // create still pending/failed — keep the optimistic value
    try {
      await api(
        `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
        }`,
        { boardId: target.boardId, itemId: target.itemId, cv: JSON.stringify({ [colId]: formatValue('long_text', next) }) }
      );
    } catch (err) {
      if (!err?.__loggedId) logger.error('useTopics', 'שמירת התייחסות נכשלה', err);
      setItems((prev) => prev.map((topic) => ({
        ...topic,
        _subitems: (topic._subitems || []).map((sub) => (sub.id === point.id ? { ...sub, responses: prevVal } : sub)),
      })));
    }
  }, [resolvePointTarget]);

  // Toggle the "not for discussion" (לא לדיון) checkbox on a POINT (subitem).
  // Persisted on the subitems board — written with the subitem's own board id.
  const togglePointNotForDiscussion = useCallback(async (point, notForDiscussion) => {
    const colId = getColumns('topics')?.pointNotForDiscussionID?.id;
    if (!colId) {
      logger.warn('useTopics', 'לא ניתן לסמן נקודה כ"לא לדיון" — עמודת לא לדיון (נקודה) אינה ממופה בהגדרות', point);
      return;
    }
    setItems((prev) => prev.map((topic) => ({
      ...topic,
      _subitems: (topic._subitems || []).map((sub) => (sub.id === point.id ? { ...sub, notForDiscussion } : sub)),
    })));
    // Resolve the real write target (awaits an in-flight create so a toggle made
    // before the subitem id arrived is flushed once it does).
    const target = await resolvePointTarget(point);
    if (!target) return; // create still pending/failed — keep the optimistic value
    try {
      await api(
        `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
        }`,
        { boardId: target.boardId, itemId: target.itemId, cv: JSON.stringify({ [colId]: formatValue('checkbox', !notForDiscussion) }) }
      );
    } catch (err) {
      if (!err?.__loggedId) logger.error('useTopics', 'סימון נקודה כ"לא לדיון" נכשל', err);
      setItems((prev) => prev.map((topic) => ({
        ...topic,
        _subitems: (topic._subitems || []).map((sub) => (sub.id === point.id ? { ...sub, notForDiscussion: !notForDiscussion } : sub)),
      })));
    }
  }, [resolvePointTarget]);

  // Toggle the "not for discussion" (לא לדיון) checkbox on a TOPIC (item).
  const toggleTopicNotForDiscussion = useCallback(async (topicId, notForDiscussion) => {
    const colId = getColumns('topics')?.topicNotForDiscussionID?.id;
    const boardId = getBoardId('topics');
    if (!colId || !boardId) {
      logger.warn('useTopics', 'לא ניתן לסמן נושא כ"לא לדיון" — עמודת לא לדיון (נושא) אינה ממופה בהגדרות', { topicId });
      return;
    }
    setItems((prev) => prev.map((t) => (t.id === topicId ? { ...t, notForDiscussion } : t)));
    try {
      const realId = await resolveRealId(topicId);
      if (!realId) return; // topic not on the board yet — keep the optimistic UI
      await api(
        `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
        }`,
        { boardId, itemId: realId, cv: JSON.stringify({ [colId]: formatValue('checkbox', !notForDiscussion) }) }
      );
    } catch (err) {
      if (!err?.__loggedId) logger.error('useTopics', 'סימון נושא כ"לא לדיון" נכשל', err);
      setItems((prev) => prev.map((t) => (t.id === topicId ? { ...t, notForDiscussion: !notForDiscussion } : t)));
    }
  }, [resolveRealId]);

  // Set a TOPIC's priority (a status column, item-level). Optimistic + revert.
  // labelId is the stable status label id (or null to clear).
  const updateTopicPriority = useCallback(async (topicId, labelId) => {
    const colId = getColumns('topics')?.topicPriorityID?.id;
    const boardId = getBoardId('topics');
    if (!colId || !boardId) {
      logger.warn('useTopics', 'לא ניתן לעדכן עדיפות נושא — עמודת עדיפות אינה ממופה בהגדרות', { topicId });
      return;
    }
    let prevVal = null;
    setItems((prev) => prev.map((t) => {
      if (t.id === topicId) { prevVal = t.priority ?? null; return { ...t, priority: labelId }; }
      return t;
    }));
    try {
      const realId = await resolveRealId(topicId);
      if (!realId) return; // not on the board yet — keep the optimistic value
      await api(
        `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
        }`,
        { boardId, itemId: realId, cv: JSON.stringify({ [colId]: formatValue('status', labelId) }) }
      );
    } catch (err) {
      if (!err?.__loggedId) logger.error('useTopics', 'עדכון עדיפות נושא נכשל', err);
      setItems((prev) => prev.map((t) => (t.id === topicId ? { ...t, priority: prevVal } : t)));
    }
  }, [resolveRealId]);

  // Rename a TOPIC (item). monday's change_multiple_column_values renames an
  // item when the JSON carries a "name" key.
  const renameTopic = useCallback(async (topicId, name) => {
    const trimmed = (name || '').trim();
    if (!topicId || !trimmed) return;
    setItems((prev) => prev.map((t) => (t.id === topicId ? { ...t, name: trimmed } : t)));
    try {
      const realId = await resolveRealId(topicId);
      if (!realId) return; // not on the board yet — keep the optimistic name
      const boardId = getBoardId('topics');
      await api(
        `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
        }`,
        { boardId, itemId: realId, cv: JSON.stringify({ name: trimmed }) }
      );
    } catch (err) {
      if (!err?.__loggedId) logger.error('useTopics', 'שינוי שם נושא נכשל', err);
      fetchTopics({ showLoader: false });
    }
  }, [fetchTopics, resolveRealId]);

  // Delete a TOPIC (item). monday cascades the delete to its subitems (points).
  const deleteTopic = useCallback(async (topicId) => {
    if (!topicId) return;
    setItems((prev) => prev.filter((t) => t.id !== topicId));
    try {
      const realId = await resolveRealId(topicId);
      if (!realId) return; // never reached the board — local removal is enough
      await api(`mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`, { itemId: realId });
    } catch (err) {
      if (!err?.__loggedId) logger.error('useTopics', 'מחיקת נושא נכשלה', err);
      fetchTopics({ showLoader: false });
    }
  }, [fetchTopics, resolveRealId]);

  // Rename a POINT (subitem). Uses the subitem's own board id.
  const renamePoint = useCallback(async (point, name) => {
    const trimmed = (name || '').trim();
    if (!point?.id || !trimmed) return;
    // Optimistic rename first so it shows even on a just-created point.
    setItems((prev) => prev.map((t) => ({
      ...t,
      _subitems: (t._subitems || []).map((s) => (s.id === point.id ? { ...s, name: trimmed } : s)),
    })));
    // Resolve the real write target (awaits an in-flight create so a rename typed
    // before the subitem id arrived is flushed once it does).
    const target = await resolvePointTarget(point);
    if (!target) return; // create still pending/failed — keep the optimistic name
    try {
      await api(
        `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
        }`,
        { boardId: target.boardId, itemId: target.itemId, cv: JSON.stringify({ name: trimmed }) }
      );
    } catch (err) {
      if (!err?.__loggedId) logger.error('useTopics', 'שינוי שם נקודה נכשל', err);
      fetchTopics({ showLoader: false });
    }
  }, [fetchTopics, resolvePointTarget]);

  // Delete a POINT (subitem).
  const deletePoint = useCallback(async (point) => {
    if (!point?.id) return;
    setItems((prev) => prev.map((t) => ({
      ...t,
      _subitems: (t._subitems || []).filter((s) => s.id !== point.id),
    })));
    const itemId = String(point._realId || point.id);
    if (itemId.startsWith('temp-')) return; // never persisted — local removal is enough
    try {
      await api(`mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`, { itemId });
    } catch (err) {
      if (!err?.__loggedId) logger.error('useTopics', 'מחיקת נקודה נכשלה', err);
      fetchTopics({ showLoader: false });
    }
  }, [fetchTopics]);

  // Soft-delete one or more POINTS (subitems) with an undo window — mirrors
  // useTasks.softDeleteTasks / useMyTasks.softDeleteTasks: the rows vanish
  // optimistically now, the real delete_item fires only after DELETE_GRACE_MS,
  // and the returned undo() (wired to the delete toast's "בטל") cancels the
  // pending delete and restores each point to its ORIGINAL topic + position.
  // Temp (never-persisted) points are just removed locally. Returns { undo, count }.
  const softDeletePoints = useCallback((points) => {
    const list = (Array.isArray(points) ? points : [points]).filter(Boolean);
    if (!list.length) return { undo: () => {}, count: 0 };
    const ids = new Set(list.map((p) => String(p.id)));
    // Snapshot each removed point WITH its topic id + index so undo restores order.
    const removed = [];
    itemsRef.current.forEach((topic) => {
      (topic._subitems || []).forEach((sub, index) => {
        if (ids.has(String(sub.id))) removed.push({ topicId: String(topic.id), index, point: sub });
      });
    });
    // Optimistic removal now.
    setItems((prev) => prev.map((topic) => ({
      ...topic,
      _subitems: (topic._subitems || []).filter((s) => !ids.has(String(s.id))),
    })));

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      removed.forEach(({ point }) => {
        const itemId = String(point._realId || point.id);
        if (itemId.startsWith('temp-')) return; // never persisted — local removal is enough
        api(`mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`, { itemId }, 'useTopics.softDeletePoints')
          .catch((err) => { if (!err?.__loggedId) logger.error('useTopics', 'מחיקת נקודה נכשלה', err); });
      });
    }, DELETE_GRACE_MS);

    const undo = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      // Reinsert each removed point into its topic at its original index.
      setItems((prev) => prev.map((topic) => {
        const restores = removed
          .filter((r) => r.topicId === String(topic.id))
          .sort((a, b) => a.index - b.index);
        if (!restores.length) return topic;
        const subs = [...(topic._subitems || [])];
        restores.forEach(({ index, point }) => {
          if (!subs.some((s) => String(s.id) === String(point.id))) {
            subs.splice(Math.min(index, subs.length), 0, point);
          }
        });
        return { ...topic, _subitems: subs };
      }));
    };
    return { undo, count: list.length };
  }, []);

  // round239 — soft-delete a TOPIC with an undo window (mirrors softDeletePoints,
  // owner request: right-click delete no longer confirms — it deletes with a
  // "בטל" toast). The topic vanishes optimistically; the real delete_item fires
  // after DELETE_GRACE_MS; undo() cancels it and restores the topic at its
  // original index. Temp (never-persisted) topics are just removed locally.
  const softDeleteTopic = useCallback((topicId) => {
    if (!topicId) return { undo: () => {} };
    const id = String(topicId);
    const index = itemsRef.current.findIndex((t) => String(t.id) === id);
    if (index < 0) return { undo: () => {} };
    const topic = itemsRef.current[index];
    setItems((prev) => prev.filter((t) => String(t.id) !== id));

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      (async () => {
        try {
          const realId = await resolveRealId(topicId);
          if (!realId) return; // never persisted — local removal is enough
          await api(`mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`, { itemId: realId }, 'useTopics.softDeleteTopic');
        } catch (err) {
          if (!err?.__loggedId) logger.error('useTopics', 'מחיקת נושא נכשלה', err);
          fetchTopics({ showLoader: false });
        }
      })();
    }, DELETE_GRACE_MS);

    const undo = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      setItems((prev) => {
        if (prev.some((t) => String(t.id) === id)) return prev;
        const next = [...prev];
        next.splice(Math.min(index, next.length), 0, topic);
        return next;
      });
    };
    return { undo };
  }, [fetchTopics, resolveRealId]);

  // Reorder TOPICS (drag). Persisted app-side in monday.storage (see topicOrder).
  const reorderTopics = useCallback((orderedIds) => {
    const ids = orderedIds.map(String);
    setItems((prev) => {
      const byId = new Map(prev.map((t) => [String(t.id), t]));
      const next = ids.map((id) => byId.get(id)).filter(Boolean);
      prev.forEach((t) => { if (!ids.includes(String(t.id))) next.push(t); });
      return next;
    });
    // Persist by real monday ids — drop still-saving optimistic topics (their
    // real id isn't known yet; they'll land in API order on the next read).
    const byId = new Map(itemsRef.current.map((t) => [String(t.id), t]));
    const realIds = ids
      .map((id) => (id.startsWith('temp-') ? (byId.get(id)?._realId ? String(byId.get(id)._realId) : null) : id))
      .filter(Boolean);
    saveTopicOrder(discussionId, realIds);
  }, [discussionId]);

  // Reorder POINTS within one topic (drag). Persisted app-side.
  const reorderPoints = useCallback((topicId, orderedPointIds) => {
    const ids = orderedPointIds.map(String);
    setItems((prev) => prev.map((t) => {
      if (t.id !== topicId) return t;
      const byId = new Map((t._subitems || []).map((s) => [String(s.id), s]));
      const next = ids.map((id) => byId.get(id)).filter(Boolean);
      (t._subitems || []).forEach((s) => { if (!ids.includes(String(s.id))) next.push(s); });
      return { ...t, _subitems: next };
    }));
    // Persist by real monday ids (topic + points), skipping still-saving items.
    const topic = itemsRef.current.find((t) => String(t.id) === String(topicId));
    const realTopicId = topic?._realId ? String(topic._realId) : String(topicId);
    if (realTopicId.startsWith('temp-')) return; // topic not on the board yet
    const subById = new Map((topic?._subitems || []).map((s) => [String(s.id), s]));
    const realPointIds = ids
      .map((id) => (id.startsWith('temp-') ? (subById.get(id)?._realId ? String(subById.get(id)._realId) : null) : id))
      .filter(Boolean);
    savePointOrder(discussionId, realTopicId, realPointIds);
  }, [discussionId]);

  return {
    items,
    loading,
    addTopic,
    addPoint,
    retryCreate,
    togglePoint,
    updatePointResponses,
    togglePointNotForDiscussion,
    toggleTopicNotForDiscussion,
    updateTopicPriority,
    renameTopic,
    deleteTopic,
    softDeleteTopic,
    renamePoint,
    deletePoint,
    softDeletePoints,
    reorderTopics,
    reorderPoints,
    refetch: fetchTopics,
  };
}
