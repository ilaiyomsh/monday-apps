// Unit tests for the sessionToken middleware factory (spec §9, §13, §15.10).
// Real JWTs signed with jsonwebtoken drive the REAL middleware — the unit
// under test is never mocked; req/res/next are minimal recording fakes.

import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createSessionTokenMiddleware } from '../src/middlewares/session-token.js';

const CLIENT_SECRET = 'test-cs';
const OTHER_SECRET = 'not-the-client-secret';
const ALLOWED_ACCOUNT_ID = '777';

const VALID_PAYLOAD = { dat: { account_id: 777, user_id: 12 } };

function buildMiddleware() {
  return createSessionTokenMiddleware({
    clientSecret: CLIENT_SECRET,
    allowedAccountId: ALLOWED_ACCOUNT_ID,
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

async function run(authorization) {
  const middleware = buildMiddleware();
  const req = makeReq(authorization);
  const res = makeRes();
  const next = vi.fn();
  await middleware(req, res, next);
  return { req, res, next };
}

describe('createSessionTokenMiddleware', () => {
  it('calls next() and sets req.session with STRING accountId/userId for a valid raw token', async () => {
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

  it('responds 403 forbidden_account and never calls next() when the account is not the allowed one', async () => {
    const token = jwt.sign({ dat: { account_id: 888, user_id: 12 } }, CLIENT_SECRET);

    const { res, next } = await run(token);

    expect(res.statusCode).toBe(403);
    expect(res.body).toStrictEqual({ error: 'forbidden_account' });
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 and never calls next() for a validly signed payload without a dat identity', async () => {
    const token = jwt.sign({ account_id: 777, user_id: 12 }, CLIENT_SECRET);

    const { res, next } = await run(token);

    expect(res.statusCode).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_session_token' });
    expect(next).not.toHaveBeenCalled();
  });
});
