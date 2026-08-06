/*
 * round365 — the export document TITLE (owner spec, approved mockup).
 *
 * Three orderable parts — a fixed FREE TEXT, a discussion field, an optional
 * second field — with positional separators between them and an alignment.
 * The config lives on the export template (`template.title`, default in
 * boards.config.js DEFAULT_EXPORT_TEMPLATE) and rides the existing cascade:
 * system template → discussion-type snapshot → per-export ephemeral edit.
 *
 * This module is the PURE composition logic, in the participantFormat.js
 * style: a resolver that always returns a usable config (stored templates
 * predate the field), and a composer that turns config + export model into
 * the final title string.
 */
import { DEFAULT_EXPORT_TEMPLATE, EXPORT_TEXT_ALIGN } from './mondayApi/boards.config.js';

/** The discussion fields a title part can pull (model key per docxExport's buildDiscussionModel). */
export const TITLE_FIELD_OPTIONS = [
  { value: 'discussionName', label: 'שם הדיון', modelKey: 'title' },
  { value: 'discussionType', label: 'סוג הדיון', modelKey: 'typesText' },
  { value: 'discussionDate', label: 'תאריך הדיון (DD.MM.YYYY)', modelKey: 'dateText' },
  { value: 'discussionLead', label: 'מוביל הדיון', modelKey: 'leadText' },
];

export const TITLE_NONE_FIELD = 'none';

/** Positional separators between parts 1-2 and 2-3. */
export const TITLE_SEPARATORS = [
  { value: 'space', label: 'רווח', text: ' ' },
  { value: 'dash', label: 'מקף', text: ' - ' },
  { value: 'colon', label: 'נקודותיים', text: ': ' },
];

const TITLE_PART_KEYS = ['free', 'field2', 'field3'];

/**
 * Always-usable title config: the stored value merged over the shipped
 * default, with a REPAIRED order (exactly the three part keys, stored order
 * honored where valid — a corrupt order must never drop a part).
 */
export function resolveExportTitle(title) {
  const def = DEFAULT_EXPORT_TEMPLATE.title;
  const merged = { ...def, ...(title || {}) };
  // Repair the order: keep valid stored keys (first occurrence, in their stored
  // positions), then append whatever is missing — a corrupt order must never
  // drop a part of the title.
  const stored = Array.isArray(merged.order) ? merged.order : [];
  const seen = new Set();
  const order = stored.filter((k) => TITLE_PART_KEYS.includes(k) && !seen.has(k) && seen.add(k));
  for (const k of TITLE_PART_KEYS) if (!seen.has(k)) order.push(k);
  return { ...merged, order };
}

/** Separator text for a stored separator value (unknown → space). */
export function titleSeparatorText(sep) {
  return TITLE_SEPARATORS.find((s) => s.value === sep)?.text ?? ' ';
}

const fieldValue = (fieldKey, model) => {
  if (!fieldKey || fieldKey === TITLE_NONE_FIELD) return '';
  const opt = TITLE_FIELD_OPTIONS.find((o) => o.value === fieldKey);
  return opt ? String(model?.[opt.modelKey] ?? '').trim() : '';
};

/**
 * Compose the final title string from a config and the export MODEL
 * (docxExport's buildDiscussionModel output: title/typesText/dateText/leadText).
 * An empty part (blank free text, 'none' field, or a field the discussion has
 * no value for) drops out together with its separator.
 */
export function composeExportTitle(title, model) {
  const cfg = resolveExportTitle(title);
  const partText = (key) => (key === 'free' ? String(cfg.free ?? '').trim() : fieldValue(cfg[key], model));
  // Positional separators: sep12 follows position 1, sep23 follows position 2.
  // When a middle part is empty, the join uses the separator AFTER the last
  // part actually rendered (so "free[-]name date" with no name reads
  // "free - date", not "free date").
  const sepAfter = [titleSeparatorText(cfg.sep12), titleSeparatorText(cfg.sep23)];
  let out = '';
  let lastIdx = -1;
  cfg.order.forEach((key, i) => {
    const text = partText(key);
    if (!text) return;
    out = out ? out + sepAfter[lastIdx] + text : text;
    lastIdx = i;
  });
  // A document must never lose its title — an all-empty config falls back to
  // the discussion name (the pre-round365 behavior's core).
  return out || String(model?.title ?? '').trim();
}

/** The title's alignment ('right'|'center'|'left'), center by default. */
export function titleAlign(title) {
  const a = title?.align;
  return Object.values(EXPORT_TEXT_ALIGN).includes(a) ? a : EXPORT_TEXT_ALIGN.CENTER;
}

export default {
  TITLE_FIELD_OPTIONS,
  TITLE_NONE_FIELD,
  TITLE_SEPARATORS,
  resolveExportTitle,
  titleSeparatorText,
  composeExportTitle,
  titleAlign,
};
