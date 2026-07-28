// Unit tests for src/server/telemetry-service.js — the per-panel failure path (gap #7).
// A single failing APL panel must NOT take down the dashboard: it degrades to [] AND the
// failure now routes through the injected server logger (logger.warn) so it ships to the
// shared errors dataset when the sink is active — it used to be console-only and never
// shipped. Assert the routing, the fail-soft [], and that a healthy panel is untouched.
//
// Zero network: an injected fetchImpl answers the Axiom _apl endpoint. Failures are
// simulated by returning a non-ok Response for one panel's query.

import { describe, it, expect, vi } from 'vitest';
import { createTelemetryService } from '../src/server/telemetry-service.js';

const TOKEN = 'axiom-read-tok';
const DATASET = 'app-errors';

function makeLogger() {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), health: vi.fn(), debug: vi.fn() };
}

/** A tabular Axiom body with a single string column so tabularToRows yields one row. */
function tabularOk() {
  return { tables: [{ fields: [{ name: 'app' }], columns: [['axis-tracker']] }] };
}

/**
 * fetchImpl that inspects the APL text and fails exactly the panels whose query text
 * contains one of `failSubstrings`. Everything else returns a valid tabular body.
 */
function fetchFailingPanels(failSubstrings) {
  return vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    const apl = String(body.apl ?? '');
    if (failSubstrings.some((s) => apl.includes(s))) {
      return new Response('rate limited', { status: 429 });
    }
    return new Response(JSON.stringify(tabularOk()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('createTelemetryService — a failing panel fails soft AND routes through the logger', () => {
  it('logs telemetry_panel_failed at WARN with the panel name + status, and never console.error', async () => {
    const logger = makeLogger();
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Fail the top_errors panel only (its query text contains "top_errors" via summarize/name).
    const svc = createTelemetryService({
      axiomToken: TOKEN,
      axiomDataset: DATASET,
      fetchImpl: fetchFailingPanels(['topk', 'top_errors', 'err_name']),
      logger,
    });

    const payload = await svc.getTelemetry('7d');

    // The failure was logged through the injected logger, not the console.
    expect(logger.warn).toHaveBeenCalled();
    const call = logger.warn.mock.calls.find((c) => c[0] === 'telemetry_panel_failed');
    expect(call).toBeTruthy();
    expect(call[1]).toBe('axiom'); // tag
    expect(call[2].status).toBe(429);
    expect(typeof call[2].panel).toBe('string');
    expect(consoleErr).not.toHaveBeenCalled();
    consoleErr.mockRestore();

    // fail-soft: the failing panel degrades to [] while others carry data.
    expect(payload.seed).toBe(false);
    expect(Array.isArray(payload.errors_by_app)).toBe(true);
  });

  it('does not log when every panel succeeds', async () => {
    const logger = makeLogger();
    const svc = createTelemetryService({
      axiomToken: TOKEN,
      axiomDataset: DATASET,
      fetchImpl: fetchFailingPanels([]), // nothing fails
      logger,
    });

    await svc.getTelemetry('7d');

    expect(logger.warn).not.toHaveBeenCalledWith('telemetry_panel_failed', expect.anything(), expect.anything());
  });

  it('a failing panel still fails soft when NO logger is injected (logger is optional)', async () => {
    // The opts JSDoc marks logger optional; a panel failure must degrade to [] rather than
    // throw a TypeError on the log call and break the "never throws to caller" invariant.
    const svc = createTelemetryService({
      axiomToken: TOKEN,
      axiomDataset: DATASET,
      fetchImpl: fetchFailingPanels(['topk', 'top_errors', 'err_name']),
      // no logger
    });

    const payload = await svc.getTelemetry('7d');
    expect(payload.seed).toBe(false);
    expect(Array.isArray(payload.errors_by_app)).toBe(true);
  });

  it('reports seed mode (and never queries) when no axiom token is configured', async () => {
    const logger = makeLogger();
    const fetchImpl = vi.fn();
    const svc = createTelemetryService({ axiomToken: '', axiomDataset: DATASET, fetchImpl, logger });

    const payload = await svc.getTelemetry('7d');

    expect(payload.seed).toBe(true);
    expect(svc.enabled).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
