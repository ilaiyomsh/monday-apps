// v2 — full email HTML renderer (email-client-safe: nested tables, inline
// styles only, no JS/external assets). The admin copies this output verbatim
// into the monday workflow email editor; {ITEM_ID} stays a literal
// placeholder in every button href.

import { escapeHtml } from './html.js';
import { renderSnippet } from './snippet.js';

export const ALLOWED_FONTS = [
  'Arial',
  'Tahoma',
  'Verdana',
  'Georgia',
  'Times New Roman',
  'Courier New',
];

function renderTextRow(block) {
  const body = escapeHtml(block.text).replaceAll('\n', '<br>');
  const style = [
    `font-family:'${block.font}',sans-serif`,
    `font-size:${block.fontSize}px`,
    `text-align:${block.align}`,
    'color:#323338',
    'line-height:1.6',
    'padding:8px 0',
  ].join(';');
  return `  <tr>
    <td dir="${block.direction}" style="${style}">${body}</td>
  </tr>`;
}

function renderButtonsRow(block, { baseUrl, secret, buttonsById, accountId }) {
  const cells = block.buttonIds
    .map((id) => buttonsById.get(id))
    .filter(Boolean) // unknown ids skipped defensively — validation prevents them
    .map((button) => `          <td style="padding:0 6px;">${renderSnippet({ baseUrl, secret, button, accountId })}</td>`)
    .join('\n');
  return `  <tr>
    <td align="center" style="padding:8px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" align="center">
        <tr>
${cells}
        </tr>
      </table>
    </td>
  </tr>`;
}

/**
 * Render one saved template to the complete email body HTML (see module
 * header + tests for the pinned contract).
 * @param {object} p
 * @param {string} p.baseUrl
 * @param {string} p.secret
 * @param {{ id: string, name: string, blocks: Array<object> }} p.template
 * @param {Array<object>} p.buttons - the config's buttons array
 * @param {string} p.accountId - carried into every button href (v3 a= param)
 * @returns {string} email body HTML
 */
export function renderEmailTemplate({ baseUrl, secret, template, buttons, accountId }) {
  const buttonsById = new Map(buttons.map((b) => [b.id, b]));
  const rows = template.blocks
    .map((block) =>
      block.type === 'text'
        ? renderTextRow(block)
        : renderButtonsRow(block, { baseUrl, secret, buttonsById, accountId })
    )
    .join('\n');
  return `<table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;max-width:600px;">
${rows}
</table>`;
}
