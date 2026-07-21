// Tests for the process crash nets. installProcessGuards must register handlers
// that SHIP through the logger; uncaughtException additionally flushes then exits.
// process.on is spied so the test never attaches real handlers to the test runner.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installProcessGuards } from '../src/process-guards.js';

let onSpy;
beforeEach(() => {
  onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
});
afterEach(() => {
  onSpy.mockRestore();
});

describe('installProcessGuards', () => {
  it('registers both uncaughtException and unhandledRejection handlers', () => {
    installProcessGuards({ logger: { error: vi.fn() }, flush: vi.fn().mockResolvedValue(undefined) });
    const events = onSpy.mock.calls.map((c) => c[0]);
    expect(events).toContain('uncaughtException');
    expect(events).toContain('unhandledRejection');
  });

  it('returns the handler functions for direct invocation', () => {
    const guards = installProcessGuards({ logger: { error: vi.fn() }, flush: vi.fn().mockResolvedValue(undefined) });
    expect(typeof guards.onUncaughtException).toBe('function');
    expect(typeof guards.onUnhandledRejection).toBe('function');
  });

  it('unhandledRejection logs the Error instance and its message as cause', () => {
    const error = vi.fn();
    const { onUnhandledRejection } = installProcessGuards({ logger: { error }, flush: vi.fn() });
    const reason = new Error('floating');
    onUnhandledRejection(reason);
    expect(error).toHaveBeenCalledTimes(1);
    const [message, tag, ctx] = error.mock.calls[0];
    expect(message).toBe('unhandled_rejection');
    expect(tag).toBe('process');
    expect(ctx.cause).toBe('floating');
    expect(ctx.error).toBe(reason);
  });

  it('unhandledRejection stringifies a non-Error reason and ships no error object', () => {
    const error = vi.fn();
    const { onUnhandledRejection } = installProcessGuards({ logger: { error }, flush: vi.fn() });
    onUnhandledRejection('just a string');
    const ctx = error.mock.calls[0][2];
    expect(ctx.cause).toBe('just a string');
    expect(ctx.error).toBeUndefined();
  });

  it('uncaughtException logs, then flushes, then exits with code 1', async () => {
    const error = vi.fn();
    const order = [];
    const flush = vi.fn(() => { order.push('flush'); return Promise.resolve(); });
    const exit = vi.fn(() => { order.push('exit'); });
    const { onUncaughtException } = installProcessGuards({ logger: { error }, flush, exit });
    const err = new Error('fatal');
    await onUncaughtException(err);
    expect(error).toHaveBeenCalledTimes(1);
    const [message, tag, ctx] = error.mock.calls[0];
    expect(message).toBe('uncaught_exception');
    expect(tag).toBe('process');
    expect(ctx.error).toBe(err);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(order).toEqual(['flush', 'exit']);
  });

  it('uncaughtException still exits(1) when flush rejects', async () => {
    const exit = vi.fn();
    const flush = vi.fn().mockRejectedValue(new Error('flush blew up'));
    const { onUncaughtException } = installProcessGuards({ logger: { error: vi.fn() }, flush, exit });
    await onUncaughtException(new Error('fatal'));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
