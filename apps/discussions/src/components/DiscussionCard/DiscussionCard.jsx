import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, useSyncExternalStore } from 'react';
import { TabsContext, TabList, Tab, IconButton } from '@vibe/core';
import { MoveArrowLeft, Info } from '@vibe/icons';
import { דיונים1Board } from '@api/BoardSDK.js';
import { useTasks } from '@generated/hooks/useTasks';
import { useDecisions } from '@generated/hooks/useDecisions';
import { useDiscussionDetails } from '@generated/hooks/useDiscussions';
import { useMondayContext } from '@generated/contexts/MondayContext.jsx';
import { useSettings } from '@generated/contexts/SettingsContext.jsx';
import { DEFAULT_PREFERENCES, resolveAccessPeople } from '@api/boards.config.js';
import { useTemplates } from '@generated/contexts/TemplatesContext.jsx';
import { useViewport } from '@generated/hooks/useViewport.js';
import { usePermissions } from '@generated/hooks/usePermission.js';
import { PersonList } from '@generated/components/PersonAvatar';
import { PersonPicker } from '@generated/components/PersonPicker';
import {
  ensurePeopleColumns,
  getColumnTitle,
  subscribe as subscribePeopleColumns,
  getVersion as getPeopleColumnsVersion,
} from '@api/peopleColumns.js';
import { PreviousTasksTab } from '@generated/components/PreviousTasksTab';
import { TopicsTab } from '@generated/components/TopicsTab';
import { TasksTab } from '@generated/components/TasksTab';
import { DecisionsTab } from '@generated/components/DecisionsTab';
import { EffectivenessTab } from '@generated/components/EffectivenessTab';
import { SummaryTab } from '@generated/components/SummaryTab';
import { NewTaskModal } from '@generated/components/NewTaskModal';
import { QuickCreateFab } from '@generated/components/QuickCreateFab';
import { QuickCreateModal } from '@generated/components/QuickCreateModal';
import { fmtTimeLabel, composeLocalDate, localYmd, toDateInput, toTimeInput } from '@generated/utils/dateTime.js';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import logger from '@generated/utils/logger.js';
import { loadPointItems, addPointItem, mergePointItemIn, prunePointItems } from '@generated/utils/pointItems.js';
import styles from './DiscussionCard.module.css';

// Ordered tab keys — index <-> key mapping for @vibe/core's index-based Tabs.
// 'decisions' is also a valid deep-link tab (?app[tab]=decisions).
const TAB_KEYS = ['previous', 'topics', 'tasks', 'decisions', 'summary', 'effectiveness'];

// Half-hour steps for the header's time menu — full day (the create modal's
// 6:00–23:00 window is too narrow here: existing discussions carry times like
// 23:30 that must stay selectable).
const HEADER_TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  return `${h}:${i % 2 ? '30' : '00'}`;
});

const HEADER_DATE_FMT = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };

function normalizeTabName(tabName) {
  if (!tabName) return null;
  const value = String(tabName).trim().toLowerCase();
  return TAB_KEYS.includes(value) ? value : null;
}

export function DiscussionCard({
  discussion,
  onBack,
  reserveSettingsSpace = false,
  onNotify,
  onShowLoading,
  onDismissToast,
  onUpdated,
  initialTab = null,
  initialTabDiscussionId = null,
  canManageSettings = false,
}) {
  const { currentUser } = useMondayContext();
  const [activeTab, setActiveTab] = useState('previous');
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskDefaults, setNewTaskDefaults] = useState({});
  // Quick-create modal (FAB / per-point "+"): null when closed, otherwise
  // { mode: 'decision'|'task', point: <topic point + topicId>|null }. The full
  // point (with topicId/decisionIds/taskIds) is kept so onCreate can link the
  // new item to the point's subitem relation columns.
  const [quickCreate, setQuickCreate] = useState(null);
  // Round 52 — per-point create-from-point progress, shown INLINE on the point's
  // decisions/tasks cell (CreateProgressBar) so the ~few-seconds create (the
  // quick-create modal closes immediately, fire-and-forget) is legible right
  // where the "+" was clicked. Map keyed `${kind}:${pointId}` → 'pending' |
  // 'success' | 'error'. This REPLACES the old centered ✓ flash: feedback now
  // lives on the row that started the create, and ONLY for the per-point "+"
  // quick-create — every other create path (NewTaskModal, the Tasks/Decisions
  // inline add rows, the FAB when NOT scoped to a point) stays silent.
  const [pointCreateStatus, setPointCreateStatus] = useState({});
  const createStatusTimersRef = useRef({});
  const setPointCreateState = useCallback((key, state) => {
    if (!key) return;
    setPointCreateStatus((m) => ({ ...m, [key]: state }));
    if (createStatusTimersRef.current[key]) {
      clearTimeout(createStatusTimersRef.current[key]);
      delete createStatusTimersRef.current[key];
    }
    // 'pending' persists until success/error replaces it; the terminal states
    // linger briefly — success ~1.3s (the ✓ pops, then the row settles as the
    // counter bumps), error a bit longer so it's noticed — then clear, revealing
    // the "+"/counter again.
    if (state === 'success' || state === 'error') {
      const ms = state === 'success' ? 1300 : 4200;
      createStatusTimersRef.current[key] = setTimeout(() => {
        setPointCreateStatus((m) => { const n = { ...m }; delete n[key]; return n; });
        delete createStatusTimersRef.current[key];
      }, ms);
    }
  }, []);
  useEffect(() => () => {
    Object.values(createStatusTimersRef.current).forEach((t) => clearTimeout(t));
    createStatusTimersRef.current = {};
  }, []);
  const { isMobile } = useViewport();
  const [infoOpen, setInfoOpen] = useState(false);
  const [timeMenuOpen, setTimeMenuOpen] = useState(false);
  // Round 51 — hide the header PEOPLE meta (מנהל / מרכז / משתתפים) when the header
  // row is too crowded to fit everything on ONE line, keeping the date + time.
  // This replaces round-50's fixed 600px width threshold, which never fired: when
  // monday docks its Updates/item-card panel the app iframe narrows but the header
  // width often stays well ABOVE 600px, so the people groups were never hidden.
  // Instead we detect ACTUAL crowding by geometry, so it triggers at ANY monitor
  // size: the meta row is flush-right and does NOT shrink (CSS flex-shrink:0), so
  // once the title's minimum width + the meta no longer fit, the meta is pushed
  // past the row's right content edge and clipped — we measure that overflow.
  // HYSTERESIS: after hiding we only reveal the people again once the row has
  // grown back to comfortably fit the FULL meta (remembered needed width + a 24px
  // buffer), so a width hovering at the threshold can't flip-flop. Desktop-only in
  // effect — the mobile layout renders the info popover, not this row; and guarded
  // for environments without ResizeObserver (tests/SSR).
  const titleRowRef = useRef(null);
  const participantsRef = useRef(null);
  const [hideMeta, setHideMeta] = useState(false);
  // round111 — the header roles/participants row is collapsed by default behind
  // a chevron next to the date/time; reset to closed per selected discussion.
  const [metaOpen, setMetaOpen] = useState(false);
  useEffect(() => { setMetaOpen(false); }, [discussion?.id]);
  const hideMetaRef = useRef(false);
  const metaNeededWidthRef = useRef(0);
  useLayoutEffect(() => {
    const row = titleRowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return undefined;
    const HYSTERESIS_BUFFER = 24;
    // Physical px reserved at the row's inline-end for the owner-only settings
    // gear (mirrors .participantsReserve { margin-inline-end: 48px } in the CSS).
    const reservePx = reserveSettingsSpace ? 48 : 0;
    const setHide = (v) => { hideMetaRef.current = v; setHideMeta(v); };
    // Re-evaluate from scratch for a freshly selected discussion.
    setHide(false);
    metaNeededWidthRef.current = 0;
    const measure = () => {
      const meta = participantsRef.current;
      const avail = row.clientWidth;
      if (!meta || avail <= 0) return;
      if (hideMetaRef.current) {
        // People hidden: reveal only once the row is comfortably wide again.
        if (avail >= metaNeededWidthRef.current) setHide(false);
      } else {
        // People visible: is the non-shrinking, flush-right meta pushed past the
        // row's right content edge? That is exactly "title + date + time + people
        // don't fit on one line".
        const overflow = meta.getBoundingClientRect().right - (row.getBoundingClientRect().right - reservePx);
        if (overflow > 1) {
          metaNeededWidthRef.current = avail + overflow + HYSTERESIS_BUFFER;
          setHide(true);
        }
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [discussion?.id, reserveSettingsSpace]);
  // The list is lean (id/name/date); pull the rest of the discussion's columns
  // on click and merge them over the list item. `overrides` holds optimistic
  // inline edits (title / description) until the next select.
  const details = useDiscussionDetails(discussion?.id);
  const [overrides, setOverrides] = useState({});
  useEffect(() => { setOverrides({}); }, [discussion?.id]);
  const data = useMemo(
    () => ({ ...discussion, ...(details || {}), ...overrides }),
    [discussion, details, overrides]
  );

  // Header people groups (top trailing corner): the discussion's role people
  // columns — מנהל דיון (lead), מרכז דיון (coordinator) and משתתפים (participants),
  // NOT the creator. Each group shows the LIVE board column title in bold beside
  // its assigned avatars; a group with no assignees is omitted. Load the live
  // people columns once so the titles resolve (falls back to the schema title
  // until they arrive), and re-render when they do.
  useEffect(() => { ensurePeopleColumns(); }, []);
  const peopleColumnsVersion = useSyncExternalStore(
    subscribePeopleColumns, getPeopleColumnsVersion, getPeopleColumnsVersion
  );

  // Per-discussion edit permission, resolved through the advisory permission
  // hook. While `permissions.enabled` is false every capability is byte-for-byte
  // identical to the legacy gate: a board owner / account admin always edits;
  // otherwise only the discussion creator (discussionCreatorID) or lead
  // (discussionLeadID). Until the full details load (the people columns are
  // unknown on the lean list item) the hook's `ready` flag keeps edit caps
  // read-only, so we never briefly expose edit controls to a non-owner.
  //
  // Phase 2 threads the GRANULAR per-capability booleans into each edit surface
  // (replacing the single canEdit prop). A coarse `canEdit` is kept ONLY for the
  // inline title edit and the "צפייה בלבד" chip. Because the feature is off
  // (permissions.enabled === false) every cap resolves via the legacy creator/
  // lead/owner path, so each granular boolean equals the old canEdit — behavior
  // is unchanged.
  const { can, canEdit, ready: permsReady } = usePermissions(data, { canManageSettings, currentUser });
  const { settings } = useSettings();
  const { typeTemplates } = useTemplates();

  // Granular discussion-tier caps (each defaults to the legacy creator/lead/owner
  // gate while the feature is off). The two task tabs both edit tasks *of this
  // discussion*, which today is gated by the same content-edit notion; route
  // both through `editDiscussionFields` so the duplicated task UX can't drift
  // (task-tier caps land in Phase 4). createTask/topics/summary/responses get
  // their own caps so Phase 3+ can diverge them per role.
  const editSummary = can('editSummary');
  const createTask = can('createTask');
  const addTopicOrPoint = can('addTopicOrPoint');
  const editTopicOrPoint = can('editTopicOrPoint');
  const deleteTopicOrPoint = can('deleteTopicOrPoint');
  const checkPoint = can('checkPoint');
  // NOTE: `editResponses` is currently INERT — the Topics-table redesign removed
  // the "התייחסויות" responses cell, so TopicPointRow renders no responses-edit
  // control to gate (the cap/handler are still threaded through TopicsTab →
  // TopicPointRow but unused at the leaf). Kept in the catalog deliberately (a
  // product decision, not dead code) so a future responses cell can re-consume it.
  const editResponses = can('editResponses');
  const editDiscussionFields = can('editDiscussionFields');
  // Hide/show a topic or point (owner decision 2026-07-14, item 10): ONLY the
  // discussion lead (מנהל דיון) or coordinator (מרכז דיון) — plus the board
  // owner — may toggle visibility. Deliberately NOT a matrix capability: the
  // owner asked for a fixed rule, independent of the editTopicOrPoint grants.
  const holdsRole = (people) =>
    Array.isArray(people) && people.some((p) => String(p?.id) === String(currentUser?.id));
  const canHideTopicOrPoint =
    canManageSettings || holdsRole(data?.discussionLeadID) || holdsRole(data?.discussionCoordinatorID);

  // Item 19 / round 78 — access-column payload for every task created FROM this
  // discussion. Which discussion ROLES fill each tasks access column is
  // owner-configurable (settings.preferences.accessRoleSources); the default
  // reproduces the original behavior — participants → יכולת צפייה (viewers),
  // lead + coordinator + creator → יכולת עריכה (editors). People from the
  // configured roles are UNIONED (deduped by id). useTasks writes them only
  // when the owner mapped the columns.
  const accessRoleSources = settings?.preferences?.accessRoleSources || DEFAULT_PREFERENCES.accessRoleSources;
  // round108 — owner-set logo (data-URI) shown at the top-right of the header.
  const logoUrl = settings?.preferences?.logoUrl || null;
  const taskAccess = useMemo(() => ({
    viewers: resolveAccessPeople(data, accessRoleSources?.taskViewersID),
    editors: resolveAccessPeople(data, accessRoleSources?.taskEditorsID),
  }), [accessRoleSources, data]);

  // Item 18 — default decider (מחליט) for NEW decisions: the discussion lead,
  // when enabled globally (settings.preferences.defaultDeciderLead) or on this
  // discussion type's template (deciderIsLead). Falls back to the hook default
  // (current user) when off / no lead. Always replaceable inline afterwards.
  const defaultDecider = useMemo(() => {
    const globalOn = settings?.preferences?.defaultDeciderLead === true;
    const typeTpl = (typeTemplates || []).find((t) => t?.discussionType === data?.discussionTypeID);
    const on = globalOn || typeTpl?.deciderIsLead === true;
    const lead = Array.isArray(data?.discussionLeadID) ? data.discussionLeadID : [];
    return on && lead.length ? lead[0] : null;
  }, [settings?.preferences?.defaultDeciderLead, typeTemplates, data?.discussionTypeID, data?.discussionLeadID]);
  // Phase 4: task-tier caps are resolved PER-TASK (each task's own creator/
  // responsible person). `canTask(cap, task)` binds the task as the item so the
  // task tabs can gate each field/delete granularly. While the feature is off
  // it resolves via the legacy creator/lead path → identical to the old coarse
  // canEditTasks for every task in this discussion.
  const canTask = useCallback(
    (cap, task) => can(cap, { boardKey: 'tasks', item: task }),
    [can]
  );
  // Decision-tier caps resolve PER-DECISION from the decision item's own people
  // columns (decisionCreatorID/deciderID) — no discussion ctx needed. The
  // discussion-tier createDecision cap gates both creation affordances (FAB /
  // add-row / per-point "+").
  const canDecision = useCallback(
    (cap, decision) => can(cap, { item: decision }),
    [can]
  );
  const canCreateDecision = can('createDecision');
  // System-tier: column drag-reorder. Owners/admins only (the resolver returns
  // owner-bypass for this cap in every path), so this equals the old
  // canManageSettings gate but also honors account admins.
  const canReorderColumns = can('reorderColumns');

  // Header people groups (top trailing corner): the discussion's role people
  // columns — מנהל דיון (lead), מרכז דיון (coordinator) and משתתפים (participants),
  // NOT the creator. Each group shows the LIVE board column title in bold beside
  // its assigned avatars. When the user can edit discussion fields we show ALL
  // role columns (even empty ones) as editable pickers so a column can be filled
  // or cleared from the header without it disappearing; read-only viewers only
  // see the columns that actually have people. The live titles resolve via
  // ensurePeopleColumns (falling back to the schema title until they arrive).
  const headerPeopleGroups = useMemo(() => {
    const defs = [
      { alias: 'discussionLeadID', fallback: 'מנהל דיון' },
      { alias: 'discussionCoordinatorID', fallback: 'מרכז דיון' },
      { alias: 'participantsID', fallback: 'משתתפים' },
    ];
    return defs
      .map((d) => ({
        alias: d.alias,
        people: Array.isArray(data[d.alias]) ? data[d.alias] : [],
        title: getColumnTitle('discussions', d.alias) || d.fallback,
      }))
      .filter((d) => editDiscussionFields || d.people.length > 0);
    // peopleColumnsVersion recomputes the titles once the live columns load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.discussionLeadID, data.discussionCoordinatorID, data.participantsID, peopleColumnsVersion, editDiscussionFields]);

  // Inline editing of the title (double-click to edit).
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  // Prefetch the discussion's tasks once at the card level and share them with
  // both the Tasks and Effectiveness tabs (no duplicate query, instant switch).
  // Pass the discussion's "סוג" (discussionTypeID) so new tasks are stamped with
  // the matching taskTypeID (used by the "by discussion type" previous-tasks view).
  const tasksData = useTasks(discussion?.id, data.discussionTypeID ?? null);

  // Prefetch the discussion's decisions the same way — shared by the Decisions
  // tab, the Topics tab's per-point counters/popup and the quick-create flow.
  // useDecisions self-guards when the decisions board is unmapped (no query,
  // empty items), so every surface degrades gracefully.
  const decisionsData = useDecisions(discussion?.id);

  // ---- Point → decisions/tasks associations (monday.storage; see pointItems) ----
  // A decision/task created FROM a topic point is remembered per discussion so the
  // Topics tab's per-point counter + names popup can resolve it and it survives a
  // reload (the subitems board has no relation column for this — see pointItems.js).
  // Shape { [pointRealId]: { decisions: [], tasks: [] } }; passed to TopicsTab,
  // which intersects the ids with the loaded decisions/tasks for the count/names.
  const [pointItemsByPoint, setPointItemsByPoint] = useState({});
  // Load the stored map when the discussion changes.
  useEffect(() => {
    const id = discussion?.id;
    if (!id) { setPointItemsByPoint({}); return undefined; }
    let cancelled = false;
    loadPointItems(id)
      .then((m) => { if (!cancelled) setPointItemsByPoint(m); })
      // loadPointItems resolves {} on storage failures; this catch is the
      // defensive last line so a future rejection can never float silently.
      .catch((err) => logger.warn('DiscussionCard', 'טעינת קישורי נקודה נכשלה', err));
    return () => { cancelled = true; };
  }, [discussion?.id]);
  // Once BOTH lists have loaded, prune stored ids that no longer exist. Stale ids
  // are harmless for the count (it intersects with the loaded lists) — this is
  // just housekeeping of the persisted JSON. Runs on the load→loaded transition
  // only (a silent refresh after a create keeps `loading` false), so it never
  // races a just-created id out of the store.
  useEffect(() => {
    const id = discussion?.id;
    if (!id || decisionsData.loading || tasksData.loading) return;
    prunePointItems(id, {
      decisions: decisionsData.items.map((d) => String(d.id)),
      tasks: tasksData.items.map((t) => String(t.id)),
    }).catch(() => {});
    // items are read at run time; depending on them would re-run on every
    // optimistic change — the loading transition is the correct, race-free trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discussion?.id, decisionsData.loading, tasksData.loading]);

  useEffect(() => {
    if (!discussion?.id || !initialTabDiscussionId) return;
    if (String(discussion.id) !== String(initialTabDiscussionId)) return;
    const nextTab = normalizeTabName(initialTab);
    if (nextTab) setActiveTab(nextTab);
  }, [discussion?.id, initialTab, initialTabDiscussionId]);

  if (!discussion) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyInner}>
          <p className={styles.emptyTitle}>בחר דיון מהרשימה</p>
          <p className={styles.emptyHint}>לחץ על דיון כדי לצפות בפרטים</p>
        </div>
      </div>
    );
  }

  const activeIndex = TAB_KEYS.indexOf(activeTab);

  // Persist a single-field edit (name or column16) to the board, optimistically.
  const persistField = async (alias, value) => {
    if (!canEdit) return; // read-only viewers can't mutate the discussion
    setOverrides((o) => ({ ...o, [alias]: value }));
    try {
      await new דיונים1Board().item(discussion.id).update({ [alias]: value }).execute();
      onUpdated?.({ ...data, [alias]: value });
    } catch (err) {
      if (!err?.__loggedId) logger.error('DiscussionCard', 'עדכון הדיון נכשל', err);
      // Revert the optimistic value on failure.
      setOverrides((o) => { const next = { ...o }; delete next[alias]; return next; });
    }
  };

  // Persist a header people-column edit (lead / coordinator / participants).
  // `people` is the PersonPicker selection ([{id,name,kind}]); the board wants a
  // plain id array. Optimistic: store the people objects so the avatars update
  // immediately, revert on failure.
  const persistPeople = async (alias, people) => {
    if (!editDiscussionFields) return;
    setOverrides((o) => ({ ...o, [alias]: people }));
    try {
      await new דיונים1Board().item(discussion.id).update({ [alias]: people.map((p) => Number(p.id)) }).execute();
      onUpdated?.({ ...data, [alias]: people });
    } catch (err) {
      if (!err?.__loggedId) logger.error('DiscussionCard', 'עדכון עמודת האנשים נכשל', err);
      setOverrides((o) => { const next = { ...o }; delete next[alias]; return next; });
    }
  };

  // Header date/time inline edit — both write the SAME date column, so each
  // change re-composes the full value: picking a new date keeps the current
  // time, picking a new time keeps the current date. persistField is optimistic
  // and reverts on failure.
  const changeDiscussionDate = (picked) => {
    if (!picked) return; // the date is required — the header picker has no clear
    persistField('discussionDateID', composeLocalDate(localYmd(picked), toTimeInput(data.discussionDateID)));
  };
  const changeDiscussionTime = (timeStr) => {
    setTimeMenuOpen(false);
    if (!data.discussionDateID) return;
    persistField('discussionDateID', composeLocalDate(toDateInput(data.discussionDateID), timeStr));
  };

  const startEditTitle = () => { if (!canEdit) return; setTitleDraft(data.name || ''); setEditingTitle(true); };
  const saveTitle = () => {
    setEditingTitle(false);
    const t = titleDraft.trim();
    if (t && t !== data.name) persistField('name', t);
  };
  // round114 — the header copy-link icon moved into the discussions-list row
  // menu ("לינק לדיון"); the card no longer copies links itself.
  const openNewTaskModal = (defaults = {}) => {
    setNewTaskDefaults(defaults);
    setNewTaskOpen(true);
  };
  const closeNewTaskModal = () => {
    setNewTaskOpen(false);
    setNewTaskDefaults({});
  };
  // Top blue "משימה חדשה" button (NewTaskModal). The modal fires this and closes
  // IMMEDIATELY (the optimistic row is already there). NO ✓ flash — the success
  // ✓ is scoped to from-point creates only (see handleQuickCreate). The new task
  // is PREPENDED so it appears at the TOP of the topmost group. Errors still
  // surface via the logger → UI sink.
  const handleCreateTask = async (name, opts) => {
    if (!createTask) return; // guard: only roles granted createTask may create tasks
    await tasksData.createTask(name, { ...(opts || {}), ...taskAccess, prepend: true });
  };

  // Inline add (Tasks tab add-row): create with just a name (+ the group's seed
  // status/assignee). The optimistic row shows instantly at its group's BOTTOM
  // (where the add-row sits — current placement kept). NO ✓ flash (from-point
  // only). deadline/assignee stay optional and are filled inline afterward.
  const handleInlineCreateTask = async (name, opts) => {
    if (!createTask) return;
    await tasksData.createTask(name, { ...(opts || {}), ...taskAccess });
  };

  // Inline add (Decisions tab add-row): create with just a name. Defaults match
  // the quick-create modal path — מושפעים = the discussion's participants, מחליט
  // defaults to the current user inside the hook, date → today. Optimistic row
  // shows instantly; the rest of the columns are filled inline afterward.
  const handleInlineCreateDecision = async (name) => {
    if (!canCreateDecision) return;
    await decisionsData.createDecision(name, {
      affected: Array.isArray(data.participantsID) ? data.participantsID : [],
      // item 18 — default decider = discussion lead when the preference is on
      // (null keeps the hook's current-user default).
      ...(defaultDecider ? { decider: defaultDecider } : {}),
    });
  };

  // ---- Quick create (FAB on every tab + per-point "+" in the Topics tab) ----
  // `source` records WHY the modal opened, so create placement/feedback can differ:
  //   'topButton' → the Decisions tab's blue "החלטה חדשה" (PREPEND the new item)
  //   'point'     → the per-point "+" in Topics (fires the ✓ success flash)
  //   'fab'/null  → the floating quick-create (silent, appended — current behavior)
  // `anchor` (item 12): the clicked "+" button's DOMRect — when present the
  // quick-create box opens right BELOW the +, centered on it, instead of at
  // the overlay's default spot.
  const openQuickCreate = (mode, point = null, source = null, anchor = null) =>
    setQuickCreate({ mode, point, source, anchor });
  const closeQuickCreate = () => setQuickCreate(null);
  // Per-point "+" — opens the modal scoped to the point (mode forced, toggle
  // hidden per the modal contract). Guarded per kind: a stale control can't
  // open a create flow the user's role doesn't grant.
  const handleCreateFromPoint = (kind, point, anchor = null) => {
    const isDecision = kind === 'decision';
    if (isDecision ? !canCreateDecision : !createTask) return;
    openQuickCreate(isDecision ? 'decision' : 'task', point, 'point', anchor);
  };
  // The modal fires this and closes immediately (fire-and-forget). ONE code path
  // for scoped + unscoped creates: when a point is present the task links to the
  // topic via createTask's topicId option, and BOTH kinds record the created item
  // under the point in the pointItems store (the source of truth for the per-point
  // counter — the subitems board has no relation column for this).
  const handleQuickCreate = async (kind, { text, person, deadline }) => {
    const point = quickCreate?.point || null;
    // The inline progress bar + success ✓ live on the point row, so they fire
    // ONLY when the create ORIGINATES FROM A POINT (the per-point "+" opens the
    // modal WITH a point). The top decisions button opens it with
    // source:'topButton' → PREPEND the new item to the topmost group.
    const fromPoint = !!point;
    // Round 52 — key the inline CreateProgressBar for THIS point + kind, using the
    // SAME id the point row renders under (point.id, shared with this scoped
    // point). null for non-point (FAB) creates → no inline progress.
    const statusKey = fromPoint ? `${kind}:${point.id}` : null;
    const prepend = quickCreate?.source === 'topButton';
    // A session-created point keeps its TEMP id in `point.id` (its REAL subitem
    // id lives in `point._realId` until a topics refetch swaps it). The point→item
    // association is stored keyed by the REAL subitem id — a temp id would never
    // match the id the Topics tab reads back — so we only record it once the
    // point has a real id. Prefer _realId, and never record against a temp id.
    const pointRealId = point ? (point._realId || point.id) : null;
    const pointIsReal = pointRealId != null && !String(pointRealId).startsWith('temp-');
    // Record a created decision/task under its origin point: optimistically in
    // local state (the counter bumps immediately) AND in monday.storage (persists
    // across reload). The Topics tab intersects these ids with the loaded lists.
    const recordPointItem = (itemId) => {
      if (!pointIsReal || itemId == null) return;
      setPointItemsByPoint((prev) => mergePointItemIn(prev, pointRealId, kind, itemId));
      addPointItem(discussion.id, pointRealId, kind, itemId).catch(() => {});
    };
    // In-flight the instant we submit (before the awaited create resolves).
    if (statusKey) setPointCreateState(statusKey, 'pending');
    if (kind === 'task') {
      if (!createTask) { if (statusKey) setPointCreateState(statusKey, 'error'); return; } // capability guard (same as handleCreateTask)
      const created = await tasksData.createTask(text, {
        status: null,
        assignee: person || [],
        deadline,
        topicId: point?.topicId || null,
        ...taskAccess,
        prepend,
      });
      if (created) { recordPointItem(created.id); if (statusKey) setPointCreateState(statusKey, 'success'); }
      else if (statusKey) setPointCreateState(statusKey, 'error');
      return;
    }
    if (!canCreateDecision) { if (statusKey) setPointCreateState(statusKey, 'error'); return; }
    const created = await decisionsData.createDecision(text, {
      // Round 52: the quick-create decision form no longer collects a status or a
      // decider — they're set later from the Decisions view. Defaults per product
      // spec: affected = the discussion's participants; the decider defaults to
      // the discussion lead when the item-18 preference is on, else to the
      // current user (hook default); date omitted → today (hook default).
      affected: Array.isArray(data.participantsID) ? data.participantsID : [],
      ...(defaultDecider ? { decider: defaultDecider } : {}),
      prepend,
    });
    if (created) { recordPointItem(created.id); if (statusKey) setPointCreateState(statusKey, 'success'); }
    else if (statusKey) setPointCreateState(statusKey, 'error');
  };

  // Item 20 — viewDiscussion gate: once the people columns have loaded, a user
  // who holds NO role on this discussion (and isn't the owner) sees a blocked
  // state instead of the discussion content. While loading (or on an unseeded
  // instance) the resolver stays permissive, so there is never a flash.
  if (permsReady && !can('viewDiscussion')) {
    return (
      <div className={styles.root}>
        <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--secondary-text-color, #676879)', direction: 'rtl' }}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>אין לך הרשאת צפייה בדיון זה</div>
          <div style={{ fontSize: 14 }}>רק משתתפי הדיון ובעלי התפקידים שלו יכולים לצפות בפרטיו.</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.titleRow} ref={titleRowRef}>
          <span className={styles.backButton}>
            <IconButton
              kind={"tertiary"}
              size={"small"}
              icon={MoveArrowLeft}
              onClick={onBack}
              ariaLabel="חזרה"
            />
          </span>
          {logoUrl && (
            /* round108 — owner-set brand logo, pinned to the top-right (RTL start)
               of the header at the title's height. Owner uploads it in Settings. */
            <img className={styles.ownerLogo} src={logoUrl} alt="לוגו" />
          )}
          <div className={styles.titleBlock}>
            {editingTitle ? (
              <input
                className={styles.titleInput}
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); saveTitle(); }
                  if (e.key === 'Escape') { setEditingTitle(false); }
                }}
                onBlur={saveTitle}
              />
            ) : (
              <div className={styles.titleMainRow}>
                <h1
                  className={styles.title}
                  onDoubleClick={canEdit ? startEditTitle : undefined}
                  title={canEdit ? 'לחיצה כפולה לעריכה' : undefined}
                >
                  {data.name}
                </h1>
              </div>
            )}
          </div>
          {(data.discussionDateID || headerPeopleGroups.length > 0) && (
            isMobile ? (
              /* Mobile: collapse the date + people groups behind an info button so
                 the title gets the header width; tap opens a popover. */
              <div className={styles.infoWrap}>
                <IconButton
                  icon={Info}
                  size="small"
                  kind="tertiary"
                  ariaLabel="תאריך ואנשים"
                  onClick={() => setInfoOpen((o) => !o)}
                />
                {infoOpen && (
                  <>
                    <div className={styles.infoBackdrop} onClick={() => setInfoOpen(false)} />
                    <div dir="rtl" className={styles.infoPopover} role="dialog" aria-label="פרטי הדיון">
                      {data.discussionDateID && (
                        <div className={styles.infoPeople}>
                          <span className={styles.peopleGroupLabel}>תאריך</span>
                          <span>{data.discussionDateID.toLocaleDateString('he-IL', HEADER_DATE_FMT)}</span>
                        </div>
                      )}
                      {data.discussionDateID?.hasTime && (
                        <div className={styles.infoPeople}>
                          <span className={styles.peopleGroupLabel}>שעה</span>
                          <span>{fmtTimeLabel(data.discussionDateID)}</span>
                        </div>
                      )}
                      {headerPeopleGroups.map((g) => (
                        <div key={g.alias} className={styles.infoPeople}>
                          <span className={styles.peopleGroupLabel}>{g.title}</span>
                          <PersonList people={g.people} size="sm" showNames max={g.people.length} />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* RTL row: תאריך (rightmost) · שעה · then the people columns, with a
                 vertical separator between fields. Date/time are BOLD and, for
                 editors, clickable — date opens the shared calendar popover, time
                 opens a half-hour menu; both persist to the discussion item. */
              <div ref={participantsRef} dir="rtl" className={`${styles.participants} ${reserveSettingsSpace ? styles.participantsReserve : ''} ${hideMeta ? styles.participantsNarrow : ''}`}>
                {/* round112 — ONE row again (the round111 second-row layout was
                    reverted by the owner): date + time, then a LEFT-pointing
                    chevron, and — when opened — the role/participants groups
                    inline to its left, exactly like the pre-round111 layout. */}
                {data.discussionDateID && (
                  <div className={`${styles.peopleGroup} ${styles.dateGroup}`}>
                    {editDiscussionFields ? (
                      <DatePickerPopover
                        variant="inline"
                        value={data.discussionDateID}
                        onChange={changeDiscussionDate}
                        allowClear={false}
                        formatDate={(d) => d.toLocaleDateString('he-IL', HEADER_DATE_FMT)}
                      />
                    ) : (
                      <span className={styles.date}>
                        {data.discussionDateID.toLocaleDateString('he-IL', HEADER_DATE_FMT)}
                      </span>
                    )}
                  </div>
                )}
                {data.discussionDateID && (data.discussionDateID.hasTime || editDiscussionFields) && (
                  <div className={`${styles.peopleGroup} ${styles.dateGroup}`}>
                    {editDiscussionFields ? (
                      <div className={styles.timeMenuWrap}>
                        <button
                          type="button"
                          className={styles.dateTrigger}
                          onClick={() => setTimeMenuOpen((o) => !o)}
                          aria-haspopup="listbox"
                          aria-expanded={timeMenuOpen}
                        >
                          {data.discussionDateID.hasTime ? fmtTimeLabel(data.discussionDateID) : 'קבע שעה'}
                        </button>
                        {timeMenuOpen && (
                          <>
                            <div className={styles.infoBackdrop} onClick={() => setTimeMenuOpen(false)} />
                            <div className={styles.timeMenu} role="listbox" aria-label="בחירת שעה">
                              {HEADER_TIME_OPTIONS.map((t) => {
                                const selected = t === toTimeInput(data.discussionDateID);
                                return (
                                  <button
                                    key={t}
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    ref={selected ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
                                    className={`${styles.timeOption} ${selected ? styles.timeOptionSelected : ''}`}
                                    onClick={() => changeDiscussionTime(t)}
                                  >
                                    {t}
                                  </button>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className={styles.date}>{fmtTimeLabel(data.discussionDateID)}</span>
                    )}
                  </div>
                )}
                {headerPeopleGroups.length > 0 && (
                  /* In this dir=rtl row the chevron sits LEFT of the time; the
                     glyphs: ‹ (points left) = open the roles, › = close them. */
                  <button
                    type="button"
                    className={styles.metaToggle}
                    onClick={() => setMetaOpen((o) => !o)}
                    aria-expanded={metaOpen}
                    aria-label={metaOpen ? 'הסתר בעלי תפקידים' : 'הצג בעלי תפקידים'}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {metaOpen ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
                    </svg>
                  </button>
                )}
                {metaOpen && headerPeopleGroups.map((g) => {
                  // מנהל (lead) + רשם דיון (coordinator) — and any future single
                  // role — are one-person fields: cap them at a single person and
                  // CLOSE the picker right after a pick (exactly like the decision/
                  // task row pickers, and the create modal's lead/coordinator).
                  // Only משתתפים (participants) is multi-select, so it stays open
                  // after each selection.
                  const singleRole = g.alias !== 'participantsID';
                  return (
                    <div key={g.alias} className={`${styles.peopleGroup} ${styles.peopleGroupAvatars}`}>
                      <span className={styles.peopleGroupLabel}>{g.title}</span>
                      {editDiscussionFields ? (
                        <PersonPicker
                          selected={g.people}
                          onChange={(p) => persistPeople(g.alias, p)}
                          single={singleRole}
                          closeOnSelect={singleRole}
                          boardKey="discussions"
                        />
                      ) : (
                        <PersonList people={g.people} size="sm" showNames={false} max={3} />
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
        <div className={styles.tabsRow} dir="ltr">
          <TabsContext activeTabId={activeIndex}>
            <TabList activeTabId={activeIndex} onTabChange={(id) => setActiveTab(TAB_KEYS[id])}>
              <Tab>הנחיות קודמות</Tab>
              <Tab>נושאים</Tab>
              <Tab>משימות</Tab>
              <Tab>החלטות</Tab>
              <Tab>סיכום</Tab>
              <Tab>אפקטיביות</Tab>
            </TabList>
          </TabsContext>
        </div>
      </div>

      {/* All tabs prefetch on discussion select. Topics/Previous stay mounted
          (hidden) to keep their loaded data + UI state; Tasks/Effectiveness read
          the shared prefetched tasksData, so every switch is instant.
          Every wrapper div gets .tabPane when active so it fades in smoothly. */}
      <div className={styles.body} key={discussion.id}>
        <div className={activeTab === 'previous' ? `${styles.tabPane} ${styles.tabPaneWide}` : styles.tabPaneWide} style={{ display: activeTab === 'previous' ? undefined : 'none' }}>
          <PreviousTasksTab discussion={data} onCarryForward={tasksData.mergeTasks} onCarryForwardUndo={tasksData.removeTasks} onNotify={onNotify} onNotifyLoading={onShowLoading} onDismissToast={onDismissToast} canTask={canTask} canCreateTask={createTask} canEditDiscussion={editDiscussionFields} canReorderColumns={canReorderColumns} canManageSettings={canManageSettings} />
        </div>
        <div className={activeTab === 'topics' ? `${styles.tabPane} ${styles.tabPaneWide}` : styles.tabPaneWide} style={{ display: activeTab === 'topics' ? undefined : 'none' }}>
          <TopicsTab discussion={data} createTask={tasksData.createTask} onNotify={onNotify} onNotifyLoading={onShowLoading} onDismissToast={onDismissToast}
            addTopicOrPoint={addTopicOrPoint} editTopicOrPoint={editTopicOrPoint} deleteTopicOrPoint={deleteTopicOrPoint} checkPoint={checkPoint} editResponses={editResponses} canHide={canHideTopicOrPoint} canReorderColumns={canReorderColumns} canManageSettings={canManageSettings}
            onCreateFromPoint={(createTask || canCreateDecision) ? handleCreateFromPoint : undefined}
            decisionsItems={decisionsData.items} tasksItems={tasksData.items} pointItemsByPoint={pointItemsByPoint} createStatusByPoint={pointCreateStatus} />
        </div>
        {activeTab === 'tasks' && (
          <div className={`${styles.tabPane} ${styles.tabPaneWide}`}>
            <TasksTab data={tasksData} discussionId={discussion.id} onNewTask={openNewTaskModal} onInlineCreateTask={handleInlineCreateTask} onNotify={onNotify} canTask={canTask} canCreateTask={createTask} canReorderColumns={canReorderColumns} canManageSettings={canManageSettings} />
          </div>
        )}
        {activeTab === 'decisions' && (
          <div className={`${styles.tabPane} ${styles.tabPaneWide}`}>
            <DecisionsTab data={decisionsData} discussionId={discussion.id} onNewDecision={() => openQuickCreate('decision', null, 'topButton')} onInlineCreate={handleInlineCreateDecision} onNotify={onNotify} canDecision={canDecision} canCreateDecision={canCreateDecision} canReorderColumns={canReorderColumns} canManageSettings={canManageSettings} />
          </div>
        )}
        {activeTab === 'summary' && (
          <div className={styles.tabPane}>
            <SummaryTab discussion={data} canEdit={editSummary} />
          </div>
        )}
        {activeTab === 'effectiveness' && (
          <div className={`${styles.tabPane} ${styles.tabPaneWide}`}>
            <EffectivenessTab data={tasksData} canManageSettings={canManageSettings} onNotify={onNotify} />
          </div>
        )}
      </div>

      {/* Quick-create FAB — ONLY on the summary + effectiveness tabs (owner
          decision 2026-07-14; the other tabs have their own inline/toolbar
          create affordances). Hidden while either create modal is open, and
          entirely absent when the user can create neither tasks nor decisions. */}
      {(activeTab === 'summary' || activeTab === 'effectiveness') &&
        (createTask || canCreateDecision) && !newTaskOpen && !quickCreate && (
        <QuickCreateFab
          onClick={() => openQuickCreate('task', null, 'fab')}
        />
      )}
      <QuickCreateModal
        open={!!quickCreate}
        initialMode={quickCreate?.mode || 'task'}
        anchor={quickCreate?.anchor || null}
        // Opened from the Decisions tab (top button / add-row) → dead-center of
        // the screen (owner request 2026-07-14); point-anchored opens keep the
        // under-the-+ placement, the FAB keeps the round-57 spot.
        centered={quickCreate?.source === 'topButton'}
        scopedPoint={quickCreate?.point || null}
        discussion={data}
        participants={Array.isArray(data.participantsID) ? data.participantsID : []}
        currentUser={currentUser}
        onClose={closeQuickCreate}
        onCreate={handleQuickCreate}
        allowTask={createTask}
        allowDecision={canCreateDecision}
      />
      <NewTaskModal
        open={newTaskOpen}
        onClose={closeNewTaskModal}
        onCreate={handleCreateTask}
        defaults={newTaskDefaults}
      />
    </div>
  );
}

export default DiscussionCard;
