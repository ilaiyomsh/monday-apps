// OAuth result pages (spec §8). Hard requirements: <html dir="rtl" lang="he">,
// inline CSS only, no external assets, mobile-friendly.
//
// V6 (docs/v6-amp-only-decisions.md T2): the /confirm route family is deleted,
// and with it the three /confirm result pages and the JS auto-POST landing
// page. These OAuth pages are the file's ONLY remaining exports.

import { escapeHtml } from './html.js';

function renderPage({ title, heading, body, footer = '', script = '' }) {
  return `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
</head>
<body style="margin:0;padding:24px;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:420px;margin:48px auto;background:#ffffff;border-radius:12px;padding:32px 24px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
<h1 style="margin:0 0 16px;font-size:24px;color:#323338;">${heading}</h1>
<p style="margin:0;font-size:18px;line-height:1.6;color:#4b4e59;">${body}</p>
${footer}
</div>
${script}
</body>
</html>`;
}

/**
 * OAuth completion page (§8).
 * @returns {string} full HTML document
 */
export function oauthDonePage() {
  return renderPage({
    title: 'החיבור הושלם',
    heading: 'החיבור הושלם ✓',
    body: 'אפשר לסגור את החלון ולרענן את מסך ההגדרות.',
  });
}

/**
 * OAuth failure page — generic Hebrew RTL message, no error details beyond
 * an optional short reason (never tokens/codes).
 * @param {string} [reason] - short, HTML-escaped
 * @returns {string} full HTML document
 */
export function oauthErrorPage(reason) {
  return renderPage({
    title: 'החיבור נכשל',
    heading: 'החיבור נכשל',
    body: reason
      ? `${escapeHtml(reason)} — אפשר לסגור את החלון ולנסות שוב ממסך ההגדרות.`
      : 'אפשר לסגור את החלון ולנסות שוב ממסך ההגדרות.',
  });
}
