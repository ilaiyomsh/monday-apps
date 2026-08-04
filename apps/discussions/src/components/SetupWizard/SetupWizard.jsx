import React, { useCallback, useEffect, useState } from 'react';
import { Button, Heading, Text, Flex, Loader, Dropdown, RadioButton } from '@vibe/core';
import { PartyProgress } from '@generated/components/PartyProgress';
import { useSettings } from '../../contexts/SettingsContext.jsx';
import { useMondayContext } from '../../contexts/MondayContext.jsx';
import { addDropdownLabel } from '@generated/hooks/useDropdownOptions.js';
import { DEFAULT_DISCUSSION_TYPE, seedDefaultTypeTemplate } from '@generated/utils/defaultTypeTemplate.js';
import { provisionAllBoards } from '../../utils/mondayApi/provisionBoards.js';
import { withSeededAccessRoles } from '../../utils/mondayApi/boards.config.js';
import { api } from '../../utils/mondayApi/monday-client.js';
import logger from '../../utils/logger.js';
import styles from './SetupWizard.module.css';

// The required task fields (mirrors PROVISION_SPEC.tasks.columns in
// provisionBoards.js). When an EXISTING tasks board is connected, each field is
// either mapped onto one of the board's existing columns or created new.
const TASK_FIELD_SPECS = [
  { alias: 'taskCreatorID', title: 'יוצר', type: 'people' },
  { alias: 'responsibilityID', title: 'אחריות', type: 'people' },
  { alias: 'deadlineID', title: 'דד ליין', type: 'date' },
  { alias: 'statusID', title: 'סטאטוס', type: 'status' },
  { alias: 'detailsID', title: 'מקור המשימה', type: 'long_text' },
];

// Sentinel map value meaning "create this column fresh" (nothing existing chosen).
const CREATE_NEW_VALUE = '__create__';

// Board roles shown (read-only) in TOP-UP mode — the order + Hebrew labels for
// the "already connected / will be added" status list. Unused on first-run.
const SETUP_ROLE_ORDER = ['discussions', 'topics', 'tasks', 'decisions'];
const SETUP_ROLE_LABELS = {
  discussions: 'דיונים',
  topics: 'נושאים לדיון',
  tasks: 'משימות',
  decisions: 'החלטות',
};

// Whether a board column of `colType` can back a required field of `fieldType`.
// long_text fields also accept a plain `text` column; everything else is exact.
function isColumnCompatible(fieldType, colType) {
  if (fieldType === 'long_text') return colType === 'long_text' || colType === 'text';
  return colType === fieldType;
}

// Dropdown options for one required field: "create new" first, then the board's
// columns whose type is compatible with the field type.
function optionsForField(field, boardColumns) {
  const compatible = (boardColumns || [])
    .filter((c) => isColumnCompatible(field.type, c.type))
    .map((c) => ({ value: String(c.id), label: c.title }));
  return [{ value: CREATE_NEW_VALUE, label: 'צור עמודה חדשה' }, ...compatible];
}

/*
 * First-run setup wizard. Shown by SettingsGate when settings are empty
 * (isConfigured === false). Offers two paths:
 *   - "צור לוחות אוטומטית" → provisionAllBoards() builds the 4 boards + columns
 *     and persists the resulting mapping via updateSettings(). When that lands,
 *     isConfigured flips true and the gate unmounts the wizard automatically.
 *   - "מיפוי ידני" → onManual(), which hands off to the existing SettingsModal.
 *
 * Errors are logged through the standard funnel (→ toast) AND shown inline so
 * the owner can retry or fall back to manual mapping.
 *
 * TOP-UP MODE — passing `existingConfig` ({ boards, columns }) reuses this same
 * wizard AFTER install (from Settings): already-mapped roles are shown read-only
 * (never recreated), the tasks create/connect section shows only when tasks is
 * NOT yet mapped, and on submit provisioning runs config-aware + merges. After a
 * successful run it calls `onDone()` (the caller closes the panel) instead of
 * relying on the SettingsGate unmount. `title` overrides the heading. With
 * `existingConfig` null the behavior is byte-for-byte the first-run flow.
 */
export function SetupWizard({ onManual, existingConfig = null, onDone = null, title }) {
  const { settings, updateSettings } = useSettings();
  const { context, currentUser } = useMondayContext();

  // TOP-UP derivations (all inert on first-run, where existingConfig is null).
  const isTopUp = Boolean(existingConfig);
  const roleMapped = (key) =>
    Boolean(existingConfig?.boards?.[key]?.id && String(existingConfig.boards[key].id).trim());
  const tasksMapped = isTopUp && roleMapped('tasks');
  const allRolesMapped = isTopUp && SETUP_ROLE_ORDER.every(roleMapped);
  // The tasks create/connect section is offered on first-run always, and in
  // top-up only when the tasks board isn't already mapped.
  const showTasksSection = !isTopUp || !tasksMapped;
  const secondaryLabel = isTopUp ? 'חזרה' : 'מיפוי ידני';
  const handleSecondary = isTopUp ? (onDone || onManual || (() => {})) : onManual;
  // round141b — custom-object install (owner report): the app can run as a
  // standalone custom object, where there is no meaningful host board to
  // extend. Detect it from the context (a non-board app-feature type, or no
  // boardId at all) and have provisioning CREATE a real "דיונים" board.
  const featureType = String(context?.appFeature?.type || '');
  const isCustomObject = !context?.boardId || /object/i.test(featureType);

  const [phase, setPhase] = useState('idle'); // idle | running | error
  // round141 — progress carries a BOARD-level narration (boardPhase) from
  // provisionAllBoards; the fine-grained label is kept for logs only.
  const [progress, setProgress] = useState({ step: 0, total: 0, boardPhase: '' });
  const [errorMsg, setErrorMsg] = useState('');

  // Tasks board choice: create a brand-new "משימות" board, or connect an existing
  // board from the account. In 'connect' mode we lazy-load the account's boards
  // once to populate the picker.
  const [tasksMode, setTasksMode] = useState('create'); // create | connect
  const [tasksBoardId, setTasksBoardId] = useState('');
  const [boardOptions, setBoardOptions] = useState([]);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [boardsLoaded, setBoardsLoaded] = useState(false);

  // When connecting an EXISTING tasks board, the owner maps its columns onto the
  // required task fields BEFORE any columns are created; only unmapped fields are
  // created new. taskBoardColumns = the chosen board's columns (id/title/type);
  // columnMap = { [alias]: columnId | '__create__' }.
  const [taskBoardColumns, setTaskBoardColumns] = useState([]);
  const [taskColumnsLoading, setTaskColumnsLoading] = useState(false);
  const [columnMap, setColumnMap] = useState({});

  // Lazy-load the account's active boards the first time the owner chooses to
  // connect an existing tasks board. Loaded once; the current board is dropped
  // from the list. Errors are logged (never crash the wizard).
  useEffect(() => {
    if (tasksMode !== 'connect' || boardsLoaded) return undefined;
    let cancelled = false;
    setBoardsLoading(true);
    (async () => {
      try {
        const data = await api(
          `query { boards(limit: 200, state: active) { id name } }`,
          {},
          'SetupWizard.loadBoards'
        );
        const currentId = context?.boardId != null ? String(context.boardId) : null;
        const opts = (data?.boards || [])
          .filter((b) => b && b.id != null && String(b.id) !== currentId)
          .map((b) => ({ value: String(b.id), label: b.name }));
        if (!cancelled) setBoardOptions(opts);
      } catch (err) {
        if (!err?.__loggedId) logger.error('SetupWizard', 'טעינת רשימת הלוחות נכשלה', err);
      } finally {
        if (!cancelled) {
          setBoardsLoaded(true);
          setBoardsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tasksMode, boardsLoaded, context]);

  // When an existing tasks board is chosen (connect mode), load THAT board's
  // columns so the owner can map them onto the required task fields. Reloads when
  // the chosen board changes. Defaults each field to a same-titled compatible
  // column when one exists, otherwise "create new". Errors are logged (never
  // crash the wizard); when not applicable the mapping state is cleared.
  useEffect(() => {
    if (tasksMode !== 'connect' || !tasksBoardId) {
      setTaskBoardColumns([]);
      setColumnMap({});
      return undefined;
    }
    let cancelled = false;
    setTaskColumnsLoading(true);
    (async () => {
      try {
        const data = await api(
          `query ($b: [ID!]) { boards(ids: $b) { columns { id title type } } }`,
          { b: [String(tasksBoardId)] },
          'SetupWizard.loadTaskBoardColumns'
        );
        const cols = (data?.boards?.[0]?.columns || []).filter((c) => c && c.id != null);
        if (cancelled) return;
        setTaskBoardColumns(cols);
        // Default the mapping: reuse a same-titled compatible column, else create.
        const map = {};
        for (const field of TASK_FIELD_SPECS) {
          const match = cols.find(
            (c) => c.title === field.title && isColumnCompatible(field.type, c.type)
          );
          map[field.alias] = match ? String(match.id) : CREATE_NEW_VALUE;
        }
        setColumnMap(map);
      } catch (err) {
        if (!err?.__loggedId) logger.error('SetupWizard', 'טעינת עמודות לוח המשימות נכשלה', err);
        if (!cancelled) {
          setTaskBoardColumns([]);
          setColumnMap({});
        }
      } finally {
        if (!cancelled) setTaskColumnsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tasksMode, tasksBoardId]);

  /*
   * round347 — seed the single default type + its template. Two stores must agree: the LABEL
   * on the managed "סוג דיון" dropdown (what a discussion stores) and the TYPE TEMPLATE in
   * monday.storage (the agenda + roles, keyed by that label's text).
   */
  const seedDefaultDiscussionType = useCallback(async () => {
    try {
      await addDropdownLabel({
        boardKey: 'discussions',
        alias: 'discussionTypeID',
        title: DEFAULT_DISCUSSION_TYPE,
      });
    } catch (err) {
      // Reported, not thrown: without the label the template is unreachable, but the install
      // is complete and the owner can add the type from תבניות.
      logger.error('SetupWizard', `יצירת סוג הדיון "${DEFAULT_DISCUSSION_TYPE}" נכשלה — ניתן להוסיף אותו בתבניות`, err);
    }
    await seedDefaultTypeTemplate(context, currentUser);
  }, [context, currentUser]);

  const handleCreate = useCallback(async () => {
    setPhase('running');
    setErrorMsg('');
    setProgress({ step: 0, total: 0, boardPhase: 'מתחיל…' });
    try {
      const config = await provisionAllBoards({
        discussionsBoardId: context?.boardId,
        workspaceId: context?.workspaceId,
        createDiscussionsBoard: isCustomObject,
        tasks: { mode: tasksMode, boardId: tasksBoardId, columnMap },
        // null on first-run (behaves exactly as before); the current mapping in
        // top-up so provisioning reuses mapped boards + completes only what's missing.
        existingConfig,
        onProgress: (step, total, label, boardPhase) =>
          setProgress({ step, total, boardPhase: boardPhase || label }),
      });
      /*
       * round317 (owner request) — persist the access-column auto-fill roles as
       * REAL state: יוצר + מוביל/מנהל + מרכז דיון on "יכולת עריכה", משתתפים on
       * "יכולת צפייה". They were only ever a fallback (nothing stored), so the
       * install's own configuration never said so. Merged per key, which is what
       * lets a TOP-UP run this too without overriding a choice the owner made.
       */
      await updateSettings({ ...config, preferences: withSeededAccessRoles(settings?.preferences) });
      /*
       * round347 (owner spec) — an install ships WITH a usable starting point: one discussion
       * type, "דיון כללי", and its agenda template, with the installing user as both מנהל
       * and מרכז הדיון. Until now a new account landed on an empty type list and an empty
       * template list and had to invent both before the app did anything.
       *
       * AFTER updateSettings on purpose: `addDropdownLabel` resolves the board + column from
       * the ACTIVE settings store, which `updateSettings` is what publishes. Both steps are
       * fail-soft and reported rather than thrown — the install itself succeeded, and the
       * owner can build a type by hand in תבניות.
       */
      await seedDefaultDiscussionType();
      // TOP-UP: the caller closes the panel (settings already refreshed). FIRST-RUN:
      // isConfigured now true → SettingsGate re-renders children, unmounting us.
      if (onDone) onDone();
    } catch (err) {
      if (!err?.__loggedId) logger.error('SetupWizard', 'הקמת הלוחות נכשלה', err);
      setErrorMsg(err?.message || 'אירעה שגיאה בהקמת הלוחות');
      setPhase('error');
    }
  }, [context, settings, updateSettings, tasksMode, tasksBoardId, columnMap, existingConfig, onDone, seedDefaultDiscussionType]);

  return (
    <div dir="rtl" className={isTopUp ? styles.rootEmbedded : styles.root}>
      <Flex direction="column" align="center" gap={16} className={styles.card}>
        {/* TOP-UP embeds inside the Settings modal, which already renders the
            panel header ("הוספת / השלמת לוחות ועמודות"). Skip the wizard's own
            heading there so the title isn't shown twice; first-run keeps it. */}
        {!isTopUp && <Heading type="h2">{title || 'הגדרת האפליקציה'}</Heading>}

        {phase === 'running' ? (
          <Flex direction="column" align="center" gap={14} className={styles.section}>
            {/* round141 — same creation experience as a new discussion: the
                branded PartyProgress bar, narrating BOARDS (not columns). */}
            <Text type="text1" weight="bold">מקים את המערכת עבורך…</Text>
            <PartyProgress
              value={progress.total > 0 ? progress.step / progress.total : null}
              label={progress.boardPhase}
            />
          </Flex>
        ) : (
          <Flex direction="column" align="center" gap={16} className={styles.section}>
            {isTopUp ? (
              <div className={styles.topUp}>
                <Text type="text1" align="start" className={styles.topUpLead}>
                  {allRolesMapped
                    ? 'כל הלוחות כבר קיימים ומחוברים. אפשר להשלים עמודות שחסרות בלוחות — המיפוי הקיים לא ייפגע.'
                    : 'אפשר להוסיף לוחות שחסרים ולהשלים עמודות חסרות. לוחות שכבר מחוברים יישארו כפי שהם — רק מה שחסר יתווסף.'}
                </Text>
                <div className={styles.rolesStatus}>
                  {SETUP_ROLE_ORDER.map((key) => {
                    const mapped = roleMapped(key);
                    // round141 — in a BOARD VIEW the discussions "board" is never
                    // created (it is the current board) — say so instead of the
                    // misleading "יתווסף". In a custom-object install (round141b)
                    // a real דיונים board IS created, so "יתווסף" is accurate.
                    const stateText = mapped
                      ? 'כבר מחובר'
                      : key === 'discussions' && !isCustomObject ? 'הלוח הנוכחי (יחובר)' : 'יתווסף';
                    return (
                      <div key={key} className={styles.roleRow}>
                        <span className={styles.roleName}>{SETUP_ROLE_LABELS[key]}</span>
                        <span className={`${styles.roleState} ${mapped ? styles.roleStateOn : styles.roleStateOff}`}>
                          {stateText}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className={styles.intro}>
                <p className={styles.introLead}>
                  ברוכים הבאים! נראה שזו ההפעלה הראשונה של האפליקציה.
                </p>
                <p className={styles.introBody}>
                  לחיצה על <b>"צור לוחות אוטומטית"</b> תקים הכול בשבילך:
                </p>
                <ul className={styles.introList}>
                  {isCustomObject ? (
                    <li>ייווצר <b>לוח דיונים</b> חדש עם כל העמודות הנדרשות.</li>
                  ) : (
                    <li><b>הלוח הנוכחי</b> — שבו האפליקציה מותקנת — יהפוך ללוח הדיונים (יתווספו אליו העמודות הנדרשות; לא נוצר לוח דיונים חדש).</li>
                  )}
                  <li>ייווצרו לוחות חדשים ל<b>נושאים לדיון</b> ול<b>החלטות</b>, עם כל העמודות והקישורים.</li>
                  <li>עבור <b>המשימות</b> — בחרו למטה: לוח חדש, או חיבור לוח קיים מהחשבון.</li>
                </ul>
                <p className={styles.introFoot}>לחלופין, אפשר למפות לוחות קיימים ידנית.</p>
              </div>
            )}

            {phase === 'error' && (
              <Text type="text2" className={styles.error}>
                {errorMsg} — אפשר לנסות שוב או למפות ידנית.
              </Text>
            )}

            {showTasksSection && (
            <div className={styles.tasksChoice}>
              <Text type="text2" weight="bold" align="center">לוח המשימות:</Text>
              <Flex gap={16} align="center" justify="center" className={styles.choiceRow}>
                <RadioButton
                  name="tasksMode"
                  text="צור לוח משימות חדש"
                  value="create"
                  checked={tasksMode === 'create'}
                  onSelect={() => setTasksMode('create')}
                />
                <RadioButton
                  name="tasksMode"
                  text="חבר לוח משימות קיים"
                  value="connect"
                  checked={tasksMode === 'connect'}
                  onSelect={() => setTasksMode('connect')}
                />
              </Flex>
              {tasksMode === 'connect' && (
                <div className={styles.boardPicker}>
                  {/* round141 — searchable: typing filters the account's boards
                      by name instead of scrolling the whole list. */}
                  <Dropdown
                    dir="rtl"
                    size="small"
                    searchable
                    placeholder="חפשו לוח לפי שם או בחרו מהרשימה"
                    options={boardOptions}
                    loading={boardsLoading}
                    value={boardOptions.find((o) => o.value === tasksBoardId) || null}
                    onChange={(opt) => setTasksBoardId(opt ? String(opt.value) : '')}
                  />
                </div>
              )}
              {tasksMode === 'connect' && tasksBoardId && (
                <div className={styles.columnMap}>
                  <Text type="text2" weight="bold" align="center">מיפוי עמודות לוח המשימות:</Text>
                  {taskColumnsLoading ? (
                    <Loader size={20} />
                  ) : (
                    TASK_FIELD_SPECS.map((field) => {
                      const options = optionsForField(field, taskBoardColumns);
                      const selected = columnMap[field.alias] || CREATE_NEW_VALUE;
                      return (
                        <div key={field.alias} className={styles.mapRow}>
                          <Text type="text2" className={styles.mapLabel}>{field.title}</Text>
                          <div className={styles.mapDropdown}>
                            <Dropdown
                              dir="rtl"
                              size="small"
                              options={options}
                              value={options.find((o) => o.value === selected) || null}
                              onChange={(opt) =>
                                setColumnMap((prev) => ({
                                  ...prev,
                                  [field.alias]: opt ? String(opt.value) : CREATE_NEW_VALUE,
                                }))
                              }
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
            )}

            <Flex gap={12} align="center" justify="center" className={styles.actions}>
              <Button
                kind="primary"
                size="medium"
                onClick={handleCreate}
                disabled={showTasksSection && tasksMode === 'connect' && (!tasksBoardId || taskColumnsLoading)}
              >
                {phase === 'error'
                  ? 'נסה שוב'
                  : isTopUp
                    ? (allRolesMapped ? 'השלם עמודות חסרות' : 'הוסף והשלם לוחות')
                    : 'צור לוחות אוטומטית'}
              </Button>
              <Button kind="secondary" size="medium" onClick={handleSecondary}>
                {secondaryLabel}
              </Button>
            </Flex>
          </Flex>
        )}
      </Flex>
    </div>
  );
}

export default SetupWizard;
