import React, { useState, useEffect, useRef } from 'react';
import { Button, Heading, Text, Flex, ButtonGroup, TabsContext, TabList, Tab, TabPanels, TabPanel } from '@vibe/core';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { useSettings } from '../../contexts/SettingsContext.jsx';
import { useMondayContext } from '../../contexts/MondayContext.jsx';
import { buildEmptyConfig, DEFAULT_PREFERENCES, PREVIOUS_TASKS_MODES, DEFAULT_PERMISSIONS, DEFAULT_PERMISSION_SEED, DEFAULT_EXPORT_TEMPLATE, ACCESS_ROLE_SOURCE_OPTIONS, APP_COMPONENTS, isComponentVisible } from '../../utils/mondayApi/boards.config.js';

// Round 78: the effective auto-fill role list for a tasks access column
// (taskViewersID / taskEditorsID) — the stored preference, or the default when
// unset. Exported so the resolution is unit-testable.
export function accessRolesFor(preferences, accessAlias) {
  const stored = preferences?.accessRoleSources?.[accessAlias];
  if (Array.isArray(stored)) return stored;
  return DEFAULT_PREFERENCES.accessRoleSources?.[accessAlias] || [];
}
// Toggle one discussion role in an access column's source list, returning the
// NEXT preferences object (pure — the component wraps it in setPreferences).
export function toggleAccessRoleSource(preferences, accessAlias, roleAlias) {
  const base = { ...DEFAULT_PREFERENCES.accessRoleSources, ...(preferences?.accessRoleSources || {}) };
  const cur = Array.isArray(base[accessAlias]) ? base[accessAlias] : [];
  const next = cur.includes(roleAlias) ? cur.filter((r) => r !== roleAlias) : [...cur, roleAlias];
  return { ...preferences, accessRoleSources: { ...base, [accessAlias]: next } };
}
import { api } from '../../utils/mondayApi/monday-client.js';
import { detectManagedColumnId } from '../../utils/mondayApi/managedColumns.js';
import { loadExportAssets, saveExportAssets } from '../../utils/exportAssets.js';
import SearchablePicker from './SearchablePicker';
import PermissionsTab from './PermissionsTab.jsx';
import ExportTemplateTab from './ExportTemplateTab.jsx';
import { TemplateManagerModal as TemplatesPanel } from '@generated/components/TemplateManagerModal';
import { SetupWizard } from '../SetupWizard';
import logger from '../../utils/logger.js';
import { getVersionLabel } from '../../utils/versionLabel.js';
import styles from './SettingsModal.module.css';

// Seed the editable export-template draft from stored settings, back-filling any
// keys added to the schema after the instance was last saved (so new sections/
// fields appear). A shallow merge over the default is enough for the top-level
// keys; `sections` is taken verbatim when present (the user owns its order).
export function seedExportTemplate(stored) {
  const base = { ...DEFAULT_EXPORT_TEMPLATE, ...(stored || {}) };
  if (!Array.isArray(base.sections) || !base.sections.length) base.sections = DEFAULT_EXPORT_TEMPLATE.sections;
  // Clone so we never mutate a shared constant / the stored object, then back-fill
  // any section key added to the schema after this instance last saved (round192:
  // 'decisions'). Each missing key is inserted near its DEFAULT position; the order
  // of keys the user already has is preserved (they own that order).
  base.sections = base.sections.map((s) => ({ ...s }));
  // round203 — drop RETIRED section keys (e.g. 'freeText' — "פתיחה") that an
  // older instance still carries; only keys in the current schema survive.
  const defaultKeys = new Set(DEFAULT_EXPORT_TEMPLATE.sections.map((s) => s.key));
  base.sections = base.sections.filter((s) => defaultKeys.has(s?.key));
  const present = new Set(base.sections.map((s) => s?.key));
  DEFAULT_EXPORT_TEMPLATE.sections.forEach((def, idx) => {
    if (!present.has(def.key)) {
      base.sections.splice(Math.min(idx, base.sections.length), 0, { ...def });
      present.add(def.key);
    }
  });
  base.header = { ...DEFAULT_EXPORT_TEMPLATE.header, ...(stored?.header || {}) };
  base.footer = { ...DEFAULT_EXPORT_TEMPLATE.footer, ...(stored?.footer || {}) };
  return base;
}

// Merge the board-key scaffold over the stored boards so a board ROLE added to
// BOARD_KEYS after the instance was saved (e.g. `decisions`) still renders its
// mapping section — preserving every board id the user already set.
function mergeBoardsWithSchema(stored) {
  return { ...buildEmptyConfig().boards, ...(stored || {}) };
}

// Merge the alias schema over the stored mapping so columns added to the schema
// AFTER a user saved settings (summaryFileID, topicNotForDiscussionID,
// pointNotForDiscussionID) still render in the modal — preserving any id/verified
// the user already mapped. Without this, new fields are invisible to existing instances.
function mergeColumnsWithSchema(stored) {
  const empty = buildEmptyConfig().columns;
  const out = {};
  for (const boardKey of Object.keys(empty)) {
    out[boardKey] = {};
    for (const alias of Object.keys(empty[boardKey])) {
      // Stored carries id/verified, but `type`/`title` are CODE-authoritative —
      // force them from the schema so a schema change (e.g. סוג dropdown→status)
      // re-filters the column picker even for already-configured instances.
      out[boardKey][alias] = {
        ...empty[boardKey][alias],
        ...(stored?.[boardKey]?.[alias] || {}),
        type: empty[boardKey][alias].type,
        title: empty[boardKey][alias].title,
      };
    }
    for (const alias of Object.keys(stored?.[boardKey] || {})) {
      if (!out[boardKey][alias]) out[boardKey][alias] = stored[boardKey][alias];
    }
  }
  return out;
}

// Column-type sections for the mapping screen (discussions + tasks). Fields are
// bucketed by their monday column TYPE into ordered sections, each with a Hebrew
// header. A field whose type matches no section falls into the trailing "אחר".
const COLUMN_TYPE_GROUPS = [
  { key: 'people', title: 'אנשים', types: ['people', 'person', 'multiple_person'] },
  { key: 'date', title: 'תאריכים', types: ['date'] },
  { key: 'status', title: 'סטטוס', types: ['status', 'color'] },
  { key: 'dropdown', title: 'רשימה נפתחת', types: ['dropdown'] },
  { key: 'relation', title: 'חיבורי לוחות', types: ['board_relation', 'connect_boards'] },
  { key: 'file', title: 'קבצים', types: ['file'] },
  { key: 'text', title: 'טקסט', types: ['text', 'long_text'] },
  { key: 'formula', title: 'נוסחאות ושיקופים', types: ['formula', 'mirror', 'lookup'] },
];

// Which section a column type belongs to (falls back to a trailing "אחר").
function typeGroupKey(type) {
  const t = String(type || '').toLowerCase().replace(/-/g, '_');
  const found = COLUMN_TYPE_GROUPS.find((g) => g.types.includes(t));
  return found ? found.key : 'other';
}

// Board permissions are ALWAYS ON (no enable toggle). Seed the editable draft
// with enabled:true and pre-fill roles from the LOCKED seed when none are stored
// yet, so the matrix is never empty and saving persists the always-on state.
function seedPermissions(stored) {
  const base = { ...DEFAULT_PERMISSIONS, ...(stored || {}), enabled: true };
  if (!base.roles || Object.keys(base.roles).length === 0) {
    base.roles = JSON.parse(JSON.stringify(DEFAULT_PERMISSION_SEED));
  }
  return base;
}

const PREVIOUS_TASKS_MODE_OPTIONS = [
  { value: PREVIOUS_TASKS_MODES.LINKED_DISCUSSION, text: 'לפי דיון קודם' },
  { value: PREVIOUS_TASKS_MODES.DISCUSSION_TYPE, text: 'לפי סוג דיון' },
  // Hybrid: per-discussion — typed discussions resolve by type, untyped ones by
  // the previous-discussion link.
  { value: PREVIOUS_TASKS_MODES.AUTO, text: 'אוטומטי' },
];

// Multi-column people mapping (יכולת צפייה / יכולת עריכה) view model. Pure +
// exported for testing. `typedOptions` are the board's live columns of the
// right type in SearchablePicker's { id, name } shape (NOT { value, label } —
// reading the wrong keys is what made the chips show raw column ids and stopped
// `remaining` from excluding already-picked columns). `colTitles` are names
// captured at pick time, used as a fallback before the live list resolves.
export function resolveMultiColView(typedOptions, selectedIds, colTitles = {}) {
  const opts = Array.isArray(typedOptions) ? typedOptions : [];
  const sel = (Array.isArray(selectedIds) ? selectedIds : []).map(String);
  const labelByVal = Object.fromEntries(opts.map((o) => [String(o.id), o.name]));
  const chipName = (cid) => labelByVal[String(cid)] || colTitles?.[String(cid)] || String(cid);
  const remaining = opts.filter((o) => !sel.includes(String(o.id)));
  return { labelByVal, chipName, remaining };
}

/**
 * Minimal in-product settings editor: edit the per-board id + each
 * alias→real-column-id mapping that the SDK reads, then persist via
 * SettingsContext.updateSettings (monday.storage, per instance).
 */
export function SettingsModal({ isOpen, onClose, onNotify, templatesOnly = false, contained = false }) {
  const { settings, updateSettings, isConfigured } = useSettings();
  const { context } = useMondayContext();
  // settings is null until a mapping is stored; seed the editable draft from an
  // empty scaffold (alias/type/title with blank ids) so first-time config works.
  const draft = settings || buildEmptyConfig();
  const [boards, setBoards] = useState(mergeBoardsWithSchema(draft.boards));
  const [columns, setColumns] = useState(mergeColumnsWithSchema(draft.columns));
  const [preferences, setPreferences] = useState({ ...DEFAULT_PREFERENCES, ...(draft.preferences || {}) });
  // Live tasks-status labels for the "delayed done statuses" preference (empty
  // until the tasks board/column are mapped and published — first-run modal).
  const { options: taskStatusOptions } = useStatusOptions('tasks', 'statusID');
  // Export-template draft + its heavy assets (logos / uploaded .docx). Assets load
  // async from their own storage key when the modal opens; both persist on Save.
  const [exportTemplate, setExportTemplate] = useState(seedExportTemplate(draft.exportTemplate));
  const [exportAssets, setExportAssets] = useState({ headerLogo: null, footerLogo: null, templateDocx: null });
  const [assetError, setAssetError] = useState(null);
  // Permissions draft: whole `permissions` object edited in the "הרשאות" tab and
  // persisted as one write on save. Seeded from stored settings or the inert
  // DEFAULT_PERMISSIONS (enabled:false ⇒ no behavior change).
  const [permissions, setPermissions] = useState(seedPermissions(draft.permissions));
  const [selectedRoleKey, setSelectedRoleKey] = useState(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(0); // 0 = מיפוי, 1 = העדפות, 2 = תבניות, 3 = תבנית ייצוא, 4 = הרשאות
  // round256 — the Templates tab (2) widens to the export size while its type
  // editor is on the "תבנית ייצוא" sub-tab (TemplateManagerModal reports this).
  const [templatesExportWide, setTemplatesExportWide] = useState(false);
  const [openBoardKey, setOpenBoardKey] = useState(null);
  const [boardOptions, setBoardOptions] = useState([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [columnsByBoardId, setColumnsByBoardId] = useState({});
  const [loadingColumnsByBoardId, setLoadingColumnsByBoardId] = useState({});
  const [subitemsBoardByBoard, setSubitemsBoardByBoard] = useState({});
  const [importMsg, setImportMsg] = useState(null);
  // TOP-UP wizard (post-install "add/complete boards & columns"): when true the
  // reusable SetupWizard replaces the tabbed mapping UI until the owner finishes
  // (onDone) or backs out (onManual). Offered only once the instance is already
  // configured — never during the first-run forced modal.
  const [showTopUp, setShowTopUp] = useState(false);
  const fileInputRef = useRef(null);

  // re-seed local draft from the live settings whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      const seed = settings || buildEmptyConfig();
      setBoards(mergeBoardsWithSchema(seed.boards));
      setColumns(mergeColumnsWithSchema(seed.columns));
      setPreferences({ ...DEFAULT_PREFERENCES, ...(seed.preferences || {}) });
      setPermissions(seedPermissions(seed.permissions));
      setExportTemplate(seedExportTemplate(seed.exportTemplate));
      setAssetError(null);
      loadExportAssets(context)
        .then(setExportAssets)
        .catch((err) => logger.warn('SettingsModal', 'טעינת נכסי הייצוא נכשלה', err));
      setOpenBoardKey(null);
    }
  }, [isOpen, settings, context]);

  // Reset the top-up view whenever the modal closes, so reopening always lands on
  // the normal Settings view (and it never lingers after first-run config). Keyed
  // on isOpen ONLY, so a settings change mid-top-up doesn't dismiss the wizard.
  useEffect(() => {
    if (!isOpen) setShowTopUp(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const loadBoards = async () => {
      setLoadingBoards(true);
      try {
        const LIMIT = 500;
        const allBoards = [];

        const seen = new Set();
        const appendBoards = (boardsPage) => {
          (boardsPage || []).forEach((board) => {
            const id = String(board?.id || '');
            if (!id || seen.has(id)) return;
            seen.add(id);
            allBoards.push(board);
          });
        };

        // Page-based pagination: keep requesting pages until a short page
        // (fewer than LIMIT) signals the last one.
        const loadByPage = async () => {
          let page = 1;
          let hasMore = true;
          let guard = 0;
          while (hasMore && guard < 100) {
            const data = await api(
              `query ($limit: Int!, $page: Int!) {
                boards(limit: $limit, page: $page) {
                  id
                  name
                  type
                }
              }`,
              { limit: LIMIT, page },
              'SettingsModal.loadBoards.page'
            );
            const pageBoards = data?.boards || [];
            appendBoards(pageBoards);
            hasMore = pageBoards.length === LIMIT;
            page += 1;
            guard += 1;
          }
        };

        await loadByPage();

        const options = allBoards
          .filter((board) => board.type === 'board')
          .map((board) => ({ value: String(board.id), label: board.name }));
        setBoardOptions(options);
      } catch (err) {
        logger.error('SettingsModal', 'טעינת רשימת הלוחות להגדרות נכשלה', err);
      } finally {
        setLoadingBoards(false);
      }
    };

    loadBoards();
  }, [isOpen]);

  const setBoardId = (boardKey, id) =>
    setBoards((b) => ({ ...b, [boardKey]: { ...b[boardKey], id } }));

  const setColId = (boardKey, alias, id) =>
    setColumns((c) => ({
      ...c,
      [boardKey]: {
        ...c[boardKey],
        [alias]: {
          ...c[boardKey][alias],
          id,
          // Manual selection is treated as user verification.
          verified: Boolean(String(id || '').trim()),
        },
      },
    }));

  // Multi-column people mapping (owner requests 2026-07-14): an alias in
  // MULTI_PEOPLE_ALIASES (the access columns — יכולת צפייה + יכולת עריכה) can
  // map SEVERAL people columns. Stored as { id: <primary>, ids: [...],
  // colTitles: {id: title} } — `id` stays the FIRST pick (the auto-fill/write
  // target), so every single-id consumer keeps working; reads/permissions
  // union all of them; colTitles keeps the picked-column chips showing the
  // COLUMN NAME even before the live column list loads (the owner saw raw ids).
  const currentMultiIds = (cur) => {
    if (Array.isArray(cur?.ids) && cur.ids.length) return cur.ids.map(String);
    return cur?.id ? [String(cur.id)] : [];
  };
  const addMultiColId = (boardKey, alias, id, title = '') => {
    if (!String(id || '').trim()) return;
    setColumns((c) => {
      const cur = c[boardKey][alias] || {};
      const ids = [...new Set([...currentMultiIds(cur), String(id)])];
      const colTitles = { ...(cur.colTitles || {}) };
      if (title) colTitles[String(id)] = title;
      return {
        ...c,
        [boardKey]: { ...c[boardKey], [alias]: { ...cur, id: ids[0] || '', ids, colTitles, verified: ids.length > 0 } },
      };
    });
  };
  const removeMultiColId = (boardKey, alias, id) =>
    setColumns((c) => {
      const cur = c[boardKey][alias] || {};
      const ids = currentMultiIds(cur).filter((x) => x !== String(id));
      const colTitles = { ...(cur.colTitles || {}) };
      delete colTitles[String(id)];
      return {
        ...c,
        [boardKey]: { ...c[boardKey], [alias]: { ...cur, id: ids[0] || '', ids, colTitles, verified: ids.length > 0 } },
      };
    });

  const normalizeType = (type) =>
    String(type || '')
      .toLowerCase()
      .replace(/-/g, '_');

  const isColumnTypeCompatible = (expectedType, actualType) => {
    const expected = normalizeType(expectedType);
    const actual = normalizeType(actualType);

    if (!expected || !actual) return true;
    if (expected === actual) return true;

    if ((expected === 'people' || expected === 'person') && (actual === 'people' || actual === 'person' || actual === 'multiple_person')) {
      return true;
    }
    if ((expected === 'long_text' || expected === 'text') && (actual === 'long_text' || actual === 'text')) {
      return true;
    }
    if (expected === 'board_relation' && (actual === 'board_relation' || actual === 'connect_boards')) {
      return true;
    }
    if (expected === 'checkbox' && (actual === 'checkbox' || actual === 'boolean')) {
      return true;
    }
    if (expected === 'mirror' && (actual === 'mirror' || actual === 'lookup')) {
      return true;
    }

    return false;
  };

  const getTypedColumnOptions = (boardId, expectedType) => {
    const source = columnsByBoardId[String(boardId || '')] || [];
    return source
      .filter((opt) => isColumnTypeCompatible(expectedType, opt.type))
      .map((opt) => ({ id: opt.value, name: opt.label }));
  };

  const BOARD_ROLE_TITLES = {
    discussions: 'דיונים',
    tasks: 'משימות',
    topics: 'נושאים לדיון',
    decisions: 'החלטות',
  };

  const DISCUSSIONS_SETTINGS_FIELDS = [
    'discussionCreatorID',
    'discussionLeadID',
    'discussionCoordinatorID', // מרכז דיון — optional people column / full role
    'participantsID',
    'externalParticipantsID', // round211 — משתתפים חיצוניים (long_text, comma-separated names)
    'creationDateID',
    'discussionDateID',
    'discussionTypeID',
    'summaryFileID',
    'previousDiscussionID',
    'tasksBoardLinkID',
    'topicsBoardLinkID',
    'decisionsBoardLinkID', // לוח החלטות — two-way pair of the decisions board's discussionLinkID
  ];
  const TASKS_SETTINGS_FIELDS = [
    'taskCreatorID',
    'taskCreationDateID', // תאריך יצירה — auto-stamped with today at task creation (round115)
    'responsibilityID',
    'deadlineID',
    'statusID',
    'discussionLinkID',
    'taskNotesID', // הערות — inline-editable notes column, "My Tasks" tab only
    'priorityID', // עדיפות — status column whose label order defines priorityID, "My Tasks" tab only
    'taskTypeID', // סוג דיון — status column auto-filled with the parent discussion's type
    'taskViewersID', // יכולת צפייה — people; auto-filled with the discussion's participants (item 19)
    'taskEditorsID', // יכולת עריכה — people; auto-filled with the discussion's lead/coordinator/creator (item 19)
    // 'פרטים' (detailsID) and 'חיבור לנושאי דיון' (topicsLinkID) intentionally omitted —
    // not needed in the tasks mapping.
  ];
  const TOPICS_SETTINGS_FIELDS = [
    'discussionLinkID', // 'דיון' — connection to the discussion
    'topicCreatorID', // 'יוצר נושא' — people column; avatar shown on the topic group header
    'topicCreationDateID', // 'תאריך יצירה' — auto-stamped with today at topic creation (round115)
    'topicPriorityID', // per-topic priority (status column on the topics board)
    'topicNotForDiscussionID', // topic-level "not for discussion" checkbox (drives export filter)
    'pointNotForDiscussionID', // point-level "not for discussion" checkbox (on the subitems board)
    'pointCheckedID', // 'האם נידונה' — discussed checkbox on the SUBITEMS board (topics table)
    'pointCreatorID', // 'יוצר נקודה' — people column on the SUBITEMS board; avatar per point
    'pointCreationDateID', // 'תאריך יצירה (נקודה)' — auto-stamped with today at point creation (round115)
    'pointDecisionsLinkID', // 'החלטות (נקודה)' — board_relation on the SUBITEMS board to decisions created from the point
    'pointTasksLinkID', // 'משימות (נקודה)' — board_relation on the SUBITEMS board to tasks created from the point
    // 'pointResponsesID' ('התייחסויות') intentionally NOT mapped here — the topics-table
    // redesign removed the responses cell, so the field is hidden from Settings.
  ];
  const DECISIONS_SETTINGS_FIELDS = [
    'decisionCreatorID', // 'יוצר החלטה' — people column; decision-tier creator role
    'deciderID', // 'מחליט' — people column; decision-tier decider role
    'affectedID', // 'מושפעים' — people column; decision-tier "affected" role
    'decisionStatusID', // 'סטאטוס החלטה' — status column (labels come from the column)
    'decisionTrackingID', // 'מעקב החלטה' — round153 second status column; labels from the column, default "התקבלה"
    // 'decisionPriorityID' ('עדיפות') intentionally NOT listed — the decisions
    // priority column was dropped from the UI (DecisionsTab hid it visually in an
    // earlier round), so it is excluded from the MAPPING screen too. The alias
    // stays in COLUMN_SCHEMA (and any previously-stored id is preserved on save)
    // so useDecisions/useMyDecisions references never break; it is simply no
    // longer a mappable row for the decisions board.
    'decisionDateID', // 'תאריך' — date column
    'discussionLinkID', // 'דיון' — two-way pair of the discussions board's decisionsBoardLinkID
  ];

  // Aliases whose real column lives on the board's SUBITEMS board, not the board itself.
  const SUBITEM_FIELDS = new Set([
    'pointCheckedID',
    'pointNotForDiscussionID',
    'pointCreatorID',
    'pointDecisionsLinkID',
    'pointTasksLinkID',
  ]);

  // Aliases that may map SEVERAL people columns (owner requests 2026-07-14):
  // both access columns — יכולת צפייה AND יכולת עריכה. Stored as
  // { id: <primary>, ids: [...], colTitles: {id: title} }. The FIRST column is
  // the auto-fill target at task creation; permissions/reads union people
  // across all of them; colTitles keeps the chips human-readable even before
  // the live column list has loaded.
  const MULTI_PEOPLE_ALIASES = new Set(['taskViewersID', 'taskEditorsID']);

  const loadBoardColumns = async (boardId) => {
    const id = String(boardId || '');
    if (!id || columnsByBoardId[id] || loadingColumnsByBoardId[id]) return;

    setLoadingColumnsByBoardId((prev) => ({ ...prev, [id]: true }));
    try {
      const data = await api(
        `query ($boardId: [ID!]) {
          boards(ids: $boardId) {
            columns {
              id
              title
              type
              settings_str
            }
          }
        }`,
        { boardId: [id] },
        'SettingsModal.loadBoardColumns'
      );

      const rawCols = data?.boards?.[0]?.columns || [];
      const cols = rawCols.map((col) => ({
        value: String(col.id),
        label: col.title,
        type: col.type,
      }));
      setColumnsByBoardId((prev) => ({ ...prev, [id]: cols }));

      // Discover this board's SUBITEMS board (from the subtasks column settings)
      // and load its columns too, so subitem-level fields (pointCheckedID) are mappable.
      const subCol = rawCols.find((c) => c.type === 'subtasks' || c.type === 'subitems');
      if (subCol?.settings_str) {
        try {
          const parsed = JSON.parse(subCol.settings_str);
          const subBoardId = String((parsed.boardIds || parsed.allowedBoardIds || [])[0] || '');
          if (subBoardId) {
            setSubitemsBoardByBoard((prev) => ({ ...prev, [id]: subBoardId }));
            loadBoardColumns(subBoardId);
          }
        } catch (err) {
          // no subitems board discoverable — subitem fields just stay unmappable
          logger.warn('SettingsModal', 'זיהוי לוח תתי-הפריטים נכשל', err);
        }
      }
    } catch (err) {
      logger.error('SettingsModal', `טעינת עמודות הלוח ${id} נכשלה`, err);
    } finally {
      setLoadingColumnsByBoardId((prev) => ({ ...prev, [id]: false }));
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const uniqueBoardIds = Array.from(
      new Set(Object.values(boards || {}).map((b) => String(b?.id || '')).filter(Boolean))
    );
    uniqueBoardIds.forEach((id) => {
      loadBoardColumns(id);
    });
  }, [isOpen, boards]);

  const handleSave = async () => {
    setSaving(true);
    setAssetError(null);
    try {
      // Persist the heavy export assets first — if they exceed the 6MB quota this
      // throws, and we abort WITHOUT saving settings so config and assets can't
      // drift out of sync. The friendly quota message is shown in the tab.
      await saveExportAssets(context, exportAssets);
      // Detect whether the discussion-type DROPDOWN column is backed by an
      // account MANAGED column and persist its UUID, so addDropdownLabel
      // (create-modal "הוסף סוג דיון חדש") goes straight to
      // update_dropdown_managed_column instead of the board-level mutation
      // (which a managed column rejects). Best-effort — a failed detection just
      // leaves the column marked regular; addDropdownLabel self-heals lazily on
      // the managed-structure rejection and the modal persists the corrected hint.
      let columnsToSave = columns;
      const typeEntry = columns?.discussions?.discussionTypeID;
      const typeBoardId = boards?.discussions?.id;
      if (typeEntry?.id && typeBoardId) {
        try {
          // Type filter matters: the account has managed columns of BOTH types
          // named "סוג דיון" — only a dropdown-type one is updatable via
          // update_dropdown_managed_column (the column itself is a dropdown).
          const uuid = await detectManagedColumnId(typeBoardId, typeEntry.id, { type: 'dropdown' });
          columnsToSave = {
            ...columns,
            discussions: {
              ...columns.discussions,
              discussionTypeID: { ...typeEntry, managed: !!uuid, managedColumnId: uuid || null },
            },
          };
        } catch (err) {
          // detection best-effort — the regular (non-managed) mapping still saves
          logger.warn('SettingsModal', 'זיהוי עמודת הסוג המנוהלת נכשל — נשמר מיפוי רגיל', err);
        }
      }
      await updateSettings({ boards, columns: columnsToSave, preferences, permissions, exportTemplate });
      // Success toast (top of the app, same funnel as every other notification).
      onNotify?.('הגדרות נשמרו בהצלחה', 'success');
      onClose();
    } catch (err) {
      logger.error('SettingsModal', 'שמירת ההגדרות נכשלה', err);
      setActiveTab(3);
      setAssetError(err?.message || 'שמירת נכסי הייצוא נכשלה');
    } finally {
      setSaving(false);
    }
  };

  const handleExportJson = () => {
    const exportPayload = {
      ...(settings || {}),
      boards,
      columns,
      preferences,
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `discussions-settings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Import a previously-exported settings JSON into the editable draft. The user
  // reviews the loaded mapping and clicks "שמור" to persist it (same path as a
  // manual edit). This is the only way to map fields the picker can't reach
  // (e.g. the subitem-level "נדון" checkbox) without re-mapping by hand.
  const handleImportClick = () => {
    setImportMsg(null);
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || !parsed.boards || !parsed.columns) {
        throw new Error('invalid settings shape');
      }
      setBoards((prev) => ({ ...prev, ...parsed.boards }));
      setColumns((prev) => ({ ...prev, ...parsed.columns }));
      if (parsed.preferences) setPreferences((prev) => ({ ...prev, ...parsed.preferences }));
      setImportMsg({ ok: true, text: 'הקובץ נטען. בדקו את המיפוי ולחצו "שמור" להחלה.' });
    } catch (err) {
      logger.error('SettingsModal', 'ייבוא קובץ הגדרות נכשל', err);
      setImportMsg({ ok: false, text: 'ייבוא נכשל — ודאו שזהו קובץ JSON תקין של הגדרות (boards + columns).' });
    }
  };

  if (!isOpen) return null;

  // round178 — `contained` scopes the overlay to the right discussion-card pane
  // (absolute, not fixed) so the settings box opens CENTERED within that pane and
  // dims only its tabs (owner request). Full-screen otherwise (e.g. the boot gate).
  // round197 — the Export-template tab BREAKS OUT of containment (owner request):
  // its box fills the whole app iframe, so the contained (card-pane-scoped)
  // overlay is dropped while that tab is active and the viewport-fixed overlay
  // takes over; every other tab keeps the contained behavior.
  const overlayClass = `${styles.overlay} ${contained && activeTab !== 3 ? styles.overlayContained : ''}`;

  // round147 — templates-only mode: a super member ("חבר-על") opens the gear to
  // manage templates and NOTHING else — no mapping, no preferences, no
  // permissions. TemplatesPanel persists itself to monday.storage, so the
  // settings save/footer machinery is deliberately absent here.
  if (templatesOnly) {
    return (
      <div className={overlayClass} onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}>
        <div
          className={`${styles.modal} ${styles.modalFixed}`}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="ניהול תבניות"
        >
          <div className={styles.header}>
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="סגירה">
              ×
            </button>
            <Heading type="h4">ניהול תבניות</Heading>
          </div>
          <div className={styles.content}>
            <div className={styles.body}>
              <TemplatesPanel />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // TOP-UP: replace the whole Settings surface with the reusable SetupWizard in
  // config-aware mode — reusing mapped boards, creating only missing ones, and
  // completing only missing columns, merged into the existing settings. Both
  // onDone and onManual return here; updateSettings already ran inside the wizard,
  // so the re-seed effect refreshes the mapping view with the fresh config.
  if (showTopUp) {
    return (
      <div className={overlayClass} onClick={(e) => {
        if (e.target === e.currentTarget) setShowTopUp(false);
      }}>
        <div
          className={`${styles.modal} ${styles.modalFixed}`}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="הוספת לוחות ועמודות"
        >
          <div className={styles.header}>
            <button type="button" className={styles.closeButton} onClick={() => setShowTopUp(false)} aria-label="חזרה">
              ×
            </button>
            <Heading type="h4">הוספת / השלמת לוחות ועמודות</Heading>
          </div>
          <div className={styles.content}>
            <SetupWizard
              existingConfig={{ boards, columns }}
              title="הוספת / השלמת לוחות ועמודות"
              onManual={() => setShowTopUp(false)}
              onDone={() => setShowTopUp(false)}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={overlayClass} onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div
        className={`${styles.modal} ${activeTab <= 2 && !(activeTab === 2 && templatesExportWide) ? styles.modalFixed : ''} ${activeTab === 3 || (activeTab === 2 && templatesExportWide) ? styles.modalExport : ''} ${activeTab === 4 ? styles.modalWide : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="הגדרות"
      >
        <div className={styles.header}>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="סגירה">
            ×
          </button>
          <Heading type="h4">הגדרות</Heading>
        </div>
        <div className={styles.content}>
          <TabsContext activeTabId={activeTab} className={styles.tabsCtx}>
            <TabList className={styles.tabList}>
              <Tab onClick={() => setActiveTab(0)}>מיפוי</Tab>
              <Tab onClick={() => setActiveTab(1)}>העדפות</Tab>
              <Tab onClick={() => setActiveTab(2)}>תבניות</Tab>
              <Tab onClick={() => setActiveTab(3)}>תבנית ייצוא</Tab>
              <Tab onClick={() => setActiveTab(4)}>הרשאות</Tab>
            </TabList>
            <TabPanels className={styles.tabPanels}>
              <TabPanel className={styles.tabPanelFill}>
          {/* round247 — the מיפוי panel is full RTL (owner request). */}
          <div className={styles.body} dir="rtl">
            {/* Post-install entry to the config-aware SetupWizard. Shown only when
                the instance is already configured (never in the first-run forced
                modal, which has the wizard as its landing screen). */}
            {isConfigured && (
              <div className={styles.topupEntry}>
                <div className={styles.topupText}>
                  <Text type={"text2"} weight={"medium"}>הוספת / השלמת לוחות ועמודות</Text>
                  <Text type={"text3"} color={"secondary"}>
                    יצירת לוחות שחסרים והשלמת עמודות חסרות — בלי לפגוע במיפוי הקיים.
                  </Text>
                </div>
                <Button kind={"secondary"} size={"small"} onClick={() => setShowTopUp(true)}>
                  פתיחת האשף
                </Button>
              </div>
            )}
            {Object.keys(boards || {}).map((boardKey) => (
              <div key={boardKey} className={styles.board}>
                <button
                  type="button"
                  className={styles.accordionHeader}
                  onClick={() => setOpenBoardKey((prev) => (prev === boardKey ? null : boardKey))}
                >
                  <span className={styles.accordionTitle}>{BOARD_ROLE_TITLES[boardKey] || boardKey}</span>
                  <span
                    className={`${styles.accordionChevron} ${openBoardKey === boardKey ? styles.accordionChevronOpen : ''}`}
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </button>

                {openBoardKey === boardKey && (
                  <div className={styles.accordionContent}>
                    <div className={styles.boardId}>
                      <Text type={"text3"} color={"secondary"}>לוח</Text>
                      <SearchablePicker
                        options={boardOptions.map((option) => ({ id: option.value, name: option.label }))}
                        value={String(boards[boardKey].id || '')}
                        onChange={(id) => setBoardId(boardKey, id)}
                        placeholder={loadingBoards ? 'טוען לוחות' : 'חפש ובחר לוח'}
                        isLoading={loadingBoards}
                        disabled={loadingBoards}
                      />
                    </div>
                    <div className={styles.cols}>
                      {(() => {
                        const aliases = boardKey === 'discussions'
                          ? DISCUSSIONS_SETTINGS_FIELDS
                          : boardKey === 'tasks'
                            ? TASKS_SETTINGS_FIELDS
                            : boardKey === 'topics'
                              ? TOPICS_SETTINGS_FIELDS
                              : boardKey === 'decisions'
                                ? DECISIONS_SETTINGS_FIELDS
                                : Object.keys(columns?.[boardKey] || {});
                        const entries = aliases
                          .map((alias) => [alias, columns?.[boardKey]?.[alias]])
                          .filter(([, col]) => Boolean(col));
                        const ownBoardId = String(boards?.[boardKey]?.id || '');
                        const renderRow = ([alias, col]) => {
                          // subitem-level fields map against the SUBITEMS board's columns
                          const boardId = SUBITEM_FIELDS.has(alias)
                            ? String(subitemsBoardByBoard[ownBoardId] || '')
                            : ownBoardId;
                          const typedOptions = getTypedColumnOptions(boardId, col.type);
                          // Multi-column people mapping (יכולת צפייה): chips of
                          // the picked columns (first = the auto-fill target) +
                          // a picker that ADDS another column on select.
                          if (MULTI_PEOPLE_ALIASES.has(alias)) {
                            const selectedIds = (Array.isArray(col.ids) && col.ids.length
                              ? col.ids
                              : (col.id ? [col.id] : [])).map(String);
                            // Chip names + still-pickable options, resolved from
                            // the live { id, name } options (see resolveMultiColView).
                            const { labelByVal, chipName, remaining } = resolveMultiColView(typedOptions, selectedIds, col.colTitles);
                            return (
                              <div key={alias} className={`${styles.colRow} ${styles.colRowWide}`}>
                                <div className={styles.colLabel}>
                                  <Text type={"text2"}>{col.title || alias}</Text>
                                </div>
                                <div className={styles.multiColPick}>
                                  {selectedIds.map((cid, idx) => (
                                    <div key={cid} className={styles.multiColChip} title={idx === 0 ? 'העמודה הראשית — מתמלאת אוטומטית ביצירת משימה' : undefined}>
                                      <span className={styles.multiColName}>
                                        {chipName(cid)}
                                        {idx === 0 && selectedIds.length > 1 ? ' (ראשית)' : ''}
                                      </span>
                                      <button
                                        type="button"
                                        className={styles.multiColRemove}
                                        aria-label={`הסר עמודה ${chipName(cid)}`}
                                        onClick={() => removeMultiColId(boardKey, alias, cid)}
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ))}
                                  <SearchablePicker
                                    options={remaining}
                                    value=""
                                    onChange={(id) => addMultiColId(boardKey, alias, id || '', labelByVal[String(id)] || '')}
                                    placeholder={
                                      loadingColumnsByBoardId[boardId]
                                        ? 'טוען עמודות'
                                        : remaining.length === 0
                                          ? (selectedIds.length ? 'אין עמודות נוספות' : 'אין עמודות תואמות')
                                          : (selectedIds.length ? 'הוסף עמודה נוספת' : 'בחר עמודה')
                                    }
                                    isLoading={loadingColumnsByBoardId[boardId]}
                                    disabled={loadingColumnsByBoardId[boardId] || remaining.length === 0}
                                  />
                                </div>
                                {/* Round 78 — which discussion-board ROLES fill
                                    this access column when a task is created. */}
                                <div className={styles.accessRoles}>
                                  <Text type={"text2"} className={styles.accessRolesLabel}>
                                    מתמלא אוטומטית ביצירת משימה מהתפקידים (מלוח הדיונים):
                                  </Text>
                                  <div className={styles.accessRolesChips}>
                                    {ACCESS_ROLE_SOURCE_OPTIONS.map((r) => {
                                      const on = accessRolesFor(preferences, alias).includes(r.alias);
                                      return (
                                        <button
                                          key={r.alias}
                                          type="button"
                                          className={`${styles.accessRoleChip} ${on ? styles.accessRoleChipOn : ''}`}
                                          aria-pressed={on}
                                          onClick={() => setPreferences((p) => toggleAccessRoleSource(p, alias, r.alias))}
                                        >
                                          {on ? '✓ ' : ''}{r.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div key={alias} className={styles.colRow}>
                              <div className={styles.colLabel}>
                                <Text type={"text2"}>{col.title || alias}</Text>
                              </div>
                              <SearchablePicker
                                options={typedOptions}
                                value={String(col.id || '')}
                                onChange={(id) => setColId(boardKey, alias, id || '')}
                                placeholder={
                                  loadingColumnsByBoardId[boardId]
                                    ? 'טוען עמודות'
                                    : typedOptions.length === 0
                                      ? 'אין עמודות תואמות'
                                      : 'בחר עמודה'
                                }
                                isLoading={loadingColumnsByBoardId[boardId]}
                                disabled={loadingColumnsByBoardId[boardId] || typedOptions.length === 0}
                              />
                            </div>
                          );
                        };

                        // The "סטאטוס בוצע" control lives beside the tasks status
                        // column: a multi-select of the status column's own labels
                        // that defines which statuses count as done for the
                        // EffectivenessTab delayed KPI (past-deadline tasks in these
                        // statuses are NOT delayed). Empty = the column's is_done
                        // label. Its labels come from the LIVE published mapping, so
                        // they appear once the tasks status column is mapped + saved.
                        const doneStatusOptions = taskStatusOptions.map((o) => ({ id: o.id, name: o.label }));
                        const renderDoneStatusRow = () => (
                          <div key="delayedDone" className={styles.colRow}>
                            <div className={styles.colLabel}>
                              <Text type={"text2"}>סטאטוס "בוצע"</Text>
                            </div>
                            <SearchablePicker
                              multiple
                              options={doneStatusOptions}
                              value={preferences.delayedDoneStatusIds || []}
                              onChange={(ids) => setPreferences((p) => ({
                                ...p,
                                delayedDoneStatusIds: ids && ids.length ? ids : null,
                              }))}
                              placeholder={doneStatusOptions.length === 0 ? 'מפו ושמרו קודם עמודת סטטוס' : 'ברירת מחדל: התווית "בוצע"'}
                              disabled={doneStatusOptions.length === 0}
                            />
                          </div>
                        );

                        // Topics board: split into item-level ("נושא") and
                        // subitem-level ("נקודה") column groups so it's clear which
                        // board each mapping targets.
                        if (boardKey === 'topics') {
                          const itemEntries = entries.filter(([alias]) => !SUBITEM_FIELDS.has(alias));
                          const subEntries = entries.filter(([alias]) => SUBITEM_FIELDS.has(alias));
                          return (
                            <>
                              <div className={styles.colGroupTitle}>
                                <Text type={"text2"} weight={"medium"}>עמודות נושא (אייטם)</Text>
                              </div>
                              {itemEntries.map(renderRow)}
                              <div className={styles.colGroupTitle}>
                                <Text type={"text2"} weight={"medium"}>עמודות נקודה (סאב־אייטם)</Text>
                                <Text type={"text3"} color={"secondary"}>נקודה = סאב־אייטם תחת הנושא. עמודות אלו ממופות מלוח הסאב־אייטמים.</Text>
                              </div>
                              {subEntries.map(renderRow)}
                            </>
                          );
                        }

                        // discussions + tasks: bucket the fields into typed
                        // sections (אנשים / תאריכים / סטטוס / חיבורי לוחות / …),
                        // preserving each section's field order. Empty sections
                        // are skipped; unmatched types fall into a trailing "אחר".
                        const sections = [...COLUMN_TYPE_GROUPS, { key: 'other', title: 'אחר', types: [] }];
                        return sections.map((group) => {
                          const groupEntries = entries.filter(
                            ([, col]) => typeGroupKey(col.type) === group.key
                          );
                          if (!groupEntries.length) return null;
                          // On the tasks board, render the "סטאטוס בוצע" multi-select
                          // right after the status column so they sit side by side.
                          const isTasksStatus = boardKey === 'tasks' && group.key === 'status';
                          return (
                            <React.Fragment key={group.key}>
                              <div className={styles.colGroupTitle}>
                                <Text type={"text2"} weight={"medium"}>{group.title}</Text>
                              </div>
                              {groupEntries.map((entry) => (
                                isTasksStatus && entry[0] === 'statusID' ? (
                                  <React.Fragment key="statusID">
                                    {renderRow(entry)}
                                    {renderDoneStatusRow()}
                                  </React.Fragment>
                                ) : renderRow(entry)
                              ))}
                            </React.Fragment>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
              </TabPanel>

              <TabPanel className={styles.tabPanelFill}>
                {/* round247 — the העדפות panel is full RTL (owner request). */}
                <div className={styles.prefs} dir="rtl">
                  {/* How the "הנחיות קודמות" tab resolves its tasks — via the linked
                      previous discussion, or by the discussion TYPE (taskTypeID). */}
                  <div className={styles.prefRow}>
                    <div className={styles.prefLabel}>
                      <Text type={"text2"}>מקור המשימות בהנחיות קודמות</Text>
                    </div>
                    <div className={styles.prefControl}>
                      <ButtonGroup
                        options={PREVIOUS_TASKS_MODE_OPTIONS}
                        value={preferences.previousTasksMode || PREVIOUS_TASKS_MODES.LINKED_DISCUSSION}
                        onSelect={(value) => setPreferences((p) => ({ ...p, previousTasksMode: value || PREVIOUS_TASKS_MODES.LINKED_DISCUSSION }))}
                        size="small"
                        kind="secondary"
                      />
                    </div>
                  </div>
                  {/* Item 18 — global default decider: every NEW decision's מחליט
                      defaults to the discussion's מנהל דיון (replaceable inline).
                      A per-type version lives on each type template (תבניות). */}
                  <div className={styles.prefRow}>
                    <div className={styles.prefLabel}>
                      <Text type={"text2"}>המחליט כברירת מחדל הוא מנהל הדיון</Text>
                    </div>
                    <div className={styles.prefControl}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={preferences.defaultDeciderLead === true}
                          onChange={(e) => setPreferences((p) => ({ ...p, defaultDeciderLead: e.target.checked }))}
                        />
                        <Text type={"text2"}>בכל הדיונים, ללא תלות בסוג</Text>
                      </label>
                    </div>
                  </div>
                  {/* round108 — brand logo shown at the top-right of every discussion
                      header. Owner-only (this whole modal is owner-gated). Stored as
                      a downscaled data-URI on preferences.logoUrl; "שמור" persists it. */}
                  {/* round205 — per-component visibility (owner request; this
                      whole modal is owner-gated): which app surfaces exist for
                      EVERYONE on this instance. Default-on; unchecking stores an
                      explicit false under preferences.visibleComponents.
                      (The round108 "לוגו" preference row was removed here.) */}
                  <div className={`${styles.prefRow} ${styles.prefRowStack}`}>
                    <div className={styles.prefLabel}>
                      <Text type={"text2"}>רכיבים באפליקציה</Text>
                    </div>
                    <div className={`${styles.prefControl} ${styles.prefControlFull}`}>
                      <div className={styles.componentGrid}>
                        {APP_COMPONENTS.map((c) => (
                          <label key={c.key} className={styles.componentItem}>
                            <input
                              type="checkbox"
                              checked={isComponentVisible(preferences, c.key)}
                              onChange={(e) =>
                                setPreferences((p) => ({
                                  ...p,
                                  visibleComponents: {
                                    ...(p.visibleComponents || {}),
                                    [c.key]: e.target.checked ? true : false,
                                  },
                                }))
                              }
                            />
                            <Text type={"text2"}>{c.label}</Text>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </TabPanel>

              <TabPanel className={styles.tabPanelFill}>
                {/* Templates manager — persists on its own (independent of the
                    Settings "שמור"); owner-only since it lives inside Settings.
                    round247/round249 — RTL now comes from the panel's own dir
                    (TemplateManagerModal), NOT a wrapper div: the round247
                    wrapper broke the flex-height chain so the editor list could
                    not scroll. TemplatesPanel is a direct flex child again. */}
                <TemplatesPanel onExportWide={setTemplatesExportWide} />
              </TabPanel>

              <TabPanel className={styles.tabPanelFill}>
                <ExportTemplateTab
                  template={exportTemplate}
                  setTemplate={setExportTemplate}
                  assets={exportAssets}
                  setAssets={setExportAssets}
                  assetError={assetError}
                />
              </TabPanel>

              <TabPanel className={styles.tabPanelFill}>
                <PermissionsTab
                  permissions={permissions}
                  setPermissions={setPermissions}
                  columns={columns}
                  selectedRoleKey={selectedRoleKey}
                  onSelectRole={setSelectedRoleKey}
                />
              </TabPanel>
            </TabPanels>
          </TabsContext>
        </div>

        <div className={styles.footerBar}>
          {importMsg && (
            <Text type={"text3"} color={importMsg.ok ? 'positive' : 'negative'} className={styles.importMsg}>
              {importMsg.text}
            </Text>
          )}
          <Flex justify="end" gap={8} className={styles.footer}>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
            <Button kind={"secondary"} onClick={handleImportClick}>
              ייבוא JSON
            </Button>
            <Button kind={"secondary"} onClick={handleExportJson}>
              ייצוא JSON
            </Button>
            <Button kind={"tertiary"} onClick={onClose}>ביטול</Button>
            <Button kind={"primary"} loading={saving} onClick={handleSave}>שמור</Button>
          </Flex>
          {/* round191 — version badge is OWNERS ONLY (owner request). This footer only
              renders in the full (owner) modal — non-owners get the templatesOnly early
              return above with no footer — but gate it explicitly so a future refactor
              can't leak the version/sha to non-owners. */}
          {!templatesOnly && (
            <div className={styles.versionLabel} dir="ltr">
              <Text type={"text3"} color={"secondary"}>{getVersionLabel()}</Text>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
