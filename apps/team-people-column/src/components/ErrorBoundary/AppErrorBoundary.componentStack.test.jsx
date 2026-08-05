// AppErrorBoundary — locks the render-crash componentStack SHIPPING contract.
//
// Defect this guards (adversarial review 2026-07-21): handleError logged the error
// at ERROR (which ships) but put React's componentStack in a SEPARATE logger.debug
// record. That DEBUG record (a) is dropped by the sink's shouldShip (WARN/ERROR only)
// and (b) lands in record.data, not record.context — so @mapps/error-kit's Axiom sink,
// which reads componentStack ONLY from record.context.componentStack
// (browser/axiomSink.ts:209), never shipped the component tree. The fix folds
// componentStack into the ERROR record's context channel and removes the dead DEBUG
// record.
//
// These tests exercise the REAL logger (via addSink) so they cover both the
// AppErrorBoundary wiring AND logger.error's context channel — the exact pipeline a
// shipped record travels before the Axiom sink maps it.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import logger from '../../utils/logger';
import { AppErrorBoundary } from './AppErrorBoundary';

afterEach(() => cleanup());

function Boom({ message }) {
  throw new Error(message);
}

// react-error-boundary + React print the caught error to console.error; silence it so
// the test output stays about the assertions.
function captureRecords(ui) {
  const records = [];
  const unsub = logger.addSink((r) => records.push(r));
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    render(ui);
  } finally {
    spy.mockRestore();
    unsub();
  }
  return records;
}

describe('AppErrorBoundary — render-crash componentStack shipping', () => {
  it('ships ONE ERROR record carrying context.componentStack (with the component tree) and the error message', () => {
    const records = captureRecords(
      <AppErrorBoundary scope="cs">
        <Boom message="kaboom in tpc" />
      </AppErrorBoundary>
    );

    const errs = records.filter((r) => r.level === 'ERROR' && r.module === 'ErrorBoundary:cs');
    expect(errs.length).toBe(1);

    const rec = errs[0];
    // M4: the message is a CONSTANT event id, NOT error.message — the sink ships `message`
    // verbatim (only err_msg is scrubbed), so folding the raw message would leak PII. The
    // crash identity travels on the Error instance; distinct crashes still dedup distinctly
    // via err_name + err_msg (fix 5).
    expect(rec.message).toBe('render_error');
    expect(rec.error).toBeInstanceOf(Error);
    expect(rec.error.message).toBe('kaboom in tpc');
    // The component tree ships at the EXACT path the error-kit sink reads.
    expect(typeof rec.context?.componentStack).toBe('string');
    expect(rec.context.componentStack).toContain('Boom');
  });

  it('no longer emits a SEPARATE record that carries componentStack in data or at DEBUG', () => {
    const records = captureRecords(
      <AppErrorBoundary scope="cs2">
        <Boom message="kaboom again" />
      </AppErrorBoundary>
    );

    // No record may carry the componentStack in the data channel (the old dropped DEBUG record).
    const dataCarriers = records.filter((r) => r.data && typeof r.data === 'object' && 'componentStack' in r.data);
    expect(dataCarriers.length).toBe(0);

    // No DEBUG-level record for this boundary at all — the component stack now rides the ERROR record.
    const debugForBoundary = records.filter((r) => r.level === 'DEBUG' && r.module === 'ErrorBoundary:cs2');
    expect(debugForBoundary.length).toBe(0);
  });
});
