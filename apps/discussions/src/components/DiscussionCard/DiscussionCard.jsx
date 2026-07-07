import { useState, useEffect, useMemo, useCallback, useSyncExternalStore } from 'react';
import { TabsContext, TabList, Tab, IconButton } from '@vibe/core';
import { MoveArrowLeft, Link, Info } from '@vibe/icons';
import { דיונים1Board } from '@api/BoardSDK.js';
import { useTasks } from '@generated/hooks/useTasks';
import { useDiscussionDetails } from '@generated/hooks/useDiscussions';
import { useMondayContext } from '@generated/contexts/MondayContext.jsx';
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
import { EffectivenessTab } from '@generated/components/EffectivenessTab';
import { SummaryTab } from '@generated/components/SummaryTab';
import { NewTaskModal } from '@generated/components/NewTaskModal';
import { CreateTaskFab } from '@generated/components/CreateTaskFab';
import { fmtTimeLabel, composeLocalDate, localYmd, toDateInput, toTimeInput } from '@generated/utils/dateTime.js';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import logger from '@generated/utils/logger.js';
import styles from './DiscussionCard.module.css';

// Ordered tab keys — index <-> key mapping for @vibe/core's index-based Tabs.
const TAB_KEYS = ['previous', 'topics', 'tasks', 'summary', 'effectiveness'];

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
  onCopyDiscussionLink,
  initialTab = null,
  initialTabDiscussionId = null,
  canManageSettings = false,
}) {
  const { currentUser } = useMondayContext();
  const [activeTab, setActiveTab] = useState('previous');
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskDefaults, setNewTaskDefaults] = useState({});
  const { isMobile } = useViewport();
  const [infoOpen, setInfoOpen] = useState(false);
  const [timeMenuOpen, setTimeMenuOpen] = useState(false);
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
  const { can, canEdit } = usePermissions(data, { canManageSettings, currentUser });

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
  // Phase 4: task-tier caps are resolved PER-TASK (each task's own creator/
  // responsible person). `canTask(cap, task)` binds the task as the item so the
  // task tabs can gate each field/delete granularly. While the feature is off
  // it resolves via the legacy creator/lead path → identical to the old coarse
  // canEditTasks for every task in this discussion.
  const canTask = useCallback(
    (cap, task) => can(cap, { boardKey: 'tasks', item: task }),
    [can]
  );
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
  const [linkCopied, setLinkCopied] = useState(false);

  // Prefetch the discussion's tasks once at the card level and share them with
  // both the Tasks and Effectiveness tabs (no duplicate query, instant switch).
  // Pass the discussion's "סוג" (discussionTypeID) so new tasks are stamped with
  // the matching taskTypeID (used by the "by discussion type" previous-tasks view).
  const tasksData = useTasks(discussion?.id, data.discussionTypeID ?? null);

  useEffect(() => {
    if (!discussion?.id || !initialTabDiscussionId) return;
    if (String(discussion.id) !== String(initialTabDiscussionId)) return;
    const nextTab = normalizeTabName(initialTab);
    if (nextTab) setActiveTab(nextTab);
  }, [discussion?.id, initialTab, initialTabDiscussionId]);

  useEffect(() => {
    if (!linkCopied) return undefined;
    const timer = setTimeout(() => setLinkCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [linkCopied]);

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
  const handleCopyLink = async () => {
    if (!discussion?.id) return;
    const copied = await onCopyDiscussionLink?.(discussion.id, activeTab);
    if (copied) setLinkCopied(true);
  };
  const openNewTaskModal = (defaults = {}) => {
    setNewTaskDefaults(defaults);
    setNewTaskOpen(true);
  };
  const closeNewTaskModal = () => {
    setNewTaskOpen(false);
    setNewTaskDefaults({});
  };
  // Task creation feedback. The modal fires this and closes IMMEDIATELY (so the
  // Tasks tab still feels instant — the optimistic row is already there); the
  // loader toast → success runs in the background, consistent on every tab.
  const handleCreateTask = async (name, opts) => {
    if (!createTask) return; // guard: only roles granted createTask may create tasks
    const loadingId = onShowLoading?.('יוצר משימה');
    const created = await tasksData.createTask(name, opts);
    if (loadingId != null) onDismissToast?.(loadingId);
    if (created) onNotify?.('משימה נוצרה בהצלחה');
    // created === null → createTask already logged the error (toast via sink).
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.backButton}>
            <IconButton
              kind={"tertiary"}
              size={"small"}
              icon={MoveArrowLeft}
              onClick={onBack}
              ariaLabel="חזרה"
            />
          </span>
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
                {!isMobile && (
                  <IconButton
                    kind={"tertiary"}
                    size={"small"}
                    icon={Link}
                    onClick={handleCopyLink}
                    ariaLabel="העתק לינק לדיון ולטאב הנוכחי"
                    className={styles.copyLinkButton}
                  />
                )}
                {!isMobile && linkCopied && (
                  <span className={styles.copyLinkCopied} aria-live="polite">
                    הועתק
                  </span>
                )}
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
              <div dir="rtl" className={`${styles.participants} ${reserveSettingsSpace ? styles.participantsReserve : ''}`}>
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
                {headerPeopleGroups.map((g) => (
                  <div key={g.alias} className={`${styles.peopleGroup} ${styles.peopleGroupAvatars}`}>
                    <span className={styles.peopleGroupLabel}>{g.title}</span>
                    {editDiscussionFields ? (
                      <PersonPicker selected={g.people} onChange={(p) => persistPeople(g.alias, p)} />
                    ) : (
                      <PersonList people={g.people} size="sm" showNames={false} max={3} />
                    )}
                  </div>
                ))}
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
            addTopicOrPoint={addTopicOrPoint} editTopicOrPoint={editTopicOrPoint} deleteTopicOrPoint={deleteTopicOrPoint} checkPoint={checkPoint} editResponses={editResponses} canReorderColumns={canReorderColumns} />
        </div>
        {activeTab === 'tasks' && (
          <div className={`${styles.tabPane} ${styles.tabPaneWide}`}>
            <TasksTab data={tasksData} onNewTask={openNewTaskModal} onNotify={onNotify} canTask={canTask} canCreateTask={createTask} canReorderColumns={canReorderColumns} canManageSettings={canManageSettings} />
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

      {/* New-task FAB — only on the "נושאים" (topics) tab, with a discussion
          selected. Hides while the modal is open. */}
      {createTask && !newTaskOpen && activeTab === 'topics' && <CreateTaskFab onClick={() => openNewTaskModal({})} />}
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
