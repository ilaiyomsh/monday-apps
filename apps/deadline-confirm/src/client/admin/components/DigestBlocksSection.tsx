// 0.15.0 — the summary email's BODY editor: ONE ordered list of blocks.
//
// Replaces the "מקבצי משימות" panel. A block is either free text (with
// block-level formatting) or a task cluster (מקבץ) carrying its own settings, and
// the ORDER of the list is both the order of the mail and the priority of the
// clusters — a task matching two clusters shows up only in the higher one.
//
// Two UI facts worth keeping:
//   * The mail contains NOTHING but these blocks. There is no hidden greeting or
//     footer any more, which is why an empty body reads as "empty mail" and the
//     hints say so out loud.
//   * The dynamic field is inserted AT THE CARET (insertAt), which is why the
//     text editor uses a native textarea with a ref rather than a Vibe TextField:
//     the caret position is the whole feature.

import { useRef, useState } from 'react';
import { Button, Dropdown, TextField } from '@vibe/core';
import type { ActionButton, BoardColumn, Direction, TextAlign } from '../types';
import { DIGEST_FONTS, DIGEST_TEXT_COLOR_PRESETS } from '../types';
import type { DigestBlockDraft, DigestClusterDraft, DigestDraft, DigestTextDraft } from '../draft';
import { digestClusters, newDigestCluster, newDigestTextBlock } from '../draft';
import {
  addBlock,
  canAddCluster,
  canAddText,
  moveBlock,
  patchBlock,
  removeBlock,
} from '../digest-block-ops';
import {
  MAX_DIGEST_BLOCKS,
  MAX_DIGEST_CLUSTERS,
  MAX_DIGEST_TEXT_LENGTH,
  NAME_TOKEN,
  insertAt,
} from '../digest-blocks';

interface Option {
  value: string;
  label: string;
}

interface Props {
  tasksColumns: BoardColumn[];
  tasksColumnsLoading: boolean;
  buttons: ActionButton[];
  digest: DigestDraft;
  onChange: (patch: Partial<DigestDraft>) => void;
}

const FONT_OPTIONS: Option[] = DIGEST_FONTS.map((f) => ({
  value: f,
  label: f === 'Default' ? 'ברירת מחדל (גופן המייל)' : f,
}));
const DIRECTION_OPTIONS: Array<{ value: Direction; label: string }> = [
  { value: 'rtl', label: 'ימין לשמאל' },
  { value: 'ltr', label: 'שמאל לימין' },
];
const ALIGN_OPTIONS: Array<{ value: TextAlign; label: string }> = [
  { value: 'right', label: 'ימין' },
  { value: 'center', label: 'מרכז' },
  { value: 'left', label: 'שמאל' },
];

const toOption = (value: string, label: string): Option => ({ value, label });
const findOption = (options: Option[], value: string | null) =>
  options.find((o) => o.value === value) ?? null;

const BLOCK_SUMMARY_MAX = 60;

/** One-line identifier shown while a block is collapsed — otherwise its content is invisible. */
function blockSummary(block: DigestBlockDraft): string {
  if (block.type === 'cluster') return block.title.trim() || 'ללא כותרת';
  const text = block.text.trim();
  if (!text) return '(ריק)';
  return text.length > BLOCK_SUMMARY_MAX ? `${text.slice(0, BLOCK_SUMMARY_MAX)}…` : text;
}

export function DigestBlocksSection({
  tasksColumns,
  tasksColumnsLoading,
  buttons,
  digest,
  onChange,
}: Props) {
  const blocks = digest.blocks;
  const clusterCount = digestClusters(digest).length;

  // Accordion state — pure UI, keyed by block id so it survives reordering and
  // is never part of the saved draft. Every block starts collapsed (owner
  // decision 2026-08-05): a config with several blocks otherwise renders all of
  // them open and buries "תצוגה מקדימה ושליחה" below the fold.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // All four go through digest-block-ops: moving a block moves the mail AND (for
  // clusters) the priority, which is exactly why that rule is tested rather than
  // inlined here.
  const onPatch = (index: number, next: DigestBlockDraft) =>
    onChange({ blocks: patchBlock(blocks, index, next) });
  const onRemove = (index: number) => onChange({ blocks: removeBlock(blocks, index) });
  const onMove = (index: number, delta: -1 | 1) => onChange({ blocks: moveBlock(blocks, index, delta) });
  const onAdd = (block: DigestBlockDraft) => {
    onChange({ blocks: addBlock(blocks, block) });
    // The block just added is the one exception to "collapsed by default" — the
    // operator opened it on purpose and needs to see it to fill it in.
    setExpandedIds((prev) => new Set(prev).add(block.id));
  };

  const dateOptions = tasksColumns.filter((c) => c.type === 'date').map((c) => toOption(c.id, c.title));
  const textOptions = tasksColumns.filter((c) => c.type === 'text').map((c) => toOption(c.id, c.title));
  const buttonOptions = buttons
    .filter((b) => b.name.trim().length > 0)
    .map((b) => toOption(b.id, b.name));

  /** Status labels of the column the cluster's FIRST button writes to. */
  const statusLabelOptionsFor = (buttonId: string | null): Option[] => {
    const button = buttons.find((b) => b.id === buttonId);
    if (!button) return [];
    const column = tasksColumns.find((c) => c.id === button.statusColumnId);
    return (column?.labels ?? []).map((l) => toOption(String(l.id), l.label));
  };

  return (
    <section className="dc-section">
      <h2>תוכן המייל — בלוקים</h2>
      <div className="dc-hint">
        המייל מורכב <b>רק</b> מהבלוקים כאן, לפי הסדר שלהם — אין שום טקסט קבוע מאחורי הקלעים.
        <br />
        <b>בלוק טקסט</b> — טקסט חופשי עם עיצוב בסיסי (כיוון, גופן, גודל, יישור, צבע, מודגש).
        <br />
        <b>בלוק מקבץ</b> — טבלת משימות: עמודת תאריך שקובעת "באיחור", תנאי סטטוס שקובע אילו משימות
        נכנסות, ותפריט סטטוס לעדכון מתוך המייל.
        <br />
        סדר הבלוקים קובע גם <b>עדיפות</b>: משימה שמתאימה לכמה מקבצים תופיע רק במקבץ הגבוה מביניהם.
        <br />
        בכל בלוק (וגם בנושא) אפשר לשבץ את השדה הדינמי <code>{NAME_TOKEN}</code> — שם המשתמש שהמייל
        נשלח אליו.
      </div>

      {blocks.length === 0 && (
        <div className="dc-error">אין בלוקים — מייל כזה יישלח ריק. הוסיפו לפחות בלוק מקבץ אחד.</div>
      )}

      {blocks.map((block, index) => {
        const isOpen = expandedIds.has(block.id);
        return (
          <div key={block.id} className="dc-card">
            <div className="dc-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                className="dc-block-toggle"
                aria-expanded={isOpen}
                onClick={() => toggleExpanded(block.id)}
              >
                <span className="dc-hint">
                  {isOpen ? '▾' : '▸'}{' '}
                  {block.type === 'text' ? `בלוק טקסט · ${index + 1}` : `בלוק מקבץ · ${index + 1}`}
                  {!isOpen && ` — ${blockSummary(block)}`}
                </span>
              </button>
              <span>
                <Button
                  size="xs"
                  kind="tertiary"
                  ariaLabel="העלאת הבלוק"
                  disabled={index === 0}
                  onClick={() => onMove(index, -1)}
                >
                  ▲
                </Button>
                <Button
                  size="xs"
                  kind="tertiary"
                  ariaLabel="הורדת הבלוק"
                  disabled={index === blocks.length - 1}
                  onClick={() => onMove(index, 1)}
                >
                  ▼
                </Button>
                <Button
                  size="xs"
                  kind="tertiary"
                  color="negative"
                  ariaLabel="הסרת הבלוק"
                  onClick={() => onRemove(index)}
                >
                  ✕
                </Button>
              </span>
            </div>

            {isOpen &&
              (block.type === 'text' ? (
                <TextBlockEditor
                  block={block}
                  onChange={(next) => onPatch(index, next)}
                />
              ) : (
                <ClusterBlockEditor
                  block={block}
                  tasksColumnsLoading={tasksColumnsLoading}
                  dateOptions={dateOptions}
                  textOptions={textOptions}
                  buttonOptions={buttonOptions}
                  statusOptions={statusLabelOptionsFor(block.buttonIds[0] ?? block.buttonId)}
                  onChange={(next) => onPatch(index, next)}
                />
              ))}
          </div>
        );
      })}

      <div className="dc-row">
        <Button
          kind={Button.kinds.SECONDARY}
          size="small"
          disabled={!canAddText(blocks)}
          onClick={() => onAdd(newDigestTextBlock())}
        >
          + בלוק טקסט
        </Button>
        <Button
          kind={Button.kinds.SECONDARY}
          size="small"
          disabled={!canAddCluster(blocks)}
          onClick={() => onAdd(newDigestCluster())}
        >
          + בלוק מקבץ
        </Button>
        <span className="dc-hint">
          {blocks.length}/{MAX_DIGEST_BLOCKS} בלוקים · {clusterCount}/{MAX_DIGEST_CLUSTERS} מקבצים
        </span>
      </div>
    </section>
  );
}

/**
 * One text block. The textarea is native (not a Vibe TextField) on purpose: the
 * "הוסף שם משתמש" button inserts at the CARET, so the component needs the
 * element's selection — and it restores the caret after the controlled re-render,
 * otherwise every insert would kick the cursor to the end of the text.
 */
function TextBlockEditor({
  block,
  onChange,
}: {
  block: DigestTextDraft;
  onChange: (next: DigestTextDraft) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const insertToken = () => {
    const el = ref.current;
    const start = el?.selectionStart ?? block.text.length;
    const end = el?.selectionEnd ?? start;
    const { text, caret } = insertAt(block.text, start, end);
    onChange({ ...block, text });
    // After React re-renders the controlled value.
    requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  };

  const tooLong = block.text.length > MAX_DIGEST_TEXT_LENGTH;

  return (
    <>
      <textarea
        ref={ref}
        className="dc-textarea"
        dir={block.direction}
        style={{
          fontFamily: block.font === 'Default' ? undefined : `'${block.font}', sans-serif`,
          fontSize: block.fontSize,
          textAlign: block.align,
          fontWeight: block.bold ? 'bold' : 'normal',
          color: block.color,
        }}
        value={block.text}
        placeholder="כתבו כאן את הטקסט שיופיע במייל…"
        onChange={(e) => onChange({ ...block, text: e.target.value })}
      />
      <div className="dc-row" style={{ alignItems: 'center' }}>
        <Button size="xs" kind="secondary" onClick={insertToken}>
          + הוסף שם משתמש
        </Button>
        <span className={tooLong ? 'dc-error' : 'dc-hint'}>
          {block.text.length}/{MAX_DIGEST_TEXT_LENGTH} תווים
          {block.text.trim().length === 0 && ' · בלוק ריק לא יישלח'}
        </span>
      </div>
      <div className="dc-row">
        <div className="dc-field" style={{ maxWidth: 150 }}>
          <label>כיוון</label>
          <Dropdown
            options={DIRECTION_OPTIONS}
            value={DIRECTION_OPTIONS.find((o) => o.value === block.direction)}
            onChange={(opt: { value: Direction } | null) =>
              onChange({ ...block, direction: opt?.value ?? 'rtl' })
            }
            clearable={false}
          />
        </div>
        <div className="dc-field" style={{ maxWidth: 230 }}>
          <label>גופן</label>
          <Dropdown
            options={FONT_OPTIONS}
            value={FONT_OPTIONS.find((o) => o.value === block.font)}
            onChange={(opt: Option | null) => onChange({ ...block, font: opt?.value ?? 'Default' })}
            clearable={false}
          />
        </div>
        <div className="dc-field" style={{ maxWidth: 120 }}>
          <label>גודל (10–32)</label>
          <TextField
            type="number"
            value={String(block.fontSize)}
            onChange={(value: string) => {
              const parsed = Number(value);
              onChange({
                ...block,
                fontSize:
                  Number.isInteger(parsed) && parsed >= 10 && parsed <= 32 ? parsed : block.fontSize,
              });
            }}
          />
        </div>
        <div className="dc-field" style={{ maxWidth: 140 }}>
          <label>יישור</label>
          <Dropdown
            options={ALIGN_OPTIONS}
            value={ALIGN_OPTIONS.find((o) => o.value === block.align)}
            onChange={(opt: { value: TextAlign } | null) =>
              onChange({ ...block, align: opt?.value ?? 'right' })
            }
            clearable={false}
          />
        </div>
        <div className="dc-field">
          <label>מודגש</label>
          <Button
            size="small"
            kind={block.bold ? 'primary' : 'secondary'}
            onClick={() => onChange({ ...block, bold: !block.bold })}
          >
            {block.bold ? 'מודגש ✓' : 'רגיל'}
          </Button>
        </div>
        <div className="dc-field">
          <label>צבע</label>
          <div className="dc-row" style={{ gap: 6 }}>
            {DIGEST_TEXT_COLOR_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`צבע ${color}`}
                onClick={() => onChange({ ...block, color })}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  background: color,
                  border: block.color === color ? '2px solid #0073ea' : '1px solid #d0d4e4',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/** One cluster block — the settings that used to live in "מקבצי משימות". */
function ClusterBlockEditor({
  block,
  tasksColumnsLoading,
  dateOptions,
  textOptions,
  buttonOptions,
  statusOptions,
  onChange,
}: {
  block: DigestClusterDraft;
  tasksColumnsLoading: boolean;
  dateOptions: Option[];
  textOptions: Option[];
  buttonOptions: Option[];
  statusOptions: Option[];
  onChange: (next: DigestClusterDraft) => void;
}) {
  const primaryButtonId = block.buttonIds[0] ?? block.buttonId;
  const selectedStatus = statusOptions.filter((o) =>
    block.includeStatusLabelIds.includes(Number(o.value))
  );
  const selectedButtons = buttonOptions.filter((o) => block.buttonIds.includes(o.value));

  return (
    <>
      <div className="dc-row">
        <div className="dc-field" style={{ minWidth: 280 }}>
          <label>כותרת המקבץ (מופיעה במייל)</label>
          <TextField
            value={block.title}
            placeholder="למשל: משימות שנדרש לסיים"
            onChange={(value: string) => onChange({ ...block, title: value })}
          />
        </div>
        <div className="dc-field">
          <label>עמודת תאריך (בלוח המשימות)</label>
          <Dropdown
            placeholder={tasksColumnsLoading ? 'טוען…' : 'בחרו עמודת תאריך'}
            options={dateOptions}
            value={findOption(dateOptions, block.dateColumnId)}
            onChange={(opt: Option | null) =>
              onChange({
                ...block,
                dateColumnId: opt?.value ?? null,
                // capture the board column title → email column header
                dateColumnTitle: opt?.label ?? '',
              })
            }
            clearable={false}
          />
        </div>
        <div className="dc-field" style={{ minWidth: 220 }}>
          <label>כפתורי פעולה (אפשרויות הסטטוס במייל)</label>
          <Dropdown
            multi
            multiline
            placeholder="בחרו כפתור אחד או יותר"
            options={buttonOptions}
            value={selectedButtons}
            onChange={(opts: Option[] | null) => {
              const buttonIds = (opts ?? []).map((o) => o.value);
              const nextPrimary = buttonIds[0] ?? null;
              const primaryChanged = nextPrimary !== primaryButtonId;
              onChange({
                ...block,
                buttonIds,
                buttonId: nextPrimary,
                // switching the primary button changes the status column → reset filter
                ...(primaryChanged ? { includeStatusLabelIds: [] } : {}),
              });
            }}
            clearable={false}
          />
        </div>
      </div>

      <div className="dc-row">
        <div className="dc-field" style={{ minWidth: 320, flex: 1 }}>
          <label>הצג רק משימות שהסטטוס שלהן (בעמודת הכפתור הראשון):</label>
          <Dropdown
            multi
            multiline
            placeholder={!primaryButtonId ? 'בחרו קודם כפתור פעולה' : 'בחרו סטטוסים שנכנסים למקבץ'}
            disabled={!primaryButtonId}
            options={statusOptions}
            value={selectedStatus}
            onChange={(opts: Option[] | null) =>
              onChange({ ...block, includeStatusLabelIds: (opts ?? []).map((o) => Number(o.value)) })
            }
            clearable={false}
          />
          <div className="dc-hint">
            רק משימות בסטטוסים שנבחרו יופיעו במקבץ — כך משימות שכבר טופלו (למשל "בוצע") לא ייכנסו.
            הכפתור הראשון קובע את עמודת הסטטוס לסינון; כל הכפתורים שנבחרו מופיעים בתפריט הנפתח במייל.
          </div>
        </div>
      </div>

      <div className="dc-row">
        <div className="dc-field" style={{ minWidth: 280 }}>
          <label>עמודת טקסט חובה (אופציונלי)</label>
          <Dropdown
            placeholder={
              tasksColumnsLoading
                ? 'טוען…'
                : textOptions.length === 0
                  ? 'אין עמודות טקסט בלוח'
                  : 'ללא — אין שדה טקסט'
            }
            disabled={tasksColumnsLoading || textOptions.length === 0}
            options={textOptions}
            value={findOption(textOptions, block.noteColumnId)}
            onChange={(opt: Option | null) =>
              onChange({
                ...block,
                noteColumnId: opt?.value ?? null,
                noteColumnTitle: opt?.label ?? '',
              })
            }
            clearable
          />
          <div className="dc-hint">
            כשבוחרים עמודה, כל שורה במקבץ מקבלת שדה טקסט במייל — <b>אי אפשר לסמן משימה בלי למלא
            אותו</b>. הערך נכתב לעמודה הזו ודורס את מה שהיה בה. ריק = אין שדה ואין חובה.
          </div>
        </div>
      </div>
    </>
  );
}
