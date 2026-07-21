// Tests for the terminal Express error middleware: it must SHIP the error through
// the logger and return a 500 JSON envelope (or delegate when headers are sent).

import { describe, it, expect, vi } from 'vitest';
import { createErrorMiddleware } from '../src/middlewares/error-middleware.js';

function fakeRes({ headersSent = false } = {}) {
  const res = {
    headersSent,
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

describe('createErrorMiddleware', () => {
  it('returns a 4-argument error handler (so Express recognises it)', () => {
    const mw = createErrorMiddleware({ error: vi.fn() });
    expect(mw.length).toBe(4);
  });

  it('ships the error via logger.error with method/path/status and the Error', () => {
    const error = vi.fn();
    const mw = createErrorMiddleware({ error });
    const err = new Error('kaboom');
    const req = { method: 'POST', path: '/api/policy' };
    const res = fakeRes();
    mw(err, req, res, vi.fn());
    expect(error).toHaveBeenCalledTimes(1);
    const [message, tag, ctx] = error.mock.calls[0];
    expect(message).toBe('error');
    expect(tag).toBe('http');
    expect(ctx.method).toBe('POST');
    expect(ctx.path).toBe('/api/policy');
    expect(ctx.status).toBe(500);
    expect(ctx.cause).toBe('kaboom');
    expect(ctx.error).toBe(err);
  });

  it('responds 500 internal_error and does not call next when headers are not sent', () => {
    const mw = createErrorMiddleware({ error: vi.fn() });
    const next = vi.fn();
    const res = fakeRes({ headersSent: false });
    mw(new Error('x'), { method: 'GET', path: '/p' }, res, next);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error' });
    expect(next).not.toHaveBeenCalled();
  });

  it('delegates to next(err) without writing a body when headers already sent', () => {
    const mw = createErrorMiddleware({ error: vi.fn() });
    const next = vi.fn();
    const err = new Error('mid-stream');
    const res = fakeRes({ headersSent: true });
    mw(err, { method: 'GET', path: '/p' }, res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.statusCode).toBeNull();
    expect(res.body).toBeNull();
  });

  it('still ships the error even when headers are already sent', () => {
    const error = vi.fn();
    const mw = createErrorMiddleware({ error });
    mw(new Error('late'), { method: 'GET', path: '/p' }, fakeRes({ headersSent: true }), vi.fn());
    expect(error).toHaveBeenCalledTimes(1);
  });
});
