// Minimal fetch helpers used across scenarios and harness utilities.
import net from 'net';

export async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

export async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

// Poll until fn returns a truthy value or the timeout elapses.
// Returns whatever fn returned (for the last successful call) or null.
export async function waitFor(fn, { timeoutMs = 8000, intervalMs = 400 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fn();
      if (r) return r;
    } catch {
      // ignore and retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

// Wait for a URL that responds 2xx on GET.
export async function waitForHealth(url, timeoutMs = 10000) {
  return waitFor(async () => {
    const r = await fetch(url);
    return r.ok;
  }, { timeoutMs, intervalMs: 200 });
}

// TCP-level "is the port accepting connections" check. Used for the app,
// which doesn't expose a health endpoint.
export async function waitForPort(port, host = 'localhost', timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const attempt = () => {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.once('connect', () => { sock.end(); resolve(true); });
      sock.once('timeout', () => { sock.destroy(); retry(); });
      sock.once('error', () => { retry(); });
      sock.connect(port, host);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) resolve(false);
      else setTimeout(attempt, 200);
    };
    attempt();
  });
}
