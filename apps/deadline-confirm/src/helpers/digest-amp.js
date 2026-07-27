// V6 amp4email digest renderer (docs/v6-amp-only-decisions.md §3, §5, D9).
//
// Layout (owner 2026-07-27): ONE table per populated cluster (מקבץ).
// Columns: name | that cluster's date | styled <select class="label-dd">
// (closed control monday-like; OS popup cannot be restyled in AMP/Gmail).
// Multiple buttons per cluster via section.buttonIds / section.buttons
// (fallback: singular buttonId / button). ONE global submit.
//
// Wire format unchanged:
//   hidden: a, p, m, s, sig
//   selection: <select name="item_<itemId>"> options = btnIds ("" = no change)
// Same item across clusters shares the same select name.

import { escapeHtml } from './html.js';
import { buildManifest, signManifest, currentSlot } from '../services/manifest-signature.js';

const AMP_ENDPOINT_PATH = '/amp/confirm';
const DEFAULT_SEND_HOUR = 8;
const SUBMIT_LABEL = 'אשר את המסומנות';
const SUBMIT_COLOR = '#0073ea';
const NEUTRAL_STATUS = '#c4c4c4';
const EMPTY_OPTION_LABEL = 'ללא שינוי';

/** YYYY-MM-DD → DD/MM/YYYY (unset → ''). */
function formatDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return escapeHtml(date);
  return `${d}/${m}/${y}`;
}

/**
 * Action buttons offered for a section — multi-button (`buttons` / `buttonIds`)
 * with legacy fallback to singular `button` / `buttonId`.
 * @param {object} section
 * @returns {Array<{ id: string, label: string, color: string }>}
 */
export function resolveSectionButtons(section) {
  /** @type {Array<{ id: string, label: string, color: string }>} */
  const out = [];
  const seen = new Set();

  const pushButton = (raw) => {
    if (!raw || typeof raw !== 'object') return;
    const id = raw.id ?? '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      label: raw.targetLabel || raw.name || 'עדכן',
      color: raw.style?.color || NEUTRAL_STATUS,
    });
  };

  if (Array.isArray(section.buttons) && section.buttons.length > 0) {
    for (const b of section.buttons) pushButton(b);
    return out;
  }

  if (Array.isArray(section.buttonIds) && section.buttonIds.length > 0) {
    const primary = section.button && section.button.id ? section.button : null;
    for (const id of section.buttonIds) {
      if (primary && primary.id === id) pushButton(primary);
      else if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
        seen.add(id);
        out.push({ id, label: id, color: NEUTRAL_STATUS });
      }
    }
    return out;
  }

  if (section.button) {
    pushButton(section.button);
    return out;
  }

  const id = section.buttonId ?? '';
  if (id) out.push({ id, label: id, color: NEUTRAL_STATUS });
  return out;
}

const STYLES = `
      body { margin:0; padding:14px 10px; background:#F5F6F8; font-family:Figtree,Roboto,"Noto Sans Hebrew",Arial,Helvetica,sans-serif; color:#323338; }
      .wrap { max-width:720px; margin:0 auto; background:#ffffff; border:1px solid #E6E9EF; border-radius:8px; padding:18px; }
      .hi { font-size:18px; font-weight:bold; margin:0 0 6px; }
      .lead { font-size:14px; color:#676879; line-height:1.6; margin:0 0 18px; }
      .cluster { margin:0 0 22px; }
      .cluster-title { font-size:15px; font-weight:bold; color:#323338; margin:0 0 8px; line-height:1.4; }
      table.board { width:100%; border-collapse:collapse; background:#ffffff; border:1px solid #E6E9EF; }
      th { font-size:12px; color:#676879; font-weight:500; text-align:center; padding:8px; border-bottom:1px solid #E6E9EF; border-inline-end:1px solid #D0D4E4; background:#FAFBFC; white-space:nowrap; }
      th.name-h { text-align:right; }
      th.status-h { min-width:200px; }
      th:last-child { border-inline-end:none; }
      td { font-size:14px; font-weight:normal; padding:0 8px; border-bottom:1px solid #E6E9EF; border-inline-end:1px solid #D0D4E4; vertical-align:middle; height:44px; text-align:center; }
      td:last-child { border-inline-end:none; }
      td.name { text-align:right; padding-inline-start:12px; white-space:nowrap; }
      td.date { color:#676879; font-size:13px; white-space:nowrap; }
      td.pick { width:220px; padding:6px 8px; text-align:right; }
      /* Closed control styled monday-like (~200×34, blue border).
         The OS popup panel cannot be restyled in AMP/Gmail. */
      select.label-dd {
        width:200px;
        max-width:100%;
        height:34px;
        line-height:34px;
        padding:0 28px 0 12px;
        font-size:14px;
        font-weight:normal;
        font-family:Figtree,Roboto,"Noto Sans Hebrew",Arial,Helvetica,sans-serif;
        color:#323338;
        background-color:#ffffff;
        border:1px solid #0073ea;
        border-radius:4px;
        box-sizing:border-box;
        vertical-align:middle;
        box-shadow:0 1px 2px rgba(0,0,0,0.06);
        -webkit-appearance:none;
        appearance:none;
      }
      .go { margin:8px 0 4px; }
      .send { color:#ffffff; border:0; border-radius:8px; padding:11px 18px; font-size:14px; font-weight:bold; }
      .ok { margin:10px 0 2px; padding:9px 12px; border-radius:8px; background:#E6F7EF; color:#00754A; font-size:13px; }
      .err { margin:10px 0 2px; padding:9px 12px; border-radius:8px; background:#FDECEE; color:#B4222F; font-size:13px; }
      .foot { font-size:12px; color:#9699A6; line-height:1.6; border-top:1px solid #E6E9EF; padding-top:12px; margin-top:10px; }
`;

/**
 * One <select> for the row — empty option = no change; each button is an <option>.
 * Option labels use the button's targetLabel; color is not reliable on <option> in
 * Gmail AMP, so we keep text-only choices (wire still sends btnId).
 */
function renderLabelSelect(fieldName, buttons) {
  const options = [
    `                <option value="">&#8207;${EMPTY_OPTION_LABEL}</option>`,
    ...buttons.map(
      (b) =>
        `                <option value="${escapeHtml(b.id)}">&#8207;${escapeHtml(b.label)}</option>`
    ),
  ].join('\n');
  return `              <td class="pick">
              <select class="label-dd" name="${fieldName}">
${options}
              </select>
            </td>`;
}

function renderClusterTable(section) {
  const buttons = resolveSectionButtons(section);
  if (buttons.length === 0) return '';

  const dateHeader =
    section.dateColumnTitle && String(section.dateColumnTitle).length > 0
      ? String(section.dateColumnTitle)
      : 'תאריך';

  const rows = section.tasks
    .map((task) => {
      const fieldName = escapeHtml(`item_${task.itemId}`);
      return `            <tr>
              <td class="name">&#8207;${escapeHtml(task.name)}</td>
              <td class="date">${formatDate(task.date) || '—'}</td>
${renderLabelSelect(fieldName, buttons)}
            </tr>`;
    })
    .join('\n');

  return `        <div class="cluster">
          <p class="cluster-title">&#8207;${escapeHtml(section.title)}</p>
          <table class="board">
            <tr>
              <th class="name-h">&#8207;שם הפעולה</th>
              <th>&#8207;${escapeHtml(dateHeader)}</th>
              <th class="status-h">&#8207;סטטוס חדש</th>
            </tr>
${rows}
          </table>
        </div>`;
}

/**
 * Build the signed-manifest bundle for the single form in one message.
 * Every (itemId × section button) pair is authorized.
 * @param {{ secret: string, accountId: string, personId: string, recipient: object, sendHour: number, now: Date }} p
 */
function buildSignedManifest({ secret, accountId, personId, recipient, sendHour, now }) {
  /** @type {Array<{ itemId: string, btnId: string }>} */
  const pairs = [];
  for (const section of recipient.sections) {
    if (!section.tasks || section.tasks.length === 0) continue;
    const buttons = resolveSectionButtons(section);
    for (const task of section.tasks) {
      for (const button of buttons) {
        pairs.push({ itemId: String(task.itemId), btnId: button.id });
      }
    }
  }
  const manifest = buildManifest(pairs);
  const slot = currentSlot({ sendHour, now });
  const signature = signManifest({
    secret,
    accountId: String(accountId),
    personId: String(personId),
    slot,
    manifest,
  });
  return { manifest, slot, signature };
}

/**
 * Render the dynamic-email (amp4email) part of one recipient's digest.
 *
 * @param {object} p
 * @param {string} p.baseUrl
 * @param {string} p.secret
 * @param {string} p.accountId
 * @param {{ name: string, personId: string, sections: Array<object> }} p.recipient
 * @param {number} [p.sendHour=8]
 * @param {Date} [p.now=new Date()]
 * @returns {string}
 */
export function renderDigestAmp({
  baseUrl,
  secret,
  accountId,
  recipient,
  sendHour = DEFAULT_SEND_HOUR,
  now = new Date(),
}) {
  const personId = recipient.personId;
  if (typeof personId !== 'string' || personId.length === 0) {
    throw new Error('renderDigestAmp: recipient.personId is required');
  }

  const signed = buildSignedManifest({ secret, accountId, personId, recipient, sendHour, now });
  const clusters = (recipient.sections ?? [])
    .filter((section) => section.tasks && section.tasks.length > 0)
    .map((section) => renderClusterTable(section))
    .filter((html) => html.length > 0)
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
      <p class="lead">&#8207;בחרו סטטוס חדש מהתפריט הנפתח לכל משימה ולחצו על אישור — כל העדכונים נשמרים מיד, בלי לצאת מהמייל.</p>
      <form method="post"
            action-xhr="${escapeHtml(baseUrl)}${AMP_ENDPOINT_PATH}"
            enctype="application/x-www-form-urlencoded">
        <input type="hidden" name="a" value="${escapeHtml(String(accountId))}">
        <input type="hidden" name="p" value="${escapeHtml(String(personId))}">
        <input type="hidden" name="m" value="${escapeHtml(signed.manifest)}">
        <input type="hidden" name="s" value="${escapeHtml(signed.slot)}">
        <input type="hidden" name="sig" value="${escapeHtml(signed.signature)}">
${clusters}
        <div class="go"><input class="send" type="submit" style="background:${SUBMIT_COLOR}" value="${SUBMIT_LABEL}"></div>
        <div submit-success><template type="amp-mustache"><div class="ok">{{message}}</div></template></div>
        <div submit-error><template type="amp-mustache"><div class="err">{{message}}</div></template></div>
      </form>
      <p class="foot">&#8207;מייל אוטומטי · משימות על "ללא שינוי" לא משתנות · אותה משימה בשני מקבצים = בחירה אחת למייל · אם הטופס אינו מוצג, עדכנו ישירות ב‑monday.com.</p>
    </div>
  </body>
</html>`;
}
