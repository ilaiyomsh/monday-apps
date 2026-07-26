// AMP-for-Email CORS resolver (V5 — Gmail dynamic email).
//
// Gmail renders the `text/x-amp-html` part of a digest and lets the reader
// submit an <amp-form> straight from the message. Before the email client will
// even read our response body it demands sender-scoped CORS headers, in one of
// two variants (both are supported per amp.dev's "CORS in AMP for Email"):
//
//   v2 (preferred): request `AMP-Email-Sender: <addr>`
//                   → response `AMP-Email-Allow-Sender: <addr>`
//   v1 (legacy):    request `Origin: <origin>` + `?__amp_source_origin=<addr>`
//                   → response `Access-Control-Allow-Origin: <origin>`
//                              `AMP-Access-Control-Allow-Source-Origin: <addr>`
//                              `Access-Control-Expose-Headers: AMP-Access-Control-Allow-Source-Origin`
//
// v2 wins when a client offers both. This module is PURE — the route decides
// what to do with the verdict.
//
// Security posture (locked): DEFAULT DENY. The allowlist comes from
// AMP_ALLOWED_SENDERS; while it is empty the endpoint admits nobody. The
// wildcard `*` that the spec permits is deliberately NOT supported: echoing it
// would let any sender's email drive our endpoint. A rejected request receives
// NO CORS headers, so the email client discards the response instead of
// rendering it as a soft failure.

/** `Name <a@b.c>` / `  A@B.C ` → `a@b.c`; anything address-less → ''. */
function normalizeAddress(raw) {
  if (typeof raw !== 'string') return '';
  const angled = raw.match(/<([^>]*)>/);
  const value = (angled ? angled[1] : raw).trim().toLowerCase();
  return value.includes('@') ? value : '';
}

/**
 * Decide whether an AMP email may talk to us, and with which headers.
 *
 * @param {object} p
 * @param {string} [p.senderHeader] - the `AMP-Email-Sender` request header (v2)
 * @param {string} [p.originHeader] - the `Origin` request header (v1)
 * @param {string} [p.sourceOrigin] - the `__amp_source_origin` query param (v1)
 * @param {string[]} [p.allowedSenders] - configured sender allowlist
 * @returns {{ ok: boolean, reason: string, headers: Record<string, string> }}
 */
export function resolveAmpCors({ senderHeader, originHeader, sourceOrigin, allowedSenders }) {
  const deny = (reason) => ({ ok: false, reason, headers: {} });

  // `*` is never an allowlist member — see the header comment.
  const allowed = new Set(
    (Array.isArray(allowedSenders) ? allowedSenders : []).map(normalizeAddress).filter((a) => a.length > 0)
  );
  if (allowed.size === 0) return deny('not_configured');

  const v2Sender = normalizeAddress(senderHeader);
  if (typeof senderHeader === 'string' && senderHeader.trim().length > 0) {
    if (!allowed.has(v2Sender)) return deny('sender_not_allowed');
    return { ok: true, reason: 'v2', headers: { 'AMP-Email-Allow-Sender': v2Sender } };
  }

  if (typeof originHeader === 'string' && originHeader.trim().length > 0) {
    if (typeof sourceOrigin !== 'string' || sourceOrigin.trim().length === 0) {
      return deny('missing_source_origin');
    }
    const v1Sender = normalizeAddress(sourceOrigin);
    if (!allowed.has(v1Sender)) return deny('sender_not_allowed');
    return {
      ok: true,
      reason: 'v1',
      headers: {
        'Access-Control-Allow-Origin': originHeader,
        'AMP-Access-Control-Allow-Source-Origin': v1Sender,
        'Access-Control-Expose-Headers': 'AMP-Access-Control-Allow-Source-Origin',
      },
    };
  }

  return deny('no_amp_headers');
}
