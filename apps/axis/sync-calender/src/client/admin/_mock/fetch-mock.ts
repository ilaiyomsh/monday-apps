// Intercepts fetch('/api/...') calls in dev/mock mode. Backs onto the shared
// in-memory state from data.ts; mutations are persisted to localStorage so
// refreshes preserve the test scenario.
import { state, saveState } from './data';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function parseBody(init: RequestInit | undefined): Promise<unknown> {
  if (!init?.body) return {};
  if (typeof init.body === 'string') {
    try { return JSON.parse(init.body); } catch { return {}; }
  }
  return {};
}

function normalizeConfig(c: Record<string, unknown>) {
  return {
    ...c,
    conditionals: Array.isArray(c.conditionals) ? c.conditionals : [],
    backfill: (c.backfill as unknown) ?? null,
  };
}

// Simulated backfill progression. When a row's backfill.status === 'running',
// we tick its processed count every ~800ms until it hits total. Deliberately
// slow so the progress bar + cancel button are visible in demos.
let simTimer: number | null = null;
function ensureSimulator() {
  if (simTimer != null) return;
  simTimer = window.setInterval(() => {
    let dirty = false;
    for (const c of state.configs as Array<Record<string, unknown>>) {
      const b = c.backfill as Record<string, unknown> | null | undefined;
      if (!b) continue;
      if (b.status === 'running') {
        const total = Number(b.total || 8);
        const processed = Number(b.processed || 0);
        const step = 1 + Math.floor(Math.random() * 2);
        const next = Math.min(total, processed + step);
        b.processed = next;
        b.updatedAt = Date.now();
        // Distribute counts roughly — for the mock we pretend everything was created.
        b.created = Math.min(total, Math.round(next * 0.7));
        b.updated = next - (b.created as number);
        if (next >= total) {
          b.status = 'done';
          b.finishedAt = Date.now();
        }
        dirty = true;
      } else if (b.status === 'cancelling') {
        b.status = 'cancelled';
        b.finishedAt = Date.now();
        dirty = true;
      }
    }
    if (dirty) saveState(state);
  }, 800);
}

async function route(method: string, url: URL, init?: RequestInit): Promise<Response | null> {
  const path = url.pathname;

  if (method === 'GET' && path === '/api/policy') {
    return json({
      policy: state.policy,
      isOwner: true,
      setupComplete: true,
    });
  }

  if (method === 'PATCH' && path === '/api/policy') {
    const body = (await parseBody(init)) as Record<string, unknown>;
    state.policy = { ...(state.policy as object), ...body, updatedAt: Date.now() };
    saveState(state);
    return json({ policy: state.policy });
  }

  if (method === 'GET' && path === '/api/configs') {
    return json({ rows: (state.configs as Record<string, unknown>[]).map(normalizeConfig) });
  }

  const patchMatch = path.match(/^\/api\/configs\/([^/]+)$/);
  if (patchMatch && method === 'PATCH') {
    const id = decodeURIComponent(patchMatch[1]);
    const body = (await parseBody(init)) as Record<string, unknown>;
    const row = (state.configs as Record<string, unknown>[]).find((c) => c.configId === id);
    if (!row) return json({ error: 'config_not_found' }, 404);
    Object.assign(row, body, { updatedAt: Date.now() });
    saveState(state);
    return json({ row: normalizeConfig(row) });
  }

  if (patchMatch && method === 'DELETE') {
    const id = decodeURIComponent(patchMatch[1]);
    state.configs = (state.configs as Record<string, unknown>[]).filter((c) => c.configId !== id);
    saveState(state);
    return json({ ok: true });
  }

  const forceSyncMatch = path.match(/^\/api\/configs\/([^/]+)\/force-sync$/);
  if (forceSyncMatch && method === 'POST') {
    const row = (state.configs as Record<string, unknown>[]).find(
      (c) => c.configId === decodeURIComponent(forceSyncMatch[1])
    );
    if (!row) return json({ error: 'config_not_found' }, 404);
    row.lastSyncAt = Date.now();
    saveState(state);
    return json({
      ok: true,
      result: { counts: { total: 3, created: 1, updated: 2, skipped: 0, deleted: 0 } },
    });
  }

  const enableMatch = path.match(/^\/api\/configs\/([^/]+)\/enable$/);
  if (enableMatch && method === 'POST') {
    const row = (state.configs as Record<string, unknown>[]).find(
      (c) => c.configId === decodeURIComponent(enableMatch[1])
    );
    if (!row) return json({ error: 'config_not_found' }, 404);
    row.status = 'active';
    row.lastError = null;
    row.updatedAt = Date.now();
    saveState(state);
    return json({ row: normalizeConfig(row) });
  }

  const pauseMatch = path.match(/^\/api\/configs\/([^/]+)\/pause$/);
  if (pauseMatch && method === 'POST') {
    const row = (state.configs as Record<string, unknown>[]).find(
      (c) => c.configId === decodeURIComponent(pauseMatch[1])
    );
    if (!row) return json({ error: 'config_not_found' }, 404);
    row.status = 'paused';
    row.updatedAt = Date.now();
    saveState(state);
    return json({ row: normalizeConfig(row) });
  }

  const backfillMatch = path.match(/^\/api\/configs\/([^/]+)\/backfill$/);
  if (backfillMatch && method === 'POST') {
    const row = (state.configs as Record<string, unknown>[]).find(
      (c) => c.configId === decodeURIComponent(backfillMatch[1])
    );
    if (!row) return json({ error: 'config_not_found' }, 404);
    const b = row.backfill as Record<string, unknown> | null | undefined;
    if (b && b.status === 'running') return json({ error: 'backfill_already_running', backfill: b }, 409);
    row.backfill = {
      status: 'running',
      total: 8,
      processed: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      errors: 0,
      cursor: null,
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + 6 * 30 * 24 * 3600 * 1000).toISOString(),
      windowMonths: 6,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
      lastError: null,
    };
    saveState(state);
    ensureSimulator();
    return json({ ok: true }, 202);
  }

  const cancelMatch = path.match(/^\/api\/configs\/([^/]+)\/backfill\/cancel$/);
  if (cancelMatch && method === 'POST') {
    const row = (state.configs as Record<string, unknown>[]).find(
      (c) => c.configId === decodeURIComponent(cancelMatch[1])
    );
    if (!row) return json({ error: 'config_not_found' }, 404);
    const b = row.backfill as Record<string, unknown> | null | undefined;
    if (!b || b.status !== 'running') return json({ error: 'no_running_backfill' }, 409);
    b.status = 'cancelling';
    b.updatedAt = Date.now();
    saveState(state);
    return json({ ok: true });
  }

  return null;
}

export function installFetchMock() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const urlStr = typeof input === 'string' ? input : (input as Request).url ?? String(input);
      const url = new URL(urlStr, window.location.origin);
      if (url.pathname.startsWith('/api/')) {
        const method = (init?.method || 'GET').toUpperCase();
        const res = await route(method, url, init);
        if (res) return res;
        console.warn('[mock fetch] unhandled /api call', method, url.pathname);
        return json({ error: 'mock_unhandled' }, 501);
      }
    } catch {
      /* fall through */
    }
    return realFetch(input as RequestInfo, init);
  };
}
