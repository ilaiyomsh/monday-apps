import React, { useRef, useState } from 'react';
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
} from '../../utils/mondayApi/boards.config.js';
import { computeFloatingPosition } from '../../utils/overlayPlacement.js';
import { estimateAssetsBytes, EXPORT_ASSETS_MAX_BYTES } from '../../utils/exportAssets.js';
import ExportPreview from './ExportPreview.jsx';
import styles from './ExportTemplateTab.module.css';

const FONT_OPTIONS = Object.entries(EXPORT_FONTS).map(([value, f]) => ({ value, label: f.label, css: f.css }));

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
        <Toggle isSelected={section.enabled !== false} onChange={onToggle} ariaLabel={`הצג ${SECTION_NAMES[section.key] || section.key}`} />
        <span className={styles.sectionName}>{SECTION_NAMES[section.key] || section.key}</span>
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
      setSizeAlert(`הקובץ גדול מדי — סך הנכסים חורג מ-${(EXPORT_ASSETS_MAX_BYTES / 1024 / 1024).toFixed(0)}MB ולכן לא נטען.`);
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
  const patchBand = (band, patch) => setTemplate((prev) => ({ ...prev, [band]: { ...prev[band], ...patch } }));

  const onDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
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
                  {(metaSection.fields || []).map((f) => (
                    <div key={f.key} className={styles.metaFieldRow}>
                      <input type="checkbox" checked={f.enabled !== false} onChange={(e) => patchMetaField(f.key, { enabled: e.target.checked })} />
                      <TextField value={f.label || ''} onChange={(val) => patchMetaField(f.key, { label: val })} size="small" />
                    </div>
                  ))}
                </div>
              )}
            </SortableSectionRow>
          ))}
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
