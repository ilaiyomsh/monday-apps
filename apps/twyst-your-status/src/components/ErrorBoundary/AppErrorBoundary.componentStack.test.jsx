/**
 * M5 (2026-07-28): a render crash must ship its React componentStack on the ERROR
 * record itself, in `context`, so the Axiom sink maps it to `component_stack`.
 *
 * This surface previously logged the stack as a separate DEBUG record. DEBUG never
 * ships (the sink's default policy is WARN/ERROR only and the record carries no
 * alwaysShip), so the stack was collected and then dropped — the exact dead pattern
 * 888d0f2 removed from team-people-column and 6abd0e0 fixed for telemetry-client.
 * twyst joined the audited surfaces after that sweep, so it kept the dead shape.
 *
 * The audit checks that a boundary EXISTS, not that it ships a usable record — so
 * this is the gate for the ordering-independent half of the standard's claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import logger from '../../utils/logger';
import { AppErrorBoundary } from './AppErrorBoundary';

const Boom = () => {
  throw new Error('render exploded');
};

describe('AppErrorBoundary — componentStack reaches the shipped ERROR record', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // React logs the caught error to console.error; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const captureRecords = (ui) => {
    const records = [];
    const unsub = logger.addSink((r) => records.push(r));
    render(ui);
    unsub();
    return records;
  };

  it('ships an ERROR record whose context carries the componentStack', () => {
    const records = captureRecords(
      <AppErrorBoundary scope="root">
        <Boom />
      </AppErrorBoundary>
    );

    const errorRecords = records.filter((r) => r.level === 'ERROR');
    expect(errorRecords).toHaveLength(1);
    const rec = errorRecords[0];
    expect(rec.error).toBeInstanceOf(Error);
    // the stack must ride the ERROR record — not a separate never-shipped record
    expect(rec.context?.componentStack).toEqual(expect.stringContaining('Boom'));
  });

  it('does NOT park the componentStack on a DEBUG record (DEBUG never ships)', () => {
    const records = captureRecords(
      <AppErrorBoundary scope="root">
        <Boom />
      </AppErrorBoundary>
    );

    const debugWithStack = records.filter(
      (r) => r.level === 'DEBUG' && r.context?.componentStack
    );
    expect(debugWithStack).toHaveLength(0);
  });
});
