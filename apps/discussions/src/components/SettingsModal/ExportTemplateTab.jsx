import React, { useEffect, useRef, useState } from 'react';
import { Button, ButtonGroup, Text, Toggle, TextField, TextArea, Dialog, DialogContentContainer } from '@vibe/core';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ChevronDown, Upload, Trash2 } from 'lucide-react';
import {
  EXPORT_HEADER_MODES,
  EXPORT_LOGO_POSITIONS,
  EXPORT_TEXT_ALIGN,
  EXPORT_FONTS,
  DEFAULT_EXPORT_FONT,
  PARTICIPANT_PART_NAME,
  PARTICIPANT_PART_TITLE,
  PARTICIPANT_CF_PREFIX,
  PARTICIPANT_SEPARATORS,
  RECORD_MARKERS,
  isPeopleMetaField,
  DEFAULT_PARTICIPANT_SEPARATOR,
} from '../../utils/mondayApi/boards.config.js';
import { resolveParticipantParts, resolvePeopleFormat, partCustomFieldId, resolveRecordMarker } from '../../utils/participantFormat.js';
import logger from '../../utils/logger.js';
import { fetchUserCustomFieldMetas } from '../../utils/mondayApi/userProfiles.js';
import { computeFloatingPosition } from '../../utils/overlayPlacement.js';
import { estimateAssetsBytes, EXPORT_ASSETS_MAX_BYTES } from '../../utils/exportAssets.js';
import ExportPreview from './ExportPreview.jsx';
import styles from './ExportTemplateTab.module.css';

const FONT_OPTIONS = Object.entries(EXPORT_FONTS).map(([value, f]) => ({ value, label: f.label, css: f.css }));

/*
 * round315 — the participants sub-editor of the מטא section. All four helpers are
 * PURE functions of the meta FIELD (the object holding label/enabled/perLine/parts)
 * so the composition can be tested without mounting the editor, and so the same
 * rules hold in all three places this tab is rendered (Settings, a discussion
 * TYPE's template, the per-export dialog).
 */
/*
 * round316/round319 — the per-line checkbox governs every person in the document
 * now (משתתפים, מוביל דיון, מרכז דיון), so it is named for people rather than for
 * one row's role.
 */
const PER_LINE_LABEL = 'כל אדם בשורה נפרדת';

const PART_LABELS = {
  [PARTICIPANT_PART_NAME]: 'שם',
  [PARTICIPANT_PART_TITLE]: 'תפקיד (Title)',
};

/**
 * The rows to render: the SELECTED parts in their stored order first, then every
 * remaining available part. `metas` are the account's custom profile fields
 * ([{ id, title }]); a selected part whose meta is gone keeps its stored label so
 * the owner can still see and remove it instead of finding a bare id.
 */
export function participantPartRows(field, metas = []) {
  const selected = resolveParticipantParts(field);
  const available = [
    { key: PARTICIPANT_PART_NAME, label: PART_LABELS[PARTICIPANT_PART_NAME] },
    { key: PARTICIPANT_PART_TITLE, label: PART_LABELS[PARTICIPANT_PART_TITLE] },
    ...(Array.isArray(metas) ? metas : []).map((m) => ({
      key: `${PARTICIPANT_CF_PREFIX}${m.id}`,
      label: m.title || String(m.id),
    })),
  ];
  const labelFor = (part) => {
    const hit = available.find((a) => a.key === part.key);
    if (hit) return hit.label;
    return part.label || PART_LABELS[part.key] || partCustomFieldId(part.key) || part.key;
  };
  const rows = selected.map((part, idx) => ({
    key: part.key,
    label: labelFor(part),
    selected: true,
    sep: typeof part.sep === 'string' ? part.sep : DEFAULT_PARTICIPANT_SEPARATOR,
    first: idx === 0,
    canUp: idx > 0,
    canDown: idx < selected.length - 1,
  }));
  const taken = new Set(selected.map((p) => p.key));
  available.forEach((a) => {
    if (taken.has(a.key)) return;
    rows.push({ key: a.key, label: a.label, selected: false, sep: DEFAULT_PARTICIPANT_SEPARATOR, first: false, canUp: false, canDown: false });
  });
  return rows;
}

/** Add a part at the END of the composition, or remove it. Pure. */
export function toggleParticipantPart(field, key, label = '') {
  const parts = resolveParticipantParts(field);
  const has = parts.some((p) => p.key === key);
  const next = has
    ? parts.filter((p) => p.key !== key)
    : [...parts, { key, sep: DEFAULT_PARTICIPANT_SEPARATOR, ...(label ? { label } : {}) }];
  // An empty composition would export a list of blank lines; the resolver already
  // falls back to the name, and storing that explicitly keeps the UI honest.
  return { ...field, parts: next };
}

/** Move a part one step within the composition (dir -1 up / +1 down). Pure. */
export function moveParticipantPart(field, key, dir) {
  const parts = resolveParticipantParts(field);
  const from = parts.findIndex((p) => p.key === key);
  const to = from + (dir < 0 ? -1 : 1);
  if (from < 0 || to < 0 || to >= parts.length) return field;
  const next = parts.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { ...field, parts: next };
}

/** Set the separator written BEFORE one part. Pure. */
export function setParticipantPartSep(field, key, sep) {
  const parts = resolveParticipantParts(field);
  if (!parts.some((p) => p.key === key)) return field;
  return { ...field, parts: parts.map((p) => (p.key === key ? { ...p, sep: typeof sep === 'string' ? sep : DEFAULT_PARTICIPANT_SEPARATOR } : p)) };
}

// Font picker built on @vibe Dialog (like the status/priority pickers) so its
// menu is PORTALLED and never clipped by the Settings modal's overflow. Opens
// upward by default; each option previews in its own font.
function FontPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState('bottom-start');
  const triggerRef = useRef(null);
  const current = FONT_OPTIONS.find((o) => o.value === value) || FONT_OPTIONS[0];

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = computeFloatingPosition({
      anchorRect: rect,
      preferred: 'bottom-start',
      popupWidth: 240,
      popupHeight: Math.min(320, FONT_OPTIONS.length * 40 + 16),
      offset: 4,
    });
    if (next?.placement) setPosition(next.placement);
  };

  return (
    <Dialog
      open={open}
      showTrigger={['click']}
      hideTrigger={['clickoutside', 'esc']}
      onDialogDidShow={() => { updatePosition(); setOpen(true); }}
      onDialogDidHide={() => setOpen(false)}
      position={position}
      zIndex={10000}
      content={() => (
        <DialogContentContainer>
          <div className={styles.fontMenu}>
            {FONT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`${styles.fontOption} ${o.value === value ? styles.fontOptionActive : ''}`}
                style={{ fontFamily: o.css }}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </DialogContentContainer>
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.fontTrigger}
        onMouseDown={updatePosition}
        style={{ fontFamily: current.css }}
      >
        <span>{current.label}</span>
        <ChevronDown size={16} />
      </button>
    </Dialog>
  );
}

const SECTION_NAMES = {
  meta: 'פרטי דיון',
  // round219 — the רקע (background) box from the Topics tab's triple box.
  background: 'רקע',
  topics: 'נושאים לדיון',
  summary: 'סיכום',
  // round200 — the References box from the Topics tab.
  references: 'התייחסויות',
  tasks: 'משימות',
  // round192 — decisions section (owner request).
  decisions: 'החלטות',
  // round203 — the "פתיחה" (freeText) section was retired (owner request).
};

const POS_OPTIONS = [
  { value: EXPORT_LOGO_POSITIONS.RIGHT, text: 'ימין' },
  { value: EXPORT_LOGO_POSITIONS.CENTER, text: 'מרכז' },
  { value: EXPORT_LOGO_POSITIONS.LEFT, text: 'שמאל' },
];
const ALIGN_OPTIONS = POS_OPTIONS; // same right/center/left choices

// Read a File as a base64 data URI (logos) or bare base64 (docx template).
function readAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(file);
  });
}
function stripDataPrefix(dataUri) {
  const i = String(dataUri).indexOf('base64,');
  return i >= 0 ? String(dataUri).slice(i + 7) : String(dataUri);
}

/*
 * round320 (owner request) — the ROWS inside "פרטי הדיון" reorder like the sections
 * do. One DndContext carries both lists, so a row's drag id is namespaced: a bare
 * key would collide with a section of the same name, and dnd-kit would happily
 * report a section as the drop target of a row.
 */
export const META_FIELD_DRAG_PREFIX = 'metafield:';

/**
 * Move one meta row to another's position. Pure, and a no-op — returning the SAME
 * template object — for a drop on itself or on anything that is not a row here,
 * which is how the shared drag handler tells "not mine" from "moved".
 *
 * @param {object} template
 * @param {string} fromKey the row being dragged
 * @param {string} toKey the row it was dropped on
 */
export function reorderMetaFields(template, fromKey, toKey) {
  if (!template || fromKey === toKey) return template;
  const sections = Array.isArray(template.sections) ? template.sections : [];
  const meta = sections.find((s) => s?.key === 'meta');
  const fields = Array.isArray(meta?.fields) ? meta.fields : null;
  if (!fields) return template;
  const from = fields.findIndex((f) => f?.key === fromKey);
  const to = fields.findIndex((f) => f?.key === toKey);
  if (from < 0 || to < 0) return template;
  return {
    ...template,
    sections: sections.map((s) => (s.key === 'meta' ? { ...s, fields: arrayMove(fields, from, to) } : s)),
  };
}

/** One row of פרטי הדיון: grip, enabled checkbox, editable label. */
function SortableMetaFieldRow({ field, onToggle, onLabel, onMarker }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${META_FIELD_DRAG_PREFIX}${field.key}`,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className={styles.metaFieldRow}>
      <button
        type="button"
        className={styles.grip}
        data-meta-field-grip={field.key}
        {...attributes}
        {...listeners}
        aria-label={`גרור לשינוי סדר ${field.label || field.key}`}
      >
        <GripVertical size={14} />
      </button>
      <input type="checkbox" checked={field.enabled !== false} onChange={(e) => onToggle(e.target.checked)} />
      <TextField value={field.label || ''} onChange={onLabel} size="small" />
      {/* round357 (owner spec) — the marker written to the RIGHT of each record, per
          people component: מוביל דיון can be bulleted while משתתפים is numbered. Only
          people rows have records, and only line-per-person mode shows them. */}
      {isPeopleMetaField(field.key) && (
        <select
          className={styles.partSep}
          value={resolveRecordMarker(field)}
          onChange={(e) => onMarker(e.target.value)}
          aria-label={`סימן לכל רשומה ב-${field.label || field.key}`}
        >
          {RECORD_MARKERS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function SortableSectionRow({ section, onToggle, onExpandToggle, expanded, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.key });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const expandable = section.key === 'meta';
  return (
    <div ref={setNodeRef} style={style} className={styles.sectionWrap}>
      <div className={styles.sectionRow}>
        <button type="button" className={styles.grip} {...attributes} {...listeners} aria-label="גרור לשינוי סדר">
          <GripVertical size={16} />
        </button>
        {/* round219 — name first (leading/right), toggle to its LEFT; the toggle
            reads "כן/לא" instead of on/off, and the row is compact so every
            component fits on one screen without scrolling. */}
        <span className={styles.sectionName}>{SECTION_NAMES[section.key] || section.key}</span>
        <Toggle
          isSelected={section.enabled !== false}
          onChange={onToggle}
          onOverrideText="כן"
          offOverrideText="לא"
          ariaLabel={`הצג ${SECTION_NAMES[section.key] || section.key}`}
        />
        {expandable && (
          <button type="button" className={`${styles.expandBtn} ${expanded ? styles.expandOpen : ''}`} onClick={onExpandToggle} aria-label="עוד">
            <ChevronDown size={16} />
          </button>
        )}
      </div>
      {expandable && expanded && <div className={styles.subPanel}>{children}</div>}
    </div>
  );
}

/**
 * Export Template editor tab. Edits the per-instance `template` (draft, seeded
 * from DEFAULT_EXPORT_TEMPLATE by SettingsModal) plus `assets` (logo images /
 * uploaded .docx, stored under a separate key). The parent persists both on Save.
 *
 * Deliberately controls-only: no eyebrow section titles, no hint/explanation text.
 */
export default function ExportTemplateTab({ template, setTemplate, assets, setAssets, assetError, previewModel = null, previewModelKey = null }) {
  const headerLogoRef = useRef(null);
  const footerLogoRef = useRef(null);
  const templateDocxRef = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const sections = Array.isArray(template?.sections) ? template.sections : [];
  const headerMode = template?.headerMode || EXPORT_HEADER_MODES.CONFIG;
  const isConfig = headerMode !== EXPORT_HEADER_MODES.UPLOAD;
  const [expandedKey, setExpandedKey] = React.useState(null);
  // Immediate over-quota alert on upload (replaces the old usage bar). The total
  // assets bundle (logos + uploaded .docx) must stay under the 6MB storage quota.
  const [sizeAlert, setSizeAlert] = useState(null);
  const exceedsBudget = (nextAssets) => {
    if (estimateAssetsBytes(nextAssets) > EXPORT_ASSETS_MAX_BYTES) {
      const msg = `הקובץ גדול מדי — סך הנכסים חורג מ-${(EXPORT_ASSETS_MAX_BYTES / 1024 / 1024).toFixed(0)}MB ולכן לא נטען.`;
      setSizeAlert(msg);
      // round358 — the inline alert renders at the BOTTOM of a long scrolling column,
      // below the fold on most screens, so a rejected upload read as "nothing
      // happened". logger.error routes to the global toast — the rejection is now
      // impossible to miss. (A stale templateDocx from "קובץ תבנית" mode still counts
      // against the budget even in "עיצוב כאן", which is how a small logo can trip it.)
      logger.error('ExportTemplateTab', msg);
      return true;
    }
    return false;
  };

  const patchTemplate = (patch) => setTemplate((prev) => ({ ...prev, ...patch }));
  const patchSection = (key, patch) =>
    setTemplate((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    }));
  const patchMetaField = (fieldKey, patch) =>
    setTemplate((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.key === 'meta'
          ? { ...s, fields: (s.fields || []).map((f) => (f.key === fieldKey ? { ...f, ...patch } : f)) }
          : s
      ),
    }));
  // round319 — the ONE people format (was round315's per-field copy). `…With` derives
  // the next value from the LIVE one via a pure helper; passing a pre-computed object
  // would write back a snapshot from render time.
  const patchPeople = (patch) =>
    setTemplate((prev) => ({ ...prev, people: { ...resolvePeopleFormat(prev), ...patch } }));
  const patchPeopleWith = (fn) =>
    setTemplate((prev) => ({ ...prev, people: fn(resolvePeopleFormat(prev)) }));
  const patchBand = (band, patch) => setTemplate((prev) => ({ ...prev, [band]: { ...prev[band], ...patch } }));

  const onDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // round320 — one context, two lists. A row's id carries the prefix; anything
    // else is a section. A row dropped on a SECTION (or the reverse) resolves to a
    // no-op rather than moving the wrong list.
    const isField = String(active.id).startsWith(META_FIELD_DRAG_PREFIX);
    if (isField) {
      if (!String(over.id).startsWith(META_FIELD_DRAG_PREFIX)) return;
      const strip = (id) => String(id).slice(META_FIELD_DRAG_PREFIX.length);
      setTemplate((prev) => reorderMetaFields(prev, strip(active.id), strip(over.id)));
      return;
    }
    setTemplate((prev) => {
      const keys = prev.sections.map((s) => s.key);
      const from = keys.indexOf(active.id);
      const to = keys.indexOf(over.id);
      if (from < 0 || to < 0) return prev;
      return { ...prev, sections: arrayMove(prev.sections, from, to) };
    });
  };

  const uploadLogo = async (band, file) => {
    if (!file) return;
    const dataUri = await readAsDataUri(file);
    const key = band === 'header' ? 'headerLogo' : 'footerLogo';
    if (exceedsBudget({ ...assets, [key]: dataUri })) return;
    setSizeAlert(null);
    setAssets((prev) => ({ ...prev, [key]: dataUri }));
    patchBand(band, { hasLogo: true });
  };
  const clearLogo = (band) => {
    setSizeAlert(null);
    setAssets((prev) => ({ ...prev, [band === 'header' ? 'headerLogo' : 'footerLogo']: null }));
    patchBand(band, { hasLogo: false });
  };
  const uploadTemplateDocx = async (file) => {
    if (!file) return;
    const dataUri = await readAsDataUri(file);
    const stripped = stripDataPrefix(dataUri);
    if (exceedsBudget({ ...assets, templateDocx: stripped })) return;
    setSizeAlert(null);
    setAssets((prev) => ({ ...prev, templateDocx: stripped }));
    patchTemplate({ hasTemplateDocx: true });
  };
  const clearTemplateDocx = () => {
    setAssets((prev) => ({ ...prev, templateDocx: null }));
    patchTemplate({ hasTemplateDocx: false });
  };

  const metaSection = sections.find((s) => s.key === 'meta');

  /*
   * round315 — the account's user-profile custom fields, loaded once when this tab
   * mounts. Empty on failure (logged in userProfiles.js), which leaves the owner
   * with שם + תפקיד — the feature degrades, it does not break the editor.
   */
  const [cfMetas, setCfMetas] = useState([]);
  useEffect(() => {
    let alive = true;
    // The rejection path was floating (error-guard, caught on this round's edit):
    // userProfiles.js already logs the failure, but an unhandled rejection still
    // reached the global handler as a second, contextless report. Swallowing is not
    // an option either — this records WHERE it was swallowed and why that is safe.
    fetchUserCustomFieldMetas()
      .then((list) => { if (alive) setCfMetas(list || []); })
      .catch((err) => {
        logger.warn('ExportTemplateTab', 'טעינת שדות הפרופיל נכשלה; נשארים עם שם + תפקיד', err);
      });
    return () => { alive = false; };
  }, []);

  /*
   * round319 (owner request) — ONE "אנשים" block for the whole document, replacing
   * round316's block per people row. The format is a property of "a person", not of
   * the column they came from, so it is configured once and applies to משתתפים,
   * מוביל דיון and מרכז דיון alike.
   */
  const renderPeopleFormat = () => {
    const people = resolvePeopleFormat(template);
    const rows = participantPartRows(people, cfMetas);
    return (
      <div className={styles.participantParts} data-people-field="all">
        <Text type="text2" weight="medium">אנשים</Text>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={people.perLine === true}
            onChange={(e) => patchPeople({ perLine: e.target.checked })}
          />
          <span>{PER_LINE_LABEL}</span>
        </label>
        {/* The externals are free text with no monday profile, so the parts above
            cannot apply to them — merged, they appear as the plain names typed. */}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={people.includeExternal === true}
            onChange={(e) => patchPeople({ includeExternal: e.target.checked })}
          />
          <span>משתתפים חיצוניים כחלק מרשימת המשתתפים</span>
        </label>
        {rows.map((row) => (
          <div key={row.key} className={styles.partRow}>
            <input
              type="checkbox"
              checked={row.selected}
              onChange={() => patchPeopleWith((live) => toggleParticipantPart(live, row.key, row.label))}
              aria-label={row.label}
            />
            <span className={styles.partLabel}>{row.label}</span>
            {row.selected && !row.first && (
              <select
                className={styles.partSep}
                value={row.sep}
                onChange={(e) => patchPeopleWith((live) => setParticipantPartSep(live, row.key, e.target.value))}
                aria-label={`מפריד לפני ${row.label}`}
              >
                {PARTICIPANT_SEPARATORS.map((s) => (
                  <option key={s.label} value={s.value}>{s.label}</option>
                ))}
              </select>
            )}
            {row.selected && (
              <span className={styles.partMove}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  disabled={!row.canUp}
                  onClick={() => patchPeopleWith((live) => moveParticipantPart(live, row.key, -1))}
                  aria-label={`הקדם את ${row.label}`}
                >↑</button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  disabled={!row.canDown}
                  onClick={() => patchPeopleWith((live) => moveParticipantPart(live, row.key, 1))}
                  aria-label={`אחר את ${row.label}`}
                >↓</button>
              </span>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderBand = (band) => {
    const cfg = template?.[band] || {};
    const logoRef = band === 'header' ? headerLogoRef : footerLogoRef;
    const logoData = band === 'header' ? assets?.headerLogo : assets?.footerLogo;
    return (
      <div className={styles.band}>
        <Text type="text2" weight="medium" className={styles.bandLabel}>
          {band === 'header' ? 'כותרת עליונה' : 'כותרת תחתונה'}
        </Text>

        <div className={styles.ctrlRow}>
          <input
            ref={logoRef}
            type="file"
            accept="image/png,image/jpeg,image/gif"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; uploadLogo(band, f); }}
          />
          {logoData ? (
            <div className={styles.logoChip}>
              <img src={logoData} alt="לוגו" className={styles.logoThumb} />
              <button type="button" className={styles.iconBtn} onClick={() => clearLogo(band)} aria-label="הסר לוגו"><Trash2 size={15} /></button>
            </div>
          ) : (
            <Button kind="secondary" size="small" leftIcon={Upload} onClick={() => logoRef.current?.click()}>לוגו</Button>
          )}
          <ButtonGroup
            options={POS_OPTIONS}
            value={cfg.logoPos || EXPORT_LOGO_POSITIONS.CENTER}
            onSelect={(v) => patchBand(band, { logoPos: v })}
            size="small"
            kind="secondary"
            disabled={!logoData}
          />
        </div>

        <TextArea
          placeholder="טקסט (מספר שורות)"
          value={cfg.text || ''}
          onChange={(e) => patchBand(band, { text: e.target.value })}
          rows={2}
        />
        <div className={styles.ctrlRow}>
          <ButtonGroup
            options={ALIGN_OPTIONS}
            value={cfg.textAlign || EXPORT_TEXT_ALIGN.CENTER}
            onSelect={(v) => patchBand(band, { textAlign: v })}
            size="small"
            kind="secondary"
          />
        </div>

        <div className={styles.checkRow}>
          {band === 'header' && (
            <label className={styles.check}>
              <input type="checkbox" checked={!!cfg.meta?.name} onChange={(e) => patchBand(band, { meta: { ...cfg.meta, name: e.target.checked } })} />
              <span>שם הדיון</span>
            </label>
          )}
          <label className={styles.check}>
            <input type="checkbox" checked={!!cfg.meta?.date} onChange={(e) => patchBand(band, { meta: { ...cfg.meta, date: e.target.checked } })} />
            <span>תאריך</span>
          </label>
          {band === 'footer' && (
            <label className={styles.check}>
              <input type="checkbox" checked={!!cfg.meta?.page} onChange={(e) => patchBand(band, { meta: { ...cfg.meta, page: e.target.checked } })} />
              <span>מספר עמוד</span>
            </label>
          )}
        </div>
      </div>
    );
  };

  const fontKey = template?.font || DEFAULT_EXPORT_FONT;

  return (
    <div className={styles.layout}>
      <div className={styles.controls}>
      <div className={styles.topRow}>
        <div className={styles.topCtrl}>
          <Text type="text3" color="secondary">כותרות</Text>
          <ButtonGroup
            options={[
              { value: EXPORT_HEADER_MODES.CONFIG, text: 'עיצוב כאן' },
              { value: EXPORT_HEADER_MODES.UPLOAD, text: 'קובץ תבנית' },
            ]}
            value={headerMode}
            onSelect={(v) => patchTemplate({ headerMode: v })}
            size="small"
            kind="secondary"
          />
        </div>
        <div className={styles.topCtrl}>
          <Text type="text3" color="secondary">גופן</Text>
          <div className={styles.fontDropdown}>
            <FontPicker value={fontKey} onChange={(v) => patchTemplate({ font: v })} />
          </div>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={sections.map((s) => s.key)} strategy={verticalListSortingStrategy}>
          <div className={styles.sectionList}>
          {sections.map((section) => (
            <SortableSectionRow
              key={section.key}
              section={section}
              expanded={expandedKey === section.key}
              onToggle={(val) => patchSection(section.key, { enabled: val })}
              onExpandToggle={() => setExpandedKey((k) => (k === section.key ? null : section.key))}
            >
              {section.key === 'meta' && metaSection && (
                <div className={styles.metaFields}>
                  {/* round320 — the rows carry their own SortableContext inside the
                      SAME DndContext as the sections (see onDragEnd's prefix split),
                      so "which line is top" is set by dragging, like everywhere else
                      in this tab. */}
                  <SortableContext
                    items={(metaSection.fields || []).map((f) => `${META_FIELD_DRAG_PREFIX}${f.key}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    {(metaSection.fields || []).map((f) => (
                      <SortableMetaFieldRow
                        key={f.key}
                        field={f}
                        onToggle={(enabled) => patchMetaField(f.key, { enabled })}
                        onLabel={(val) => patchMetaField(f.key, { label: val })}
                        onMarker={(val) => patchMetaField(f.key, { marker: val })}
                      />
                    ))}
                  </SortableContext>
                  {/* round319 (owner request) — ONE block, after the rows it governs:
                      how every person in the document is written (line each, which
                      profile parts in which order, the separator before each), and
                      whether the external participants join the משתתפים list. Was a
                      block per people row until round316. */}
                  {renderPeopleFormat()}
                </div>
              )}
            </SortableSectionRow>
          ))}
          </div>
        </SortableContext>
      </DndContext>

      {isConfig ? (
        <>
          {renderBand('header')}
          {renderBand('footer')}
        </>
      ) : (
        <div className={styles.band}>
          <input
            ref={templateDocxRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; uploadTemplateDocx(f); }}
          />
          {assets?.templateDocx ? (
            <div className={styles.fileChip}>
              <span className={styles.fileName}>קובץ תבנית נטען</span>
              <button type="button" className={styles.iconBtn} onClick={clearTemplateDocx} aria-label="הסר קובץ"><Trash2 size={15} /></button>
            </div>
          ) : (
            <Button kind="secondary" size="small" leftIcon={Upload} onClick={() => templateDocxRef.current?.click()}>העלה קובץ DOCX</Button>
          )}
        </div>
      )}

      {sizeAlert && <Text type="text3" color="negative">{sizeAlert}</Text>}
      {assetError && <Text type="text3" color="negative">{assetError}</Text>}
      </div>

      <div className={styles.previewCol}>
        <ExportPreview template={template} assets={assets} model={previewModel} modelKey={previewModelKey} />
      </div>
    </div>
  );
}
