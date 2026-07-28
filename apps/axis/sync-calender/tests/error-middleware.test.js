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

  it('coerces a non-Error rejection so the shipped record is never empty (Low)', () => {
    // next('boom') / a thrown string reaches here as a non-Error. Previously ctx.error was
    // undefined AND ctx.cause was err?.message (also undefined) — the record shipped empty,
    // so a real failure was invisible in Axiom. It must coerce to an Error and carry a cause.
    const error = vi.fn();
    const mw = createErrorMiddleware({ error });
    mw('string failure', { method: 'GET', path: '/p' }, fakeRes(), vi.fn());
    const ctx = error.mock.calls[0][2];
    expect(ctx.error).toBeInstanceOf(Error);
    expect(ctx.error.message).toContain('string failure');
    expect(ctx.cause).toContain('string failure');
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

  // A blanket 500 on a CLIENT error is an operational bug, not a cosmetic one: Google and
  // Microsoft Graph mark a push subscription unhealthy on 5xx, so one truncated webhook
  // body could take the subscription down. body-parser tags its own errors (400 malformed
  // JSON, 413 over the size limit) and Express's finalhandler honoured that before this
  // middleware existed — so the middleware must honour it too, in BOTH the response and
  // the shipped record.
  describe('status derivation', () => {
    /** @returns {{ status: number, body: unknown, shipped: number }} */
    function run(err) {
      const error = vi.fn();
      const mw = createErrorMiddleware({ error });
      const res = fakeRes();
      mw(err, { method: 'POST', path: '/webhook/microsoft' }, res, vi.fn());
      return { status: res.statusCode, body: res.body, shipped: error.mock.calls[0][2].status };
    }

    it('honours err.status=400 from a malformed JSON body in the response and the record', () => {
      const err = Object.assign(new SyntaxError('Unexpected end of JSON input'), { status: 400 });
      expect(run(err)).toEqual({
        status: 400,
        body: { error: 'invalid_request' },
        shipped: 400,
      });
    });

    it('honours err.statusCode=413 when the payload exceeds the body-parser limit', () => {
      const err = Object.assign(new Error('request entity too large'), { statusCode: 413 });
      expect(run(err)).toEqual({
        status: 413,
        body: { error: 'invalid_request' },
        shipped: 413,
      });
    });

    it('honours 400, the low edge of the trusted client-error band', () => {
      expect(run(Object.assign(new Error('e'), { status: 400 })).status).toBe(400);
    });

    it('honours 499, the high edge of the trusted client-error band', () => {
      expect(run(Object.assign(new Error('e'), { status: 499 })).status).toBe(499);
    });

    it('rejects 399, just below the band, and answers 500 internal_error', () => {
      expect(run(Object.assign(new Error('e'), { status: 399 }))).toEqual({
        status: 500,
        body: { error: 'internal_error' },
        shipped: 500,
      });
    });

    it('rejects 500, just above the band, and answers 500 internal_error', () => {
      expect(run(Object.assign(new Error('e'), { status: 500 })).body).toEqual({ error: 'internal_error' });
    });

    it('does not let an upstream 502 masquerade as a client error', () => {
      expect(run(Object.assign(new Error('bad gateway'), { status: 502 })).status).toBe(500);
    });

    it('prefers err.status over err.statusCode when both are present', () => {
      // Both branches must be distinguishable, else this pins nothing (P6).
      const err = Object.assign(new Error('e'), { status: 404, statusCode: 451 });
      expect(run(err).status).toBe(404);
    });

    it('falls back to 500 when the claimed status is not a number', () => {
      expect(run(Object.assign(new Error('e'), { status: 'teapot' })).status).toBe(500);
    });

    it('falls back to 500 for a fractional claimed status', () => {
      expect(run(Object.assign(new Error('e'), { status: 404.5 })).status).toBe(500);
    });

    it('answers 500 for a plain Error that claims no status at all', () => {
      expect(run(new Error('kaboom'))).toEqual({
        status: 500,
        body: { error: 'internal_error' },
        shipped: 500,
      });
    });

    it('answers 500 for a non-Error rejection carrying no status', () => {
      expect(run('string failure').status).toBe(500);
    });

    it('delegates the ORIGINAL error to next when headers are sent, whatever its status', () => {
      const mw = createErrorMiddleware({ error: vi.fn() });
      const next = vi.fn();
      const err = Object.assign(new SyntaxError('bad body'), { status: 400 });
      const res = fakeRes({ headersSent: true });
      mw(err, { method: 'POST', path: '/webhook/microsoft' }, res, next);
      expect(next).toHaveBeenCalledWith(err);
      expect(res.statusCode).toBeNull();
    });
  });
});
