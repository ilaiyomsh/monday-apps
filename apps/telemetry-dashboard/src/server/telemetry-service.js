// Orchestrates the 11 APL queries into one dashboard payload, with a small
// in-memory per-window cache (~5 min) so repeated dashboard loads don't hammer
// Axiom. When no Axiom token is configured the service reports seed mode and
// the client falls back to the bundled synthetic dataset.

import { buildQueries, WINDOWS } from './queries.js';
import { createAxiomClient } from './axiom.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

// The panel keys, in the order they appear in the response payload.
const PANEL_KEYS = [
  'kpi_summary',
  'errors_by_app',
  'errors_by_account',
  'errors_over_time',
  'top_errors',
  'usage_by_app',
  'usage_by_account',
  'top_usage_events',
  'health_boot',
  'health_api_latency',
  'app_account_crosstab',
];

/**
 * @param {{ axiomToken: string, axiomDataset: string, axiomOrgId?: string, fetchImpl?: typeof fetch, now?: () => number, logger?: { warn: Function } }} opts
 */
export function createTelemetryService({ axiomToken, axiomDataset, axiomOrgId, fetchImpl, now, logger }) {
  const clock = now || (() => Date.now());
  const enabled = typeof axiomToken === 'string' && axiomToken.length > 0;
  const client = enabled ? createAxiomClient({ token: axiomToken, orgId: axiomOrgId, fetchImpl }) : null;
  const queries = buildQueries(axiomDataset);
  /** @type {Map<string, { at: number, payload: object }>} */
  const cache = new Map();

  function normalizeWindow(win) {
    return Object.prototype.hasOwnProperty.call(WINDOWS, win) ? win : '7d';
  }

  /**
   * Build the full payload for a window. Returns { seed:true } when Axiom is
   * not configured. Never throws to the caller for a single failed panel —
   * a failed panel becomes an empty array so the rest of the dashboard renders.
   * @param {string} rawWindow
   */
  async function getTelemetry(rawWindow) {
    const win = normalizeWindow(rawWindow);
    if (!enabled) {
      return { seed: true, window: win, generatedAt: new Date(clock()).toISOString() };
    }

    const cached = cache.get(win);
    if (cached && clock() - cached.at < CACHE_TTL_MS) {
      return cached.payload;
    }

    const end = new Date(clock());
    const start = new Date(clock() - WINDOWS[win]);
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const results = await Promise.all(
      PANEL_KEYS.map(async (key) => {
        try {
          const rows = await client.query(queries[key], startIso, endIso);
          return [key, rows];
        } catch (err) {
          // Route through the server logger so an Axiom-read failure ships to the shared
          // errors dataset when the sink is active (it used to be console-only and never
          // shipped even with the sink on). Panel + status only — never the token or the
          // full query text. The panel degrades to [] so the rest of the dashboard renders.
          // logger is optional (see the opts JSDoc) — guard the call so a caller that
          // omits it can never turn a soft panel failure into a thrown TypeError, which
          // would break the "never throws to the caller" invariant this function promises.
          logger?.warn?.('telemetry_panel_failed', 'axiom', {
            panel: key,
            status: Number.isFinite(err?.status) ? err.status : undefined,
            error: err instanceof Error ? err : new Error(String(err?.message ?? err)),
          });
          return [key, []];
        }
      })
    );

    const panels = Object.fromEntries(results);
    const payload = {
      seed: false,
      generatedAt: endIso,
      window: win,
      // kpi_summary is a single-row summarize — expose the row (or an empty {}).
      kpi_summary: Array.isArray(panels.kpi_summary) ? panels.kpi_summary[0] ?? {} : {},
      errors_by_app: panels.errors_by_app,
      errors_by_account: panels.errors_by_account,
      errors_over_time: panels.errors_over_time,
      top_errors: panels.top_errors,
      usage_by_app: panels.usage_by_app,
      usage_by_account: panels.usage_by_account,
      top_usage_events: panels.top_usage_events,
      health_boot: panels.health_boot,
      health_api_latency: panels.health_api_latency,
      app_account_crosstab: panels.app_account_crosstab,
    };

    cache.set(win, { at: clock(), payload });
    return payload;
  }

  return { getTelemetry, enabled };
}
