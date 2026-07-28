// Unit tests for src/middlewares/session-token.js (observability gap #6). A valid monday
// sessionToken is always required (401 otherwise); an optional allowlist further restricts
// which accounts may read (403). The change under test: auth denials are now logged at WARN
// (reason + account id only, NEVER token bytes) so a spike of rejected reads is visible,
// and verifySessionToken's catch records the raw failure at DEBUG instead of being silent.

import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  verifySessionToken,
  createSessionTokenMiddleware,
} from '../src/middlewares/session-token.js';

const SECRET = 'client-secret-under-test';

function signToken({ accountId = '111', userId = '222', secret = SECRET } = {}) {
  return jwt.sign({ dat: { account_id: accountId, user_id: userId } }, secret);
}

function makeLogger() {
  return { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() };
}

/** Minimal Express res double: records the status + json body. */
function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('verifySessionToken — pure predicate, non-silent catch', () => {
  it('returns { accountId, userId } as strings for a valid token', () => {
    const result = verifySessionToken(signToken({ accountId: 555, userId: 999 }), SECRET);
    expect(result).toEqual({ accountId: '555', userId: '999' });
  });

  it('returns null for a token signed with a different secret and logs the failure at DEBUG (no token bytes)', () => {
    const logger = makeLogger();
    const foreign = signToken({ secret: 'some-other-secret' });
    const result = verifySessionToken(foreign, SECRET, logger);
    expect(result).toBeNull();
    expect(logger.debug).toHaveBeenCalledWith(
      'session_token_verify_failed',
      'auth',
      expect.objectContaining({ reason: expect.any(String) })
    );
    // no argument to any logger call is the token itself
    for (const call of logger.debug.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(foreign);
    }
  });

  it('returns null WITHOUT entering the catch (no DEBUG) for an empty token — early return', () => {
    const logger = makeLogger();
    expect(verifySessionToken('', SECRET, logger)).toBeNull();
    expect(logger.debug).not.toHaveBeenCalled();
  });
});

describe('createSessionTokenMiddleware — auth denials are logged at WARN', () => {
  it('401s and logs session_token_rejected reason=invalid for a present-but-bad token', () => {
    const logger = makeLogger();
    const mw = createSessionTokenMiddleware({ clientSecret: SECRET, allowedAccountIds: [], logger });
    const req = { headers: { authorization: 'Bearer garbage.token.value' } };
    const res = makeRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_session_token' });
    expect(next).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('session_token_rejected', 'auth', { reason: 'invalid' });
  });

  it('401s and logs reason=missing when no Authorization header is present', () => {
    const logger = makeLogger();
    const mw = createSessionTokenMiddleware({ clientSecret: SECRET, allowedAccountIds: [], logger });
    const req = { headers: {} };
    const res = makeRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(logger.warn).toHaveBeenCalledWith('session_token_rejected', 'auth', { reason: 'missing' });
  });

  it('403s and logs session_forbidden_account (with the account id) when the allowlist excludes it', () => {
    const logger = makeLogger();
    const mw = createSessionTokenMiddleware({
      clientSecret: SECRET,
      allowedAccountIds: ['777'],
      logger,
    });
    const req = { headers: { authorization: signToken({ accountId: '111' }) } };
    const res = makeRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden_account' });
    expect(next).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('session_forbidden_account', 'auth', { acc: '111' });
  });

  it('calls next(), sets req.session, and logs NO warning for a valid allowed token', () => {
    const logger = makeLogger();
    const mw = createSessionTokenMiddleware({
      clientSecret: SECRET,
      allowedAccountIds: ['111'],
      logger,
    });
    const req = { headers: { authorization: signToken({ accountId: '111', userId: '222' }) } };
    const res = makeRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.session).toEqual({ accountId: '111', userId: '222' });
    expect(res.statusCode).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

// Audit finding 8: session_token_rejected is emitted BEFORE any credential is verified —
// any caller can reach it with no token at all — and WARN ships to Axiom under the default
// policy. Unbounded, 10k unauthenticated requests are 10k Axiom writes, which lets an
// external party choose our ingest bill. The 401 must stay unconditional while the write
// volume becomes bounded.
describe('createSessionTokenMiddleware — the pre-auth rejection WARN is budget-bounded', () => {
  /** A throttle double with an explicit budget, so the test never depends on the real cap. */
  function budget(limit) {
    let emitted = 0;
    let suppressed = 0;
    return {
      check() {
        if (emitted < limit) {
          emitted += 1;
          const s = suppressed;
          suppressed = 0;
          return { suppressed: s };
        }
        suppressed += 1;
        return null;
      },
    };
  }

  it('emits at most the budgeted number of WARNs no matter how many probes arrive', () => {
    const logger = makeLogger();
    const mw = createSessionTokenMiddleware({
      clientSecret: SECRET,
      allowedAccountIds: [],
      logger,
      throttle: budget(2),
    });

    for (let i = 0; i < 25; i++) {
      mw({ headers: {} }, makeRes(), vi.fn());
    }

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('still 401s every unauthenticated request while the WARN budget is exhausted', () => {
    const logger = makeLogger();
    const mw = createSessionTokenMiddleware({
      clientSecret: SECRET,
      allowedAccountIds: [],
      logger,
      throttle: budget(0),
    });

    const statuses = [];
    const nexts = [];
    for (let i = 0; i < 5; i++) {
      const res = makeRes();
      const next = vi.fn();
      mw({ headers: {} }, res, next);
      statuses.push(res.statusCode);
      nexts.push(next.mock.calls.length);
    }

    // Security is never throttled: every probe is still rejected, none reaches the handler.
    expect(statuses).toEqual([401, 401, 401, 401, 401]);
    expect(nexts).toEqual([0, 0, 0, 0, 0]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reports the suppressed count on the next emitted WARN so the loss is never silent', () => {
    const logger = makeLogger();
    const scripted = { check: vi.fn() };
    scripted.check
      .mockReturnValueOnce({ suppressed: 0 })
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ suppressed: 2 });

    const mw = createSessionTokenMiddleware({
      clientSecret: SECRET,
      allowedAccountIds: [],
      logger,
      throttle: scripted,
    });
    for (let i = 0; i < 4; i++) mw({ headers: {} }, makeRes(), vi.fn());

    expect(logger.warn).toHaveBeenCalledTimes(2);
    // no noise key when nothing was lost, explicit count when it was
    expect(logger.warn).toHaveBeenNthCalledWith(1, 'session_token_rejected', 'auth', { reason: 'missing' });
    expect(logger.warn).toHaveBeenNthCalledWith(2, 'session_token_rejected', 'auth', { reason: 'missing', suppressed: 2 });
  });

  it('defaults to a real throttle when none is injected (the budget is not opt-in)', () => {
    const logger = makeLogger();
    const mw = createSessionTokenMiddleware({ clientSecret: SECRET, allowedAccountIds: [], logger });

    for (let i = 0; i < 200; i++) mw({ headers: {} }, makeRes(), vi.fn());

    // The real default cap is well under 200/min; the exact number is an implementation
    // detail, but "unbounded" must not be the default.
    expect(logger.warn.mock.calls.length).toBeLessThan(200);
  });
});
