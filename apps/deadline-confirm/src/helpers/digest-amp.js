// V6 amp4email digest renderer (docs/v6-amp-only-decisions.md §3, §5, D9/T15).
//
// Produces the `text/x-amp-html` MIME part. Gmail renders it as dynamic email:
// the reader selects a status per task and submits once — the update happens
// inside the message. The paired `text/plain` part (helpers/digest-plain.js)
// is the non-actionable fallback; there is no HTML part in V6.
//
// Layout (D9): ONE table for the whole message — one radio column per button,
// one global submit. Wire format unchanged:
//   hidden: a, p, m, s, sig
//   selection: radio name="item_<itemId>" value="<btnId>"
//
// Format constraints are hard requirements (invalid AMP → silent fallback to plain):
//   - `<!doctype html>` + `<html amp4email>` + `<meta charset="utf-8">` first
//   - scripts ONLY from cdn.ampproject.org (v0 + amp-form + amp-mustache)
//   - POST via `action-xhr`; whole part under 200,000 bytes

import { escapeHtml } from './html.js';
import { buildManifest, signManifest, currentSlot } from '../services/manifest-signature.js';

const AMP_ENDPOINT_PATH = '/amp/confirm';
const DEFAULT_SEND_HOUR = 8;
const SUBMIT_LABEL = 'אשר את המסומנות';
const SUBMIT_COLOR = '#0073ea';

/** YYYY-MM-DD → DD/MM/YYYY (unset → ''). */
function formatDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return escapeHtml(date);
  return `${d}/${m}/${y}`;
}

const STYLES = `
      body { margin:0; padding:14px 10px; background:#EEF0F4; font-family:Arial,Helvetica,sans-serif; color:#1F2430; }
      .wrap { max-width:720px; margin:0 auto; background:#ffffff; border:1px solid #E4E7EC; border-radius:12px; padding:18px; }
      .hi { font-size:19px; font-weight:bold; margin:0 0 6px; }
      .lead { font-size:14px; color:#55606E; line-height:1.6; margin:0 0 16px; }
      table { width:100%; border-collapse:collapse; background:#ffffff; }
      th { font-size:12px; color:#55606E; font-weight:bold; text-align:right; padding:7px 8px; border:1px solid #E4E7EC; }
      td { font-size:13px; padding:7px 8px; border:1px solid #E4E7EC; vertical-align:middle; }
      .pick { text-align:center; width:56px; white-space:nowrap; }
      .meta { color:#55606E; font-size:12px; text-align:center; white-space:nowrap; }
      label { display:block; }
      .go { margin:12px 0 4px; }
      .send { color:#ffffff; border:0; border-radius:8px; padding:11px 18px; font-size:14px; font-weight:bold; }
      .ok { margin:10px 0 2px; padding:9px 12px; border-radius:8px; background:#E6F7EF; color:#00754A; font-size:13px; }
      .err { margin:10px 0 2px; padding:9px 12px; border-radius:8px; background:#FDECEE; color:#B4222F; font-size:13px; }
      .foot { font-size:12px; color:#8A919B; line-height:1.6; border-top:1px solid #E9EBEF; padding-top:12px; margin-top:4px; }
`;

/**
 * Unique buttons from populated sections, in first-seen order.
 * @param {Array<object>} sections
 * @returns {Array<{ id: string, label: string }>}
 */
function collectButtons(sections) {
  /** @type {Array<{ id: string, label: string }>} */
  const buttons = [];
  const seen = new Set();
  for (const section of sections) {
    if (!section.tasks || section.tasks.length === 0) continue;
    const button = section.button ?? {};
    const id = section.buttonId ?? button.id ?? '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = button.targetLabel || button.name || 'עדכן';
    buttons.push({ id, label });
  }
  return buttons;
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
        row = { task, buttonIds: new Set() };
        byId.set(itemId, row);
      }
      if (btnId) row.buttonIds.add(btnId);
    }
  }
  return [...byId.values()];
}

function renderRow({ task, buttonIds, buttons }) {
  const fieldName = escapeHtml(`item_${task.itemId}`);
  const pickCells = buttons
    .map((button) => {
      if (!buttonIds.has(button.id)) {
        return '              <td class="pick"></td>';
      }
      const boxId = escapeHtml(`sel_${button.id}_${task.itemId}`);
      return `              <td class="pick"><input type="radio" name="${fieldName}" value="${escapeHtml(button.id)}" id="${boxId}"></td>`;
    })
    .join('\n');

  return `            <tr>
${pickCells}
              <td><label>&#8207;${escapeHtml(task.name)}</label></td>
              <td class="meta">${formatDate(task.date)}</td>
              <td class="meta">${escapeHtml(task.statusText ?? '')}</td>
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
 * @param {string} p.baseUrl - app base URL (forms post to `${baseUrl}/amp/confirm`)
 * @param {string} p.secret - account link secret (server-side only; never emitted)
 * @param {string} p.accountId
 * @param {{ name: string, personId: string, sections: Array<object> }} p.recipient
 * @param {number} [p.sendHour=8] - digest send hour (Asia/Jerusalem) for slot math
 * @param {Date} [p.now=new Date()] - injectable clock (preview + tests)
 * @returns {string} a complete amp4email document
 */
export function renderDigestAmp({ baseUrl, secret, accountId, recipient, sendHour = DEFAULT_SEND_HOUR, now = new Date() }) {
  const personId = recipient.personId;
  if (typeof personId !== 'string' || personId.length === 0) {
    throw new Error('renderDigestAmp: recipient.personId is required');
  }

  const signed = buildSignedManifest({ secret, accountId, personId, recipient, sendHour, now });
  const buttons = collectButtons(recipient.sections);
  const rows = flattenTasks(recipient.sections)
    .map(({ task, buttonIds }) => renderRow({ task, buttonIds, buttons }))
    .join('\n');

  const buttonHeaders = buttons
    .map((button) => `              <th class="pick">&#8207;${escapeHtml(button.label)}</th>`)
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
      <p class="lead">&#8207;סמנו לכל משימה את הסטטוס הרצוי ולחצו על אישור — העדכון נשמר בלוח מיד, בלי לצאת מהמייל.</p>
      <form method="post"
            action-xhr="${escapeHtml(baseUrl)}${AMP_ENDPOINT_PATH}"
            enctype="application/x-www-form-urlencoded">
        <input type="hidden" name="a" value="${escapeHtml(String(accountId))}">
        <input type="hidden" name="p" value="${escapeHtml(String(personId))}">
        <input type="hidden" name="m" value="${escapeHtml(signed.manifest)}">
        <input type="hidden" name="s" value="${escapeHtml(signed.slot)}">
        <input type="hidden" name="sig" value="${escapeHtml(signed.signature)}">
        <table>
          <tr>
${buttonHeaders}
            <th>&#8207;שם הפעולה</th>
            <th class="meta">&#8207;תאריך</th>
            <th class="meta">&#8207;סטטוס</th>
          </tr>
${rows}
        </table>
        <div class="go"><input class="send" type="submit" style="background:${SUBMIT_COLOR}" value="${SUBMIT_LABEL}"></div>
        <div submit-success><template type="amp-mustache"><div class="ok">{{message}}</div></template></div>
        <div submit-error><template type="amp-mustache"><div class="err">{{message}}</div></template></div>
      </form>
      <p class="foot">&#8207;מייל אוטומטי · אם משימה כבר עודכנה, סימון חוזר לא ישנה דבר · אם תיבות הסימון אינן מוצגות, עדכנו ישירות ב‑monday.com.</p>
    </div>
  </body>
</html>`;
}
