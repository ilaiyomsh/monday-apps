import React, { useEffect, useRef, useState, useSyncExternalStore, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { Button, TextField, Text, Loader, ColorPicker } from '@vibe/core';
import { Search } from '@vibe/icons';
import { Plus, Trash2, Pencil, ChevronLeft, ChevronDown, X, GripVertical } from 'lucide-react';
import {
  ensurePeopleColumns,
  getColumnTitle,
  subscribe as subscribePeopleColumns,
  getVersion as getPeopleColumnsVersion,
} from '@generated/utils/mondayApi/peopleColumns.js';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTemplates } from '@generated/contexts/TemplatesContext.jsx';
import { useSettings } from '@generated/contexts/SettingsContext.jsx';
import { countPoints } from '@generated/utils/templates.js';
import { shouldApplyTypeEdit } from './typeEditRequest.js';
import { missingStoredTemplateDocx } from '@generated/utils/exportAssets.js';
import { canSaveType, cleanTypeTopics } from './typeSaveGuard.js';
import {
  useDropdownOptions,
  addDropdownLabel,
  renameDropdownLabel,
  renameDropdownLabelByText,
} from '@generated/hooks/useDropdownOptions.js';
import { validateTypeRename } from '@generated/utils/typeRename.js';
import { getColumns } from '@generated/utils/mondayApi/board-config-store.js';
import { MONDAY_COLOR_NAMES, colorNameToCss } from '@generated/constants/mondayPalette.js';
import { PersonPicker } from '@generated/components/PersonPicker';
import ExportTemplateTab from '@generated/components/SettingsModal/ExportTemplateTab.jsx';
import { seedExportTemplate } from '@generated/components/SettingsModal/SettingsModal.jsx';
import logger from '@generated/utils/logger.js';
import styles from './TemplateManagerModal.module.css';

/* "סוג דיון" picker styled to match the app's custom dropdowns, with a color
   swatch per type. "סוג" is a DROPDOWN column, so value = the label TEXT (or
   null). Colors come from app storage via `colorFn(name)`. */
function TypeDropdown({ value, onChange, options, colorFn, takenNames }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  // The menu is portaled to document.body (position:fixed) so the modal's
  // scroll/overflow never clips it — same pattern as PersonPicker / FilterSelect.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const reposition = () => setOpen(false); // close on scroll/resize rather than chase
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc, true);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc, true);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen(true);
  };
  const swatch = (name) => <span className={styles.typeSwatch} style={{ background: colorFn(name) }} />;
  return (
    <div className={styles.typeDropdown}>
      <button ref={triggerRef} type="button" className={styles.typeTrigger} onClick={toggle} aria-haspopup="listbox" aria-expanded={open}>
        {value
          ? <span className={styles.typeValue}>{swatch(value)}{value}</span>
          : <span className={`${styles.typeValue} ${styles.typePlaceholder}`}>ללא סוג</span>}
        <span className={styles.typeTrailing}>
          {value != null && (
            <span
              role="button"
              tabIndex={0}
              className={styles.typeClear}
              aria-label="נקה סוג"
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange(null); } }}
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown className={styles.typeChevron} size={16} aria-hidden="true" />
        </span>
      </button>
      {open && pos && createPortal(
        <ul
          ref={menuRef}
          className={styles.typeMenu}
          role="listbox"
          dir="rtl"
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 10000 }}
        >
          <li role="option" aria-selected={value == null} className={`${styles.typeItem} ${value == null ? styles.typeItemSelected : ''}`} onClick={() => { onChange(null); setOpen(false); }}>
            ללא סוג
          </li>
          {options.map((o) => {
            const disabled = takenNames?.has(o.label) && o.label !== value;
            return (
              <li
                key={o.id ?? o.label}
                role="option"
                aria-selected={o.label === value}
                aria-disabled={disabled || undefined}
                className={`${styles.typeItem} ${o.label === value ? styles.typeItemSelected : ''} ${disabled ? styles.typeItemDisabled : ''}`}
                onClick={() => { if (disabled) return; onChange(o.label); setOpen(false); }}
              >
                {swatch(o.label)}{o.label}
              </li>
            );
          })}
        </ul>,
        document.body
      )}
    </div>
  );
}

/* One draggable point row inside a topic (keyed by stable _uid). */
function SortablePointRow({ topicUid, point, onChange, onRemove, onEnterAddPoint, autoFocus = false, onFocused }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: point._uid });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  // round295 — when ENTER on the previous point created THIS (freshly added) row,
  // move the caret straight into it so the user keeps typing the next point with
  // no mouse. The parent flags the new row via autoFocus and clears it once used.
  const fieldRef = useRef(null);
  useEffect(() => {
    if (!autoFocus) return;
    const input = fieldRef.current?.querySelector('input, textarea');
    if (input) input.focus();
    onFocused?.();
  }, [autoFocus]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={setNodeRef} style={style} className={styles.pointRow}>
      <button type="button" className={styles.dragGrip} {...attributes} {...listeners} aria-label="גרור נקודה">
        <GripVertical size={14} />
      </button>
      <div className={styles.pointField} ref={fieldRef}>
        <TextField
          value={point.text}
          onChange={(v) => onChange(topicUid, point._uid, v)}
          placeholder="נקודה"
          size="small"
          onKeyDown={(e) => { if (e.key === 'Enter' && point.text.trim()) { e.preventDefault(); onEnterAddPoint(topicUid); } }}
        />
      </div>
      <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => onRemove(topicUid, point._uid)} aria-label="מחק נקודה">
        <X size={16} />
      </button>
    </div>
  );
}

/* One draggable topic card with its own sortable points list. */
function SortableTopicCard({ topic, sensors, canRemove, onSetName, onRemove, onAddPoint, onRemovePoint, onSetPoint, onPointsDragEnd, autoFocusPointUid, onPointFocused }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: topic._uid });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <div ref={setNodeRef} style={style} className={styles.topicCard}>
      <div className={styles.topicHeader}>
        <button type="button" className={styles.dragGrip} {...attributes} {...listeners} aria-label="גרור נושא">
          <GripVertical size={16} />
        </button>
        <div className={styles.topicNameField}>
          <TextField value={topic.name} onChange={(v) => onSetName(topic._uid, v)} placeholder="שם הנושא" size="small" />
        </div>
        <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => onRemove(topic._uid)} aria-label="מחק נושא" disabled={!canRemove}>
          <Trash2 size={16} />
        </button>
      </div>
      <div className={styles.pointsWrap}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onPointsDragEnd(topic._uid, e)}>
          <SortableContext items={topic.points.map((p) => p._uid)} strategy={verticalListSortingStrategy}>
            {topic.points.map((point) => (
              <SortablePointRow key={point._uid} topicUid={topic._uid} point={point} onChange={onSetPoint} onRemove={onRemovePoint} onEnterAddPoint={onAddPoint} autoFocus={point._uid === autoFocusPointUid} onFocused={onPointFocused} />
            ))}
          </SortableContext>
        </DndContext>
        <button type="button" className={styles.addPointBtn} onClick={() => onAddPoint(topic._uid)}>
          <Plus size={12} /> הוסף נקודה
        </button>
      </div>
    </div>
  );
}

/*
 * The editor works on a DRAFT whose topics/points carry an ephemeral `_uid`
 * (session-local, never persisted) so React keys stay stable while rows are
 * added/removed mid-edit. draftToTemplate() strips the uids back to the stored
 * shape ({ name, topics:[{ name, points:string[] }] }) on save.
 */
let _uidSeq = 0;
const uid = () => `k${(_uidSeq += 1)}`;
const makePoint = (text = '') => ({ _uid: uid(), text });
const makeTopic = (name = '') => ({ _uid: uid(), name, points: [] });
const emptyDraft = () => ({ id: null, name: '', discussionType: null, topics: [makeTopic()] });
const emptyParticipantDraft = () => ({ id: null, name: '', discussionType: null, lead: [], coordinator: [], participants: [] });

function templateToDraft(t) {
  return {
    id: t.id,
    name: t.name,
    discussionType: t.discussionType ?? null,
    topics: t.topics.map((tp) => ({
      _uid: uid(),
      name: tp.name,
      points: tp.points.map((p) => makePoint(p)),
    })),
  };
}
function draftToTemplate(draft) {
  return {
    name: draft.name,
    discussionType: draft.discussionType ?? null,
    topics: draft.topics.map((t) => ({ name: t.name, points: t.points.map((p) => p.text) })),
  };
}

/*
 * Templates manager PANEL — rendered as the "תבניות" tab inside the Settings
 * dialog (owner-only). Three kinds, switched by an inner tab bar:
 *   • לפי סוג דיון (default) — one UNIFIED template per discussion TYPE, bundling
 *     topics + people (lead/coordinator/participants) + the type's display color.
 *   • נושאים   — a named set of fixed topics, each with a list of points.
 *   • משתתפים  — a named set of people.
 * Persists via TemplatesContext (immediately, independent of the Settings save).
 * People pickers for a role column appear ONLY when that column is mapped in
 * Settings (the "יוצר" creator column is intentionally never shown/edited here).
 */
/*
 * round355 — `pendingTypeEdit` ({ type, nonce }) asks this panel to open ONE
 * discussion type's editor, and `onTypeSaved(typeName)` reports a successful save
 * back out. Together they let the create-discussion card's pencil hand the user
 * here and get them back (see typeEditRequest.js for the two guards this needs).
 * Both default to inert, so every existing mount behaves exactly as before.
 */
export const TemplateManagerModal = forwardRef(function TemplateManagerModal({ onExportWide, pendingTypeEdit = null, onTypeSaved = null } = {}, ref) {
  const { settings } = useSettings();
  const {
    templates,
    participantTemplates,
    typeTemplates,
    loading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    createParticipantTemplate,
    updateParticipantTemplate,
    deleteParticipantTemplate,
    upsertTypeTemplate,
    deleteTypeTemplate,
    typeColor,
    typeColorName,
    setTypeColor,
    assignRandomTypeColor,
    loadTypeExportAssets,
    saveTypeExportAssets,
    renameDiscussionType,
  } = useTemplates();
  // "סוג דיון" is a DROPDOWN column — its labels are the assignable types.
  const { options: typeOptions } = useDropdownOptions('discussions', 'discussionTypeID');
  // Which discussion people columns are mapped (creator is intentionally ignored):
  // only mapped roles get a picker in the template editors.
  const discCols = getColumns('discussions') || {};
  const leadMapped = !!discCols.discussionLeadID?.id;
  const coordinatorMapped = !!discCols.discussionCoordinatorID?.id;
  const participantsMapped = !!discCols.participantsID?.id;
  // People-picker labels come from the LIVE board column titles (fall back to the
  // schema title until the live columns load, then re-render on the version bump).
  useEffect(() => { ensurePeopleColumns(); }, []);
  const peopleColumnsVersion = useSyncExternalStore(subscribePeopleColumns, getPeopleColumnsVersion, getPeopleColumnsVersion);
  const roleTitle = (alias, fallback) => getColumnTitle('discussions', alias) || fallback;
  // Reference the version so the labels recompute once the live titles arrive.
  void peopleColumnsVersion;
  // Drag-reorder sensor — declared with the other hooks, BEFORE any early return.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // kind: 'types' | 'topics' | 'participants' (tab) · view: 'list' | 'edit'.
  // Default tab is "by discussion type".
  const [kind, setKind] = useState('types');
  const [view, setView] = useState('list');
  const [draft, setDraft] = useState(null); // topic draft (also holds the topics + selected type when kind==='types')
  const [pDraft, setPDraft] = useState(null); // participant draft
  // Type-template editor reuses `draft` for its topics (and draft.discussionType
  // for the fixed type); people + color live in their own state.
  const [typeLead, setTypeLead] = useState([]);
  const [typeCoordinator, setTypeCoordinator] = useState([]);
  const [typeParticipants, setTypeParticipants] = useState([]);
  const [typeColorDraft, setTypeColorDraft] = useState(null); // a monday color NAME
  // Item 18 — per-type default decider: when true, NEW decisions in discussions
  // of this type default their מחליט to the discussion's מנהל דיון.
  const [typeDeciderIsLead, setTypeDeciderIsLead] = useState(false);
  // round256 — the type editor is split into 3 sub-tabs: roles / agenda / export.
  const [typeSubTab, setTypeSubTab] = useState('roles'); // 'roles' | 'agenda' | 'export'
  // round254/256 — per-type export template (config on the TypeTemplate) + its own
  // brand assets. The export tab ALWAYS shows (default = the system template);
  // it is persisted as the type's OWN only if the user edits it here (dirty).
  const [typeExportTemplate, setTypeExportTemplate] = useState(null); // seeded object
  const [typeExportAssets, setTypeExportAssets] = useState(null);
  // round356 — see startEditType: which asset read is current, and whether the owner
  // has already touched the assets (a late read must not land on top of an edit).
  const typeAssetsLoadRef = useRef(0);
  const typeExportTouchedRef = useRef(false);
  const [typeExportAssetError, setTypeExportAssetError] = useState(null);
  const [typeExportDirty, setTypeExportDirty] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  // round295 — uid of a freshly-added point row that should grab keyboard focus
  // (set by addPoint, cleared once the row focuses).
  const [autoFocusPointUid, setAutoFocusPointUid] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [typeSearch, setTypeSearch] = useState(''); // filters the "סוג דיון" list (also the typed source for the inline "create" affordance)
  const [addingType, setAddingType] = useState(false); // add-type mutation in-flight
  const [addOpen, setAddOpen] = useState(false); // "סוג דיון חדש" popup open state
  const [addName, setAddName] = useState(''); // typed name inside the add-type popup
  // round304 — rename the OPEN type template (its name IS the discussion type).
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState(null);
  const [renaming, setRenaming] = useState(false);
  // { from, to } while the monday label is renamed but the stored-data migration
  // still owes a retry (see handleRenameType). Cleared on success / leaving the editor.
  const renamePendingRef = useRef(null);
  const typeSearchRef = useRef(null); // ref for the "סוג דיון" search box input
  // Color popover (opened by the color circle in the type-editor header).
  const [colorOpen, setColorOpen] = useState(false);
  const [colorPos, setColorPos] = useState(null);
  const colorTriggerRef = useRef(null);
  const colorPopoverRef = useRef(null);

  useEffect(() => {
    if (!colorOpen) return undefined;
    const onDown = (e) => {
      if (colorPopoverRef.current?.contains(e.target) || colorTriggerRef.current?.contains(e.target)) return;
      setColorOpen(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setColorOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc, true);
    };
  }, [colorOpen]);

  const openColorPopover = () => {
    if (colorOpen) { setColorOpen(false); return; }
    const rect = colorTriggerRef.current?.getBoundingClientRect();
    if (rect) setColorPos({ top: rect.bottom + 6, left: rect.left });
    setColorOpen(true);
  };

  const switchKind = (next) => {
    if (next === kind) return;
    setKind(next);
    setView('list');
    setDraft(null);
    setPDraft(null);
    setTypeLead([]);
    setTypeCoordinator([]);
    setTypeParticipants([]);
    setTypeColorDraft(null);
    setTypeDeciderIsLead(false);
    setIsNew(false);
    setConfirmDeleteId(null);
    setTypeSearch('');
  };

  const startNew = () => {
    if (kind === 'topics') setDraft(emptyDraft());
    else setPDraft(emptyParticipantDraft());
    setIsNew(true);
    setView('edit');
  };
  const startEdit = (t) => {
    if (kind === 'topics') setDraft(templateToDraft(t));
    else setPDraft({ id: t.id, name: t.name, discussionType: t.discussionType ?? null, lead: t.lead || [], coordinator: t.coordinator || [], participants: t.participants || [] });
    setIsNew(false);
    setView('edit');
  };
  // Open the unified editor for a discussion TYPE (kind==='types'). `typeName` is
  // the dropdown label; the existing type template (if any) seeds topics + people.
  const startEditType = (typeName) => {
    renamePendingRef.current = null;
    const existing = typeTemplates.find((t) => t.discussionType === typeName);
    const topics = existing?.topics?.length ? existing.topics : [{ name: '', points: [] }];
    setDraft({
      id: existing?.id ?? null,
      name: '',
      discussionType: typeName,
      topics: topics.map((tp) => ({ _uid: uid(), name: tp.name, points: tp.points.map((p) => makePoint(p)) })),
    });
    setTypeLead(existing?.lead || []);
    setTypeCoordinator(existing?.coordinator || []);
    setTypeParticipants(existing?.participants || []);
    setTypeColorDraft(typeColorName(typeName));
    setTypeDeciderIsLead(existing?.deciderIsLead === true);
    // round256 — always open on the roles sub-tab; the export tab seeds from the
    // type's OWN template if it has one, otherwise from the system default
    // (settings.exportTemplate) → the built-in default. Not dirty until edited.
    setTypeSubTab('roles');
    setTypeExportDirty(false);
    setTypeExportTemplate(seedExportTemplate(existing?.exportTemplate || settings?.exportTemplate || null));
    setTypeExportAssetError(null);
    setTypeExportAssets(null);
    /*
     * round356 — this read is async, and the owner can reach the export sub-tab and
     * upload a .docx before it lands. Unguarded, the resolved STORED assets overwrote
     * the file that was just picked and the save then persisted the old bundle — a
     * silent loss of the upload, with the dirty flag still set so it looked saved.
     * The token drops a stale read, and `typeExportTouchedRef` drops a read that
     * would land on top of an edit the owner already made.
     */
    const token = (typeAssetsLoadRef.current += 1);
    typeExportTouchedRef.current = false;
    /*
     * round361 (owner: "אין שגיאה אבל הקובץ לא שם") — the editor's read is STRICT,
     * because here a swallowed read failure renders exactly like "no file was ever
     * saved". Two distinct states become visible on the export sub-tab:
     *   - the read itself failed → say so, instead of an innocent empty upload row;
     *   - the read succeeded EMPTY while the type's OWN stored config says a file
     *     was saved (`hasTemplateDocx` persists in the small, reliable
     *     type-templates key) → the asset write was lost — say that.
     * Both are token-guarded like the assets themselves — a stale result must not
     * stamp an error onto a newer editing session.
     */
    Promise.resolve(loadTypeExportAssets?.(typeName, { strict: true }))
      .then((a) => {
        if (!a) return;
        if (token !== typeAssetsLoadRef.current || typeExportTouchedRef.current) return;
        setTypeExportAssets(a);
        if (missingStoredTemplateDocx(existing?.exportTemplate ?? null, a)) {
          setTypeExportAssetError('קובץ התבנית סומן כשמור, אך לא נמצא באחסון — נסו להעלות ולשמור אותו שוב.');
        }
      })
      .catch((err) => {
        logger.warn('TemplateManagerModal', 'טעינת נכסי הייצוא של הסוג נכשלה', err);
        if (token !== typeAssetsLoadRef.current) return;
        setTypeExportAssetError('קריאת נכסי הייצוא של הסוג מהאחסון נכשלה — הקובץ עשוי להיות שמור. סגרו את העורך ונסו שוב.');
      });
    setIsNew(!existing);
    setView('edit');
  };
  const backToList = () => {
    renamePendingRef.current = null; // a pending rename-migration belongs to this editor only
    setView('list');
    setDraft(null);
    setPDraft(null);
    setTypeLead([]);
    setTypeCoordinator([]);
    setTypeParticipants([]);
    setTypeColorDraft(null);
    setTypeDeciderIsLead(false);
    setTypeSubTab('roles');
    setTypeExportTemplate(null);
    setTypeExportAssets(null);
    setTypeExportAssetError(null);
    setTypeExportDirty(false);
    setIsNew(false);
  };

  // round355 — honour an external "edit this type's template" request (the pencil in
  // the create-discussion card). `shouldApplyTypeEdit` holds the two rules: wait for
  // the templates to load (entering blank would make the save WIPE the stored
  // template) and apply each nonce at most once (re-applying resets the draft under
  // the user). The tab is forced to "types" because the request is type-scoped.
  const appliedTypeEditRef = useRef(null);
  useEffect(() => {
    if (!shouldApplyTypeEdit({ request: pendingTypeEdit, loading, appliedNonce: appliedTypeEditRef.current })) return;
    appliedTypeEditRef.current = pendingTypeEdit.nonce;
    setKind('types');
    startEditType(pendingTypeEdit.type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTypeEdit, loading]);

  // round256 — any user edit inside the export sub-tab marks it dirty, so save
  // persists the type's OWN template/assets (otherwise it stays on the system
  // default). These wrap the plain setters passed to ExportTemplateTab.
  const setTypeExportTemplateDirty = (updater) => { setTypeExportDirty(true); setTypeExportTemplate(updater); };
  const setTypeExportAssetsDirty = (updater) => {
    typeExportTouchedRef.current = true; // guards against a late load clobbering this
    setTypeExportDirty(true);
    setTypeExportAssets(updater);
  };
  // Ask the host (SettingsModal) to widen the modal while the export sub-tab is
  // open, so it gets the same room as the system export-template screen.
  useEffect(() => {
    onExportWide?.(view === 'edit' && kind === 'types' && typeSubTab === 'export');
  }, [onExportWide, view, kind, typeSubTab]);

  // ---- topic draft mutations (keyed by stable _uid, never by index) ----
  const update = (fn) => setDraft((d) => fn(d));
  // Drag-reorder topics, and points within a topic (by stable _uid).
  const onTopicsDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    update((d) => {
      const ids = d.topics.map((t) => t._uid);
      return { ...d, topics: arrayMove(d.topics, ids.indexOf(active.id), ids.indexOf(over.id)) };
    });
  };
  const onPointsDragEnd = (tuid, { active, over }) => {
    if (!over || active.id === over.id) return;
    update((d) => ({
      ...d,
      topics: d.topics.map((t) => {
        if (t._uid !== tuid) return t;
        const ids = t.points.map((p) => p._uid);
        return { ...t, points: arrayMove(t.points, ids.indexOf(active.id), ids.indexOf(over.id)) };
      }),
    }));
  };
  const setName = (v) => update((d) => ({ ...d, name: v }));
  const addTopic = () => update((d) => ({ ...d, topics: [...d.topics, makeTopic()] }));
  const removeTopic = (tuid) => update((d) => ({ ...d, topics: d.topics.filter((t) => t._uid !== tuid) }));
  const setTopicName = (tuid, v) =>
    update((d) => ({ ...d, topics: d.topics.map((t) => (t._uid === tuid ? { ...t, name: v } : t)) }));
  const addPoint = (tuid) => {
    // round295 — create the point with a known uid so the new row can grab focus
    // (ENTER on the previous point flows straight into the next one).
    const np = makePoint();
    update((d) => ({
      ...d,
      topics: d.topics.map((t) => (t._uid === tuid ? { ...t, points: [...t.points, np] } : t)),
    }));
    setAutoFocusPointUid(np._uid);
  };
  const removePoint = (tuid, puid) =>
    update((d) => ({
      ...d,
      topics: d.topics.map((t) =>
        t._uid === tuid ? { ...t, points: t.points.filter((p) => p._uid !== puid) } : t
      ),
    }));
  const setPoint = (tuid, puid, v) =>
    update((d) => ({
      ...d,
      topics: d.topics.map((t) =>
        t._uid === tuid
          ? { ...t, points: t.points.map((p) => (p._uid === puid ? { ...p, text: v } : p)) }
          : t
      ),
    }));

  const items = kind === 'topics' ? templates : participantTemplates;
  const canSave =
    kind === 'topics'
      ? !!draft && draft.name.trim() && draft.topics.some((t) => t.name.trim())
      : kind === 'participants'
      ? !!pDraft && pDraft.name.trim() && (pDraft.participants || []).length > 0
      // types: content (a topic / any person) OR an actual edit to one of the
      // template-independent facets. round362 — the old content-only gate silently
      // discarded an export-.docx upload (or a color / decider change) on a
      // template-less type: it opens with one blank seeded topic, so canSave stayed
      // false and the שמור button did nothing, with no error anywhere.
      : canSaveType({
          draft,
          lead: typeLead,
          coordinator: typeCoordinator,
          participants: typeParticipants,
          exportDirty: typeExportDirty,
          colorDraft: typeColorDraft,
          storedColor: draft ? typeColorName(draft.discussionType) : null,
          deciderIsLead: typeDeciderIsLead,
          storedDeciderIsLead:
            typeTemplates.find((t) => t.discussionType === draft?.discussionType)?.deciderIsLead === true,
        });

  const handleSave = async () => {
    if (!canSave || saving) return;
    // round355 — set only on a successful TYPE save; drives the hand-back below.
    let savedTypeName = null;
    // Per-kind uniqueness: at most one template of the current kind may be
    // assigned to a given "סוג דיון". Re-check here (the UI already greys taken
    // types) so a stale/edge case can't slip a duplicate through.
    const chosenType = kind === 'topics' ? (draft?.discussionType ?? null) : (pDraft?.discussionType ?? null);
    const currentId = kind === 'topics' ? draft?.id : pDraft?.id;
    if (kind !== 'types' && chosenType != null) {
      const clash = items.some((t) => t.id !== currentId && t.discussionType === chosenType);
      if (clash) {
        logger.error('TemplateManagerModal', `כבר קיימת תבנית מסוג זה עבור "${chosenType}". בחרו סוג אחר או הסירו את השיוך.`);
        return;
      }
    }
    setSaving(true);
    try {
      if (kind === 'topics') {
        const payload = draftToTemplate(draft);
        if (isNew) await createTemplate(payload);
        else await updateTemplate(draft.id, payload);
      } else if (kind === 'participants') {
        const payload = { name: pDraft.name, discussionType: pDraft.discussionType ?? null, lead: pDraft.lead, coordinator: pDraft.coordinator, participants: pDraft.participants };
        if (isNew) await createParticipantTemplate(payload);
        else await updateParticipantTemplate(pDraft.id, payload);
      } else {
        // round256 — the export tab always shows (default = system template). We
        // persist the type's OWN template only when the user EDITED it here
        // (typeExportDirty); otherwise keep whatever was stored (null ⇒ the type
        // keeps following the system default, so future system changes propagate).
        const existingType = typeTemplates.find((t) => t.discussionType === draft.discussionType);
        // round304 — `typeExportAssets` is null until the async load lands, and
        // writing that null would normalize to EMPTY and WIPE the type's stored
        // logos / uploaded .docx (e.g. when the user edited only the config and
        // saved before the load finished). Only write real, loaded assets.
        if (typeExportDirty && typeExportAssets) {
          // persist the per-type export ASSETS first (quota-checked). On an
          // over-quota error, keep the editor open with the message.
          try {
            await saveTypeExportAssets(draft.discussionType, typeExportAssets);
          } catch (err) {
            logger.error('TemplateManagerModal', 'שמירת נכסי הייצוא של הסוג נכשלה', err);
            setTypeExportAssetError(err?.message || 'שמירת נכסי הייצוא נכשלה');
            setTypeSubTab('export'); // surface the error on the right tab
            return; // the finally below clears `saving`
          }
        }
        // types: keyed by discussionType (name) — upsert replaces any existing entry.
        await upsertTypeTemplate({
          id: draft.id,
          discussionType: draft.discussionType,
          // round362 — blank rows (incl. the seeded one) are dropped, so an
          // export-only save does not mint an empty agenda item.
          topics: cleanTypeTopics(draft.topics),
          lead: typeLead,
          coordinator: typeCoordinator,
          participants: typeParticipants,
          // item 18 — per-type default decider (מחליט = מנהל הדיון)
          deciderIsLead: typeDeciderIsLead,
          // round256 — edited-here ⇒ store the type's own template; else preserve
          // the existing value (null ⇒ follow the system default).
          exportTemplate: typeExportDirty ? typeExportTemplate : (existingType?.exportTemplate ?? null),
        });
        // Persist the chosen color for this type.
        if (typeColorDraft) await setTypeColor(draft.discussionType, typeColorDraft);
        savedTypeName = draft.discussionType;
      }
      backToList();
      // round355 — when the editor was entered from the create-discussion card's
      // pencil, saving IS the hand-back signal: the host restores that card exactly
      // as the user left it. Inert (no listener) on every other entry path.
      if (savedTypeName) onTypeSaved?.(savedTypeName);
    } finally {
      setSaving(false);
    }
  };

  // round295 — expose dirty-state + a save to the host (SettingsModal) so:
  //  (1) the general Settings "שמור" also flushes an in-progress template draft
  //      the user forgot to "שמור תבנית", and
  //  (2) closing Settings (X) mid-edit can offer to save first.
  // "Dirty" = we're inside the editor and its content DIFFERS from what it held
  // when the editor opened (snapshot captured on view→edit). No change ⇒ not
  // dirty ⇒ the host closes with no prompt (owner spec).
  const editorSnapshotRef = useRef(null);
  const serializeEditorState = () => {
    if (kind === 'topics') return JSON.stringify(draft ? draftToTemplate(draft) : null);
    if (kind === 'participants') return JSON.stringify(pDraft);
    return JSON.stringify({
      topics: draft ? draft.topics.map((t) => ({ name: t.name, points: t.points.map((p) => p.text) })) : null,
      lead: typeLead, coordinator: typeCoordinator, participants: typeParticipants,
      color: typeColorDraft, deciderIsLead: typeDeciderIsLead, exportDirty: typeExportDirty,
    });
  };
  useEffect(() => {
    editorSnapshotRef.current = view === 'edit' ? serializeEditorState() : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, kind]);
  const isDirty = () =>
    view === 'edit' && editorSnapshotRef.current != null && serializeEditorState() !== editorSnapshotRef.current;
  useImperativeHandle(ref, () => ({
    isDirty,
    // Persist the current draft exactly as "שמור תבנית" would (guards on canSave).
    saveDraft: async () => { if (canSave && !saving) await handleSave(); },
  }));

  const handleDelete = async (id) => {
    if (kind === 'topics') await deleteTemplate(id);
    else if (kind === 'participants') await deleteParticipantTemplate(id);
    else await deleteTypeTemplate(id); // for types `id` IS the discussionType (name)
    setConfirmDeleteId(null);
  };

  // Add a NEW discussion type = a new label on the account-level MANAGED
  // "סוג דיון" dropdown, created right here in the Templates tab (mirrors
  // CreateDiscussionModal.handleAddType). addDropdownLabel self-resolves the
  // managed column (persisted hint, else DETECTION via the managed-structure
  // self-heal), so this works on new installs AND on the current install (whose
  // type dropdown is a managed instance whose managedColumnId was never
  // persisted). Its notify() refreshes typeOptions so the new type shows in the
  // list without a reload; on failure the logger surfaces a toast and the typed
  // text is kept so the user can retry.
  const handleAddType = async (rawName) => {
    const nm = (rawName || '').trim();
    if (!nm || addingType) return;
    try {
      setAddingType(true);
      await addDropdownLabel({ boardKey: 'discussions', alias: 'discussionTypeID', title: nm });
      await assignRandomTypeColor(nm);
      setTypeSearch('');
      // round304 (owner spec) — creating the type is only the FIRST half of setting
      // it up, so land the user straight in its editor (בעלי תפקידים / אג'נדה /
      // תבנית ייצוא) instead of back on the list with a template-less type.
      setAddOpen(false);
      startEditType(nm);
    } catch (err) {
      logger.error('TemplateManagerModal', 'הוספת סוג דיון נכשלה', err);
    } finally {
      setAddingType(false);
    }
  };

  /*
   * round304 (owner spec) — rename the OPEN type template. Its name IS the "סוג
   * דיון" label, so the rename is: validate → rename the monday label (the write
   * that can actually fail) → re-key everything stored under the old name
   * (template, color, assignments, export assets). Existing discussions follow
   * automatically: a dropdown item stores the label ID, not its text.
   */
  const openRenameType = () => {
    setRenameName(draft?.discussionType || '');
    setRenameError(null);
    setRenameOpen(true);
  };
  const handleRenameType = async () => {
    if (renaming) return;
    // PR-review fix: the label rename and the stored-data migration are two writes.
    // When the label landed but the migration failed, `renamePendingRef` holds the
    // pair so "שמור שם" retries ONLY the migration — re-running the label rename
    // would now look up a name that no longer exists and refuse as a duplicate.
    const pending = renamePendingRef.current;
    if (pending) {
      setRenaming(true);
      setRenameError(null);
      try {
        await renameDiscussionType?.(pending.from, pending.to);
        renamePendingRef.current = null;
        setRenameOpen(false);
      } catch (err) {
        logger.error('TemplateManagerModal', 'השלמת שינוי שם סוג הדיון נכשלה', err);
        setRenameError(err?.message || 'שמירת נתוני התבנית נכשלה — נסו שוב');
      } finally {
        setRenaming(false);
      }
      return;
    }
    const current = draft?.discussionType || '';
    const check = validateTypeRename({
      oldName: current,
      newName: renameName,
      existingNames: typeOptions.map((o) => o.label),
    });
    if (!check.ok) { setRenameError(check.error); return; }
    if (check.unchanged) { setRenameOpen(false); return; }
    const labelId = typeOptions.find((o) => (o.label || '').trim() === current.trim())?.id;
    if (labelId == null) {
      setRenameError('הסוג לא נמצא בעמודת "סוג דיון" — רעננו ונסו שוב');
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      await renameDropdownLabel({
        boardKey: 'discussions', alias: 'discussionTypeID', labelId, title: check.name,
      });
    } catch (err) {
      // Nothing migrated yet — the old name is still the truth everywhere.
      logger.error('TemplateManagerModal', 'שינוי שם סוג הדיון נכשל', err);
      setRenameError(err?.message || 'שינוי שם סוג הדיון נכשל');
      setRenaming(false);
      return;
    }
    // The TASKS board carries its own "סוג דיון" dropdown whose labels mirror these
    // BY TEXT (previous-tasks-by-type bridges the two independent columns), so it
    // must follow the rename or existing tasks drop out of that view. Best-effort:
    // the primary rename already succeeded, and when both columns are the same
    // MANAGED column this is a no-op (the label already carries the new text).
    try {
      await renameDropdownLabelByText({
        boardKey: 'tasks', alias: 'taskTypeID', fromTitle: current, title: check.name,
      });
    } catch (err) {
      logger.warn(
        'TemplateManagerModal',
        'שינוי שם הסוג בעמודת "סוג דיון" של לוח המשימות נכשל — משימות קיימות עשויות לא להופיע בתצוגת "משימות קודמות לפי סוג"',
        err
      );
    }
    try {
      await renameDiscussionType?.(current, check.name);
      setDraft((d) => (d ? { ...d, discussionType: check.name } : d));
      setRenameOpen(false);
    } catch (err) {
      // The label IS renamed — adopt the new name in the editor (monday is the
      // source of truth) and remember the migration so the retry above finishes it.
      renamePendingRef.current = { from: current, to: check.name };
      setDraft((d) => (d ? { ...d, discussionType: check.name } : d));
      setRenameName(check.name);
      logger.error('TemplateManagerModal', 'שינוי שם סוג הדיון: מיגרציית הנתונים נכשלה', err);
      setRenameError(err?.message || 'שמירת נתוני התבנית נכשלה — נסו שוב');
    } finally {
      setRenaming(false);
    }
  };

  // "צור" inside the add-type popup: create via the SAME managed-dropdown add
  // handler, then close. An exact-name match short-circuits (mirrors the search's
  // "already exists" behavior — no duplicate label is created).
  const handleAddFromPopup = async () => {
    const nm = addName.trim();
    if (!nm || addingType) return;
    const exists = typeOptions.some((opt) => (opt.label || '').trim().toLowerCase() === nm.toLowerCase());
    if (exists) return;
    await handleAddType(nm);
    setAddOpen(false);
  };

  const topicsTitle = view === 'list' ? 'תבניות דיון' : isNew ? 'תבנית חדשה' : 'עריכת תבנית';
  const participantsTitle = view === 'list' ? 'תבניות משתתפים' : isNew ? 'תבנית משתתפים חדשה' : 'עריכת תבנית משתתפים';
  const typesTitle = view === 'list' ? 'תבניות סוג דיון' : (draft?.discussionType || 'תבנית סוג דיון');
  const title = kind === 'topics' ? topicsTitle : kind === 'participants' ? participantsTitle : typesTitle;

  // Types tab: filtered options + whether to offer an inline "create <typed>"
  // row (monday-dropdown behavior: a search that matches no existing type — and
  // isn't an exact existing label — offers to create it from the typed text).
  const trimmedTypeSearch = typeSearch.trim();
  // Add-type popup: the trimmed typed name + whether that exact name already
  // exists (case-insensitive) — drives the "already exists" hint + disables "צור".
  const addTrimmed = addName.trim();
  const addExists = !!addTrimmed && typeOptions.some((opt) => (opt.label || '').trim().toLowerCase() === addTrimmed.toLowerCase());
  const filteredTypeOptions = typeOptions.filter(
    (opt) => !trimmedTypeSearch || (opt.label || '').toLowerCase().includes(trimmedTypeSearch.toLowerCase())
  );
  const showCreateType =
    !!trimmedTypeSearch
    && filteredTypeOptions.length === 0
    && !typeOptions.some((opt) => (opt.label || '').trim().toLowerCase() === trimmedTypeSearch.toLowerCase());

  return (
    <div className={styles.panel} dir="rtl">
      {view === 'edit' && (
        <div className={styles.panelHeader}>
          <button type="button" className={styles.backBtn} onClick={backToList} aria-label="חזרה">
            <ChevronLeft size={19} />
          </button>
          <h3 className={styles.title}>{title}</h3>
          {/* Types editor: a large color circle beside the name — click to open the
              monday ColorPicker (5-wide) in a popover. Shows the type name ONCE. */}
          {kind === 'types' && (
            <>
              <button
                ref={colorTriggerRef}
                type="button"
                className={styles.colorCircle}
                style={{ background: colorNameToCss(typeColorDraft || typeColorName(draft.discussionType)) }}
                onClick={openColorPopover}
                aria-label="בחירת צבע לסוג"
                aria-expanded={colorOpen}
              />
              {colorOpen && colorPos && createPortal(
                <div
                  ref={colorPopoverRef}
                  className={styles.colorPopover}
                  style={{ position: 'fixed', top: colorPos.top, left: colorPos.left, zIndex: 10000 }}
                >
                  <ColorPicker
                    value={[typeColorDraft || typeColorName(draft.discussionType)]}
                    onSave={(vals) => {
                      if (!vals || !vals[0]) return;
                      setTypeColorDraft(vals[0]);
                      setColorOpen(false);
                      // Persist the color IMMEDIATELY — it's a standalone per-type
                      // setting, independent of the template's topics/people (which
                      // gate the "שמור תבנית" button). So a color-only change takes
                      // effect + survives refresh even without saving a template.
                      setTypeColor(draft.discussionType, vals[0]);
                    }}
                    colorsList={MONDAY_COLOR_NAMES}
                    /* CRITICAL: isBlackListMode defaults to TRUE in @vibe/core, which
                       treats colorsList as colors to EXCLUDE — hiding everything and
                       rendering an empty picker. false = colorsList is a whitelist. */
                    isBlackListMode={false}
                    colorShape="circle"
                    colorSize="medium"
                    numberOfColorsInLine={5}
                    focusOnMount={false}
                  />
                </div>,
                document.body
              )}
              {/* round304 — the missing rename affordance: the type template's name
                  was only editable in monday's column settings until now. */}
              <button
                type="button"
                className={styles.renameBtn}
                onClick={openRenameType}
                aria-label="שינוי שם התבנית"
                title="שינוי שם התבנית"
              >
                <Pencil size={15} />
              </button>
            </>
          )}
        </div>
      )}

      {view === 'list' && (
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'types'}
            className={`${styles.tab} ${kind === 'types' ? styles.tabActive : ''}`}
            onClick={() => switchKind('types')}
          >
            תבנית לפי סוג דיון
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'topics'}
            className={`${styles.tab} ${kind === 'topics' ? styles.tabActive : ''}`}
            onClick={() => switchKind('topics')}
          >
            נושאים
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'participants'}
            className={`${styles.tab} ${kind === 'participants' ? styles.tabActive : ''}`}
            onClick={() => switchKind('participants')}
          >
            משתתפים
          </button>
        </div>
      )}

      <div className={styles.content}>
        {view === 'list' && kind === 'types' ? (
          loading ? (
            <div className={styles.empty}><Loader size={24} /></div>
          ) : (
            <>
              {/* Add a NEW discussion type — above the search AND reachable in the
                  empty state, so a fresh account with no types can seed the first
                  one. Opens a small popup to type the name; creating it adds a label
                  on the account MANAGED "סוג דיון" dropdown and the list refreshes
                  live (addDropdownLabel notify -> typeOptions). */}
              <button
                type="button"
                className={styles.addTypeBtn}
                disabled={addingType}
                onClick={() => { setAddName(''); setAddOpen(true); }}
              >
                {addingType ? <Loader size={16} /> : <Plus size={16} />}
                <span>הוסף סוג דיון חדש</span>
              </button>

              <div className={styles.searchWrap}>
                <Search className={styles.searchIcon} aria-hidden="true" />
                <input
                  ref={typeSearchRef}
                  type="text"
                  className={styles.search}
                  aria-label="חיפוש או הוספת סוג דיון"
                  placeholder="חיפוש סוג דיון…"
                  value={typeSearch}
                  onChange={(e) => setTypeSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && showCreateType) { e.preventDefault(); handleAddType(typeSearch); } }}
                />
              </div>

              {typeOptions.length === 0 && !trimmedTypeSearch ? (
                <div className={styles.empty}>
                  <Text type="text2" color="secondary">
                    עדיין אין סוגי דיון. הקלידו שם למעלה כדי ליצור סוג ראשון (או הוסיפו סוג ביצירת דיון), ואז תוכלו להגדיר תבנית לכל סוג.
                  </Text>
                </div>
              ) : (
                <div className={styles.list}>
                  {filteredTypeOptions.map((opt) => {
                const tpl = typeTemplates.find((t) => t.discussionType === opt.label);
                const hasTpl = !!tpl;
                return (
                  <div key={opt.id ?? opt.label} className={styles.listItem}>
                    <button type="button" className={styles.listItemMain} onClick={() => startEditType(opt.label)}>
                      <p className={styles.listItemName}>
                        <span className={styles.typeSwatch} style={{ background: typeColor(opt.label) }} />
                        {opt.label}
                      </p>
                      <p className={styles.listItemMeta}>
                        <span>
                          {hasTpl
                            ? `${tpl.topics.length} נושאים · ${(tpl.participants || []).length} משתתפים`
                            : 'ללא תבנית — הקליקו להגדרה'}
                        </span>
                      </p>
                    </button>
                    {hasTpl && (
                      confirmDeleteId === opt.label ? (
                        <div className={styles.confirmDelete}>
                          <span className={styles.confirmText}>למחוק?</span>
                          <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => handleDelete(opt.label)} aria-label="אישור מחיקה">
                            <Trash2 size={16} />
                          </button>
                          <button type="button" className={styles.iconBtn} onClick={() => setConfirmDeleteId(null)} aria-label="ביטול מחיקה">
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className={styles.listItemActions}>
                          <button type="button" className={styles.iconBtn} onClick={() => startEditType(opt.label)} aria-label="עריכה">
                            <Pencil size={16} />
                          </button>
                          <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => setConfirmDeleteId(opt.label)} aria-label="מחיקה">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )
                    )}
                  </div>
                );
                  })}
                  {showCreateType && (
                    <button
                      type="button"
                      className={styles.createTypeRow}
                      disabled={addingType}
                      onClick={() => handleAddType(typeSearch)}
                    >
                      {addingType
                        ? <Loader size={16} />
                        : <span className={styles.createTypePlus} aria-hidden="true">➕</span>}
                      <span>צור סוג דיון "{trimmedTypeSearch}"</span>
                    </button>
                  )}
                </div>
              )}
            </>
          )
        ) : view === 'list' ? (
          loading ? (
            <div className={styles.empty}><Loader size={24} /></div>
          ) : items.length === 0 ? (
            <div className={styles.empty}>
              <Text type="text2" color="secondary">
                {kind === 'topics'
                  ? 'עדיין אין תבניות. צרו תבנית ראשונה של נושאי דיון קבועים.'
                  : 'עדיין אין תבניות משתתפים. צרו תבנית ראשונה של קבוצת משתתפים קבועה.'}
              </Text>
            </div>
          ) : (
            <div className={styles.list}>
              {items.map((t) => (
                <div key={t.id} className={styles.listItem}>
                  <button type="button" className={styles.listItemMain} onClick={() => startEdit(t)}>
                    <p className={styles.listItemName}>{t.name}</p>
                    <p className={styles.listItemMeta}>
                      <span>
                        {kind === 'topics'
                          ? `${t.topics.length} נושאים · ${countPoints(t)} נקודות`
                          : `${(t.participants || []).length} משתתפים`}
                      </span>
                      {t.discussionType && (
                        <span className={styles.listItemType}>
                          <span className={styles.typeSwatch} style={{ background: typeColor(t.discussionType) }} />
                          {t.discussionType}
                        </span>
                      )}
                    </p>
                  </button>
                  {confirmDeleteId === t.id ? (
                    <div className={styles.confirmDelete}>
                      <span className={styles.confirmText}>למחוק?</span>
                      <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => handleDelete(t.id)} aria-label="אישור מחיקה">
                        <Trash2 size={16} />
                      </button>
                      <button type="button" className={styles.iconBtn} onClick={() => setConfirmDeleteId(null)} aria-label="ביטול מחיקה">
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className={styles.listItemActions}>
                      <button type="button" className={styles.iconBtn} onClick={() => startEdit(t)} aria-label="עריכה">
                        <Pencil size={16} />
                      </button>
                      <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => setConfirmDeleteId(t.id)} aria-label="מחיקה">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : kind === 'topics' ? (
          <>
            <div className={styles.nameTypeRow}>
              <div className={styles.nameCol}>
                <TextField value={draft.name} onChange={(v) => setName(v)} placeholder="שם התבנית" size="small" autoFocus />
              </div>
              <div className={styles.typeCol}>
                <TypeDropdown
                  value={draft.discussionType ?? null}
                  onChange={(name) => update((d) => ({ ...d, discussionType: name }))}
                  options={typeOptions}
                  colorFn={typeColor}
                  takenNames={new Set(templates.filter((t) => t.id !== draft.id && t.discussionType != null).map((t) => t.discussionType))}
                />
              </div>
            </div>

            <div className={styles.topicsWrap}>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onTopicsDragEnd}>
                <SortableContext items={draft.topics.map((t) => t._uid)} strategy={verticalListSortingStrategy}>
                  {draft.topics.map((topic) => (
                    <SortableTopicCard
                      key={topic._uid}
                      topic={topic}
                      sensors={sensors}
                      canRemove={draft.topics.length > 1}
                      onSetName={setTopicName}
                      onRemove={removeTopic}
                      onAddPoint={addPoint}
                      onRemovePoint={removePoint}
                      onSetPoint={setPoint}
                      onPointsDragEnd={onPointsDragEnd}
                      autoFocusPointUid={autoFocusPointUid}
                      onPointFocused={() => setAutoFocusPointUid(null)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>

            <Button kind="secondary" size="small" leftIcon={Plus} onClick={addTopic} className={styles.addTopicBtn}>
              הוסף נושא
            </Button>
          </>
        ) : kind === 'participants' ? (
          <>
            <div className={styles.nameTypeRow}>
              <div className={styles.nameCol}>
                <TextField value={pDraft.name} onChange={(v) => setPDraft((d) => ({ ...d, name: v }))} placeholder="שם התבנית" size="small" autoFocus />
              </div>
              <div className={styles.typeCol}>
                <TypeDropdown
                  value={pDraft.discussionType ?? null}
                  onChange={(name) => setPDraft((d) => ({ ...d, discussionType: name }))}
                  options={typeOptions}
                  colorFn={typeColor}
                  takenNames={new Set(participantTemplates.filter((t) => t.id !== pDraft.id && t.discussionType != null).map((t) => t.discussionType))}
                />
              </div>
            </div>

            <div className={styles.peopleRow}>
              {leadMapped && (
                <div className={styles.peopleCol}>
                  <Text type="text2" className={styles.label}>{roleTitle('discussionLeadID', 'מוביל דיון')}</Text>
                  <PersonPicker selected={pDraft.lead || []} onChange={(next) => setPDraft((d) => ({ ...d, lead: next }))} bordered />
                </div>
              )}
              {coordinatorMapped && (
                <div className={styles.peopleCol}>
                  <Text type="text2" className={styles.label}>{roleTitle('discussionCoordinatorID', 'מרכז דיון')}</Text>
                  <PersonPicker selected={pDraft.coordinator || []} onChange={(next) => setPDraft((d) => ({ ...d, coordinator: next }))} bordered />
                </div>
              )}
              {participantsMapped && (
                <div className={styles.peopleCol}>
                  <Text type="text2" className={styles.label}>{roleTitle('participantsID', 'משתתפים')}</Text>
                  <PersonPicker selected={pDraft.participants || []} onChange={(next) => setPDraft((d) => ({ ...d, participants: next }))} bordered />
                </div>
              )}
            </div>
          </>
        ) : (
          /* round256 — types editor as 3 sub-tabs: בעלי תפקידים / אג'נדה / תבנית
             ייצוא. The type name + color circle live in the header (shown once). */
          <>
            <div className={`${styles.tabs} ${styles.subTabs}`} role="tablist">
              <button
                type="button" role="tab" aria-selected={typeSubTab === 'roles'}
                className={`${styles.tab} ${typeSubTab === 'roles' ? styles.tabActive : ''}`}
                onClick={() => setTypeSubTab('roles')}
              >בעלי תפקידים</button>
              <button
                type="button" role="tab" aria-selected={typeSubTab === 'agenda'}
                className={`${styles.tab} ${typeSubTab === 'agenda' ? styles.tabActive : ''}`}
                onClick={() => setTypeSubTab('agenda')}
              >אג'נדה</button>
              <button
                type="button" role="tab" aria-selected={typeSubTab === 'export'}
                className={`${styles.tab} ${typeSubTab === 'export' ? styles.tabActive : ''}`}
                onClick={() => setTypeSubTab('export')}
              >תבנית ייצוא</button>
            </div>

            {typeSubTab === 'roles' && (
              <>
                <div className={styles.peopleRow}>
                  {leadMapped && (
                    <div className={styles.peopleCol}>
                      <Text type="text2" className={styles.label}>{roleTitle('discussionLeadID', 'מוביל דיון')}</Text>
                      <PersonPicker selected={typeLead} onChange={setTypeLead} bordered />
                    </div>
                  )}
                  {coordinatorMapped && (
                    <div className={styles.peopleCol}>
                      <Text type="text2" className={styles.label}>{roleTitle('discussionCoordinatorID', 'מרכז דיון')}</Text>
                      <PersonPicker selected={typeCoordinator} onChange={setTypeCoordinator} bordered />
                    </div>
                  )}
                  {participantsMapped && (
                    <div className={styles.peopleCol}>
                      <Text type="text2" className={styles.label}>{roleTitle('participantsID', 'משתתפים')}</Text>
                      <PersonPicker selected={typeParticipants} onChange={setTypeParticipants} bordered />
                    </div>
                  )}
                </div>

                {/* Item 18 — per-type default decider toggle. */}
                <label className={styles.deciderDefaultRow}>
                  <input
                    type="checkbox"
                    className={styles.deciderDefaultCheckbox}
                    checked={typeDeciderIsLead}
                    onChange={(e) => setTypeDeciderIsLead(e.target.checked)}
                  />
                  <span className={styles.deciderDefaultLabel}>בהחלטה חדשה, המחליט כברירת מחדל הוא מנהל הדיון</span>
                </label>
              </>
            )}

            {typeSubTab === 'agenda' && (
              <>
                <Text type="text2" className={styles.sectionLabel}>נושאים קבועים</Text>
                <div className={styles.topicsWrap}>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onTopicsDragEnd}>
                    <SortableContext items={draft.topics.map((t) => t._uid)} strategy={verticalListSortingStrategy}>
                      {draft.topics.map((topic) => (
                        <SortableTopicCard
                          key={topic._uid}
                          topic={topic}
                          sensors={sensors}
                          canRemove={draft.topics.length > 1}
                          onSetName={setTopicName}
                          onRemove={removeTopic}
                          onAddPoint={addPoint}
                          onRemovePoint={removePoint}
                          onSetPoint={setPoint}
                          onPointsDragEnd={onPointsDragEnd}
                          autoFocusPointUid={autoFocusPointUid}
                          onPointFocused={() => setAutoFocusPointUid(null)}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
                <Button kind="secondary" size="small" leftIcon={Plus} onClick={addTopic} className={styles.addTopicBtn}>
                  הוסף נושא
                </Button>
              </>
            )}

            {/* round256 — the export tab ALWAYS shows (no checkbox). It seeds from
                the system template by default; editing it here saves a template
                specific to this type (overriding the system at export time). */}
            {typeSubTab === 'export' && typeExportTemplate && (
              <div className={styles.typeExportFull}>
                <ExportTemplateTab
                  template={typeExportTemplate}
                  setTemplate={setTypeExportTemplateDirty}
                  assets={typeExportAssets}
                  setAssets={setTypeExportAssetsDirty}
                  assetError={typeExportAssetError}
                  previewModel={null}
                  previewModelKey={null}
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className={styles.footer}>
        {view === 'list' ? (
          kind !== 'types' ? (
            <Button kind="primary" size="small" leftIcon={Plus} onClick={startNew}>
              תבנית חדשה
            </Button>
          ) : <span />
        ) : (
          <div className={styles.footerEnd}>
            <Button kind="tertiary" size="small" onClick={backToList} disabled={saving}>ביטול</Button>
            <Button kind="primary" size="small" onClick={handleSave} loading={saving} disabled={!canSave || saving}>
              שמור תבנית
            </Button>
          </div>
        )}
      </div>

      {/* "סוג דיון חדש" popup — opened by the addTypeBtn. Portaled to body so it
          floats above the Settings modal (not clipped by the panel's scroll).
          Enter submits · Esc / ביטול closes · an existing exact-name match shows
          a hint + disables "צור" (mirrors the search's "already exists"). */}
      {addOpen && createPortal(
        <div
          className={styles.addOverlay}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setAddOpen(false); }}
        >
          <div className={styles.addCard} dir="rtl" role="dialog" aria-modal="true" aria-label="סוג דיון חדש">
            <h3 className={styles.addTitle}>סוג דיון חדש</h3>
            <input
              type="text"
              className={styles.addInput}
              autoFocus
              value={addName}
              placeholder="שם הסוג"
              aria-label="שם סוג הדיון"
              onChange={(e) => setAddName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleAddFromPopup(); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAddOpen(false); }
              }}
            />
            <div className={styles.addHint}>
              {addExists && (
                <Text type="text2" color="secondary">סוג בשם "{addTrimmed}" כבר קיים</Text>
              )}
            </div>
            <div className={styles.addActions}>
              <Button kind="tertiary" size="small" onClick={() => setAddOpen(false)} disabled={addingType}>
                ביטול
              </Button>
              <Button
                kind="primary"
                size="small"
                onClick={handleAddFromPopup}
                loading={addingType}
                disabled={!addTrimmed || addExists || addingType}
              >
                צור
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* round304 — "שינוי שם התבנית" popup (types editor). The name is the "סוג
          דיון" label, so the change also re-labels every existing discussion of
          this type — said plainly in the hint rather than left as a surprise. */}
      {renameOpen && createPortal(
        <div
          className={styles.addOverlay}
          onMouseDown={(e) => { if (e.target === e.currentTarget && !renaming) setRenameOpen(false); }}
        >
          <div className={styles.addCard} dir="rtl" role="dialog" aria-modal="true" aria-label="שינוי שם התבנית">
            <h3 className={styles.addTitle}>שינוי שם התבנית</h3>
            <input
              type="text"
              className={styles.addInput}
              autoFocus
              value={renameName}
              placeholder="שם התבנית"
              aria-label="שם התבנית"
              onChange={(e) => { setRenameName(e.target.value); setRenameError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleRenameType(); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!renaming) setRenameOpen(false); }
              }}
            />
            <div className={styles.addHint}>
              <Text type="text2" color={renameError ? 'negative' : 'secondary'}>
                {renameError || 'השם הוא גם שם סוג הדיון — השינוי יחול על כל הדיונים מסוג זה'}
              </Text>
            </div>
            <div className={styles.addActions}>
              <Button kind="tertiary" size="small" onClick={() => setRenameOpen(false)} disabled={renaming}>
                ביטול
              </Button>
              <Button
                kind="primary"
                size="small"
                onClick={handleRenameType}
                loading={renaming}
                disabled={!renameName.trim() || renaming}
              >
                שמור שם
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

export default TemplateManagerModal;
