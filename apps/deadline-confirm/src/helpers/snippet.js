// Email button snippet generator (spec §12). Email-client-safe: table
// wrapper, inline styles, no JS. {ITEM_ID} stays a literal placeholder —
// the monday workflow maps the real item id into it.

/**
 * Render the §12 snippet with the deployment URL and current secret.
 * @param {{ baseUrl: string, secret: string }} params
 * @returns {string} HTML snippet
 */
export function renderSnippet({ baseUrl, secret }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:16px auto;">
  <tr>
    <td style="border-radius:8px;background-color:#00854d;">
      <a href="${baseUrl}/confirm?itemId={ITEM_ID}&amp;k=${secret}" target="_blank"
         style="display:inline-block;padding:12px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">
        ✓ סמן כבוצע
      </a>
    </td>
  </tr>
</table>`;
}
