import React, { useEffect, useRef, useState, useSyncExternalStore, useMemo } from 'react';
import { Text, Button, Flex, Avatar } from '@vibe/core';
import { CloseSmall, Search } from '@vibe/icons';
import { דיונים1Board } from '@api/BoardSDK.js';
import { useDropdownOptions, addDropdownLabel } from '@generated/hooks/useDropdownOptions.js';
import { usePermission, useIsSuperMember } from '@generated/hooks/usePermission.js';
import { api, parseValue, cvSelection } from '@generated/utils/mondayApi/monday-client.js';
import { getColumns } from '@generated/utils/mondayApi/board-config-store.js';
import {
  ensurePeopleColumns,
  getColumnTitle,
  isColumnMapped,
  subscribe as subscribePeopleColumns,
  getVersion as getPeopleColumnsVersion,
} from '@generated/utils/mondayApi/peopleColumns.js';
import { useMondayContext } from '@generated/contexts/MondayContext.jsx';
import { useUsers } from '@generated/utils/mondayApi/hooks/use-users.js';
import { useTemplates } from '@generated/contexts/TemplatesContext.jsx';
import { useSettings } from '@generated/contexts/SettingsContext.jsx';
import { PREVIOUS_TASKS_MODES, CREATE_DISCUSSION_MODES, resolvePreference, isProjectModeReady } from '@generated/utils/mondayApi/boards.config.js';
import { useRelationItems } from '@generated/hooks/useRelationItems.js';
import {
  availableCreateModes, canAutoName, isFormRevealed, projectLinkValue, CREATE_MODE_LABEL,
} from './createModeRules.js';
import { buildAutoName, formatNameDate, syncTrailingDate } from '@generated/utils/autoDiscussionName.js';
import { createTopicsFromTemplate, linkTemplateTopics, readDiscussionTopicsAsTemplate } from '@generated/utils/templates.js';
import { parseExternalParticipants, formatExternalParticipants } from '@generated/utils/externalParticipants.js';
import { PersonPicker } from '@generated/components/PersonPicker';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { PartyProgress } from '@generated/components/PartyProgress';
import { ConfettiBurst } from '@generated/components/ConfettiBurst';
import { toDateInput, toTimeInput, composeLocalDate, nowDateTimeInputs } from '@generated/utils/dateTime.js';
import { LayoutTemplate, Pencil } from 'lucide-react';
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


// round115 — may the app WRITE the mapped discussion-creator column? Only a
// regular people column is writable; monday's built-in "creation log" column
// (auto-filled by monday) is read-only and writing it throws a GraphQL
// validation error. Pure + exported for testing.
export function isWritablePeopleColumnType(type) {
  const t = String(type || '').toLowerCase();
  return t === 'people' || t.includes('person');
}

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
// `onEditTypeTemplate(typeName)` (round355) — the host hands the user to that type's
// template editor and brings them back; when it is absent the pencil is not rendered.
export function CreateDiscussionModal({ open, onClose, onCreated, onOptimisticCreate = null, onStageAdvance = null, onStageComplete = null, onStageError = null, editDiscussion = null, duplicateFrom = null, prefill = null, canManageSettings = false, onEditTypeTemplate = null }) {
  const isEdit = !!editDiscussion;
  const isDuplicate = !isEdit && !!duplicateFrom;
  const { currentUser } = useMondayContext();
  // Advisory gate: may this user add a NEW discussion type (status-column label)
  // from the field? Owners always can; the "כללי" permission opens it to members.
  const can = usePermission({ canManageSettings, currentUser });
  const canAddType = can('addDiscussionTypes');
  // round355 — who may open a type's TEMPLATE from this field: the board owner or a
  // super member (the same pair that gets the settings gear — see DiscussionList).
  // Deliberately NOT can('manageTemplates'): that capability defaults to 'all'.
  const isSuper = useIsSuperMember({ currentUser });
  const canEditTypeTemplate = !!onEditTypeTemplate && (canManageSettings || isSuper);
  // Set (to `{ type }`) when the user leaves for the type-template editor. This
  // component never unmounts (`open` only gates the render), so every field the user
  // already filled is still in state when they come back — the flag stops the
  // open-effects below from re-seeding over it, which is what makes the return land
  // "at the same point". The type name rides along so the resume can refresh that
  // type's derived agenda (see the resume effect).
  const resumingFromTypeEditorRef = useRef(null);
  const { templates, participantTemplates, typeTemplates, typeColor, assignRandomTypeColor } = useTemplates();
  const { settings, updateSettings } = useSettings();
  // round340 — see resolvePreference: the fallback is DEFAULT_PREFERENCES, not a literal
  // repeated per call site (which is how this drifted from the shipped default).
  const previousTasksMode = resolvePreference(settings?.preferences, 'previousTasksMode');
  const [name, setName] = useState('');
  /*
   * round367 (owner spec, approved mockup) — the card opens on a two-path
   * toggle: TEMPLATE (pick a template → template aspects revealed, auto name,
   * no previous-discussion link) or ADHOC (clean name + previous link).
   * lastAutoDateRef carries the date string the card last wrote at the END of
   * the name; a date change rewrites only that suffix, and stops forever once
   * the user removed/changed it.
   */
  const [createMode, setCreateMode] = useState(CREATE_DISCUSSION_MODES.TEMPLATE);
  const lastAutoDateRef = useRef('');
  // round129 — while the edit/duplicate SOURCE record is being fetched, the
  // form is hidden behind a loading bar (the owner saw an "empty card filling
  // in slowly"); the fields appear only fully populated.
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState(''); // optional "HH:MM"; '' = date-only
  const [lead, setLead] = useState([]);
  const [coordinator, setCoordinator] = useState([]);
  const [participants, setParticipants] = useState([]);
  // round211 — EXTERNAL participants: text-only names (not monday users), kept
  // as a names array; persisted comma-separated to the mapped long_text column.
  const [externalParticipants, setExternalParticipants] = useState([]);
  const [externalDraft, setExternalDraft] = useState('');

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
  // Item 6 — create-time experience: real step progress ({done,total}) drives
  // the PartyProgress bar; `celebrate` holds the modal open ~1.5s after a
  // successful CREATE for the full bar + confetti before handing off.
  const [createProgress, setCreateProgress] = useState(null);
  const [celebrate, setCelebrate] = useState(false);
  const [isPreviousDropdownOpen, setIsPreviousDropdownOpen] = useState(false);
  const [previousSearch, setPreviousSearch] = useState('');
  const [templateId, setTemplateId] = useState('none');
  /*
   * round381 — the PROJECT path's own subject. `projectId` is what gets written to
   * projectLinkID; `projectName` is kept beside it so the trigger and the auto name
   * do not have to re-find the item in the candidate list (which is paged and may
   * still be loading when the card reopens on a prefill).
   */
  const [projectId, setProjectId] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
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
  const { options: typeOptions, loading: typeOptionsLoading } = useDropdownOptions('discussions', 'discussionTypeID');
  const titleRef = useRef(null);
  const timeMenuRef = useRef(null);
  // If the root discussion was saved but template seeding failed, retain its id
  // and the per-alias checkpoint so a retry resumes instead of duplicating the
  // discussion or already-created topics/points.
  const creationResumeRef = useRef(null);
  const creationSessionRef = useRef(null);

  // Hide "דיון קודם" when the Previous-tasks tab won't use the link for this
  // discussion: always in DISCUSSION_TYPE mode, and — in AUTO mode — only while a
  // type is selected (an untyped discussion falls back to the link, so the picker
  // must stay). LINKED_DISCUSSION always shows it. Derived from `discussionType`,
  // so it reacts live as the type is picked/cleared.
  const typeChosen = discussionType !== null && discussionType !== undefined;
  // round367 — the staged card: in create/duplicate the form body reveals only
  // once the path is usable (ADHOC immediately; TEMPLATE after a template was
  // picked). Edit mode keeps the full card. TEMPLATE mode never shows דיון קודם.
  const templateMode = !isEdit && createMode === CREATE_DISCUSSION_MODES.TEMPLATE;
  /*
   * round381 — the third path. `projectReady` is the SAME gate the side-menu filter
   * and the previous-tasks resolution use: the preference is on AND projectLinkID is
   * mapped. With either missing the toggle shows the original two paths, so an
   * instance that never turns this on cannot tell this round happened.
   */
  const projectReady = isProjectModeReady(
    settings?.preferences,
    settings?.columns?.discussions || getColumns('discussions')
  );
  const projectMode = !isEdit && projectReady && createMode === CREATE_DISCUSSION_MODES.PROJECT;
  const projectChosen = !!projectId;
  // Candidates for the picker — the same cached, paged, group-aware reader the
  // custom connected-board cells use, so a big projects board pages identically.
  const projectOpts = useRelationItems(projectReady ? 'discussions' : null, projectReady ? 'projectLinkID' : null);
  // Plain substring search over the loaded candidates — the same match the
  // connected-board picker uses, and Hebrew has no better collated substring.
  const projectCandidates = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    const list = projectOpts.items || [];
    return q ? list.filter((it) => (it.name || '').toLowerCase().includes(q)) : list;
  }, [projectOpts.items, projectSearch]);

  // ONE reveal rule for both folding paths (see createModeRules): each mode names
  // its own subject and the rule is shared, so they cannot drift apart.
  const formRevealed = isFormRevealed({
    isEdit,
    isDuplicate,
    mode: createMode,
    subjectChosen: projectMode ? projectChosen : typeChosen,
  });
  const hidePreviousDiscussion =
    templateMode
    || previousTasksMode === PREVIOUS_TASKS_MODES.DISCUSSION_TYPE
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

  // Reset resumable creation state only when the logical modal session changes
  // (closed/reopened or a different source discussion). Parent rerenders often
  // replace prop objects with equivalent copies; resetting on object identity
  // could otherwise lose a saved root id after a partial failure.
  useEffect(() => {
    const sessionKey = open
      ? `${isEdit ? 'edit' : (isDuplicate ? 'duplicate' : 'create')}:${editDiscussion?.id || duplicateFrom?.id || 'new'}`
      : null;
    if (creationSessionRef.current !== sessionKey) {
      creationSessionRef.current = sessionKey;
      creationResumeRef.current = null;
    }
  }, [open, isEdit, isDuplicate, editDiscussion?.id, duplicateFrom?.id]);

  // Seed the form when opening: prefill from editDiscussion (edit), from
  // duplicateFrom (duplicate), or clear (plain create).
  useEffect(() => {
    if (!open) return undefined;
    // round355 — returning from the type-template editor: the form is exactly as the
    // user left it, so seeding must NOT run (it would wipe every filled field).
    if (resumingFromTypeEditorRef.current) return undefined;
    setTemplateId('none');
    setTypeTopics(null);
    let cancelled = false;

    // The list is lean (id/name/date only), so the edit/duplicate source object
    // lacks participants/description. Fetch the FULL record by id and prefill
    // from it (falling back to whatever the lean object already carries).
    const srcId = isEdit ? editDiscussion?.id : duplicateFrom?.id;
    const base = isEdit ? editDiscussion : duplicateFrom;
    setPrefillLoading(Boolean(srcId));

    (async () => {
      let full = base || null;
      if (srcId) {
        try {
          const fetched = await new דיונים1Board().itemById(srcId);
          if (fetched) full = { ...base, ...fetched };
        } catch (err) {
          // keep the lean object — api() already logged+toasted; the warn here
          // records that prefill fell back (dedup drops the repeat).
          logger.warn('CreateDiscussionModal', 'טעינת הדיון המלא לפריפיל נכשלה — ממשיכים עם הרשומה הרזה', err);
        }
      }
      if (cancelled) return;

      if (!isEdit) {
        const src = full;
        // "Duplicate" actually creates a CONTINUATION of the source discussion:
        // same participants + topics, a clean date, the source itself set as the
        // "previous discussion", and a "דיון המשך - {name}" title.
        setName(src ? `דיון המשך - ${src.name || ''}` : '');
      // round367 — the toggle's initial half: a duplicate of a TYPED discussion
      // lands on template mode; otherwise the owner's preference decides.
      lastAutoDateRef.current = '';
      setCreateMode(src
        ? (src.discussionTypeID ? CREATE_DISCUSSION_MODES.TEMPLATE : CREATE_DISCUSSION_MODES.ADHOC)
        : resolvePreference(settings?.preferences, 'createDiscussionMode'));
        // round148 — a new-discussion card opens stamped with the MOMENT it
        // was opened (today + the current time), immediately editable. An
        // explicit calendar-slot prefill (the user clicked a specific hour)
        // still wins. Applies to duplicate ("דיון המשך") too, which previously
        // opened with an empty date.
        const nowInputs = nowDateTimeInputs();
        setDate(!src && prefill?.date ? prefill.date : nowInputs.date);
        setTime(!src && prefill?.time ? prefill.time : nowInputs.time);
        setLead(
          src?.discussionLeadID?.length
            ? src.discussionLeadID
            : (currentUser?.id ? [{ id: currentUser.id, kind: 'person', name: currentUser.name }] : [])
        );
        setCoordinator(src?.discussionCoordinatorID || []);
        setParticipants(src?.participantsID || []);
        setExternalParticipants(parseExternalParticipants(src?.externalParticipantsID));
        // discussionTypeID is now the dropdown label TEXT (or null/empty).
        setDiscussionType(src?.discussionTypeID || null);
        // The source discussion is the continuation's "previous discussion".
        setPreviousDiscussionId(src ? String(src.id) : 'none');
        setPrefillLoading(false);
        return;
      }

      setName(full.name || '');
      setDate(toDateInput(full.discussionDateID));
      // hasTime is read off the ORIGINAL parsed Date (clones lose the flag).
      setTime(toTimeInput(full.discussionDateID));
      setLead(full.discussionLeadID || []);
      setCoordinator(full.discussionCoordinatorID || []);
      setParticipants(full.participantsID || []);
      setExternalParticipants(parseExternalParticipants(full.externalParticipantsID));
      setDiscussionType(full.discussionTypeID || null);
      setPreviousDiscussionId('none');

      // Resolve the current "previous discussion" link so the dropdown reflects it.
      resolvePreviousDiscussion(full.id, (id) => { if (!cancelled) setPreviousDiscussionId(id); });
      setPrefillLoading(false);
    })();

    return () => { cancelled = true; };
  }, [open, isEdit, editDiscussion, duplicateFrom, prefill]);

  // For a NEW discussion (incl. duplicate), focus + select the title so it's
  // clearly editable.
  useEffect(() => {
    // round355 — on a RESUME, leave focus and the title selection alone: the user was
    // working in the type field, not the title, and selecting it would make their
    // next keystroke replace the title they already wrote.
    if (resumingFromTypeEditorRef.current) return;
    if (open && !isEdit && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [open, isEdit]);

  // round355 — the resume pass. Declared last on purpose: effects run in declaration
  // order within a component, so the two open-effects above have already read the flag
  // and this is the one that consumes it (a later fresh open then seeds normally).
  useEffect(() => {
    if (!open) return;
    const resumed = resumingFromTypeEditorRef.current;
    resumingFromTypeEditorRef.current = null;
    if (!resumed?.type || resumed.type !== discussionType) return;
    // Codex P2 on round355 — the type just edited may be the one selected here, and
    // `selectType` had already stashed the OLD agenda in `typeTopics` for submit. Left
    // alone, creating now would build topics from the agenda the user just replaced.
    // Only the AGENDA is re-derived: applyParticipantTemplate merges people in, and
    // the user may have removed some of them on purpose since selecting the type.
    setTypeTopics(typeTopicsFor(resumed.type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyParticipantTemplate = (tpl) => {
    setParticipants((prev) => {
      const seen = new Set(prev.map((p) => String(p.id)));
      const additions = (tpl.participants || []).filter((p) => !seen.has(String(p.id)));
      return [...prev, ...additions];
    });
    // The template may also carry a "מוביל דיון" — set it when present.
    if (Array.isArray(tpl.lead) && tpl.lead.length) setLead(tpl.lead);
    // round367 — the template's external participants merge in (dedup by trimmed name).
    if (Array.isArray(tpl.externalParticipants) && tpl.externalParticipants.length) {
      setExternalParticipants((prev) => {
        const seen = new Set(prev.map((n) => String(n).trim()));
        return [...prev, ...tpl.externalParticipants.filter((n) => !seen.has(String(n).trim()))];
      });
    }
    // round295 — and a "מרכז דיון" (coordinator): it is stored on the template
    // (sanitizeTypeTemplate/sanitizeParticipantTemplate) but was never applied
    // here, so the coordinator defined in a type/participant template never
    // reached the create-discussion form (owner-reported; lead + participants
    // worked). Mirror the lead branch.
    if (Array.isArray(tpl.coordinator) && tpl.coordinator.length) setCoordinator(tpl.coordinator);
    setIsParticipantTemplateMenuOpen(false);
  };

  // Pick a discussion type (status label id, or null to clear). Classifying a
  // discussion immediately attaches its template. Preference order:
  //   1. the UNIFIED type template (topics + lead + participants in one) — new;
  //   2. legacy fallback: the separate topic + participant templates assigned to
  //      that type (each type maps to at most one of each — see TemplateManager).
  // The agenda a type template contributes to a NEW discussion (null = none). Shared
  // by selectType and the resume refresh so the two can never disagree.
  const typeTopicsFor = (typeName) => {
    const tpl = typeTemplates.find((t) => t.discussionType === typeName);
    return tpl?.topics?.length ? tpl.topics : null;
  };

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
      setTypeTopics(typeTopicsFor(id));
      applyParticipantTemplate({
        participants: typeTpl.participants,
        lead: typeTpl.lead,
        coordinator: typeTpl.coordinator,
        externalParticipants: typeTpl.externalParticipants,
      });
      autoNameForType(id);
      return;
    }

    // Legacy fallback.
    const topicTpl = templates.find((t) => t.discussionType === id);
    if (topicTpl) setTemplateId(topicTpl.id);
    const partTpl = participantTemplates.find((t) => t.discussionType === id);
    if (partTpl) applyParticipantTemplate(partTpl);
    autoNameForType(id);
  };

  /*
   * round367 — TEMPLATE mode + the templateAutoName preference: picking a
   * template writes "<תבנית> - <DD.MM.YYYY>" (the card's current date). Only
   * when the name is empty or still the previous auto name — a name the user
   * typed is never overwritten.
   */
  const autoNameForType = (typeName) => {
    if (isEdit || createMode !== CREATE_DISCUSSION_MODES.TEMPLATE) return;
    if (resolvePreference(settings?.preferences, 'templateAutoName') !== true) return;
    const isAutoOrEmpty = !name.trim() || (lastAutoDateRef.current && name.endsWith(lastAutoDateRef.current));
    if (!isAutoOrEmpty) return;
    setName(buildAutoName(typeName, date));
    lastAutoDateRef.current = formatNameDate(date);
  };

  // Add a new discussion type: create the label on the "סוג" dropdown column
  // DIRECTLY, right now — never deferred to save-time create_labels_if_missing,
  // which silently cannot create labels on MANAGED columns (2026-07-12 incident:
  // the UI showed the type as created, then the save failed). addDropdownLabel
  // handles BOTH regular and managed columns: the persisted managedColumnId hint
  // (detected on Settings save, published via the config store) skips the account
  // scan, a regular column goes through update_dropdown_column, and a stale hint
  // self-heals — the corrected uuid is persisted back to settings. Only after the
  // label EXISTS on the board do we store its color and select it (typeOptions
  // refreshes live via addDropdownLabel → notify). Failures surface via the
  // logger/toast funnel and the input stays open with the typed text.
  const handleAddType = async () => {
    const nm = newTypeName.trim();
    if (!nm || addingType) return;
    const hint = getColumns('discussions')?.discussionTypeID?.managedColumnId || null;
    try {
      setAddingType(true);
      const { managedColumnId } = await addDropdownLabel({
        boardKey: 'discussions', alias: 'discussionTypeID', title: nm, managedColumnId: hint,
      });
      const typeEntry = settings?.columns?.discussions?.discussionTypeID;
      if (managedColumnId !== hint && typeEntry) {
        // Self-heal resolved the truth — persist it so the next add skips the scan.
        // Best-effort: a failed persist only costs a re-detection next time.
        try {
          await updateSettings({
            columns: {
              ...settings.columns,
              discussions: {
                ...settings.columns.discussions,
                discussionTypeID: { ...typeEntry, managed: !!managedColumnId, managedColumnId },
              },
            },
          });
        } catch (persistErr) {
          logger.warn('CreateDiscussionModal', 'עדכון רמז עמודה מנוהלת נכשל (לא חוסם)', persistErr);
        }
      }
      await assignRandomTypeColor(nm);
      setIsAddingType(false);
      setNewTypeName('');
      selectType(nm);
    } catch (err) {
      logger.error('CreateDiscussionModal', 'שגיאה בהוספת סוג דיון — הסוג לא נוצר בלוח', err);
    } finally {
      setAddingType(false);
    }
  };

  /*
   * round381 — picking the project. It mirrors picking a type: close the menu, keep
   * the name beside the id, and write the auto name through the SHARED gate so a
   * name the user typed is never overwritten (canAutoName, see createModeRules).
   */
  const pickProject = (item) => {
    setProjectId(String(item.id));
    setProjectName(item.name || String(item.id));
    setIsProjectDropdownOpen(false);
    setProjectSearch('');
    if (canAutoName({
      isEdit,
      mode: createMode,
      autoNameEnabled: resolvePreference(settings?.preferences, 'templateAutoName'),
      name,
      lastAutoDate: lastAutoDateRef.current,
    })) {
      setName(buildAutoName(item.name || String(item.id), date));
      lastAutoDateRef.current = formatNameDate(date);
    }
  };

  /*
   * round367 — switching the toggle half. To ADHOC: the discussion is typeless
   * (type + stashed agenda cleared) and a still-auto name is cleared to the
   * clean empty state; a user-typed name survives the switch. To TEMPLATE: the
   * form folds back until a template is picked (unless one is already picked).
   */
  const switchCreateMode = (nextMode) => {
    if (nextMode === createMode) return;
    setCreateMode(nextMode);
    if (nextMode === CREATE_DISCUSSION_MODES.ADHOC) {
      setDiscussionType(null);
      setTypeTopics(null);
      if (lastAutoDateRef.current && name.endsWith(lastAutoDateRef.current)) setName('');
      lastAutoDateRef.current = '';
    }
    /*
     * round381 — leaving the project path drops its subject, the mirror of ADHOC
     * dropping the type: a project left behind would be WRITTEN by a submit from
     * another path, linking a discussion to a project the user had switched away
     * from. A still-auto name is cleared with it; a typed name survives.
     */
    if (nextMode !== CREATE_DISCUSSION_MODES.PROJECT && projectId) {
      setProjectId(null);
      setProjectName('');
      setIsProjectDropdownOpen(false);
      if (lastAutoDateRef.current && name.endsWith(lastAutoDateRef.current)) setName('');
      lastAutoDateRef.current = '';
    }
  };

  const handleSubmit = async () => {
    // Name, date AND time are required — every discussion is scheduled at an hour.
    if (!name.trim() || !date || !time) return;
    const submitStartedAt = Date.now();
    let submitSucceeded = false;
    // round300 — when the optimistic path hands off, the synchronous flow returns
    // before the write resolves, so the finally's total would log a misleading
    // ok=false. This flag makes the finally skip it; the background closure emits
    // the REAL total (round299's health metric stays accurate).
    let optimisticHandoff = false;
    try {
      setCreating(true);
      const submissionKey = JSON.stringify({
        mode: isEdit ? 'edit' : (isDuplicate ? 'duplicate' : 'create'),
        sourceId: isEdit ? editDiscussion?.id : duplicateFrom?.id,
        name: name.trim(),
        date,
        time,
        lead: lead.map((person) => String(person.id)),
        coordinator: coordinator.map((person) => String(person.id)),
        participants: participants.map((person) => String(person.id)),
        externalParticipants,
        discussionType,
        previousDiscussionId,
        templateId,
        typeTopics,
      });
      let resume = creationResumeRef.current;
      if (resume && resume.submissionKey !== submissionKey) {
        throw new Error('הדיון כבר נוצר חלקית. כדי למנוע כפילות, יש לסגור את הטופס ולפתוח דיון חדש לפני שינוי הפרטים.');
      }
      // Item 6 — real step progress: 1 step for the item save + one per
      // topic/point the picked template will create (refined live by
      // createTopicsFromTemplate's onProgress, which knows the sanitized total).
      const pickedTemplate = templates.find((t) => t.id === templateId);
      // round127 — duplicate: read the source topics BEFORE creating the item so
      // plannedSteps counts every clone step (the bar used to fake 100% after
      // the item save, seconds before the clone even started).
      const duplicateReadStartedAt = Date.now();
      const duplicateTemplate = isDuplicate
        ? (resume?.duplicateTemplate || await readDiscussionTopicsAsTemplate(duplicateFrom.id))
        : null;
      if (isDuplicate && !resume?.duplicateTemplate) {
        logger.health?.('discussion_create_phase', {
          step: 'duplicate_read',
          duration_ms: Date.now() - duplicateReadStartedAt,
        });
      }
      const primaryTopics = pickedTemplate?.topics || (typeTopics?.length ? typeTopics : []);
      const plannedTopics = [
        ...primaryTopics,
        ...(duplicateTemplate?.topics || []),
      ];
      const plannedSteps = 1 + plannedTopics.reduce((n, t) => n + 1 + (t.points?.length || 0), 0);
      setCreateProgress({ done: 0, total: plannedSteps });
      const onTemplateProgress = ({ done, total }) =>
        setCreateProgress({ done: 1 + done, total: 1 + total });
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
      // round211 — external (text-only) participants. On EDIT always send (an
      // empty string clears the column); on CREATE only when something was
      // typed. Unmapped column → the SDK skips the alias, like the people cols.
      if (externalParticipants.length || isEdit) {
        payload.externalParticipantsID = formatExternalParticipants(externalParticipants);
      }
      // "סוג" dropdown: only ever WRITE a label that ACTUALLY EXISTS on the
      // column. Options come from useDropdownOptions (the board's real labels),
      // so this blocks the inline "add new type" free-text affordance from
      // submitting a NON-existent label (e.g. "טוויסט") — which monday rejects
      // with a ColumnValueException on a locked/fixed dropdown even with
      // create_labels_if_missing. (Creatable types are out of scope for now.)
      // While options are still loading we can't validate, so we keep the
      // selected value rather than risk dropping a valid one. When the type is
      // CLEARED (or is an unknown label we won't submit) in edit mode we WRITE an
      // empty value (formatValue('dropdown', null) => {}) so the original label
      // doesn't persist — mirrors the previousDiscussionID clear-on-edit below.
      // On create we simply omit it.
      const knownTypeLabels = (typeOptions || []).map((o) => o.label);
      const typeIsSubmittable =
        discussionType !== null && discussionType !== undefined && discussionType !== ''
        && (typeOptionsLoading || knownTypeLabels.includes(discussionType));
      if (typeIsSubmittable) {
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
      // round115 — stamp the CREATOR + CREATION DATE on NEW discussions only
      // (never on edit — both are immutable facts of creation). Creator is
      // written ONLY when the mapped column is a regular writable people column
      // (verified in the owner's account: multiple_person_*); a monday
      // "creation log" column is read-only — monday fills it itself — and
      // writing it is what caused the historical GraphQL validation error, so
      // non-people mappings are skipped.
      if (!isEdit) {
        const dCols = getColumns('discussions') || {};
        if (dCols.discussionCreatorID?.id && currentUser?.id != null && isWritablePeopleColumnType(dCols.discussionCreatorID?.type)) {
          payload.discussionCreatorID = [Number(currentUser.id)];
        }
        if (dCols.creationDateID?.id) {
          payload.creationDateID = new Date();
        }
      }

      const cols = getColumns('discussions') || {};
      logger.info('CreateDiscussionModal', isEdit ? 'submitting update' : 'submitting create', {
        payloadKeys: Object.keys(payload),
        resolvedColumnIds: {
          discussionLeadID: cols.discussionLeadID?.id || null,
          participants_column6: cols.participantsID?.id || null,
        },
      });

      // round301 — STAGED create (plain NEW discussion only; edit + duplicate keep
      // the awaited flow below). round300 opened the card instantly but EMPTY: the
      // whole write ran in the background, so a template discussion showed no
      // topics until a minute later. Now the work is ordered by how much the user
      // needs it, per the owner's spec:
      //   Stage 1 (awaited — the card opens only after this): the root item with
      //           the BASICS (name/date/type/previous/creator) + ALL topics, created
      //           but not yet connected. round304 sizes this at ~40% of the wait.
      //   Stage 2 (background): every point, then the connection of the topics to
      //           the discussion (linkLast), resumed from stage 1's checkpoint so
      //           nothing is created twice.
      //   Stage 3 (background, last): the people columns — lead, coordinator,
      //           participants, external participants.
      // Stage 2/3 completion bumps a reload stamp on the card so the late arrivals
      // actually show up without a manual refresh.
      if (!isEdit && !isDuplicate && onOptimisticCreate) {
        // Stage 3 payload — pulled OUT of the create so the root item lands fast.
        // discussionCreatorID deliberately stays in stage 1: it is the permission
        // anchor (canEdit reads creator), so it must exist the moment the card opens.
        const rootPayload = { ...payload };
        const peoplePayload = {};
        for (const key of ['discussionLeadID', 'discussionCoordinatorID', 'participantsID', 'externalParticipantsID']) {
          if (key in rootPayload) {
            peoplePayload[key] = rootPayload[key];
            delete rootPayload[key];
          }
        }
        // The people the user picked are shown from this shape until stage 3 has
        // actually written them (see DiscussionCard's __pendingPeople merge), so
        // the header never blanks out while the write is still in flight.
        const pendingPeople = {
          discussionLeadID: lead,
          discussionCoordinatorID: coordinator,
          participantsID: participants,
          externalParticipantsID: formatExternalParticipants(externalParticipants),
        };
        const optimisticShape = {
          name: name.trim(),
          discussionDateID: date ? composeLocalDate(date, time) : null,
          ...pendingPeople,
          ...(typeIsSubmittable ? { discussionTypeID: discussionType } : {}),
          /*
           * round381 — the project link, written ONLY when the project path actually
           * produced one. Omitting the key on every other path is deliberate: a
           * board_relation write of an empty list CLEARS the column, so sending it
           * unconditionally would wipe the link on an edit of a project discussion.
           */
          ...(projectId ? { projectLinkID: projectLinkValue(projectId) } : {}),
        };
        // Template inputs are captured here (submit-time) so the form reset below
        // can't affect the staged writes.
        const stageTemplate = pickedTemplate || (typeTopics?.length ? { topics: typeTopics } : null);
        // A retry after a PARTIAL stage 1 must resume, never start over: the root
        // item may already exist. Same contract the awaited path uses, and the
        // submissionKey guard above already refuses a retry with edited details.
        let newId = resume?.savedId || null;
        let stage1Checkpoint = resume?.templateResumeState || null;
        const rememberRoot = (checkpoint) => {
          if (!newId) return;
          creationResumeRef.current = {
            ...(creationResumeRef.current || {}),
            submissionKey,
            savedId: String(newId),
            rootSaved: true,
            templateResumeState: checkpoint || null,
          };
        };
        try {
          if (!resume?.rootSaved) {
            const rootSavedAt = Date.now();
            const created = await board.item().create(rootPayload).execute();
            newId = created.id;
            rememberRoot(null);
            logger.health?.('discussion_create_phase', {
              step: 'staged_root_save', duration_ms: Date.now() - rootSavedAt,
            });
          }
          // round304 (owner spec) — REBALANCE the wait. round303 awaited only the
          // root item here, which the owner measured as ~15% of the wait in the
          // card vs ~85% under the card's loader; the ask is ~40/60. So the awaited
          // part now also creates every TOPIC (no points, no connection yet): that
          // is the second of the agenda's round-trips, and it moves the split
          // without giving up round303's win — the points and the connection
          // (linkLast) still run in the background, so the agenda still pops in
          // COMPLETE on one fetch instead of filling in topic by topic.
          if (stageTemplate) {
            const topicsAt = Date.now();
            await createTopicsFromTemplate(newId, stageTemplate, {
              freshDiscussion: true,
              // Topics ONLY — every point is deferred to the background pass, which
              // resumes from this pass's checkpoint so nothing is created twice.
              pointTopicIndexes: [],
              // …and NOTHING is connected here (PR-review fix): the relation is the
              // card's read path, so linking now would serve empty topics before
              // their points exist. The background pass owns the connection.
              skipLink: true,
              resumeState: stage1Checkpoint,
              onCheckpoint: (cp) => { stage1Checkpoint = cp; rememberRoot(cp); },
              // A real bar in the card for the part the user is actually waiting on.
              onProgress: setCreateProgress,
            });
            logger.health?.('discussion_create_phase', {
              step: 'staged_topics_awaited', duration_ms: Date.now() - topicsAt,
            });
          }
        } catch (err) {
          // Either the root create or the awaited topic pass failed. Both are
          // resumable (rememberRoot persisted the checkpoint) and nothing was handed
          // off yet, so surface it on the FORM (the modal is still open) exactly like
          // the awaited path does.
          rememberRoot(err?.templateResumeState || stage1Checkpoint);
          throw err;
        }
        // Stage 1 is on the board and about to be owned by the card — this form is
        // done with it, so the resume slot must not leak into the next creation.
        creationResumeRef.current = null;
        // Hand off — the card opens now with the real id. `__building` tells it the
        // rest is still on its way, so ניהול דיון runs the app's standard loading
        // animation instead of showing a half-built agenda; it clears when the last
        // stage lands (or fails).
        optimisticHandoff = true;
        onOptimisticCreate({
          ...optimisticShape,
          id: newId,
          __pendingPeople: pendingPeople,
          // Only TEMPLATE work gates the agenda view. The people write changes the
          // header, not the agenda, so it must not hold the loader up.
          __building: Boolean(stageTemplate),
        });
        // Reset the form for next time (the modal is unmounting).
        setName(''); setDate(''); setTime(''); setLead([]); setCoordinator([]);
        setParticipants([]); setExternalParticipants([]); setExternalDraft('');
        setDiscussionType(null); setTypeTopics(null); setPreviousDiscussionId('none');
        setTemplateId('none'); setCreating(false); setCreateProgress(null);
        (async () => {
          const bgStartedAt = Date.now();
          let bgOk = false;
          // The agenda and the people columns are INDEPENDENT writes, and the root
          // create deliberately omits the people ones (they are stage 3). So an
          // agenda failure must not skip stage 3 — that silently dropped every
          // person the user picked, for a write that was never even attempted
          // (round306 PR review). The agenda error is held here and rethrown after
          // stage 3 has had its turn, so reporting is unchanged.
          let agendaErr = null;
          try {
            try {
              // Stage 2 — the REST of the agenda, built while the discussion card
              // shows the standard loading animation: every point (the topics already
              // exist from the awaited pass and come back through the checkpoint), and
              // only then the connection to the discussion (linkLast). Because the
              // link is the card's read path, the agenda appears complete in one shot.
              if (stageTemplate) {
                const stage2At = Date.now();
                // With linkLast a mid-run failure leaves created topics INVISIBLE
                // (they exist but are not connected, and the card reads through the
                // connection). So: one resumed retry — the checkpoint guarantees
                // nothing is created twice — and if that fails too, a best-effort
                // salvage link of whatever WAS created, so no real item is stranded
                // unreachable. Only then does the failure surface.
                const buildAgenda = () => createTopicsFromTemplate(newId, stageTemplate, {
                  freshDiscussion: true,
                  linkLast: true,
                  resumeState: stage1Checkpoint,
                  onCheckpoint: (cp) => { stage1Checkpoint = cp; },
                });
                try {
                  await buildAgenda();
                } catch (firstErr) {
                  if (!firstErr?.__loggedId) logger.warn('CreateDiscussionModal', 'בניית האג׳נדה נכשלה — ניסיון חוזר מה-checkpoint', firstErr);
                  if (firstErr?.templateResumeState) stage1Checkpoint = firstErr.templateResumeState;
                  try {
                    await buildAgenda();
                  } catch (secondErr) {
                    if (secondErr?.templateResumeState) stage1Checkpoint = secondErr.templateResumeState;
                    try {
                      const salvaged = await linkTemplateTopics(newId, stage1Checkpoint);
                      logger.warn('CreateDiscussionModal', `בניית האג׳נדה נכשלה פעמיים — ${salvaged} נושאים שנוצרו קושרו לדיון כדי שלא יאבדו`, secondErr);
                    } catch (salvageErr) {
                      if (!salvageErr?.__loggedId) logger.error('CreateDiscussionModal', 'גם קישור ההצלה של נושאי האג׳נדה נכשל', salvageErr);
                    }
                    throw secondErr;
                  }
                }
                logger.health?.('discussion_create_phase', {
                  step: 'staged_agenda_link_last', duration_ms: Date.now() - stage2At,
                });
                // monday is read-after-write lagged: a resolved create_item/create_subitem
                // does not mean the relation and subitems are READABLE yet. Now that this
                // wait costs the user nothing (the loader is already running) we hold the
                // loader until the board really serves the agenda back, instead of
                // dropping the user onto a half-empty one.
                const readinessAt = Date.now();
                const wantTopics = (stageTemplate.topics || []).length;
                const wantPoints = (stageTemplate.topics || [])
                  .reduce((n, t) => n + (t.points?.length || 0), 0);
                let confirmed = false;
                for (let attempt = 0; attempt < 10; attempt += 1) {
                  try {
                    const readBack = await readDiscussionTopicsAsTemplate(newId);
                    const got = readBack?.topics || [];
                    const gotPoints = got.reduce((n, t) => n + (t.points?.length || 0), 0);
                    if (got.length >= wantTopics && gotPoints >= wantPoints) { confirmed = true; break; }
                  } catch (err) {
                    if (!err?.__loggedId) logger.warn('CreateDiscussionModal', 'קריאת אימות של נושאי הדיון נכשלה — ממשיך להמתין', err);
                  }
                  await new Promise((resolve) => { setTimeout(resolve, 500); });
                }
                logger.health?.('discussion_create_phase', {
                  step: 'staged_readiness', duration_ms: Date.now() - readinessAt, ok: confirmed,
                });
                // Reveal the agenda without waiting for the people write.
                onStageAdvance?.({ id: newId, stage: 2 });
                if (!confirmed) {
                  // The budget ran out before the board served the full agenda back.
                  // We still reveal (an endless loader would strand the user), but a
                  // single one-shot refetch could land on the same stale read, so
                  // schedule one more pass instead of leaving points missing until the
                  // user reopens the discussion.
                  logger.warn('CreateDiscussionModal', 'סדר היום עדיין לא נקרא במלואו מהלוח — מתוזמנת קריאה נוספת');
                  setTimeout(() => onStageAdvance?.({ id: newId, stage: 2, retry: true }), 4000);
                }
              }
            } catch (err) {
              // HELD, not swallowed: stage 3 (people) is an INDEPENDENT write that has
              // not been attempted yet, so it runs below and this error is rethrown after
              // it — the failure is still reported, the people are no longer lost with it.
              if (!err?.__loggedId) logger.warn('CreateDiscussionModal', 'בניית האג׳נדה נכשלה — ממשיך לכתיבת המשתתפים ואז מדווח', err);
              agendaErr = err;
            }
            // Stage 3 — people last. Runs even after an agenda failure: it is a
            // separate write, and the root create left these columns out on purpose.
            if (Object.keys(peoplePayload).length) {
              const stage3At = Date.now();
              await board.item(newId).update(peoplePayload).execute();
              logger.health?.('discussion_create_phase', {
                step: 'staged_people', duration_ms: Date.now() - stage3At,
              });
            }
            // Now the held agenda failure surfaces — same reporting as before, but
            // after the people made it to the board.
            if (agendaErr) throw agendaErr;
            bgOk = true;
            // Clears __pendingPeople and refetches, so the card now shows what monday
            // actually stores. This is a STAGE completion, not a fresh save: it lands
            // seconds after the handoff, by which time the user may have opened another
            // create form or gone back to the list, and the generic save handler would
            // close that modal (losing its unsaved input) and yank them back here. So
            // it goes through the id-GUARDED stage channel, which no-ops unless this
            // discussion is still the open one (round306 PR review).
            onStageComplete?.({ id: newId });
          } catch (err) {
            if (!err?.__loggedId) logger.error('CreateDiscussionModal', 'הדיון נוצר, אך השלמת הנושאים/המשתתפים ברקע נכשלה', err);
            // The discussion EXISTS (stage 1 succeeded) — do not revert the card;
            // only report, so the user can retry the missing parts in place.
            onStageError?.({ id: newId });
          } finally {
            // Stage 2+3 total, measured over the BACKGROUND tail only and tagged so
            // it stays distinguishable from the awaited flow's total.
            logger.health?.('discussion_create_total', {
              duration_ms: Date.now() - bgStartedAt,
              ok: bgOk,
              operation: 'create',
              optimistic: true,
              staged_tail: true,
            });
          }
        })();
        return;
      }

      // NO create_labels_if_missing here: a freshly-added "סוג" label was
      // already created on the column by handleAddType (addDropdownLabel) — and
      // on a MANAGED column the flag can't create labels anyway (it fails the
      // whole save with ColumnValueException; 2026-07-12 incident).
      const rootSaveStartedAt = Date.now();
      let savedId = resume?.savedId || (isEdit ? editDiscussion.id : null);
      const resumedRoot = Boolean(resume?.rootSaved);
      if (!resumedRoot) {
        if (isEdit) {
          await board.item(editDiscussion.id).update(payload).execute();
          savedId = editDiscussion.id;
        } else {
          const created = await board.item().create(payload).execute();
          savedId = created.id;
        }
        resume = {
          ...(resume || {}),
          submissionKey,
          savedId: String(savedId),
          duplicateTemplate,
          rootSaved: true,
          templateResumeState: resume?.templateResumeState || null,
        };
        creationResumeRef.current = resume;
      }
      logger.health?.('discussion_create_phase', {
        step: resumedRoot ? 'root_resume' : 'root_save',
        duration_ms: Date.now() - rootSaveStartedAt,
        operation: isEdit ? 'edit' : (isDuplicate ? 'duplicate' : 'create'),
      });
      setCreateProgress((p) => (p ? { ...p, done: 1 } : { done: 1, total: 1 }));

      // Seed every planned topic in ONE resumable pipeline. The helper batches
      // actual GraphQL mutations (not Promise.all over SDK calls, which monday's
      // iframe bridge serializes). A checkpoint is retained after each batch.
      if (savedId && plannedTopics.length) {
        const seedStartedAt = Date.now();
        let seedSucceeded = false;
        try {
          await createTopicsFromTemplate(savedId, { topics: plannedTopics }, {
            onProgress: onTemplateProgress,
            freshDiscussion: !isEdit,
            resumeState: resume?.templateResumeState || null,
            onCheckpoint: (nextState) => {
              if (
                creationResumeRef.current?.savedId === String(savedId)
                && creationResumeRef.current?.submissionKey === submissionKey
              ) {
                creationResumeRef.current.templateResumeState = nextState;
              }
            },
          });
          seedSucceeded = true;
        } finally {
          logger.health?.('discussion_create_phase', {
            step: 'template_seed',
            duration_ms: Date.now() - seedStartedAt,
            items: plannedSteps - 1,
            ok: seedSucceeded,
          });
        }
      }

      // Duplicate: clone the source discussion's topics + points onto the new
      // one (round127: from the PRE-READ template — no second read), then WAIT
      // until the clone is actually READABLE before handing the card off:
      // monday reads lag writes, and opening the card early is what showed an
      // empty discussion "filling in slowly".
      if (savedId && isDuplicate && duplicateTemplate?.topics?.length) {
        const readinessStartedAt = Date.now();
        const expectedTopicCount = plannedTopics.length;
        const expectedPointCount = plannedTopics.reduce(
          (count, topic) => count + (topic.points?.length || 0),
          0
        );
        for (let attempt = 0; attempt < 10; attempt += 1) {
          try {
            const readBack = await readDiscussionTopicsAsTemplate(savedId);
            const readableTopics = readBack?.topics || [];
            const readablePointCount = readableTopics.reduce(
              (count, topic) => count + (topic.points?.length || 0),
              0
            );
            if (
              readableTopics.length >= expectedTopicCount
              && readablePointCount >= expectedPointCount
            ) break;
          } catch (err) {
            if (!err?.__loggedId) logger.warn('CreateDiscussionModal', 'קריאת אימות של נושאי השכפול נכשלה — ממשיך להמתין', err);
          }
          await new Promise((resolve) => { setTimeout(resolve, 1000); });
        }
        logger.health?.('discussion_create_phase', {
          step: 'duplicate_readiness',
          duration_ms: Date.now() - readinessStartedAt,
        });
      }

      // Item 6 — the fun part: full bar + a confetti burst before handing off
      // (create/duplicate only; edits keep their toast). The short pause is the
      // celebration window — the discussion is already saved at this point.
      setCreateProgress((p) => (p ? { ...p, done: p.total } : { done: 1, total: 1 }));
      if (!isEdit) {
        // round298 — the discussion is ALREADY saved here; drop the blocking
        // celebration wait entirely so the card opens the instant the save
        // resolves (owner: creation still felt slow). A brief confetti still
        // flashes but never delays the hand-off.
        setCelebrate(true);
      }

      setName('');
      setDate('');
      setTime('');
      setLead([]);
      setCoordinator([]);
      setParticipants([]);
      setExternalParticipants([]);
      setExternalDraft('');
      setDiscussionType(null);
      setTypeTopics(null);
      setPreviousDiscussionId('none');
      setTemplateId('none');
      submitSucceeded = true;
      creationResumeRef.current = null;
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
        externalParticipantsID: formatExternalParticipants(externalParticipants),
        // round127 — carry the just-saved link so the refreshed card doesn't
        // keep showing the pre-edit previous discussion (the write succeeded;
        // only the hand-back omitted it).
        previousDiscussionID: previousDiscussionId && previousDiscussionId !== 'none'
          ? { linkedItems: [{ id: previousDiscussionId }] }
          : { linkedItems: [] },
      } : {
        id: savedId,
        name: name.trim(),
        discussionDateID: date ? composeLocalDate(date, time) : null,
        discussionLeadID: lead,
        discussionCoordinatorID: coordinator,
        participantsID: participants,
        externalParticipantsID: formatExternalParticipants(externalParticipants),
      }, { isEdit, isDuplicate });
    } catch (err) {
      logger.error('CreateDiscussionModal', isEdit ? 'שגיאה בעדכון הדיון' : 'שגיאה ביצירת הדיון', err);
    } finally {
      if (!optimisticHandoff) {
        logger.health?.('discussion_create_total', {
          duration_ms: Date.now() - submitStartedAt,
          ok: submitSucceeded,
          operation: isEdit ? 'edit' : (isDuplicate ? 'duplicate' : 'create'),
        });
      }
      setCreating(false);
      setCreateProgress(null);
      setCelebrate(false);
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
          {/* round367 — the title appears only once the card body has opened
              (adhoc immediately; template after picking a template). */}
          {formRevealed ? (
            <input
              ref={titleRef}
              className={styles.titleInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="שם הדיון"
              aria-label="שם הדיון"
            />
          ) : <span className={styles.titleSpacer} aria-hidden="true" />}
          {formRevealed && name && <FieldClearButton onClear={() => setName('')} label="ניקוי שם" />}
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="סגירה">
            ×
          </button>
        </div>
        <div className={styles.content}>
          {prefillLoading && (
            <div style={{ padding: '28px 8px' }}>
              <PartyProgress
                value={null}
                label={isDuplicate ? 'טוען את פרטי הדיון לשכפול...' : 'טוען את פרטי הדיון...'}
              />
            </div>
          )}
          <Flex direction="column" gap={16} align="stretch" className={styles.form} style={prefillLoading ? { display: 'none' } : undefined}>
            {/* round367 — the two-path toggle (approved mockup): full-width,
                right = מתבנית (default per preference), left = מזדמן. Always
                switchable; not shown when editing an existing discussion. */}
            {!isEdit && (
              /* round381 — the toggle is now BUILT from availableCreateModes, so the
                 project path appears between מתבנית and מזדמן exactly when the app can
                 carry it, and an instance with the feature off renders the same two
                 buttons round367 shipped. */
              <div className={styles.modeToggle} role="tablist" aria-label="אופן יצירת הדיון">
                {availableCreateModes(projectReady).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={createMode === mode}
                    className={`${styles.modeToggleBtn} ${createMode === mode ? styles.modeToggleActive : ''}`}
                    onClick={() => switchCreateMode(mode)}
                  >
                    {CREATE_MODE_LABEL[mode]}
                  </button>
                ))}
              </div>
            )}

            {/* round381 — the PROJECT subject cell. Deliberately the SAME
                .customDropdown markup the type cell uses (owner: "ממש כמו שבמקרה של
                דיון מתבנית נפתח תא עם כל התבניות"), so the two folding paths look
                identical and the card's cell standard (round368 §2) holds. */}
            {projectMode && (
            <div className={`${styles.row} ${styles.rowSingle}`}>
              <div className={styles.field}>
                <Text type="text2" className={styles.label}>פרויקט</Text>
                <div className={styles.customDropdown}>
                  <button
                    type="button"
                    className={styles.dropdownTrigger}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsProjectDropdownOpen((prev) => !prev);
                      setIsTypeDropdownOpen(false);
                      setIsPreviousDropdownOpen(false);
                      setIsTimeDropdownOpen(false);
                      setIsParticipantTemplateMenuOpen(false);
                      setProjectSearch('');
                    }}
                    aria-expanded={isProjectDropdownOpen}
                    aria-haspopup="listbox"
                  >
                    {projectId ? (
                      <span className={styles.dropdownValue}>{projectName}</span>
                    ) : (
                      <span className={`${styles.dropdownValue} ${styles.dropdownPlaceholder}`}>בחרו פרויקט</span>
                    )}
                    <span className={styles.dropdownChevron} aria-hidden="true">▾</span>
                  </button>
                  {isProjectDropdownOpen && (
                    <div className={styles.dropdownMenu} role="listbox" onPointerDown={(e) => e.stopPropagation()}>
                      <div className={styles.dropdownSearchRow}>
                        <input
                          className={styles.dropdownSearch}
                          value={projectSearch}
                          placeholder="חיפוש פרויקט"
                          aria-label="חיפוש פרויקט"
                          autoFocus
                          onChange={(e) => setProjectSearch(e.target.value)}
                        />
                      </div>
                      {projectOpts.loading && <div className={styles.dropdownEmpty}>טוען פרויקטים…</div>}
                      {!projectOpts.loading && projectCandidates.length === 0 && (
                        <div className={styles.dropdownEmpty}>
                          {projectOpts.items.length === 0 ? 'אין פרויקטים בלוח המקושר' : 'לא נמצאו פרויקטים מתאימים'}
                        </div>
                      )}
                      {projectCandidates.map((it) => (
                        <button
                          key={it.id}
                          type="button"
                          role="option"
                          aria-selected={String(it.id) === String(projectId)}
                          className={`${styles.dropdownItem} ${String(it.id) === String(projectId) ? styles.dropdownItemSelected : ''}`}
                          onClick={() => pickProject(it)}
                        >
                          {it.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            )}

            {/* Row 1: סוג דיון — full-width, on its own row. round367: shown in
                TEMPLATE mode (and in edit, where the toggle doesn't exist). */}
            {(isEdit || templateMode) && (
            <div className={`${styles.row} ${styles.rowSingle}`}>
              <div className={styles.field}>
                <Text type="text2" className={styles.label}>{fieldLabels.type}</Text>
                <div className={styles.customDropdown}>
                  <button
                    type="button"
                    className={styles.dropdownTrigger}
                    /* round127 — stop pointerdown too: the window-level closer fires on
                       pointerdown BEFORE click, so without this a second click on an open
                       trigger closed the menu and the click's toggle instantly reopened it. */
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsTypeDropdownOpen((prev) => !prev);
                      setIsPreviousDropdownOpen(false);
                      setIsTimeDropdownOpen(false);
                      setIsParticipantTemplateMenuOpen(false);
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
                      <span className={`${styles.dropdownValue} ${styles.dropdownPlaceholder}`}>{templateMode ? 'בחרו תבנית דיון' : 'בחר סוג דיון'}</span>
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
                                <span className={styles.dropdownItemLabel}>{option.label}</span>
                                {/* round355 — owner / super member only: jump to THIS type's
                                    template (roles · agenda · export) and come back here
                                    afterwards. Stops both events: the row's onClick would
                                    otherwise select the type, and the window-level closer
                                    fires on pointerdown before click (see the trigger). */}
                                {canEditTypeTemplate && (
                                  <button
                                    type="button"
                                    className={styles.typeTemplateBtn}
                                    aria-label={`הגדרת תבנית לסוג ${option.label}`}
                                    title="הגדרת תבנית הסוג"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      resumingFromTypeEditorRef.current = { type: option.label };
                                      setIsTypeDropdownOpen(false);
                                      setTypeSearch('');
                                      onEditTypeTemplate(option.label);
                                    }}
                                  >
                                    <Pencil size={14} />
                                  </button>
                                )}
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

            )}

            {/* round367 — the card body opens downward only once the path is
                usable; until then only the toggle (+ template picker) shows. */}
            {formRevealed && (<>
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
                        onChange={(d) => {
                          const next = d ? toDateInput(d) : '';
                          setDate(next);
                          // round367 — rewrite ONLY the auto date at the END of
                          // the name; a removed suffix means hands off forever.
                          const sync = syncTrailingDate(name, lastAutoDateRef.current, next);
                          if (sync) { setName(sync.name); lastAutoDateRef.current = sync.dateStr; }
                        }}
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
                        onPointerDown={(e) => e.stopPropagation()} /* round127 — see the type trigger */
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsTimeDropdownOpen((prev) => !prev);
                          setIsPreviousDropdownOpen(false);
                          setIsTypeDropdownOpen(false);
                          setIsParticipantTemplateMenuOpen(false);
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
                  <PersonPicker selected={lead} onChange={setLead} bordered single closeOnSelect boardKey="discussions" accountWide />
                  {lead.length > 0 && <FieldClearButton onClear={() => setLead([])} label={`ניקוי ${leadLabel}`} />}
                </div>
              </div>
              {/* round219 — the coordinator field appears iff the מרכז דיון
                  column is MAPPED (isColumnMapped); unmapped → it drops from the
                  form, mirroring the header + permissions matrix. */}
              {isColumnMapped('discussions', 'discussionCoordinatorID') && (
                <div className={styles.field}>
                  <Text type="text2" className={styles.label}>{coordinatorLabel}</Text>
                  <div className={styles.fieldWrap}>
                    <PersonPicker selected={coordinator} onChange={setCoordinator} bordered single closeOnSelect boardKey="discussions" accountWide />
                    {coordinator.length > 0 && <FieldClearButton onClear={() => setCoordinator([])} label={`ניקוי ${coordinatorLabel}`} />}
                  </div>
                </div>
              )}
              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <Text type="text2" className={styles.label}>{fieldLabels.participants}</Text>
                  {participantTemplates.length > 0 && (
                    <div className={styles.customDropdown}>
                      <button
                        type="button"
                        className={styles.templateChip}
                        onPointerDown={(e) => e.stopPropagation()} /* round127 — see the type trigger */
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsParticipantTemplateMenuOpen((prev) => !prev);
                          setIsPreviousDropdownOpen(false);
                          setIsTypeDropdownOpen(false);
                          setIsTimeDropdownOpen(false);
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
                  <PersonPicker selected={participants} onChange={setParticipants} bordered boardKey="discussions" accountWide />
                  {participants.length > 0 && <FieldClearButton onClear={() => setParticipants([])} label="ניקוי משתתפים" />}
                </div>
              </div>
            </div>

            {/* round211 — משתתפים חיצוניים (text-only names, not monday users;
                never assignable to tasks). Shown only when the long_text column
                is mapped in Settings. Type a full name + Enter/הוסף → chip. */}
            {Boolean(getColumns('discussions')?.externalParticipantsID?.id) && (
              <div className={`${styles.row} ${styles.rowSingle}`}>
                <div className={styles.field}>
                  <Text type="text2" className={styles.label}>
                    {/* round278 — always "משתתפים חיצוניים", matching DiscussionCard's
                        hardcoded label (round238). The mapped monday column is titled
                        "משתתפים", so deriving from its title showed the wrong (generic)
                        name in the create/duplicate card. */}
                    משתתפים חיצוניים
                  </Text>
                  <div className={styles.extPeopleBox}>
                    {externalParticipants.map((n, i) => (
                      <span key={`${n}-${i}`} className={styles.extPersonChip}>
                        {n}
                        <button
                          type="button"
                          className={styles.extPersonRemove}
                          onClick={() => setExternalParticipants((list) => list.filter((_, j) => j !== i))}
                          aria-label={`הסרת ${n}`}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    <input
                      className={styles.extPersonInput}
                      value={externalDraft}
                      placeholder={externalParticipants.length ? 'שם נוסף…' : 'שם מלא… (Enter להוספה)'}
                      onChange={(e) => setExternalDraft(e.target.value)}
                      onKeyDown={(e) => {
                        // round296 — Enter here ADDS a chip; it must NOT bubble to the
                        // modal-level onFormKeyDown (which would submit/create the
                        // discussion). preventDefault alone doesn't stop bubbling, so a
                        // single Enter both added a name AND created the discussion —
                        // aborting further additions and dropping the just-typed name.
                        // stopPropagation on EVERY Enter keeps this field submit-inert;
                        // only clicking "צור דיון" creates. (owner-reported)
                        if (e.key !== 'Enter' || e.shiftKey) return;
                        e.stopPropagation();
                        if (externalDraft.trim()) {
                          e.preventDefault();
                          setExternalParticipants((list) => [...list, externalDraft.trim()]);
                          setExternalDraft('');
                        }
                      }}
                      onBlur={() => {
                        if (externalDraft.trim()) {
                          setExternalParticipants((list) => [...list, externalDraft.trim()]);
                          setExternalDraft('');
                        }
                      }}
                      aria-label="הוספת משתתף חיצוני"
                    />
                  </div>
                </div>
              </div>
            )}

            </>)}

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
                    onPointerDown={(e) => e.stopPropagation()} /* round127 — see the type trigger */
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviousSearch('');
                      setIsPreviousDropdownOpen((prev) => !prev);
                      setIsTypeDropdownOpen(false);
                      setIsTimeDropdownOpen(false);
                      setIsParticipantTemplateMenuOpen(false);
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
          {formRevealed && (
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
              <Button onClick={handleSubmit} loading={creating && !celebrate} disabled={creating || prefillLoading || !name.trim() || !date || !time}>
                {isEdit ? 'שמור שינויים' : 'צור דיון'}
              </Button>
            </Flex>
          </Flex>
          )}
          {/* Item 6 — real-progress bar while the discussion (+ template topics)
              is being created; confetti bursts over everything on success. */}
          {creating && createProgress && (
            <div style={{ marginTop: 10 }}>
              <PartyProgress
                value={createProgress.done / Math.max(1, createProgress.total)}
                label={celebrate ? '🎉 הדיון נוצר!' : (isEdit ? 'שומר את השינויים...' : (isDuplicate ? 'משכפל את הדיון...' : 'יוצר את הדיון...'))} /* round127 */
              />
            </div>
          )}
        </div>
      </div>
      <ConfettiBurst active={celebrate} />
    </div>
  );
}

export default CreateDiscussionModal;
