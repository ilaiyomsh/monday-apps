// V6 amp4email digest renderer (docs/v6-amp-only-decisions.md §3, §5).
//
// Produces the `text/x-amp-html` MIME part. Gmail renders it as dynamic email:
// the reader selects tasks and submits — the update happens inside the message.
// The paired `text/plain` part (helpers/digest-plain.js) is the non-actionable
// fallback; there is no HTML part in V6.
//
// Wire format (one signed manifest per message — the base secret NEVER appears):
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

/** YYYY-MM-DD → DD/MM/YYYY (unset → ''). */
function formatDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return escapeHtml(date);
  return `${d}/${m}/${y}`;
}

const STYLES = `
      body { margin:0; padding:14px 10px; background:#EEF0F4; font-family:Arial,Helvetica,sans-serif; color:#1F2430; }
      .wrap { max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #E4E7EC; border-radius:12px; padding:18px; }
      .hi { font-size:19px; font-weight:bold; margin:0 0 6px; }
      .lead { font-size:14px; color:#55606E; line-height:1.6; margin:0 0 16px; }
      .grp { background:#F7F8FA; border:1px solid #E4E7EC; border-radius:10px; padding:12px 12px 8px; margin:0 0 16px; }
      .grp h2 { font-size:15px; margin:0 0 10px; }
      table { width:100%; border-collapse:collapse; background:#ffffff; }
      th { font-size:12px; color:#55606E; font-weight:bold; text-align:right; padding:7px 8px; border:1px solid #E4E7EC; }
      td { font-size:13px; padding:7px 8px; border:1px solid #E4E7EC; vertical-align:middle; }
      .pick { text-align:center; width:34px; }
      .meta { color:#55606E; font-size:12px; text-align:center; white-space:nowrap; }
      label { display:block; }
      .go { margin:12px 0 4px; }
      .send { color:#ffffff; border:0; border-radius:8px; padding:11px 18px; font-size:14px; font-weight:bold; }
      .ok { margin:10px 0 2px; padding:9px 12px; border-radius:8px; background:#E6F7EF; color:#00754A; font-size:13px; }
      .err { margin:10px 0 2px; padding:9px 12px; border-radius:8px; background:#FDECEE; color:#B4222F; font-size:13px; }
      .foot { font-size:12px; color:#8A919B; line-height:1.6; border-top:1px solid #E9EBEF; padding-top:12px; margin-top:4px; }
`;

function renderRow({ task, buttonId }) {
  const fieldName = escapeHtml(`item_${task.itemId}`);
  const boxId = escapeHtml(`sel_${buttonId}_${task.itemId}`);
  return `            <tr>
              <td class="pick"><input type="radio" name="${fieldName}" value="${escapeHtml(buttonId)}" id="${boxId}"></td>
              <td><label for="${boxId}">&#8207;${escapeHtml(task.name)}</label></td>
              <td class="meta">${formatDate(task.date)}</td>
              <td class="meta">${escapeHtml(task.statusText ?? '')}</td>
            </tr>`;
}

function renderSection({ section, baseUrl, signed, accountId, personId }) {
  const button = section.button ?? {};
  const buttonId = section.buttonId ?? button.id ?? '';
  const color = button.style?.color ?? '#00854d';
  const icon = button.style?.icon ?? '';
  const submitLabel = `${icon ? `${icon} ` : ''}${button.name ?? 'עדכן'} — אשר את המסומנות`;
  const dateHeader = section.dateColumnTitle && section.dateColumnTitle.length > 0 ? section.dateColumnTitle : 'תאריך';
  const rows = section.tasks.map((task) => renderRow({ task, buttonId })).join('\n');

  return `      <div class="grp">
        <h2>&#8207;${escapeHtml(section.title)}</h2>
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
              <th class="pick"></th>
              <th>&#8207;שם הפעולה</th>
              <th class="meta">${escapeHtml(dateHeader)}</th>
              <th class="meta">&#8207;סטטוס</th>
            </tr>
${rows}
          </table>
          <div class="go"><input class="send" type="submit" style="background:${escapeHtml(color)}" value="${escapeHtml(submitLabel)}"></div>
          <div submit-success><template type="amp-mustache"><div class="ok">{{message}}</div></template></div>
          <div submit-error><template type="amp-mustache"><div class="err">{{message}}</div></template></div>
        </form>
      </div>`;
}

/**
 * Build the signed-manifest bundle shared by every form in one message.
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

  const sections = recipient.sections
    .filter((s) => s.tasks.length > 0)
    .map((section) =>
      renderSection({ section, baseUrl, signed, accountId, personId })
    )
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
      <p class="lead">&#8207;סמנו את המשימות שברצונכם לעדכן ולחצו על הכפתור שמתחת לכל קבוצה — העדכון נשמר בלוח מיד, בלי לצאת מהמייל.</p>
${sections}
      <p class="foot">&#8207;מייל אוטומטי · אם משימה כבר עודכנה, סימון חוזר לא ישנה דבר · אם תיבות הסימון אינן מוצגות, עדכנו ישירות ב‑monday.com.</p>
    </div>
  </body>
</html>`;
}
