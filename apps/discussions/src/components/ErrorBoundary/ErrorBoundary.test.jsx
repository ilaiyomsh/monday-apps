// ErrorBoundary — locks the render-crash record's componentStack contract.
//
// Defect this guards (adversarial review 2026-07-21): componentDidCatch dropped
// React's 2nd `errorInfo` arg, so the shipped render-crash ERROR record carried a
// JS stack but NEVER React's componentStack. @mapps/error-kit's Axiom sink reads
// componentStack ONLY from record.context.componentStack (browser/axiomSink.ts:209),
// so shipped records had no component tree. The fix threads errorInfo.componentStack
// through logger.error(...)'s context channel onto record.context.componentStack.
//
// These tests exercise the REAL logger (via addSink) so they cover both the
// ErrorBoundary wiring AND logger.error's context channel — the exact pipeline a
// shipped record travels before the Axiom sink maps it.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import logger from '../../utils/logger';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(() => cleanup());

function Boom({ message }) {
  throw new Error(message);
}

// React prints "The above error occurred" to console.error on a caught render
// throw; silence it so the test output stays about the assertions.
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

describe('ErrorBoundary — render-crash componentStack shipping', () => {
  it('emits ONE ERROR record carrying context.componentStack with the component tree', () => {
    const records = captureRecords(
      <ErrorBoundary>
        <Boom message="kaboom in discussions" />
      </ErrorBoundary>
    );

    const errs = records.filter((r) => r.level === 'ERROR' && r.module === 'ErrorBoundary');
    expect(errs.length).toBe(1);

    const rec = errs[0];
    // The crash identity travels on the Error instance (scrubbed to err_msg by the sink),
    // NOT the message field — see the privacy test below.
    expect(rec.error).toBeInstanceOf(Error);
    expect(rec.error.message).toContain('kaboom in discussions');
    // The component tree ships at the EXACT path the error-kit sink reads.
    expect(typeof rec.context?.componentStack).toBe('string');
    expect(rec.context.componentStack).toContain('Boom');
  });

  it('M4: the record message is a CONSTANT event id — a raw error.message never leaks into it', () => {
    // The sink ships `message` verbatim (only err_msg is scrubbed), so folding error.message
    // in would leak PII. Distinct crashes still dedup distinctly via err_name + err_msg (fix 5).
    const records = captureRecords(
      <ErrorBoundary>
        <Boom message="leak admin@corp.co id 12345678" />
      </ErrorBoundary>
    );
    const rec = records.find((r) => r.level === 'ERROR' && r.module === 'ErrorBoundary');
    expect(rec.message).toBe('render_error');
    expect(rec.message).not.toContain('@');
    expect(rec.message).not.toContain('12345678');
    // the identity is preserved on the Error instance for the sink's scrubbed err_msg
    expect(rec.error.message).toContain('leak admin@corp.co id 12345678');
  });
});
