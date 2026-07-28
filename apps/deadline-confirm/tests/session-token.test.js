// Unit tests for the sessionToken middleware factory (spec §9, §13, §15.10) —
// V6 D15: allowedAccountIds is the tenant roster — empty = default-deny
// (nobody admitted). The module exports verifySessionToken for non-middleware
// callers (oauth start). Real JWTs signed with jsonwebtoken drive the REAL
// middleware — the unit under test is never mocked; req/res/next are minimal
// recording fakes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  createSessionTokenMiddleware,
  verifySessionToken,
} from '../src/middlewares/session-token.js';

const CLIENT_SECRET = 'test-cs';
const OTHER_SECRET = 'not-the-client-secret';
const ALLOWED_ACCOUNT_IDS = ['777'];

const VALID_PAYLOAD = { dat: { account_id: 777, user_id: 12 } };

function buildMiddleware(allowedAccountIds = ALLOWED_ACCOUNT_IDS) {
  return createSessionTokenMiddleware({
    clientSecret: CLIENT_SECRET,
    allowedAccountIds,
  });
}

function makeReq(authorization) {
  const headers = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return {
    headers,
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };
}

function makeRes() {
  return {
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
}

async function run(authorization, allowedAccountIds) {
  const middleware = buildMiddleware(allowedAccountIds);
  const req = makeReq(authorization);
  const res = makeRes();
  const next = vi.fn();
  await middleware(req, res, next);
  return { req, res, next };
}

describe('createSessionTokenMiddleware', () => {
  it('calls next() and sets req.session with STRING accountId/userId for a valid raw token of an allowlisted account', async () => {
    const token = jwt.sign(VALID_PAYLOAD, CLIENT_SECRET);

    const { req, res, next } = await run(token);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.session).toStrictEqual({ accountId: '777', userId: '12' });
    expect(res.statusCode).toBeNull();
    expect(res.body).toBeNull();
  });

  it('accepts the same token with a "Bearer " prefix identically', async () => {
    const token = jwt.sign(VALID_PAYLOAD, CLIENT_SECRET);

    const { req, res, next } = await run(`Bearer ${token}`);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.session).toStrictEqual({ accountId: '777', userId: '12' });
    expect(res.statusCode).toBeNull();
  });

  it('responds 401 invalid_session_token and never calls next() when the Authorization header is missing', async () => {
    const { res, next } = await run(undefined);

    expect(res.statusCode).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_session_token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 and never calls next() for a token signed with a different secret', async () => {
    const token = jwt.sign(VALID_PAYLOAD, OTHER_SECRET);

    const { res, next } = await run(token);

    expect(res.statusCode).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_session_token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 and never calls next() for an expired token', async () => {
    const token = jwt.sign(VALID_PAYLOAD, CLIENT_SECRET, { expiresIn: -10 });

    const { res, next } = await run(token);

    expect(res.statusCode).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_session_token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 and never calls next() for a validly signed payload without a dat identity', async () => {
    const token = jwt.sign({ account_id: 777, user_id: 12 }, CLIENT_SECRET);

    const { res, next } = await run(token);

    expect(res.statusCode).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_session_token' });
    expect(next).not.toHaveBeenCalled();
  });

  describe('allowedAccountIds allowlist (v3)', () => {
    it('responds 403 forbidden_account and never calls next() when the account is not in a non-empty allowlist', async () => {
      const token = jwt.sign({ dat: { account_id: 888, user_id: 12 } }, CLIENT_SECRET);

      const { res, next } = await run(token, ['777']);

      expect(res.statusCode).toBe(403);
      expect(res.body).toStrictEqual({ error: 'forbidden_account' });
      expect(next).not.toHaveBeenCalled();
    });

    it('passes a token whose numeric dat.account_id matches ONE of several allowlisted string ids', async () => {
      const token = jwt.sign({ dat: { account_id: 888, user_id: 12 } }, CLIENT_SECRET);

      const { req, res, next } = await run(token, ['777', '888']);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.session).toStrictEqual({ accountId: '888', userId: '12' });
      expect(res.statusCode).toBeNull();
    });

    it('refuses ANY validly-signed account with 403 when the allowlist is the EMPTY array (D15 default-deny)', async () => {
      const token = jwt.sign({ dat: { account_id: 999123, user_id: 5 } }, CLIENT_SECRET);

      const { req, res, next } = await run(token, []);

      expect(res.statusCode).toBe(403);
      expect(res.body).toStrictEqual({ error: 'forbidden_account' });
      expect(next).not.toHaveBeenCalled();
      expect(req.session).toBeUndefined();
    });

    it('still responds 401 (never 403) to a badly-signed token when the allowlist is empty', async () => {
      const token = jwt.sign(VALID_PAYLOAD, OTHER_SECRET);

      const { res, next } = await run(token, []);

      expect(res.statusCode).toBe(401);
      expect(res.body).toStrictEqual({ error: 'invalid_session_token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('still responds 401 to a dat-less token when the allowlist is empty', async () => {
      const token = jwt.sign({ account_id: 777, user_id: 12 }, CLIENT_SECRET);

      const { res, next } = await run(token, []);

      expect(res.statusCode).toBe(401);
      expect(res.body).toStrictEqual({ error: 'invalid_session_token' });
      expect(next).not.toHaveBeenCalled();
    });
  });
});

describe('verifySessionToken (v3 export)', () => {
  it('returns { accountId, userId } as STRINGS for a valid raw token', () => {
    const token = jwt.sign(VALID_PAYLOAD, CLIENT_SECRET);
    expect(verifySessionToken(token, CLIENT_SECRET)).toStrictEqual({
      accountId: '777',
      userId: '12',
    });
  });

  it('accepts the same token with a "Bearer " prefix identically', () => {
    const token = jwt.sign(VALID_PAYLOAD, CLIENT_SECRET);
    expect(verifySessionToken(`Bearer ${token}`, CLIENT_SECRET)).toStrictEqual({
      accountId: '777',
      userId: '12',
    });
  });

  it('returns null for a token signed with a different secret', () => {
    const token = jwt.sign(VALID_PAYLOAD, OTHER_SECRET);
    expect(verifySessionToken(token, CLIENT_SECRET)).toBeNull();
  });

  it('returns null — and never throws — for a malformed token string', () => {
    let result;
    expect(() => {
      result = verifySessionToken('not-a-jwt', CLIENT_SECRET);
    }).not.toThrow();
    expect(result).toBeNull();
  });

  it('returns null for a validly signed payload without a dat identity', () => {
    const token = jwt.sign({ account_id: 777, user_id: 12 }, CLIENT_SECRET);
    expect(verifySessionToken(token, CLIENT_SECRET)).toBeNull();
  });

  it('returns null when dat.account_id is missing', () => {
    const token = jwt.sign({ dat: { user_id: 12 } }, CLIENT_SECRET);
    expect(verifySessionToken(token, CLIENT_SECRET)).toBeNull();
  });

  it('returns null when dat.user_id is missing', () => {
    const token = jwt.sign({ dat: { account_id: 777 } }, CLIENT_SECRET);
    expect(verifySessionToken(token, CLIENT_SECRET)).toBeNull();
  });
});

describe('verifySessionToken — verification-failure telemetry (WARN, reason only, no token)', () => {
  let errSpy;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** All console.error lines that parse as JSON WARN records. */
  const warnRecords = () =>
    errSpy.mock.calls
      .map((c) => c[0])
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((e) => e && e.level === 'warn');

  it("logs exactly ONE WARN {tag:'auth', reason:'JsonWebTokenError'} and never the token for a wrong-secret token", () => {
    const token = jwt.sign(VALID_PAYLOAD, OTHER_SECRET);

    expect(verifySessionToken(token, CLIENT_SECRET)).toBeNull();

    const warns = warnRecords();
    expect(warns).toHaveLength(1);
    expect(warns[0].tag).toBe('auth');
    expect(warns[0].message).toBe('session token verification failed');
    expect(warns[0].reason).toBe('JsonWebTokenError');
    // the raw token must never appear anywhere in the logged output
    for (const call of errSpy.mock.calls) {
      expect(call.map(String).join(' ')).not.toContain(token);
    }
  });

  it("reports reason 'TokenExpiredError' for an expired but correctly-signed token", () => {
    const token = jwt.sign(VALID_PAYLOAD, CLIENT_SECRET, { expiresIn: -10 });
    verifySessionToken(token, CLIENT_SECRET);
    expect(warnRecords()[0].reason).toBe('TokenExpiredError');
  });

  it('does NOT log a WARN when the token is simply absent (empty string is not a verification failure)', () => {
    expect(verifySessionToken('', CLIENT_SECRET)).toBeNull();
    expect(warnRecords()).toHaveLength(0);
  });

  it('does NOT log a WARN for a validly-signed token that merely lacks the dat identity (verify succeeded)', () => {
    const token = jwt.sign({ account_id: 777, user_id: 12 }, CLIENT_SECRET);
    expect(verifySessionToken(token, CLIENT_SECRET)).toBeNull();
    expect(warnRecords()).toHaveLength(0);
  });
});

// Audit finding 8: the verification-failure WARN is reachable WITHOUT credentials
// (/oauth/start takes ?st=<sessionToken>), and WARN ships to Axiom by default. Unbounded,
// 10k unauthenticated requests are 10k Axiom writes — an external party choosing our
// ingest bill. The rejection must stay VISIBLE while the write volume stays BOUNDED.
describe('verifySessionToken — the rejection WARN is budget-bounded (audit finding 8)', () => {
  let errSpy;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const warnRecords = () =>
    errSpy.mock.calls
      .map((c) => c[0])
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((e) => e && e.level === 'warn');

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

  it('emits at most the budgeted number of WARNs no matter how many rejections arrive', () => {
    const token = jwt.sign(VALID_PAYLOAD, OTHER_SECRET);
    const throttle = budget(2);

    for (let i = 0; i < 25; i++) {
      expect(verifySessionToken(token, CLIENT_SECRET, throttle)).toBeNull();
    }

    // 25 unauthenticated probes must not become 25 Axiom writes.
    expect(warnRecords()).toHaveLength(2);
  });

  it('still rejects every token while the WARN budget is exhausted (security is not throttled)', () => {
    const token = jwt.sign(VALID_PAYLOAD, OTHER_SECRET);
    const throttle = budget(0);

    const results = [];
    for (let i = 0; i < 5; i++) results.push(verifySessionToken(token, CLIENT_SECRET, throttle));

    expect(results).toEqual([null, null, null, null, null]);
    expect(warnRecords()).toHaveLength(0);
  });

  it('reports the suppressed count on the next emitted WARN so the loss is never silent', () => {
    const token = jwt.sign(VALID_PAYLOAD, OTHER_SECRET);
    // A throttle that allows one, suppresses two, then allows again.
    const scripted = { check: vi.fn() };
    scripted.check
      .mockReturnValueOnce({ suppressed: 0 })
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ suppressed: 2 });

    for (let i = 0; i < 4; i++) verifySessionToken(token, CLIENT_SECRET, scripted);

    const warns = warnRecords();
    expect(warns).toHaveLength(2);
    expect(warns[0].suppressed).toBeUndefined(); // no noise key when nothing was lost
    expect(warns[1].suppressed).toBe(2);
    expect(warns[1].reason).toBe('JsonWebTokenError');
  });
});
