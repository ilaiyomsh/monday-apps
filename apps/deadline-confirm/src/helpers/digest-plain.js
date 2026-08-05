// V6 text/plain digest renderer (docs/v6-amp-only-decisions.md §5), block-driven
// since 0.15.0.
//
// AMP for Email requires a fallback part — "AMP-only" means the second part
// becomes NON-ACTIONABLE, not absent. This renders that part from the SAME
// blocks the AMP part is built from, so the two can never say different things:
// text blocks as typed, cluster blocks as a task list. It must carry NO
// credential of any kind — no links, no signatures, no secret — leaving a
// /confirm-style link here would undo D2 and D3 entirely. No HTML either: this
// is the text/plain MIME part (the html fallback is DERIVED from this string,
// which is what keeps an operator's typed URL inert — it is escaped text there,
// never an anchor).
//
// Nothing in this file is content: no greeting, no instruction line, no closing
// sentence. Every sentence comes from a block (a config predating blocks is
// reconstructed into the 0.13.x sentences — services/digest-blocks.js).

import { applyTokens } from '../services/digest-blocks.js';

/** YYYY-MM-DD → DD/MM/YYYY (unset → ''). */
function formatDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return date;
  return `${d}/${m}/${y}`;
}

/**
 * @param {object} task
 * @param {Array<{ id: string, title: string }>} dateColumns
 * @param {string} sectionDateHeader
 * @returns {string[]}
 */
function datePartsForTask(task, dateColumns, sectionDateHeader) {
  if (Array.isArray(dateColumns) && dateColumns.length > 0 && task.dates && typeof task.dates === 'object') {
    const parts = [];
    for (const col of dateColumns) {
      const formatted = formatDate(task.dates[col.id]);
      if (formatted) parts.push(`${col.title || 'תאריך'}: ${formatted}`);
    }
    return parts;
  }
  const date = formatDate(task.date);
  return date ? [`${sectionDateHeader}: ${date}`] : [];
}

/**
 * One cluster as text: its title, then a line per task.
 * @param {object} section
 * @param {Array<{ id: string, title: string }>} dateColumns
 * @returns {string}
 */
function renderCluster(section, dateColumns) {
  const dateHeader =
    section.dateColumnTitle && section.dateColumnTitle.length > 0 ? section.dateColumnTitle : 'תאריך';
  const lines = [section.title];
  for (const task of section.tasks) {
    const parts = [`- ${task.name}`, ...datePartsForTask(task, dateColumns, dateHeader)];
    if (task.statusText) parts.push(`סטטוס: ${task.statusText}`);
    lines.push(parts.join(' · '));
  }
  return lines.join('\n');
}

/**
 * Resolve the blocks against this recipient — same rule as the AMP renderer:
 * clusters match by section id (never by position, since a recipient with no
 * tasks in a cluster has no section for it), and `blocks` absent means "the
 * clusters alone, in recipient order".
 *
 * @param {Array<object>|undefined} blocks
 * @param {object} recipient
 * @returns {Array<{ kind: 'text', block: object } | { kind: 'cluster', section: object }>}
 */
function resolveUnits(blocks, recipient) {
  const sections = recipient.sections ?? [];
  const hasTasks = (section) => Boolean(section?.tasks && section.tasks.length > 0);
  if (!Array.isArray(blocks)) {
    return sections.filter(hasTasks).map((section) => ({ kind: 'cluster', section }));
  }
  const byId = new Map();
  for (const section of sections) {
    const id = section.sectionId ?? section.id;
    if (typeof id === 'string' && id.length > 0 && !byId.has(id)) byId.set(id, section);
  }
  const units = [];
  for (const block of blocks) {
    if (block?.type === 'text') {
      units.push({ kind: 'text', block });
      continue;
    }
    if (block?.type !== 'cluster') continue;
    const section = byId.get(block.id);
    if (hasTasks(section)) units.push({ kind: 'cluster', section });
  }
  return units;
}

/**
 * Render one recipient's digest as plain text.
 *
 * @param {object} p
 * @param {{ name: string, dateColumns?: Array<{id:string,title:string}>,
 *          sections: Array<{ sectionId?: string, title: string, dateColumnTitle?: string,
 *          tasks: Array<{ itemId: string, name: string, date: string|null,
 *            dates?: Record<string, string|null>, statusText?: string }> }> }} p.recipient
 * @param {Array<object>} [p.blocks] normalized digest blocks; absent = clusters only
 * @returns {string}
 */
export function renderDigestPlain({ recipient, blocks }) {
  const dateColumns = recipient.dateColumns ?? [];
  const parts = [];

  for (const unit of resolveUnits(blocks, recipient)) {
    if (unit.kind === 'text') {
      const resolved = applyTokens(unit.block.text, { name: recipient.name });
      // An empty block would show up here as a pair of blank lines.
      if (resolved.trim().length === 0) continue;
      parts.push(resolved);
      continue;
    }
    parts.push(renderCluster(unit.section, dateColumns));
  }

  // One blank line between blocks — the only structure plain text has.
  return parts.join('\n\n');
}
