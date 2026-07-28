// test-guard gate for src/index.ts — the public surface of @axis/app-core.
//
// Audit finding 11: errors/axiomSink.ts re-exports getAxiomStats and its docstring states
// it is "additionally exposed (additive, error-guard parity)", but the barrel omitted it —
// so `import { getAxiomStats } from '@axis/app-core'` failed with TS2305 despite the
// documented contract. A barrel is a promise; this suite is what keeps it honest.

import { describe, it, expect } from 'vitest';
import * as appCore from '../src/index';

describe('@axis/app-core barrel — the documented error-pipeline surface is importable', () => {
  // Every runtime binding errors/axiomSink.ts re-exports must reach consumers through the
  // barrel, since that is the only path apps import by.
  const AXIOM_SINK_EXPORTS = [
    'attachAxiomSink',
    'setAxiomContext',
    'isAxiomSinkActive',
    'setRemoteLevel',
    'shouldShip',
    'mapRecordToEvent',
    'scrubMessage',
    'getAxiomStats',
  ] as const;

  it.each(AXIOM_SINK_EXPORTS)('re-exports %s as a callable', (name) => {
    expect(typeof (appCore as unknown as Record<string, unknown>)[name]).toBe('function');
  });

  it('exposes getAxiomStats, which the docstring promises but the barrel used to drop', () => {
    expect(appCore).toHaveProperty('getAxiomStats');
    // It must be the real accessor, not a stray same-named binding: with no sink attached
    // it reports the inert handle rather than throwing.
    expect(appCore.getAxiomStats()).toEqual({ enabled: false });
  });

  it('keeps the rest of the error pipeline on the barrel too', () => {
    expect(typeof appCore.ErrorBoundary).toBe('function');
    expect(typeof appCore.setupGlobalErrorHandlers).toBe('function');
    expect(typeof appCore.useErrorHandler).toBe('function');
  });
});
