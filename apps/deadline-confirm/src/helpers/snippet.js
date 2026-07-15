// v2 email button snippet generator. Email-client-safe: table wrapper,
// inline styles, no JS. {ITEM_ID} stays a literal placeholder — the monday
// workflow maps the real item id into it.

import { escapeHtml } from './html.js';

/** size → {fontSize, padding} (email-safe px values) */
export const BUTTON_SIZES = {
  sm: { fontSize: 13, padding: '8px 20px' },
  md: { fontSize: 16, padding: '12px 32px' },
  lg: { fontSize: 20, padding: '16px 40px' },
};

/**
 * Render one button's snippet — see the module header + tests for the
 * pinned contract (href entities, literal {ITEM_ID}, size mapping).
 * @param {{ baseUrl: string, secret: string, button: { id: string, name: string, style?: { color?: string, icon?: string, size?: string } }, accountId: string }} params
 * @returns {string} HTML snippet
 */
export function renderSnippet({ baseUrl, secret, button, accountId }) {
  const style = button.style ?? {};
  const size = BUTTON_SIZES[style.size] ?? BUTTON_SIZES.md;
  const color = style.color ?? '#00854d';
  const icon = style.icon ?? '';
  const text = icon ? `${icon} ${button.name}` : button.name;
  const href = `${baseUrl}/confirm?itemId={ITEM_ID}&amp;a=${accountId}&amp;k=${secret}&amp;btn=${button.id}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:16px auto;">
  <tr>
    <td style="border-radius:8px;background-color:${color};">
      <a href="${href}" target="_blank"
         style="display:inline-block;padding:${size.padding};font-family:Arial,Helvetica,sans-serif;font-size:${size.fontSize}px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(text)}</a>
    </td>
  </tr>
</table>`;
}
