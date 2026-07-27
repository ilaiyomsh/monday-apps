// V6 amp4email digest renderer (docs/v6-amp-only-decisions.md §3, §5, D9).
//
// Visual language ports the discussions monday-like table + LabelPickerCell
// (apps/discussions TaskTable / DecisionRow LabelPickerCell — statusFill +
// colored option menu). AMP for Email cannot host React/Vibe Dialog, so the
// picker menu is inlined in the "סטטוס חדש" cell as colored radio options.
//
// Layout: ONE table — name, every digest date column, current status fill,
// LabelPicker-style options, ONE global submit.
// Wire format unchanged:
//   hidden: a, p, m, s, sig
//   selection: radio name="item_<itemId>" value="<btnId>" (unchecked = no change)

import { escapeHtml } from './html.js';
import { buildManifest, signManifest, currentSlot } from '../services/manifest-signature.js';

const AMP_ENDPOINT_PATH = '/amp/confirm';
const DEFAULT_SEND_HOUR = 8;
const SUBMIT_LABEL = 'אשר את המסומנות';
const SUBMIT_COLOR = '#0073ea';
const NEUTRAL_STATUS = '#c4c4c4';

/** YYYY-MM-DD → DD/MM/YYYY (unset → ''). */
function formatDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return escapeHtml(date);
  return `${d}/${m}/${y}`;
}

/** Match current status text to an offered button color (discussions colorById). */
function colorForStatusText(statusText, buttons) {
  const text = (statusText ?? '').trim();
  if (!text) return NEUTRAL_STATUS;
  for (const button of buttons) {
    if (button.label === text) return button.color || NEUTRAL_STATUS;
  }
  return NEUTRAL_STATUS;
}

const STYLES = `
      body { margin:0; padding:14px 10px; background:#F5F6F8; font-family:Arial,Helvetica,sans-serif; color:#323338; }
      .wrap { max-width:820px; margin:0 auto; background:#ffffff; border:1px solid #E6E9EF; border-radius:8px; padding:18px; }
      .hi { font-size:18px; font-weight:bold; margin:0 0 6px; }
      .lead { font-size:14px; color:#676879; line-height:1.6; margin:0 0 14px; }
      table.board { width:100%; border-collapse:collapse; background:#ffffff; border:1px solid #E6E9EF; }
      th { font-size:13px; color:#676879; font-weight:500; text-align:right; padding:8px 10px; border-bottom:1px solid #E6E9EF; border-inline-end:1px solid #D0D4E4; background:#ffffff; }
      th:last-child { border-inline-end:none; }
      td { font-size:14px; padding:0 10px; border-bottom:1px solid #E6E9EF; border-inline-end:1px solid #D0D4E4; vertical-align:middle; min-height:40px; height:40px; }
      td:last-child { border-inline-end:none; }
      .name { text-align:right; padding-inline-start:14px; }
      .meta { color:#676879; font-size:13px; text-align:center; white-space:nowrap; }
      .status-cell { padding:0; width:120px; }
      .status-fill { display:block; text-align:center; color:#ffffff; font-size:14px; font-weight:normal; line-height:40px; min-height:40px; padding:0 8px; }
      .picker-cell { padding:8px; min-width:150px; vertical-align:top; }
      .picker { width:100%; }
      .opt { display:block; margin:0 0 6px; }
      .opt:last-child { margin-bottom:0; }
      .opt input { position:absolute; opacity:0; width:1px; height:1px; overflow:hidden; }
      .opt-fill { display:block; text-align:center; color:#ffffff; font-size:13px; font-weight:500; line-height:34px; min-height:34px; border-radius:4px; padding:0 10px; border:2px solid transparent; }
      .opt input:checked + .opt-fill { border-color:#323338; box-shadow:inset 0 0 0 1px #ffffff; }
      .go { margin:14px 0 4px; }
      .send { color:#ffffff; border:0; border-radius:8px; padding:11px 18px; font-size:14px; font-weight:bold; }
      .ok { margin:10px 0 2px; padding:9px 12px; border-radius:8px; background:#E6F7EF; color:#00754A; font-size:13px; }
      .err { margin:10px 0 2px; padding:9px 12px; border-radius:8px; background:#FDECEE; color:#B4222F; font-size:13px; }
      .foot { font-size:12px; color:#9699A6; line-height:1.6; border-top:1px solid #E6E9EF; padding-top:12px; margin-top:8px; }
`;

/**
 * Unique buttons from populated sections, in first-seen order.
 * @param {Array<object>} sections
 * @returns {Array<{ id: string, label: string, color: string }>}
 */
function collectButtons(sections) {
  /** @type {Array<{ id: string, label: string, color: string }>} */
  const buttons = [];
  const seen = new Set();
  for (const section of sections) {
    if (!section.tasks || section.tasks.length === 0) continue;
    const button = section.button ?? {};
    const id = section.buttonId ?? button.id ?? '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = button.targetLabel || button.name || 'עדכן';
    const color = button.style?.color || NEUTRAL_STATUS;
    buttons.push({ id, label, color });
  }
  return buttons;
}

/**
 * Date columns shown in the table — prefer recipient.dateColumns (from digest
 * settings); fall back to unique titles from populated sections.
 * @param {object} recipient
 * @returns {Array<{ id: string, title: string }>}
 */
function resolveDateColumns(recipient) {
  if (Array.isArray(recipient.dateColumns) && recipient.dateColumns.length > 0) {
    return recipient.dateColumns.map((c) => ({
      id: String(c.id),
      title: c.title && String(c.title).length > 0 ? String(c.title) : 'תאריך',
    }));
  }
  /** @type {Array<{ id: string, title: string }>} */
  const cols = [];
  const seen = new Set();
  for (const section of recipient.sections ?? []) {
    if (!section.tasks || section.tasks.length === 0) continue;
    const title = section.dateColumnTitle && section.dateColumnTitle.length > 0 ? section.dateColumnTitle : 'תאריך';
    const id = section.dateColumnId || title;
    if (seen.has(id)) continue;
    seen.add(id);
    cols.push({ id, title });
  }
  return cols;
}

/**
 * Flatten tasks across sections: one row per itemId, union of offered button ids.
 * @param {Array<object>} sections
 * @returns {Array<{ task: object, buttonIds: Set<string> }>}
 */
function flattenTasks(sections) {
  /** @type {Map<string, { task: object, buttonIds: Set<string> }>} */
  const byId = new Map();
  for (const section of sections) {
    if (!section.tasks || section.tasks.length === 0) continue;
    const btnId = section.buttonId ?? section.button?.id ?? '';
    for (const task of section.tasks) {
      const itemId = String(task.itemId);
      let row = byId.get(itemId);
      if (!row) {
        row = {
          task: {
            ...task,
            dates: task.dates && typeof task.dates === 'object' ? { ...task.dates } : {},
          },
          buttonIds: new Set(),
        };
        byId.set(itemId, row);
      } else if (task.dates && typeof task.dates === 'object') {
        row.task.dates = { ...row.task.dates, ...task.dates };
      }
      if (btnId) row.buttonIds.add(btnId);
    }
  }
  return [...byId.values()];
}

function renderStatusFill(statusText, buttons) {
  const text = (statusText ?? '').trim();
  const color = colorForStatusText(text, buttons);
  const label = text || '—';
  return `<span class="status-fill" style="background:${escapeHtml(color)}">&#8207;${escapeHtml(label)}</span>`;
}

/**
 * Inlined LabelPicker menu: colored options (discussions decMenuOption / statusOption).
 * Unchecked radios omit the field → no change for that task.
 */
function renderLabelPicker({ task, buttonIds, buttons }) {
  const fieldName = escapeHtml(`item_${task.itemId}`);
  const options = buttons
    .filter((button) => buttonIds.has(button.id))
    .map((button) => {
      const boxId = escapeHtml(`sel_${button.id}_${task.itemId}`);
      const color = escapeHtml(button.color || NEUTRAL_STATUS);
      return `              <label class="opt" for="${boxId}">
                <input type="radio" name="${fieldName}" value="${escapeHtml(button.id)}" id="${boxId}">
                <span class="opt-fill" style="background:${color}">&#8207;${escapeHtml(button.label)}</span>
              </label>`;
    })
    .join('\n');
  return `            <td class="picker-cell"><div class="picker">
${options}
            </div></td>`;
}

function renderRow({ task, buttonIds, buttons, dateColumns }) {
  const dateCells = dateColumns
    .map((col) => {
      const raw =
        task.dates && Object.prototype.hasOwnProperty.call(task.dates, col.id)
          ? task.dates[col.id]
          : dateColumns.length === 1
            ? task.date
            : null;
      return `              <td class="meta">${formatDate(raw) || '—'}</td>`;
    })
    .join('\n');

  return `            <tr>
              <td class="name">&#8207;${escapeHtml(task.name)}</td>
${dateCells}
              <td class="status-cell">${renderStatusFill(task.statusText, buttons)}</td>
${renderLabelPicker({ task, buttonIds, buttons })}
            </tr>`;
}

/**
 * Build the signed-manifest bundle for the single form in one message.
 * @param {{ secret: string, accountId: string, personId: string, recipient: object, sendHour: number, now: Date }} p
 */
function buildSignedManifest({ secret, accountId, personId, recipient, sendHour, now }) {
  /** @type {Array<{ itemId: string, btnId: string }>} */
  const pairs = [];
  for (const section of recipient.sections) {
    if (section.tasks.length === 0) continue;
    const btnId = section.buttonId ?? section.button?.id ?? '';
    for (const task of section.tasks) {
      pairs.push({ itemId: String(task.itemId), btnId });
    }
  }
  const manifest = buildManifest(pairs);
  const slot = currentSlot({ sendHour, now });
  const signature = signManifest({ secret, accountId: String(accountId), personId: String(personId), slot, manifest });
  return { manifest, slot, signature };
}

/**
 * Render the dynamic-email (amp4email) part of one recipient's digest.
 *
 * @param {object} p
 * @param {string} p.baseUrl
 * @param {string} p.secret
 * @param {string} p.accountId
 * @param {{ name: string, personId: string, sections: Array<object>, dateColumns?: Array<{id:string,title:string}> }} p.recipient
 * @param {number} [p.sendHour=8]
 * @param {Date} [p.now=new Date()]
 * @returns {string}
 */
export function renderDigestAmp({ baseUrl, secret, accountId, recipient, sendHour = DEFAULT_SEND_HOUR, now = new Date() }) {
  const personId = recipient.personId;
  if (typeof personId !== 'string' || personId.length === 0) {
    throw new Error('renderDigestAmp: recipient.personId is required');
  }

  const signed = buildSignedManifest({ secret, accountId, personId, recipient, sendHour, now });
  const buttons = collectButtons(recipient.sections);
  const dateColumns = resolveDateColumns(recipient);
  const rows = flattenTasks(recipient.sections)
    .map(({ task, buttonIds }) => renderRow({ task, buttonIds, buttons, dateColumns }))
    .join('\n');

  const dateHeaders = dateColumns
    .map((col) => `            <th class="meta">&#8207;${escapeHtml(col.title)}</th>`)
    .join('\n');

  return `<!doctype html>
<html amp4email lang="he">
  <head>
    <meta charset="utf-8">
    <script async src="https://cdn.ampproject.org/v0.js"></script>
    <script async custom-element="amp-form" src="https://cdn.ampproject.org/v0/amp-form-0.1.js"></script>
    <script async custom-template="amp-mustache" src="https://cdn.ampproject.org/v0/amp-mustache-0.2.js"></script>
    <style amp4email-boilerplate>body{visibility:hidden}</style>
    <style amp-custom>${STYLES}    </style>
  </head>
  <body dir="rtl">
    <div class="wrap">
      <p class="hi">&#8207;שלום ${escapeHtml(recipient.name)},</p>
      <p class="lead">&#8207;בחרו סטטוס חדש לכל משימה (כמו בלוח) ולחצו על אישור — כל העדכונים נשמרים מיד, בלי לצאת מהמייל.</p>
      <form method="post"
            action-xhr="${escapeHtml(baseUrl)}${AMP_ENDPOINT_PATH}"
            enctype="application/x-www-form-urlencoded">
        <input type="hidden" name="a" value="${escapeHtml(String(accountId))}">
        <input type="hidden" name="p" value="${escapeHtml(String(personId))}">
        <input type="hidden" name="m" value="${escapeHtml(signed.manifest)}">
        <input type="hidden" name="s" value="${escapeHtml(signed.slot)}">
        <input type="hidden" name="sig" value="${escapeHtml(signed.signature)}">
        <table class="board">
          <tr>
            <th>&#8207;שם הפעולה</th>
${dateHeaders}
            <th class="status-cell">&#8207;סטטוס</th>
            <th class="picker-cell">&#8207;סטטוס חדש</th>
          </tr>
${rows}
        </table>
        <div class="go"><input class="send" type="submit" style="background:${SUBMIT_COLOR}" value="${SUBMIT_LABEL}"></div>
        <div submit-success><template type="amp-mustache"><div class="ok">{{message}}</div></template></div>
        <div submit-error><template type="amp-mustache"><div class="err">{{message}}</div></template></div>
      </form>
      <p class="foot">&#8207;מייל אוטומטי · משימות בלי בחירת סטטוס לא משתנות · אם כבר עודכן — סימון חוזר לא ישנה דבר · אם הטופס אינו מוצג, עדכנו ישירות ב‑monday.com.</p>
    </div>
  </body>
</html>`;
}
