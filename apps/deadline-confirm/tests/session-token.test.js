// Unit tests for the sessionToken middleware factory (spec §9, §13, §15.10) —
// v3 multi-tenant: the single ALLOWED_ACCOUNT_ID lockdown becomes an OPTIONAL
// allowedAccountIds ARRAY (empty = every validly-signed account passes), and
// the module exports verifySessionToken for non-middleware callers (oauth
// start). Real JWTs signed with jsonwebtoken drive the REAL middleware — the
// unit under test is never mocked; req/res/next are minimal recording fakes.

import { describe, it, expect, vi } from 'vitest';
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

    it('passes ANY validly-signed account when the allowlist is the EMPTY array', async () => {
      const token = jwt.sign({ dat: { account_id: 999123, user_id: 5 } }, CLIENT_SECRET);

      const { req, res, next } = await run(token, []);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.session).toStrictEqual({ accountId: '999123', userId: '5' });
      expect(res.statusCode).toBeNull();
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
