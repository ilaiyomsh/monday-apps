// Renders a single-page HTML response that works in BOTH popup and fallback
// (direct-navigation) OAuth modes.
//
// Popup mode: the inline script posts a typed message to the opener and
// closes the window. The admin UI picks up the message through useOAuthPopup.
//
// Fallback mode: if the user opened OAuth in a normal tab (popup blocked or
// their browser forced it), we redirect to the admin UI with query params
// the legacy handler understands (`?google=ok&configId=...`).
//
// postMessage target origin is the current origin — popup and opener are
// always same-origin (both served from APP_BASE_URL), so '*' is unnecessary.

export function renderOAuthDone({ provider, configId, ok, errorMsg = null }) {
  const payload = {
    type: `oauth:${provider}:complete`,
    provider,
    configId,
    ok,
    error: errorMsg,
  };
  const payloadJson = JSON.stringify(payload).replace(/</g, '\\u003c');
  const title = ok ? 'Auth complete' : 'Auth failed';
  const heading = ok
    ? 'Completing authentication…'
    : `Authentication failed: ${escapeHtml(errorMsg || 'unknown')}`;

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;color:#323338;">
<p>${heading}</p>
<p style="color:#676879;font-size:12px;">You can close this window.</p>
<script>
(function(){
  var data = ${payloadJson};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(data, window.location.origin);
      setTimeout(function(){ window.close(); }, 250);
      return;
    }
  } catch (e) { /* fall through */ }
  var params = new URLSearchParams();
  params.set(data.provider, data.ok ? 'ok' : 'err');
  if (data.configId) params.set('configId', data.configId);
  if (!data.ok && data.error) params.set('error', data.error);
  window.location.replace('/admin/?' + params.toString());
})();
</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
