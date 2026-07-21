// test-guard gate for logWarn — the WARN line writer added to helpers/logger.js.
// WARN must (a) render one stderr JSON line with level:"warn" and the context
// fields, and (b) feed the sink pipeline as a WARN record that ships by default.
// (The byte-exact shapes of logAttempt/logError/logInfo stay locked in
// tests/core-output.test.js — this file covers ONLY the new WARN surface.)

import { describe, it, expect, vi, afterEach } from 'vitest';
import { logWarn, addSink } from '../src/helpers/logger.js';
import { shouldShip } from '../src/helpers/axiomServerSink.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

describe('logWarn', () => {
  it('emits ONE stderr JSON line with level:"warn", the exact tag/message, and context fields; nothing to stdout', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logWarn('auth', 'session token verification failed', { reason: 'TokenExpiredError' });

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    const parsed = JSON.parse(errSpy.mock.calls[0][0]);
    expect(Object.keys(parsed).sort()).toEqual(['level', 'message', 'reason', 'tag', 'ts']);
    expect(parsed.level).toBe('warn');
    expect(parsed.tag).toBe('auth');
    expect(parsed.message).toBe('session token verification failed');
    expect(parsed.reason).toBe('TokenExpiredError');
    expect(parsed.ts).toMatch(ISO_8601);
  });

  it('feeds the sink pipeline a WARN record (tag/message/context) that shipsShip=true by default', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const records = [];
    const unsub = addSink((r) => records.push(r));
    try {
      logWarn('auth', 'session token verification failed', { reason: 'JsonWebTokenError' });
    } finally {
      unsub();
    }
    const rec = records.find((r) => r.tag === 'auth');
    expect(rec).toBeTruthy();
    expect(rec.level).toBe('WARN');
    expect(rec.message).toBe('session token verification failed');
    expect(rec.context.reason).toBe('JsonWebTokenError');
    // WARN clears the default ship threshold (INFO would not).
    expect(shouldShip(rec)).toBe(true);
  });

  it('never places the record on stdout even with an empty context', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logWarn('auth', 'session token verification failed');
    expect(logSpy).not.toHaveBeenCalled();
  });
});
