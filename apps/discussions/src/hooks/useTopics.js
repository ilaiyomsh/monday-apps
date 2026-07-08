import { useState, useEffect, useCallback, useRef } from 'react';
import { api, formatValue } from '../utils/mondayApi/monday-client.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import { loadOrder, saveTopicOrder, savePointOrder, applyOrder } from '../utils/topicOrder.js';
import { loadDiscussedPointIds, saveDiscussedPointIds } from '../utils/discussedStore.js';
import { useMondayContext } from '../contexts/MondayContext.jsx';
import logger from '../utils/logger.js';

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

  const fetchTopics = useCallback(async (options = {}) => {
    const { showLoader = true } = options;
    if (!discussionId) { setItems([]); setLoading(false); return; }
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
      // Mapped topic-item column ids to fetch; empty is fine (monday returns []),
      // so an unmapped column reads back empty.
      const topicReadCols = [topicNfdId, topicPriorityId, topicCreatorId].filter(Boolean);
      const pointReadCols = [pointNfdId, pointCheckedId, pointCreatorId, pointResponsesId].filter(Boolean);

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
                      column_values(ids: $pointCols) { id text ... on CheckboxValue { checked } ... on PeopleValue { persons_and_teams { id } } }
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
        })),
      }));

      // Apply the user's saved drag order (topics + points per topic).
      const order = await loadOrder(discussionId);
      setItems(applyOrder(topicItems, order));
    } catch (err) {
      if (!err?.__loggedId) logger.error('useTopics', 'טעינת הנושאים נכשלה', err);
    } finally {
      setLoading(false);
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
    if (pending) { try { return await pending; } catch { return null; } }
    for (const t of itemsRef.current) {
      if (String(t.id) === sid) return t._realId ? String(t._realId) : null;
      for (const s of (t._subitems || [])) {
        if (String(s.id) === sid) return s._realId ? String(s._realId) : null;
      }
    }
    return null;
  }, []);

  // Create a new TOPIC (item) linked to the discussion. Fully optimistic: the
  // row appears INSTANTLY as a normal topic (no fade/lock/spinner). The board
  // write runs in the background; when the real id returns it's swapped in place
  // (the temp id stays the React key + color seed, so nothing flashes or jumps).
  const addTopic = useCallback((name) => {
    if (!discussionId || !name?.trim()) return;
    const tempId = `temp-${++tempSeq.current}`;
    const trimmed = name.trim();
    const creatorId = currentUser?.id != null ? String(currentUser.id) : null;
    setItems((prev) => [{ id: tempId, _realId: null, name: trimmed, notForDiscussion: false, creatorId, _subitems: [], _pending: true }, ...prev]);

    const promise = (async () => {
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
      const created = await api(
        `mutation ($boardId: ID!, $name: String!, $columnValues: JSON!) {
          create_item(board_id: $boardId, item_name: $name, column_values: $columnValues) { id }
        }`,
        { boardId, name: trimmed, columnValues: JSON.stringify(columnValues) }
      );
      const createdId = String(created?.create_item?.id || '');
      if (!createdId) throw new Error('create_item returned no id');
      const saved = await loadOrder(discussionId);
      await saveTopicOrder(
        discussionId,
        [createdId, ...(saved?.topics || []).map(String).filter((id) => id !== createdId)],
      );
      return createdId;
    })();
    pendingCreates.current.set(tempId, promise);

    promise
      .then((createdId) => {
        // Swap in the real id in place — no full refetch (avoids the flash/jump).
        setItems((prev) => prev.map((t) => (t.id === tempId ? { ...t, _realId: createdId, _pending: false } : t)));
        onSuccess?.('נושא לדיון נוצר בהצלחה');
      })
      .catch((err) => {
        if (!err?.__loggedId) logger.error('useTopics', 'הוספת נושא נכשלה', err);
        setItems((prev) => prev.filter((i) => i.id !== tempId));
      })
      .finally(() => { pendingCreates.current.delete(tempId); });
  }, [discussionId, onSuccess]);

  // Add a discussion POINT = a subitem under the topic. Fully optimistic: the
  // point appears INSTANTLY (no fade/lock/spinner). The board write runs in the
  // background and resolves the parent's real id first — so a point added under
  // a topic that's still being created waits for that id instead of failing.
  const addPoint = useCallback((topicId, pointName) => {
    if (!pointName?.trim()) return;
    const tempId = `temp-sub-${++tempSeq.current}`;
    const trimmed = pointName.trim();
    const creatorId = currentUser?.id != null ? String(currentUser.id) : null;
    setItems((prev) => prev.map((topic) => (
      topic.id === topicId
        ? { ...topic, _subitems: [...(topic._subitems || []), { id: tempId, _realId: null, name: trimmed, notForDiscussion: false, discussed: false, creatorId, responses: '', boardId: null, _pending: true }] }
        : topic
    )));

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
            ? { ...topic, _subitems: (topic._subitems || []).map((s) => (s.id === tempId ? { ...s, _realId: subId, boardId, _pending: false } : s)) }
            : topic
        )));
        onSuccess?.('נקודה לדיון נוצרה בהצלחה');
      })
      .catch((err) => {
        if (!err?.__loggedId) logger.error('useTopics', 'הוספת נקודה נכשלה', err);
        setItems((prev) => prev.map((topic) => (
          topic.id === topicId
            ? { ...topic, _subitems: (topic._subitems || []).filter((sub) => sub.id !== tempId) }
            : topic
        )));
      })
      .finally(() => { pendingCreates.current.delete(tempId); });
  }, [resolveRealId, onSuccess]);

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
    const boardId = point?.boardId;
    const itemId = String(point?._realId || point?.id || '');
    // Board path: column mapped AND the subitem is real (has a board id). A
    // still-saving point (boardId null / temp id) has no board row yet — skip the
    // write; the next read reflects nothing, which is fine for an unticked default.
    if (checkedCol && boardId && !itemId.startsWith('temp-')) {
      try {
        await api(
          `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
            change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
          }`,
          { boardId, itemId, cv: JSON.stringify({ [checkedCol]: formatValue('checkbox', discussed) }) }
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

    // Fallback: app-local storage set, matched against real ids on read.
    const persistId = String(point._realId || point.id);
    const set = new Set(discussedRef.current);
    if (discussed) set.add(persistId); else set.delete(persistId);
    discussedRef.current = set;
    saveDiscussedPointIds(discussionId, set);
  }, [discussionId]);

  // Edit a POINT's free-text "responses" (התייחסויות) — long_text on the subitems
  // board. Optimistic + revert; no-op (warn) when the column isn't mapped or the
  // point isn't on the board yet.
  const updatePointResponses = useCallback(async (point, text) => {
    const colId = getColumns('topics')?.pointResponsesID?.id;
    const boardId = point?.boardId;
    const itemId = String(point?._realId || point?.id || '');
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
    if (!colId || !boardId || itemId.startsWith('temp-')) {
      if (!colId) logger.warn('useTopics', 'לא ניתן לשמור התייחסות — עמודת ההתייחסויות אינה ממופה בהגדרות', point);
      return;
    }
    try {
      await api(
        `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
        }`,
        { boardId, itemId, cv: JSON.stringify({ [colId]: formatValue('long_text', next) }) }
      );
    } catch (err) {
      if (!err?.__loggedId) logger.error('useTopics', 'שמירת התייחסות נכשלה', err);
      setItems((prev) => prev.map((topic) => ({
        ...topic,
        _subitems: (topic._subitems || []).map((sub) => (sub.id === point.id ? { ...sub, responses: prevVal } : sub)),
      })));
    }
  }, []);

  // Toggle the "not for discussion" (לא לדיון) checkbox on a POINT (subitem).
  // Persisted on the subitems board — written with the subitem's own board id.
  const togglePointNotForDiscussion = useCallback(async (point, notForDiscussion) => {
    const colId = getColumns('topics')?.pointNotForDiscussionID?.id;
    const boardId = point?.boardId;
    const itemId = String(point?._realId || point?.id || '');
    // boardId only exists once the subitem is real, so a still-saving point is
    // already gated here (boardId null) — no bogus write against a temp id.
    if (!colId || !boardId || itemId.startsWith('temp-')) {
      logger.warn('useTopics', 'לא ניתן לסמן נקודה כ"לא לדיון" — עמודת לא לדיון (נקודה) אינה ממופה בהגדרות', point);
      return;
    }
    setItems((prev) => prev.map((topic) => ({
      ...topic,
      _subitems: (topic._subitems || []).map((sub) => (sub.id === point.id ? { ...sub, notForDiscussion } : sub)),
    })));
    try {
      await api(
        `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
        }`,
        { boardId, itemId, cv: JSON.stringify({ [colId]: formatValue('checkbox', !notForDiscussion) }) }
      );
    } catch (err) {
      if (!err?.__loggedId) logger.error('useTopics', 'סימון נקודה כ"לא לדיון" נכשל', err);
      setItems((prev) => prev.map((topic) => ({
        ...topic,
        _subitems: (topic._subitems || []).map((sub) => (sub.id === point.id ? { ...sub, notForDiscussion: !notForDiscussion } : sub)),
      })));
    }
  }, []);

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
    const itemId = String(point._realId || point.id);
    // boardId only exists once the subitem is real — skip the write until then.
    if (!point.boardId || itemId.startsWith('temp-')) return;
    try {
      await api(
        `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
        }`,
        { boardId: point.boardId, itemId, cv: JSON.stringify({ name: trimmed }) }
      );
    } catch (err) {
      if (!err?.__loggedId) logger.error('useTopics', 'שינוי שם נקודה נכשל', err);
      fetchTopics({ showLoader: false });
    }
  }, [fetchTopics]);

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
    togglePoint,
    updatePointResponses,
    togglePointNotForDiscussion,
    toggleTopicNotForDiscussion,
    updateTopicPriority,
    renameTopic,
    deleteTopic,
    renamePoint,
    deletePoint,
    reorderTopics,
    reorderPoints,
    refetch: fetchTopics,
  };
}
