// Digest email renderer (v4 phase 1) — email-client-safe: nested tables,
// inline styles, full RTL treatment, NO JS. Buttons carry REAL /confirm hrefs
// (itemId + a + k + btn — the v3 link mechanism, unchanged). Layout follows
// the owner-approved mock: greeting → section cards → footer.

import { escapeHtml } from './html.js';

const FONT = 'font-family:Arial,Helvetica,sans-serif';
const CELL_BORDER = 'border:1px solid #E4E7EC';

/** YYYY-MM-DD → DD/MM/YYYY (unset → ''). */
function formatDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return escapeHtml(date);
  return `${d}/${m}/${y}`;
}

function confirmHref({ baseUrl, secret, accountId, buttonId, itemId }) {
  return `${baseUrl}/confirm?itemId=${itemId}&amp;a=${accountId}&amp;k=${secret}&amp;btn=${buttonId}`;
}

function renderTaskRow({ task, button, baseUrl, secret, accountId }) {
  const href = confirmHref({ baseUrl, secret, accountId, buttonId: button.id, itemId: task.itemId });
  const color = button.style?.color ?? '#00854d';
  const icon = button.style?.icon ?? '';
  const label = icon ? `${icon} ${button.name}` : button.name;
  return `        <tr>
          <td dir="rtl" align="right" style="direction:rtl;text-align:right;padding:8px 10px;${CELL_BORDER};color:#1F2430;${FONT};font-size:13px;">&#8207;${escapeHtml(task.name)}</td>
          <td align="center" style="padding:8px 6px;${CELL_BORDER};color:#55606E;${FONT};font-size:13px;white-space:nowrap;">${formatDate(task.date)}</td>
          <td align="center" style="padding:8px 6px;${CELL_BORDER};color:#55606E;${FONT};font-size:12px;">${escapeHtml(task.statusText ?? '')}</td>
          <td align="center" style="padding:6px;${CELL_BORDER};">
            <a href="${href}" target="_blank" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:7px 12px;border-radius:6px;${FONT};font-size:12px;font-weight:bold;">${escapeHtml(label)}</a>
          </td>
        </tr>`;
}

function renderSection({ section, baseUrl, secret, accountId }) {
  const rows = section.tasks
    .map((task) => renderTaskRow({ task, button: section.button, baseUrl, secret, accountId }))
    .join('\n');
  const th = (text) =>
    `<td align="center" style="padding:8px 6px;${CELL_BORDER};background:#FFFFFF;color:#55606E;${FONT};font-size:12px;font-weight:bold;">${text}</td>`;
  return `  <tr>
    <td dir="rtl" style="direction:rtl;padding:0 20px 22px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" dir="rtl" style="direction:rtl;background:#F7F8FA;border:1px solid #E4E7EC;border-radius:12px;">
        <tr>
          <td dir="rtl" align="right" style="direction:rtl;text-align:right;padding:16px 18px 12px;color:#1F2430;${FONT};font-size:16px;font-weight:bold;">&#8207;${escapeHtml(section.title)}</td>
        </tr>
        <tr>
          <td dir="rtl" style="direction:rtl;padding:0 14px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" dir="rtl" style="direction:rtl;border-collapse:collapse;background:#ffffff;">
              <tr>
                <td dir="rtl" align="right" style="direction:rtl;text-align:right;padding:8px 10px;${CELL_BORDER};background:#FFFFFF;color:#55606E;${FONT};font-size:12px;font-weight:bold;">&#8207;שם הפעולה</td>
                ${th('תאריך')}
                ${th('סטאטוס')}
                ${th('עדכון בקליק')}
              </tr>
${rows}
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

/**
 * @param {object} p
 * @param {string} p.baseUrl
 * @param {string} p.secret
 * @param {string} p.accountId
 * @param {{ name: string, sections: Array<{ title: string, button: object, tasks: Array<object> }> }} p.recipient
 * @returns {string} full email body HTML
 */
export function renderDigestEmail({ baseUrl, secret, accountId, recipient }) {
  const sections = recipient.sections
    .filter((s) => s.tasks.length > 0)
    .map((section) => renderSection({ section, baseUrl, secret, accountId }))
    .join('\n');

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" dir="rtl" style="direction:rtl;background:#EEF0F4;margin:0;padding:0;">
  <tr>
    <td align="center" dir="rtl" style="direction:rtl;padding:24px 12px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" dir="rtl" style="direction:rtl;width:600px;max-width:600px;background:#ffffff;border-radius:12px;border:1px solid #E4E7EC;">
        <tr>
          <td dir="rtl" align="right" style="direction:rtl;text-align:right;padding:26px 26px 6px;color:#1F2430;${FONT};font-size:20px;font-weight:bold;">&#8207;שלום ${escapeHtml(recipient.name)},</td>
        </tr>
        <tr>
          <td dir="rtl" align="right" style="direction:rtl;text-align:right;padding:0 26px 20px;color:#55606E;${FONT};font-size:15px;line-height:1.6;">&#8207;אלו המשימות שממתינות לעדכון שלך. לחיצה אחת על הכפתור מעדכנת את הסטטוס — אין צורך להתחבר.</td>
        </tr>
${sections}
        <tr>
          <td dir="rtl" align="right" style="direction:rtl;text-align:right;padding:14px 26px 20px;border-top:1px solid #E9EBEF;color:#8A919B;${FONT};font-size:12px;line-height:1.6;">&#8207;מייל אוטומטי · הכפתורים מעדכנים את הסטטוס בלוח בקליק אחד · אם כבר עדכנת — אפשר להתעלם, לא יקרה כלום כפול.</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}
