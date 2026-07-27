// V6 amp4email digest renderer (docs/v6-amp-only-decisions.md §3, §5, D9).
//
// Layout (owner 2026-07-27): ONE table per populated cluster (מקבץ).
// Columns: name | that cluster's date | amp-bind dropdown (monday-colored
// trigger + popup options). Native <select> popup cannot be styled; always-open
// radio stacks are not a dropdown. Wire via hidden input [value] binding.
//
// Wire format unchanged:
//   hidden: a, p, m, s, sig
//   selection: <input type="hidden" name="item_<itemId>" [value]=btnId> ("" = no change)
// Same item across clusters shares one state key + one hidden field.

import { escapeHtml } from './html.js';
import { buildManifest, signManifest, currentSlot } from '../services/manifest-signature.js';

const AMP_ENDPOINT_PATH = '/amp/confirm';
const DEFAULT_SEND_HOUR = 8;
const SUBMIT_LABEL = 'אשר את המסומנות';
const SUBMIT_COLOR = '#0073ea';
const NEUTRAL_STATUS = '#c4c4c4';
const TRIGGER_EMPTY = '—';
const STATUS_HEADER = 'סטטוס';

/** YYYY-MM-DD → DD/MM/YYYY (unset → ''). */
function formatDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return escapeHtml(date);
  return `${d}/${m}/${y}`;
}

/**
 * Escape a string for use inside a single-quoted amp-bind / setState literal.
 * @param {string} raw
 */
function escapeBindStr(raw) {
  return String(raw)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ');
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

/**
 * Collect unique item ids (string) across populated sections — for amp-state.
 * @param {object} recipient
 * @returns {string[]}
 */
function collectItemIds(recipient) {
  const ids = [];
  const seen = new Set();
  for (const section of recipient.sections ?? []) {
    if (!section.tasks || section.tasks.length === 0) continue;
    for (const task of section.tasks) {
      const id = String(task.itemId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * AMP4EMAIL forbids [style] on <button> — bind background via [class] instead.
 * @param {string} hex
 * @returns {string} e.g. bg_fdab3d
 */
function colorToClass(hex) {
  const clean = String(hex || NEUTRAL_STATUS)
    .trim()
    .replace(/^#/, '')
    .replace(/[^a-fA-F0-9]/g, '')
    .toLowerCase();
  return `bg_${clean || 'c4c4c4'}`;
}

/**
 * @param {Iterable<string>} colors hex colors used in this message
 * @returns {string} CSS rules for .dd-trig.bg_*
 */
function buildColorClassCss(colors) {
  const seen = new Set();
  const rules = [];
  for (const raw of colors) {
    const cls = colorToClass(raw);
    if (seen.has(cls)) continue;
    seen.add(cls);
    const hexDigits = cls.slice(3); // after bg_
    rules.push(`.dd-trig.${cls} { background:#${escapeHtml(hexDigits)}; }`);
  }
  return rules.join('\n      ');
}

/**
 * All action buttons across populated sections (for status-color matching).
 * @param {object} recipient
 * @returns {Array<{ id: string, label: string, color: string }>}
 */
function allRecipientButtons(recipient) {
  const out = [];
  const seen = new Set();
  for (const section of recipient.sections ?? []) {
    if (!section.tasks || section.tasks.length === 0) continue;
    for (const button of resolveSectionButtons(section)) {
      if (seen.has(button.id)) continue;
      seen.add(button.id);
      out.push(button);
    }
  }
  return out;
}

/**
 * Best-effort color for the task's current status label: optional
 * task.statusColor, else match a known action-button label, else gray.
 * @param {string} statusText
 * @param {Array<{ label: string, color: string }>} buttons
 * @param {string} [statusColor]
 */
function resolveCurrentStatusColor(statusText, buttons, statusColor) {
  if (statusColor && typeof statusColor === 'string' && statusColor.trim()) {
    return statusColor.trim();
  }
  const needle = String(statusText || '').trim();
  if (!needle) return NEUTRAL_STATUS;
  const match = buttons.find((b) => b.label === needle);
  return match?.color || NEUTRAL_STATUS;
}

/** Closed-trigger label = current status text (or em dash if unset). */
function currentStatusLabel(task) {
  const text = typeof task?.statusText === 'string' ? task.statusText.trim() : '';
  return text || TRIGGER_EMPTY;
}

/**
 * Collect button + current-status colors used in this message (+ neutral).
 * @param {object} recipient
 * @returns {string[]}
 */
function collectColors(recipient) {
  const colors = new Set([NEUTRAL_STATUS]);
  const palette = allRecipientButtons(recipient);
  for (const button of palette) colors.add(button.color || NEUTRAL_STATUS);
  for (const section of recipient.sections ?? []) {
    if (!section.tasks || section.tasks.length === 0) continue;
    for (const task of section.tasks) {
      const label = currentStatusLabel(task);
      colors.add(
        resolveCurrentStatusColor(label === TRIGGER_EMPTY ? '' : label, palette, task.statusColor)
      );
    }
  }
  return [...colors];
}

/**
 * Initial amp-state — seeded with each item's current status (first occurrence
 * wins across clusters). c<id> is a CSS class name (AMP4EMAIL forbids [style]
 * on button). ol/oc keep the originals for "ללא שינוי".
 * @param {object} recipient
 */
function buildDropdownState(recipient) {
  /** @type {Record<string, string>} */
  const state = { o: '' };
  const palette = allRecipientButtons(recipient);
  const seen = new Set();
  for (const section of recipient.sections ?? []) {
    if (!section.tasks || section.tasks.length === 0) continue;
    for (const task of section.tasks) {
      const id = String(task.itemId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const label = currentStatusLabel(task);
      const color = resolveCurrentStatusColor(
        label === TRIGGER_EMPTY ? '' : label,
        palette,
        task.statusColor
      );
      const cls = colorToClass(color);
      state[`v${id}`] = '';
      state[`l${id}`] = label;
      state[`c${id}`] = cls;
      state[`ol${id}`] = label;
      state[`oc${id}`] = cls;
    }
  }
  return state;
}

const STYLES_BASE = `
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
      td.dd-cell { padding:8px; width:220px; vertical-align:middle; text-align:right; }
      .dd-wrap { position:relative; display:inline-block; width:200px; max-width:100%; text-align:right; }
      .dd-trig {
        width:200px; max-width:100%; height:34px; box-sizing:border-box;
        padding:0 12px; border:0; border-radius:4px; cursor:pointer;
        font-size:14px; font-weight:bold; color:#ffffff; text-align:center;
        font-family:Figtree,Roboto,"Noto Sans Hebrew",Arial,Helvetica,sans-serif;
        background:${NEUTRAL_STATUS};
      }
      .dd-menu {
        position:absolute; top:100%; inset-inline-end:0; z-index:20;
        width:200px; margin-top:4px; padding:8px; box-sizing:border-box;
        background:#ffffff; border:1px solid #E6E9EF; border-radius:8px;
        box-shadow:0 10px 25px rgba(0,0,0,0.15);
      }
      .dd-opt {
        display:block; width:100%; box-sizing:border-box;
        margin:0 0 4px; padding:0 12px; border:0; border-radius:4px; cursor:pointer;
        height:34px; line-height:34px; font-size:14px; font-weight:bold; color:#ffffff; text-align:center;
        font-family:Figtree,Roboto,"Noto Sans Hebrew",Arial,Helvetica,sans-serif;
      }
      .dd-opt:last-child { margin-bottom:0; }
      .dd-overlay {
        position:fixed; top:0; right:0; bottom:0; left:0; z-index:10;
        background:transparent;
      }
      .go { margin:8px 0 4px; }
      .send { color:#ffffff; border:0; border-radius:8px; padding:11px 18px; font-size:14px; font-weight:bold; }
      .ok { margin:10px 0 2px; padding:9px 12px; border-radius:8px; background:#E6F7EF; color:#00754A; font-size:13px; }
      .err { margin:10px 0 2px; padding:9px 12px; border-radius:8px; background:#FDECEE; color:#B4222F; font-size:13px; }
      .foot { font-size:12px; color:#9699A6; line-height:1.6; border-top:1px solid #E6E9EF; padding-top:12px; margin-top:10px; }
`;

/**
 * amp-bind dropdown: closed trigger shows CURRENT status; tap opens colored
 * options. Selecting updates the cell via [text]/[class]. "ללא שינוי" clears
 * the wire value and restores the original status display.
 * Trigger color via [class] (AMP4EMAIL forbids [style] on button).
 * @param {string} fieldName escaped name="item_<id>"
 * @param {Array<{ id: string, label: string, color: string }>} buttons section options
 * @param {Array<{ id: string, label: string, color: string }>} palette all digest buttons (color match)
 * @param {object} task
 * @param {boolean} includeHidden emit the wire hidden input once per item
 */
function renderLabelDropdown(fieldName, buttons, palette, task, includeHidden) {
  const id = String(task.itemId);
  const idBind = escapeBindStr(id);
  const vKey = `v${id}`;
  const lKey = `l${id}`;
  const cKey = `c${id}`;
  const olKey = `ol${id}`;
  const ocKey = `oc${id}`;

  const curLabel = currentStatusLabel(task);
  const curColor = resolveCurrentStatusColor(
    curLabel === TRIGGER_EMPTY ? '' : curLabel,
    palette,
    task.statusColor
  );
  const curCls = colorToClass(curColor);

  const options = [
    ...buttons.map((button) => {
      const color = button.color || NEUTRAL_STATUS;
      const cls = colorToClass(color);
      const label = button.label;
      return `                <button type="button" class="dd-opt" style="background:${escapeHtml(color)}"
                        on="tap:AMP.setState({dd:{o:'', ${vKey}:'${escapeBindStr(button.id)}', ${lKey}:'${escapeBindStr(label)}', ${cKey}:'${escapeBindStr(cls)}'}})">&#8207;${escapeHtml(label)}</button>`;
    }),
    `                <button type="button" class="dd-opt" style="background:${NEUTRAL_STATUS}"
                        on="tap:AMP.setState({dd:{o:'', ${vKey}:'', ${lKey}: dd.${olKey}, ${cKey}: dd.${ocKey}}})">&#8207;ללא שינוי</button>`,
  ].join('\n');

  const hidden = includeHidden
    ? `\n              <input type="hidden" name="${fieldName}" value="" [value]="dd.${vKey}">`
    : '';

  return `              <td class="dd-cell">
              <div class="dd-wrap">
                <button type="button" class="dd-trig ${curCls}"
                        [class]="'dd-trig ' + dd.${cKey}"
                        on="tap:AMP.setState({dd:{o: dd.o == '${idBind}' ? '' : '${idBind}'}})">
                  <span [text]="dd.${lKey}">&#8207;${escapeHtml(curLabel)}</span>
                </button>
                <div class="dd-menu" hidden [hidden]="dd.o != '${idBind}'">
${options}
                </div>
              </div>${hidden}
            </td>`;
}

/**
 * @param {object} section
 * @param {Set<string>} emittedHidden
 * @param {Array<{ id: string, label: string, color: string }>} palette
 */
function renderClusterTable(section, emittedHidden, palette) {
  const buttons = resolveSectionButtons(section);
  if (buttons.length === 0) return '';

  const dateHeader =
    section.dateColumnTitle && String(section.dateColumnTitle).length > 0
      ? String(section.dateColumnTitle)
      : 'תאריך';

  const rows = section.tasks
    .map((task) => {
      const itemId = String(task.itemId);
      const fieldName = escapeHtml(`item_${itemId}`);
      const includeHidden = !emittedHidden.has(itemId);
      if (includeHidden) emittedHidden.add(itemId);
      return `            <tr>
              <td class="name">&#8207;${escapeHtml(task.name)}</td>
              <td class="date">${formatDate(task.date) || '—'}</td>
${renderLabelDropdown(fieldName, buttons, palette, task, includeHidden)}
            </tr>`;
    })
    .join('\n');

  return `        <div class="cluster">
          <p class="cluster-title">&#8207;${escapeHtml(section.title)}</p>
          <table class="board">
            <tr>
              <th class="name-h">&#8207;שם הפעולה</th>
              <th>&#8207;${escapeHtml(dateHeader)}</th>
              <th class="status-h">&#8207;${STATUS_HEADER}</th>
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
  const ddState = buildDropdownState(recipient);
  const palette = allRecipientButtons(recipient);
  const colorCss = buildColorClassCss(collectColors(recipient));
  const styles = `${STYLES_BASE}\n      ${colorCss}`;
  const emittedHidden = new Set();
  const clusters = (recipient.sections ?? [])
    .filter((section) => section.tasks && section.tasks.length > 0)
    .map((section) => renderClusterTable(section, emittedHidden, palette))
    .filter((html) => html.length > 0)
    .join('\n');

  return `<!doctype html>
<html amp4email lang="he">
  <head>
    <meta charset="utf-8">
    <script async src="https://cdn.ampproject.org/v0.js"></script>
    <script async custom-element="amp-form" src="https://cdn.ampproject.org/v0/amp-form-0.1.js"></script>
    <script async custom-element="amp-bind" src="https://cdn.ampproject.org/v0/amp-bind-0.1.js"></script>
    <script async custom-template="amp-mustache" src="https://cdn.ampproject.org/v0/amp-mustache-0.2.js"></script>
    <style amp4email-boilerplate>body{visibility:hidden}</style>
    <style amp-custom>${styles}    </style>
  </head>
  <body dir="rtl">
    <amp-state id="dd"><script type="application/json">${JSON.stringify(ddState)}</script></amp-state>
    <div class="dd-overlay" hidden [hidden]="dd.o == ''" role="button" tabindex="0"
         on="tap:AMP.setState({dd:{o:''}})"></div>
    <div class="wrap">
      <p class="hi">&#8207;שלום ${escapeHtml(recipient.name)},</p>
      <p class="lead">&#8207;לחצו על תגית הסטטוס לבחירה מהתפריט הנפתח, ואז על אישור — כל העדכונים נשמרים מיד, בלי לצאת מהמייל.</p>
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
