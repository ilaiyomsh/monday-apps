import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Text, Button, Flex, Avatar } from '@vibe/core';
import { CloseSmall, Search } from '@vibe/icons';
import { דיונים1Board } from '@api/BoardSDK.js';
import { useDropdownOptions } from '@generated/hooks/useDropdownOptions.js';
import { usePermission } from '@generated/hooks/usePermission.js';
import { api, parseValue, cvSelection } from '@generated/utils/mondayApi/monday-client.js';
import { getColumns } from '@generated/utils/mondayApi/board-config-store.js';
import {
  ensurePeopleColumns,
  getColumnTitle,
  subscribe as subscribePeopleColumns,
  getVersion as getPeopleColumnsVersion,
} from '@generated/utils/mondayApi/peopleColumns.js';
import { useMondayContext } from '@generated/contexts/MondayContext.jsx';
import { useUsers } from '@generated/utils/mondayApi/hooks/use-users.js';
import { useTemplates } from '@generated/contexts/TemplatesContext.jsx';
import { useSettings } from '@generated/contexts/SettingsContext.jsx';
import { PREVIOUS_TASKS_MODES } from '@generated/utils/mondayApi/boards.config.js';
import { createTopicsFromTemplate, readDiscussionTopicsAsTemplate } from '@generated/utils/templates.js';
import { PersonPicker } from '@generated/components/PersonPicker';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { toDateInput, toTimeInput, composeLocalDate } from '@generated/utils/dateTime.js';
import { LayoutTemplate } from 'lucide-react';
import logger from '@generated/utils/logger.js';
import styles from './CreateDiscussionModal.module.css';

function initialsOf(name) {
  return (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2);
}

// Small inline X-clear button rendered at the visual-left edge of a field (the
// modal body is dir=ltr, so physical `left` IS the visual left). onMouseDown
// preventDefault stops the window-level pointerdown listener from racing/closing
// dropdowns before the click fires; stopPropagation keeps dropdown toggles from
// firing on the same click.
function FieldClearButton({ onClear, label = 'ניקוי' }) {
  return (
    <button
      type="button"
      className={styles.fieldClear}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { e.stopPropagation(); onClear(); }}
      aria-label={label}
    >
      <CloseSmall size={14} />
    </button>
  );
}

const NEW_DISCUSSION_NAME = 'דיון חדש';

// Time picker options — one flat menu in half-hour steps, limited to the
// calendar's visible day window (06:00..23:00).
const TIME_OPTIONS = Array.from({ length: (23 - 6) * 2 + 1 }, (_, i) => {
  const h = String(6 + Math.floor(i / 2)).padStart(2, '0');
  return `${h}:${i % 2 ? '30' : '00'}`;
});
// Where the menu auto-scrolls when nothing is selected yet.
const TIME_SCROLL_DEFAULT = '08:00';

/* Resolve a discussion's "previous discussion" board_relation link (typed read)
 * and hand the linked id back via onResolved. Best-effort; used to reflect the
 * link in the dropdown when editing or duplicating. */
async function resolvePreviousDiscussion(discussionId, onResolved) {
  try {
    const colId = getColumns('discussions')?.previousDiscussionID?.id;
    if (!colId) return;
    const data = await api(
      `query ($discussionId: ID!, $relationCol: [String!]) {
        items(ids: [$discussionId]) {
          column_values(ids: $relationCol) { ${cvSelection(['board_relation'])} }
        }
      }`,
      { discussionId: String(discussionId), relationCol: [colId] },
      'CreateDiscussionModal.resolvePreviousDiscussion'
    );
    const relation = parseValue('board_relation', data?.items?.[0]?.column_values?.[0]);
    const prevId = relation?.linkedItems?.[0]?.id;
    if (prevId) onResolved(String(prevId));
  } catch (err) {
    logger.error('CreateDiscussionModal', 'שגיאה בטעינת הדיון הקודם', err);
  }
}

// Same form for creating a new discussion, editing an existing one (pass
// `editDiscussion`), or duplicating one (pass `duplicateFrom`). In edit mode the
// fields are prefilled and the submit updates that item. In duplicate mode it
// creates a NEW item prefilled from the source (its fields + topics), with an
// empty date and the name selected for immediate editing.
// `prefill` ({date:'YYYY-MM-DD', time:'HH:MM'}) seeds a PLAIN create — set when
// the user clicks an empty hour slot in the calendar's week view.
export function CreateDiscussionModal({ open, onClose, onCreated, editDiscussion = null, duplicateFrom = null, prefill = null, canManageSettings = false }) {
  const isEdit = !!editDiscussion;
  const isDuplicate = !isEdit && !!duplicateFrom;
  const { currentUser } = useMondayContext();
  // Advisory gate: may this user add a NEW discussion type (status-column label)
  // from the field? Owners always can; the "כללי" permission opens it to members.
  const can = usePermission({ canManageSettings, currentUser });
  const canAddType = can('addDiscussionTypes');
  const { templates, participantTemplates, typeTemplates, typeColor, assignRandomTypeColor } = useTemplates();
  const { settings } = useSettings();
  const previousTasksMode =
    settings?.preferences?.previousTasksMode || PREVIOUS_TASKS_MODES.LINKED_DISCUSSION;
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState(''); // optional "HH:MM"; '' = date-only
  const [lead, setLead] = useState([]);
  const [coordinator, setCoordinator] = useState([]);
  const [participants, setParticipants] = useState([]);

  // People-column field labels come from the LIVE board column titles (not the
  // Settings-only schema titles), so e.g. מרכז דיון shows as "רשם דיון" when
  // that's the mapped column. Load once; re-render when the titles arrive
  // (peopleColumnsVersion drives the label recompute below).
  useEffect(() => { if (open) ensurePeopleColumns(); }, [open]);
  const peopleColumnsVersion = useSyncExternalStore(
    subscribePeopleColumns, getPeopleColumnsVersion, getPeopleColumnsVersion
  );
  // Every field that maps to a board column shows that column's LIVE title
  // (fallback = its historical Hebrew label). "שעה" is not a board column, so
  // it keeps its fixed label.
  const fieldLabels = React.useMemo(() => ({
    type: getColumnTitle('discussions', 'discussionTypeID') || 'סוג דיון',
    date: getColumnTitle('discussions', 'discussionDateID') || 'תאריך',
    participants: getColumnTitle('discussions', 'participantsID') || 'משתתפים',
    lead: getColumnTitle('discussions', 'discussionLeadID') || 'מוביל דיון',
    coordinator: getColumnTitle('discussions', 'discussionCoordinatorID') || 'מרכז דיון',
    previous: getColumnTitle('discussions', 'previousDiscussionID') || 'דיון קודם',
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [peopleColumnsVersion]);
  const leadLabel = fieldLabels.lead;
  const coordinatorLabel = fieldLabels.coordinator;
  const [previousDiscussionId, setPreviousDiscussionId] = useState('none');
  const [discussionOptions, setDiscussionOptions] = useState([]);
  const [loadingDiscussions, setLoadingDiscussions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [isPreviousDropdownOpen, setIsPreviousDropdownOpen] = useState(false);
  const [previousSearch, setPreviousSearch] = useState('');
  const [templateId, setTemplateId] = useState('none');
  const [isParticipantTemplateMenuOpen, setIsParticipantTemplateMenuOpen] = useState(false);
  // "סוג" (discussion type) — a SINGLE-select DROPDOWN column (alias
  // discussionTypeID). `discussionType` holds the type's label TEXT (or null).
  // Options come from useDropdownOptions; the per-type color comes from app
  // storage (typeColor), NOT the column.
  const [discussionType, setDiscussionType] = useState(null);
  // Topics ([{name, points[]}]) auto-filled from the selected type's UNIFIED type
  // template, pending creation on submit. null = none (use the manual picker).
  const [typeTopics, setTypeTopics] = useState(null);
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);
  const [isTimeDropdownOpen, setIsTimeDropdownOpen] = useState(false);
  // Inline "add new type" affordance in the type dropdown (owner/permitted only).
  const [isAddingType, setIsAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [addingType, setAddingType] = useState(false); // mutation in-flight
  const [typeSearch, setTypeSearch] = useState(''); // filters the type dropdown list
  const { options: typeOptions } = useDropdownOptions('discussions', 'discussionTypeID');
  const titleRef = useRef(null);
  const timeMenuRef = useRef(null);

  // Hide "דיון קודם" when the Previous-tasks tab won't use the link for this
  // discussion: always in DISCUSSION_TYPE mode, and — in AUTO mode — only while a
  // type is selected (an untyped discussion falls back to the link, so the picker
  // must stay). LINKED_DISCUSSION always shows it. Derived from `discussionType`,
  // so it reacts live as the type is picked/cleared.
  const typeChosen = discussionType !== null && discussionType !== undefined;
  const hidePreviousDiscussion =
    previousTasksMode === PREVIOUS_TASKS_MODES.DISCUSSION_TYPE
    || (previousTasksMode === PREVIOUS_TASKS_MODES.AUTO && typeChosen);

  // Opening the time menu lands on the selected time (or 08:00), centered.
  useEffect(() => {
    if (!isTimeDropdownOpen) return;
    const menu = timeMenuRef.current;
    if (!menu) return;
    const target = menu.querySelector(`[data-time="${time || TIME_SCROLL_DEFAULT}"]`);
    if (target) menu.scrollTop = target.offsetTop - menu.clientHeight / 2 + target.clientHeight / 2;
  }, [isTimeDropdownOpen, time]);

  // Creator is read-only: the existing discussionCreatorID when editing, else the
  // current user for a new discussion. Resolve names/photos via useUsers.
  const creatorIds = isEdit
    ? (editDiscussion.discussionCreatorID || []).map((p) => String(p.id))
    : (currentUser?.id ? [String(currentUser.id)] : []);
  const { users: creatorUsers } = useUsers(creatorIds);

  useEffect(() => {
    if (!open) return;
    // The "דיון קודם" picker is hidden in discussionType mode — skip the
    // (potentially many-page) load of all discussions it would feed.
    if (hidePreviousDiscussion) { setDiscussionOptions([]); return; }
    async function loadDiscussions() {
      try {
        setLoadingDiscussions(true);
        const board = new דיונים1Board();
        // Pull ALL discussions (paginate the cursor) so the "previous discussion"
        // picker can reference any discussion, not just the most recent page.
        const opts = [];
        let cursor = null;
        let guard = 0;
        do {
          const result = await board.items()
            .withColumns(["discussionDateID"])
            .orderBy({ column: "discussionDateID", direction: "desc" })
            .withPagination(cursor ? { cursor } : { limit: 500 })
            .execute();
          for (const d of (result.items || [])) {
            opts.push({
              value: d.id,
              label: `${d.name}${d.discussionDateID ? ` (${d.discussionDateID.toLocaleDateString('he-IL')})` : ''}`,
            });
          }
          cursor = result.cursor;
          guard += 1;
        } while (cursor && guard < 50);
        setDiscussionOptions(opts);
      } catch (err) {
        logger.error('CreateDiscussionModal', 'שגיאה בטעינת דיונים קודמים', err);
        setDiscussionOptions([]);
      } finally {
        setLoadingDiscussions(false);
      }
    }
    loadDiscussions();
  }, [open, hidePreviousDiscussion]);

  // Seed the form when opening: prefill from editDiscussion (edit), from
  // duplicateFrom (duplicate), or clear (plain create).
  useEffect(() => {
    if (!open) return undefined;
    setTemplateId('none');
    setTypeTopics(null);
    let cancelled = false;

    // The list is lean (id/name/date only), so the edit/duplicate source object
    // lacks participants/description. Fetch the FULL record by id and prefill
    // from it (falling back to whatever the lean object already carries).
    const srcId = isEdit ? editDiscussion?.id : duplicateFrom?.id;
    const base = isEdit ? editDiscussion : duplicateFrom;

    (async () => {
      let full = base || null;
      if (srcId) {
        try {
          const fetched = await new דיונים1Board().itemById(srcId);
          if (fetched) full = { ...base, ...fetched };
        } catch { /* keep the lean object — api() already logged */ }
      }
      if (cancelled) return;

      if (!isEdit) {
        const src = full;
        // "Duplicate" actually creates a CONTINUATION of the source discussion:
        // same participants + topics, a clean date, the source itself set as the
        // "previous discussion", and a "דיון המשך - {name}" title.
        setName(src ? `דיון המשך - ${src.name || ''}` : NEW_DISCUSSION_NAME);
        // Duplicate always starts with a clean date; a plain create may carry a
        // calendar-slot prefill (date + hour).
        setDate(src ? '' : (prefill?.date || ''));
        setTime(src ? '' : (prefill?.time || ''));
        setLead(
          src?.discussionLeadID?.length
            ? src.discussionLeadID
            : (currentUser?.id ? [{ id: currentUser.id, kind: 'person', name: currentUser.name }] : [])
        );
        setCoordinator(src?.discussionCoordinatorID || []);
        setParticipants(src?.participantsID || []);
        // discussionTypeID is now the dropdown label TEXT (or null/empty).
        setDiscussionType(src?.discussionTypeID || null);
        // The source discussion is the continuation's "previous discussion".
        setPreviousDiscussionId(src ? String(src.id) : 'none');
        return;
      }

      setName(full.name || '');
      setDate(toDateInput(full.discussionDateID));
      // hasTime is read off the ORIGINAL parsed Date (clones lose the flag).
      setTime(toTimeInput(full.discussionDateID));
      setLead(full.discussionLeadID || []);
      setCoordinator(full.discussionCoordinatorID || []);
      setParticipants(full.participantsID || []);
      setDiscussionType(full.discussionTypeID || null);
      setPreviousDiscussionId('none');

      // Resolve the current "previous discussion" link so the dropdown reflects it.
      resolvePreviousDiscussion(full.id, (id) => { if (!cancelled) setPreviousDiscussionId(id); });
    })();

    return () => { cancelled = true; };
  }, [open, isEdit, editDiscussion, duplicateFrom, prefill]);

  // For a NEW discussion (incl. duplicate), focus + select the title so it's
  // clearly editable.
  useEffect(() => {
    if (open && !isEdit && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [open, isEdit]);

  const applyParticipantTemplate = (tpl) => {
    setParticipants((prev) => {
      const seen = new Set(prev.map((p) => String(p.id)));
      const additions = (tpl.participants || []).filter((p) => !seen.has(String(p.id)));
      return [...prev, ...additions];
    });
    // The template may also carry a "מוביל דיון" — set it when present.
    if (Array.isArray(tpl.lead) && tpl.lead.length) setLead(tpl.lead);
    setIsParticipantTemplateMenuOpen(false);
  };

  // Pick a discussion type (status label id, or null to clear). Classifying a
  // discussion immediately attaches its template. Preference order:
  //   1. the UNIFIED type template (topics + lead + participants in one) — new;
  //   2. legacy fallback: the separate topic + participant templates assigned to
  //      that type (each type maps to at most one of each — see TemplateManager).
  const selectType = (id) => {
    setDiscussionType(id);
    setIsTypeDropdownOpen(false);
    setTypeTopics(null);
    // Auto-attach only when creating/duplicating (not when editing an existing
    // discussion, where re-adding participants/topics would be surprising).
    if (isEdit || id === null || id === undefined) return;

    const typeTpl = typeTemplates.find((t) => t.discussionType === id);
    if (typeTpl) {
      // Unified template: fill people now, stash topics for submit. Clear any
      // manual topic-template pick so we don't double-create topics.
      setTemplateId('none');
      if (typeTpl.topics?.length) setTypeTopics(typeTpl.topics);
      applyParticipantTemplate({ participants: typeTpl.participants, lead: typeTpl.lead });
      return;
    }

    // Legacy fallback.
    const topicTpl = templates.find((t) => t.discussionType === id);
    if (topicTpl) setTemplateId(topicTpl.id);
    const partTpl = participantTemplates.find((t) => t.discussionType === id);
    if (partTpl) applyParticipantTemplate(partTpl);
  };

  // Add a new discussion type from the field, then select it. "סוג" is a dropdown
  // column, so the label is created on the board when the discussion is SAVED
  // (create_labels_if_missing on the write). Here we just assign the type a random
  // palette color in app storage and select the name. Errors surface via the
  // logger/toast funnel.
  const handleAddType = async () => {
    const nm = newTypeName.trim();
    if (!nm || addingType) return;
    try {
      setAddingType(true);
      await assignRandomTypeColor(nm);
      setIsAddingType(false);
      setNewTypeName('');
      selectType(nm);
    } catch (err) {
      logger.error('CreateDiscussionModal', 'שגיאה בהוספת סוג דיון', err);
    } finally {
      setAddingType(false);
    }
  };

  const handleSubmit = async () => {
    // Name, date AND time are required — every discussion is scheduled at an hour.
    if (!name.trim() || !date || !time) return;
    try {
      setCreating(true);
      const board = new דיונים1Board();
      const payload = {
        name: name.trim(),
      };
      // composeLocalDate stamps hasTime so formatValue('date') writes the
      // optional time part (as UTC) only when one was actually picked.
      if (date) payload.discussionDateID = composeLocalDate(date, time);
      // People columns — only send when there's a selection (and only persist
      // once the column is mapped in Settings; otherwise the SDK skips them).
      if (lead.length) payload.discussionLeadID = lead;
      if (coordinator.length) payload.discussionCoordinatorID = coordinator;
      if (participants.length) payload.participantsID = participants;
      // "סוג" dropdown: write the selected label TEXT. When the type is CLEARED
      // in edit mode we must WRITE an empty value (formatValue('dropdown', null)
      // => {}) so the original label doesn't persist — mirrors the
      // previousDiscussionID clear-on-edit below. On create we simply omit it.
      if (discussionType !== null && discussionType !== undefined && discussionType !== '') {
        payload.discussionTypeID = discussionType;
      } else if (isEdit) {
        payload.discussionTypeID = null;
      }
      if (previousDiscussionId && previousDiscussionId !== 'none') {
        payload.previousDiscussionID = { linkedItems: [{ id: previousDiscussionId }] };
      } else if (isEdit) {
        // "ללא דיון קודם" in edit mode clears the existing link (empty item_ids).
        payload.previousDiscussionID = { linkedItems: [] };
      }
      // NOTE: discussionCreatorID is NOT written — monday auto-tracks the item
      // creator, and that column is typically read-only (writing it failed with
      // a GraphQL validation error on create_item).

      const cols = getColumns('discussions') || {};
      logger.info('CreateDiscussionModal', isEdit ? 'submitting update' : 'submitting create', {
        payloadKeys: Object.keys(payload),
        resolvedColumnIds: {
          discussionLeadID: cols.discussionLeadID?.id || null,
          participants_column6: cols.participantsID?.id || null,
        },
      });

      // create_labels_if_missing so a freshly-added "סוג" (dropdown) label is
      // minted on the board here rather than silently dropped.
      let savedId;
      if (isEdit) {
        await board.item(editDiscussion.id).update(payload, { createLabelsIfMissing: true }).execute();
        savedId = editDiscussion.id;
      } else {
        const created = await board.item().create(payload, { createLabelsIfMissing: true }).execute();
        savedId = created.id;
      }

      // Optionally seed topics + points. A manual topic-template pick takes
      // precedence; otherwise fall back to topics auto-filled from the unified
      // type template (typeTopics). (create: always; edit: applies onto the item.)
      const template = templates.find((t) => t.id === templateId);
      if (savedId && template) {
        await createTopicsFromTemplate(savedId, template);
      } else if (savedId && typeTopics?.length) {
        await createTopicsFromTemplate(savedId, { topics: typeTopics });
      }

      // Duplicate: clone the source discussion's topics + points onto the new one.
      if (savedId && isDuplicate) {
        const topicsTemplate = await readDiscussionTopicsAsTemplate(duplicateFrom.id);
        if (topicsTemplate.topics.length) {
          await createTopicsFromTemplate(savedId, topicsTemplate);
        }
      }

      setName('');
      setDate('');
      setTime('');
      setLead([]);
      setCoordinator([]);
      setParticipants([]);
      setDiscussionType(null);
      setTypeTopics(null);
      setPreviousDiscussionId('none');
      setTemplateId('none');
      // Hand back the discussion shape so the caller can refresh the open card
      // (edit) or open the freshly created/duplicated one immediately (create /
      // duplicate — savedId is the new item's id). Second arg tells the caller
      // which op ran, so it can show the matching success notice.
      onCreated(isEdit ? {
        ...editDiscussion,
        name: name.trim(),
        discussionDateID: date ? composeLocalDate(date, time) : editDiscussion.discussionDateID,
        discussionLeadID: lead,
        discussionCoordinatorID: coordinator,
        participantsID: participants,
      } : {
        id: savedId,
        name: name.trim(),
        discussionDateID: date ? composeLocalDate(date, time) : null,
        discussionLeadID: lead,
        discussionCoordinatorID: coordinator,
        participantsID: participants,
      }, { isEdit, isDuplicate });
    } catch (err) {
      logger.error('CreateDiscussionModal', isEdit ? 'שגיאה בעדכון הדיון' : 'שגיאה ביצירת הדיון', err);
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        if (isPreviousDropdownOpen) {
          setIsPreviousDropdownOpen(false);
          return;
        }
        if (isParticipantTemplateMenuOpen) {
          setIsParticipantTemplateMenuOpen(false);
          return;
        }
        if (isTypeDropdownOpen) {
          setIsTypeDropdownOpen(false);
          return;
        }
        if (isTimeDropdownOpen) {
          setIsTimeDropdownOpen(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose, isPreviousDropdownOpen, isParticipantTemplateMenuOpen, isTypeDropdownOpen, isTimeDropdownOpen]);

  useEffect(() => {
    if (!open || (!isPreviousDropdownOpen && !isParticipantTemplateMenuOpen && !isTypeDropdownOpen && !isTimeDropdownOpen)) return undefined;
    const handlePointerDown = () => {
      setIsPreviousDropdownOpen(false);
      setIsTypeDropdownOpen(false);
      setIsParticipantTemplateMenuOpen(false);
      setIsTimeDropdownOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [open, isPreviousDropdownOpen, isParticipantTemplateMenuOpen, isTypeDropdownOpen, isTimeDropdownOpen]);

  if (!open) return null;

  const isPreviousUnset = !previousDiscussionId || previousDiscussionId === 'none';
  const selectedPreviousLabel =
    discussionOptions.find((o) => o.value === previousDiscussionId)?.label || 'בחר דיון קודם';

  const q = previousSearch.trim().toLowerCase();
  const filteredDiscussionOptions = q
    ? discussionOptions.filter((o) => o.label.toLowerCase().includes(q))
    : discussionOptions;

  // Enter ANYWHERE in the form submits — same as clicking "צור דיון"/"שמור
  // שינויים" — while RESPECTING the button's disabled state (name + date + time
  // are all required). It is deliberately INERT when a picker layer is active:
  //  • any control inside an open inline dropdown list (role=listbox: the type /
  //    שעה / previous-discussion menus and their search + add-type inputs) — so
  //    Enter selects/searches there instead of submitting;
  //  • buttons (Enter triggers their own click) and textareas (multiline);
  //  • whenever an inline dropdown open-flag is set (belt-and-suspenders).
  // The date + people pickers render in portals, so their Enter never bubbles here.
  const onFormKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
    if (t && typeof t.closest === 'function' && t.closest('[role="listbox"], [role="menu"]')) return;
    if (isTypeDropdownOpen || isTimeDropdownOpen || isPreviousDropdownOpen || isParticipantTemplateMenuOpen || isAddingType) return;
    if (creating || !name.trim() || !date || !time) return;
    e.preventDefault();
    handleSubmit();
  };

  return (
    <div className={styles.overlay} onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onFormKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'עריכת דיון' : 'יצירת דיון חדש'}
        dir="rtl"
      >
        <div className={styles.header}>
          <input
            ref={titleRef}
            className={styles.titleInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="שם הדיון"
            aria-label="שם הדיון"
          />
          {name && <FieldClearButton onClear={() => setName('')} label="ניקוי שם" />}
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="סגירה">
            ×
          </button>
        </div>
        <div className={styles.content}>
          <Flex direction="column" gap={16} align="stretch" className={styles.form}>
            {/* Row 1: סוג דיון — full-width, on its own row. */}
            <div className={`${styles.row} ${styles.rowSingle}`}>
              <div className={styles.field}>
                <Text type="text2" className={styles.label}>{fieldLabels.type}</Text>
                <div className={styles.customDropdown}>
                  <button
                    type="button"
                    className={styles.dropdownTrigger}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsTypeDropdownOpen((prev) => !prev);
                      setIsPreviousDropdownOpen(false);
                      setIsAddingType(false);
                      setTypeSearch('');
                    }}
                    aria-expanded={isTypeDropdownOpen}
                    aria-haspopup="listbox"
                  >
                    {discussionType ? (
                      <span className={styles.dropdownValue}>
                        <span className={styles.typeSwatch} style={{ background: typeColor(discussionType) }} />
                        {discussionType}
                      </span>
                    ) : (
                      <span className={`${styles.dropdownValue} ${styles.dropdownPlaceholder}`}>בחר סוג דיון</span>
                    )}
                    <span className={styles.dropdownChevron} aria-hidden="true">▾</span>
                  </button>
                  {discussionType !== null && discussionType !== undefined && (
                    <FieldClearButton onClear={() => { setDiscussionType(null); setTypeTopics(null); }} label="ניקוי סוג" />
                  )}
                  {isTypeDropdownOpen && (
                    <ul
                      className={styles.dropdownMenu}
                      role="listbox"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {typeOptions.length === 0 && !canAddType ? (
                        <li className={styles.dropdownEmpty}>אין סוגים מוגדרים בעמודה</li>
                      ) : (
                        <>
                          {typeOptions.length > 0 && (
                            <li className={styles.dropdownSearchRow} onClick={(e) => e.stopPropagation()}>
                              <Search className={styles.dropdownSearchIcon} aria-hidden="true" />
                              <input
                                type="text"
                                className={styles.dropdownSearch}
                                value={typeSearch}
                                aria-label="חיפוש סוג דיון"
                                onChange={(e) => setTypeSearch(e.target.value)}
                              />
                            </li>
                          )}
                          {typeOptions
                            .filter((option) => !typeSearch.trim() || (option.label || '').toLowerCase().includes(typeSearch.trim().toLowerCase()))
                            .map((option) => {
                            const selected = option.label === discussionType;
                            return (
                              <li
                                key={option.id ?? option.label}
                                role="option"
                                aria-selected={selected}
                                className={`${styles.dropdownItem} ${selected ? styles.dropdownItemSelected : ''}`}
                                onClick={() => selectType(option.label)}
                              >
                                <span className={styles.typeSwatch} style={{ background: typeColor(option.label) }} />
                                {option.label}
                              </li>
                            );
                          })}
                        </>
                      )}
                      {canAddType && (
                        isAddingType ? (
                          <li className={styles.dropdownAddRow} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              className={styles.dropdownAddInput}
                              value={newTypeName}
                              autoFocus
                              placeholder="שם הסוג החדש"
                              disabled={addingType}
                              onChange={(e) => setNewTypeName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); handleAddType(); }
                                if (e.key === 'Escape') { setIsAddingType(false); setNewTypeName(''); }
                              }}
                            />
                            <button
                              type="button"
                              className={styles.dropdownAddConfirm}
                              disabled={!newTypeName.trim() || addingType}
                              onClick={handleAddType}
                            >
                              {addingType
                                ? <span className={styles.addSpinner} role="status" aria-label="מוסיף סוג דיון…" />
                                : 'הוסף'}
                            </button>
                          </li>
                        ) : (
                          <li
                            className={styles.dropdownAddTrigger}
                            onClick={() => { setIsAddingType(true); setNewTypeName(''); }}
                          >
                            + הוסף סוג דיון חדש
                          </li>
                        )
                      )}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Row 2: תאריך הדיון + שעה, side by side. */}
            <div className={`${styles.row} ${styles.rowSingle}`}>
              <div className={styles.field}>
                <div className={styles.dateTimeRow}>
                  <div className={styles.dateCol}>
                    <Text type="text2" className={styles.label}>{fieldLabels.date} <span className={styles.required}>*</span></Text>
                    <div className={styles.fieldWrap}>
                      <DatePickerPopover
                        variant="field"
                        zIndex={4200}
                        value={date ? new Date(`${date}T00:00:00`) : null}
                        onChange={(d) => setDate(d ? toDateInput(d) : '')}
                      />
                    </div>
                  </div>
                  {/* Hour picker — ONE flat menu in half-hour steps (replaces the
                      native time input's split hour/minute spinners). Required. */}
                  <div className={styles.timeCol}>
                    <Text type="text2" className={styles.label}>שעה <span className={styles.required}>*</span></Text>
                    <div className={`${styles.customDropdown} ${styles.timeDropdown}`}>
                      <button
                        type="button"
                        className={styles.dropdownTrigger}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsTimeDropdownOpen((prev) => !prev);
                          setIsPreviousDropdownOpen(false);
                          setIsTypeDropdownOpen(false);
                        }}
                        aria-expanded={isTimeDropdownOpen}
                        aria-haspopup="listbox"
                        aria-label="שעה"
                      >
                        <span className={`${styles.dropdownValue} ${!time ? styles.dropdownPlaceholder : ''}`}>
                          {time || 'בחר שעה'}
                        </span>
                        <span className={styles.dropdownChevron} aria-hidden="true">▾</span>
                      </button>
                      {time && <FieldClearButton onClear={() => setTime('')} label="ניקוי שעה" />}
                      {isTimeDropdownOpen && (
                        <ul
                          ref={timeMenuRef}
                          className={styles.dropdownMenu}
                          role="listbox"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          {TIME_OPTIONS.map((t) => (
                            <li
                              key={t}
                              data-time={t}
                              role="option"
                              aria-selected={time === t}
                              className={`${styles.dropdownItem} ${styles.timeOption} ${time === t ? styles.dropdownItemSelected : ''}`}
                              onClick={() => { setTime(t); setIsTimeDropdownOpen(false); }}
                            >
                              {t}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 3: מנהל (lead) + רשם דיון (coordinator) + משתתפים (participants),
                three balanced fields side by side. The "מתבנית" participant-
                template action stays attached to the משתתפים label. */}
            <div className={styles.row3}>
              <div className={styles.field}>
                <Text type="text2" className={styles.label}>{leadLabel}</Text>
                <div className={styles.fieldWrap}>
                  <PersonPicker selected={lead} onChange={setLead} bordered single closeOnSelect />
                  {lead.length > 0 && <FieldClearButton onClear={() => setLead([])} label={`ניקוי ${leadLabel}`} />}
                </div>
              </div>
              <div className={styles.field}>
                <Text type="text2" className={styles.label}>{coordinatorLabel}</Text>
                <div className={styles.fieldWrap}>
                  <PersonPicker selected={coordinator} onChange={setCoordinator} bordered single closeOnSelect />
                  {coordinator.length > 0 && <FieldClearButton onClear={() => setCoordinator([])} label={`ניקוי ${coordinatorLabel}`} />}
                </div>
              </div>
              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <Text type="text2" className={styles.label}>{fieldLabels.participants}</Text>
                  {participantTemplates.length > 0 && (
                    <div className={styles.customDropdown}>
                      <button
                        type="button"
                        className={styles.templateChip}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsParticipantTemplateMenuOpen((prev) => !prev);
                          setIsPreviousDropdownOpen(false);
                        }}
                        aria-haspopup="listbox"
                        aria-expanded={isParticipantTemplateMenuOpen}
                      >
                        <LayoutTemplate size={13} /> מתבנית
                      </button>
                      {isParticipantTemplateMenuOpen && (
                        <ul
                          className={styles.templateMenu}
                          role="listbox"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          {participantTemplates.map((tpl) => (
                            <li
                              key={tpl.id}
                              role="option"
                              aria-selected={false}
                              className={styles.dropdownItem}
                              onClick={() => applyParticipantTemplate(tpl)}
                            >
                              {tpl.name} ({(tpl.participants || []).length})
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
                <div className={styles.fieldWrap}>
                  <PersonPicker selected={participants} onChange={setParticipants} bordered />
                  {participants.length > 0 && <FieldClearButton onClear={() => setParticipants([])} label="ניקוי משתתפים" />}
                </div>
              </div>
            </div>

            {/* Row 4: דיון קודם (previous discussion). */}
            {!hidePreviousDiscussion && (
            <div className={`${styles.row} ${styles.rowSingle}`}>
              <div className={`${styles.field} ${styles.previousDiscussionField}`}>
                <Text type="text2" className={styles.label}>{fieldLabels.previous}</Text>
                <div className={styles.customDropdown}>
                  <button
                    type="button"
                    className={styles.dropdownTrigger}
                    disabled={loadingDiscussions}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviousSearch('');
                      setIsPreviousDropdownOpen((prev) => !prev);
                    }}
                    aria-expanded={isPreviousDropdownOpen}
                    aria-haspopup="listbox"
                  >
                    <span className={`${styles.dropdownValue} ${(!loadingDiscussions && isPreviousUnset) ? styles.dropdownPlaceholder : ''}`}>
                      {loadingDiscussions ? 'טוען דיונים' : selectedPreviousLabel}
                    </span>
                    <span className={styles.dropdownChevron} aria-hidden="true">▾</span>
                  </button>
                  {!loadingDiscussions && !isPreviousUnset && (
                    <FieldClearButton onClear={() => setPreviousDiscussionId('none')} label="ניקוי דיון קודם" />
                  )}
                  {isPreviousDropdownOpen && !loadingDiscussions && (
                    <ul
                      className={styles.dropdownMenu}
                      role="listbox"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <li className={styles.dropdownSearchRow}>
                        <Search className={styles.dropdownSearchIcon} aria-hidden="true" />
                        <input
                          type="text"
                          className={styles.dropdownSearch}
                          placeholder="חיפוש דיון"
                          value={previousSearch}
                          onChange={(e) => setPreviousSearch(e.target.value)}
                          autoFocus
                        />
                      </li>
                      {filteredDiscussionOptions.length === 0 ? (
                        <li className={styles.dropdownEmpty}>לא נמצאו דיונים</li>
                      ) : (
                        filteredDiscussionOptions.map((option) => (
                          <li
                            key={option.value}
                            role="option"
                            aria-selected={previousDiscussionId === option.value}
                            className={`${styles.dropdownItem} ${
                              previousDiscussionId === option.value ? styles.dropdownItemSelected : ''
                            }`}
                            onClick={() => {
                              setPreviousDiscussionId(option.value);
                              setPreviousSearch('');
                              setIsPreviousDropdownOpen(false);
                            }}
                          >
                            {option.label}
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
              </div>
            </div>
            )}
          </Flex>
          <Flex align="center" justify="space-between" className={styles.footer}>
            <div className={styles.creator}>
              {creatorUsers.length > 0 ? (
                creatorUsers.map((u) => (
                  <span key={u.id} className={styles.personChip}>
                    <Avatar
                      size="small"
                      src={u.photo_thumb}
                      text={initialsOf(u.name)}
                      type={u.photo_thumb ? 'img' : 'text'}
                      ariaLabel={u.name}
                    />
                    <span className={styles.personName}>{u.name}</span>
                  </span>
                ))
              ) : (
                <span className={styles.muted}>—</span>
              )}
            </div>
            <Flex gap={8}>
              <Button kind={"tertiary"} onClick={onClose} disabled={creating}>
                ביטול
              </Button>
              <Button onClick={handleSubmit} loading={creating} disabled={creating || !name.trim() || !date || !time}>
                {isEdit ? 'שמור שינויים' : 'צור דיון'}
              </Button>
            </Flex>
          </Flex>
        </div>
      </div>
    </div>
  );
}

export default CreateDiscussionModal;
