// getErrorDetail — the live drill-down path on the telemetry service. It runs
// ONE query (the buildErrorDetailQuery pipeline) over the requested window and
// returns the raw rows. Contract:
//   - Axiom unconfigured  → { seed:true, rows:[] }, and NEVER fetches;
//   - empty err_name      → { rows:[] } without a query;
//   - configured + name   → queries Axiom, returns the raw occurrence rows;
//   - a query failure PROPAGATES (the route maps it to 502, like getTelemetry).

import { describe, it, expect, vi } from 'vitest';
import { createTelemetryService } from '../src/server/telemetry-service.js';

// Build Axiom's column-major tabular response from an array of row objects.
function tabular(rows) {
  const names = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const columns = names.map((n) => rows.map((r) => r[n]));
  return { tables: [{ fields: names.map((name) => ({ name })), columns }] };
}

describe('getErrorDetail', () => {
  it('reports seed (and never fetches) when Axiom is not configured', async () => {
    const fetchImpl = vi.fn();
    const svc = createTelemetryService({ axiomToken: '', axiomDataset: 'app-errors', fetchImpl });
    const res = await svc.getErrorDetail('7d', 'TimeoutError');
    expect(res.seed).toBe(true);
    expect(res.rows).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns [] without querying when err_name is blank', async () => {
    const fetchImpl = vi.fn();
    const svc = createTelemetryService({ axiomToken: 't', axiomDataset: 'app-errors', fetchImpl });
    const res = await svc.getErrorDetail('7d', '   ');
    expect(res.rows).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('queries Axiom for the err_name and returns the raw occurrence rows', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () =>
        tabular([
          { _time: '2026-07-24T10:00:00Z', app: 'planner', acc: 'acc1', err_name: 'TimeoutError', usr: 'u1' },
        ]),
    }));
    const svc = createTelemetryService({
      axiomToken: 't',
      axiomDataset: 'app-errors',
      fetchImpl,
      now: () => Date.parse('2026-07-24T12:00:00Z'),
    });
    const res = await svc.getErrorDetail('24h', 'TimeoutError');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.apl).toContain("__name=='TimeoutError'"); // matched via the shared name derivation
    expect(body.apl).toContain("kind=='error'");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].usr).toBe('u1'); // enrichment field survives the round-trip
  });

  it('propagates a query failure so the route can turn it into 502', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
    const svc = createTelemetryService({ axiomToken: 't', axiomDataset: 'app-errors', fetchImpl });
    await expect(svc.getErrorDetail('7d', 'X')).rejects.toThrow(/axiom query failed/);
  });
});
