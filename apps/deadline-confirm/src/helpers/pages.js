// The three static /confirm response pages (spec §7) + the OAuth result
// pages (§8). Hard requirements: <html dir="rtl" lang="he">, inline CSS only,
// no JS, no external assets, mobile-friendly. The /confirm pages contain ZERO
// item/account-derived data — the only dynamic value is the config-derived
// target label on the success page (locked decision §3.6).

import { escapeHtml } from './html.js';

function renderPage({ title, heading, body }) {
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
</div>
</body>
</html>`;
}

/**
 * Success page (§7.1, HTTP 200).
 * @param {string} toLabel - HTML-escaped here (config-derived, never trusted raw)
 * @returns {string} full HTML document
 */
export function successPage(toLabel) {
  return renderPage({
    title: 'המשימה עודכנה',
    heading: 'המשימה עודכנה ✓',
    body: `הסטטוס שונה ל"${escapeHtml(toLabel)}".`,
  });
}

/**
 * Generic invalid page (§7.2, HTTP 200) — uniform for bad k, not found,
 * wrong board, wrong status, already done, expired, missing config, API error.
 * @returns {string} full HTML document
 */
export function invalidPage() {
  return renderPage({
    title: 'הקישור אינו בתוקף',
    heading: 'הקישור אינו בתוקף',
    body: 'ייתכן שהמשימה כבר טופלה או שהקישור הוחלף. אפשר לבדוק את הסטטוס ישירות בלוח.',
  });
}

/**
 * Bad request page (§7.3, HTTP 400).
 * @returns {string} full HTML document
 */
export function badRequestPage() {
  return renderPage({
    title: 'בקשה שגויה',
    heading: 'בקשה שגויה',
    body: 'הקישור שהגיע אינו תקין.',
  });
}

/**
 * v2 — mail-scanner protection landing page (owner decision 2026-07-15).
 * Served on GET /confirm AFTER the secret gate + rate limit; performs the
 * action via an immediate JS auto-submitted POST so link-following email
 * scanners (which don't execute JS) never change statuses.
 *
 * Requirements:
 * - <html dir="rtl" lang="he">, inline CSS, mobile-friendly
 * - a <form method="post" action="/confirm"> with HIDDEN inputs itemId, k,
 *   btn — every value HTML-ATTRIBUTE-escaped
 * - an inline <script> that submits the form immediately on load
 * - a <noscript> fallback INSIDE the form showing a real submit button
 *   (text: המשך לאישור) — one extra click for JS-less humans, nothing for
 *   scanners
 * - visible interim text: מאשר את המשימה…
 *
 * @param {{ itemId: string, k: string, btn: string }} params
 * @returns {string} full HTML document
 */
export function confirmLandingPage({ itemId, k, btn, a }) {
  return `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>מאשר את המשימה…</title>
</head>
<body style="margin:0;padding:24px;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:420px;margin:48px auto;background:#ffffff;border-radius:12px;padding:32px 24px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
<h1 style="margin:0 0 16px;font-size:22px;color:#323338;">מאשר את המשימה…</h1>
<form id="confirm-form" method="post" action="/confirm">
<input type="hidden" name="itemId" value="${escapeHtml(itemId)}">
<input type="hidden" name="a" value="${escapeHtml(a)}">
<input type="hidden" name="k" value="${escapeHtml(k)}">
<input type="hidden" name="btn" value="${escapeHtml(btn)}">
<noscript>
<button type="submit" style="display:inline-block;padding:12px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;background-color:#00854d;border:none;border-radius:8px;cursor:pointer;">המשך לאישור</button>
</noscript>
</form>
<script>document.getElementById('confirm-form').submit();</script>
</div>
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
