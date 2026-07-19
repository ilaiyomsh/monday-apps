// Unit tests for src/middlewares/webhook-auth.js (lifecycle spec — Tests
// bullet 1): verifyWithSecrets must pick the correct appSlug out of a
// multi-app secret map (with or without a `Bearer ` prefix) and return null
// for anything unverifiable — wrong secret, expired token, empty map —
// without ever throwing (fail-closed auth). The middleware must answer
// 401 { error: 'invalid_webhook_token' } on failure and set
// req.webhook = { appSlug, decoded } on success. Real JWTs signed with
// jsonwebtoken drive the REAL module — nothing under test is mocked;
// req/res/next are minimal recording fakes, the logger is a vi.fn() spy.

import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  verifyWithSecrets,
  createWebhookAuthMiddleware,
} from '../src/middlewares/webhook-auth.js';

const SECRETS = {
  'axis-tracker': 'secret-tracker',
  'axis-planner': 'secret-planner',
  discussions: 'secret-discussions',
};
const UNKNOWN_SECRET = 'secret-of-an-unconfigured-app';

const PAYLOAD = { type: 'AppFeatureBoardView:delete', accountId: 4242 };

function makeLogger() {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
}

function makeReq(authorization) {
  const headers = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return {
    headers,
    path: '/lifecycle',
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

function runMiddleware(authorization, { secretsBySlug = SECRETS, logger = makeLogger() } = {}) {
  const middleware = createWebhookAuthMiddleware({ secretsBySlug, logger });
  const req = makeReq(authorization);
  const res = makeRes();
  const next = vi.fn();
  middleware(req, res, next);
  return { req, res, next, logger };
}

describe('verifyWithSecrets', () => {
  it('picks the correct appSlug among 3 configured secrets and returns the decoded payload', () => {
    const token = jwt.sign(PAYLOAD, SECRETS['axis-planner']);

    const result = verifyWithSecrets(token, SECRETS);

    expect(result).not.toBeNull();
    expect(result.appSlug).toBe('axis-planner');
    expect(result.decoded).toMatchObject(PAYLOAD);
  });

  it('identifies each sender by whichever secret verifies (not map order)', () => {
    for (const slug of Object.keys(SECRETS)) {
      const token = jwt.sign(PAYLOAD, SECRETS[slug]);
      expect(verifyWithSecrets(token, SECRETS)?.appSlug).toBe(slug);
    }
  });

  it('accepts the same token with a "Bearer " prefix identically', () => {
    const token = jwt.sign(PAYLOAD, SECRETS.discussions);

    const bare = verifyWithSecrets(token, SECRETS);
    const prefixed = verifyWithSecrets(`Bearer ${token}`, SECRETS);

    expect(prefixed).toStrictEqual(bare);
    expect(prefixed.appSlug).toBe('discussions');
  });

  it('returns null for a token signed with a secret no configured app has', () => {
    const token = jwt.sign(PAYLOAD, UNKNOWN_SECRET);

    expect(verifyWithSecrets(token, SECRETS)).toBeNull();
  });

  it('returns null for EVERY token when the secret map is empty (fail-closed)', () => {
    const token = jwt.sign(PAYLOAD, SECRETS['axis-tracker']);

    expect(verifyWithSecrets(token, {})).toBeNull();
  });

  it('returns null for an expired token even though its secret is configured', () => {
    const token = jwt.sign(PAYLOAD, SECRETS['axis-tracker'], { expiresIn: -10 });

    expect(verifyWithSecrets(token, SECRETS)).toBeNull();
  });

  it('returns null — and never throws — for a malformed token string', () => {
    let result;
    expect(() => {
      result = verifyWithSecrets('not-a-jwt', SECRETS);
    }).not.toThrow();
    expect(result).toBeNull();
  });

  it('returns null — and never throws — for an empty token or missing map', () => {
    expect(verifyWithSecrets('', SECRETS)).toBeNull();
    expect(verifyWithSecrets(undefined, SECRETS)).toBeNull();
    const token = jwt.sign(PAYLOAD, SECRETS['axis-tracker']);
    expect(verifyWithSecrets(token, undefined)).toBeNull();
    expect(verifyWithSecrets(token, null)).toBeNull();
  });
});

describe('createWebhookAuthMiddleware', () => {
  it('sets req.webhook = { appSlug, decoded } and calls next() for a valid token', () => {
    const token = jwt.sign(PAYLOAD, SECRETS['axis-tracker']);

    const { req, res, next } = runMiddleware(token);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.webhook.appSlug).toBe('axis-tracker');
    expect(req.webhook.decoded).toMatchObject(PAYLOAD);
    expect(res.statusCode).toBeNull();
    expect(res.body).toBeNull();
  });

  it('accepts a "Bearer "-prefixed Authorization header identically', () => {
    const token = jwt.sign(PAYLOAD, SECRETS.discussions);

    const { req, next } = runMiddleware(`Bearer ${token}`);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.webhook.appSlug).toBe('discussions');
  });

  it('responds 401 { error: "invalid_webhook_token" }, warns, and never calls next() when the header is missing', () => {
    const { req, res, next, logger } = runMiddleware(undefined);

    expect(res.statusCode).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_webhook_token' });
    expect(next).not.toHaveBeenCalled();
    expect(req.webhook).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('responds 401 with the exact body shape for a token signed with an unknown secret', () => {
    const token = jwt.sign(PAYLOAD, UNKNOWN_SECRET);

    const { res, next } = runMiddleware(token);

    expect(res.statusCode).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_webhook_token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 for an expired token from a configured app', () => {
    const token = jwt.sign(PAYLOAD, SECRETS['axis-planner'], { expiresIn: -10 });

    const { res, next } = runMiddleware(token);

    expect(res.statusCode).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_webhook_token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 to a well-signed token when NO secrets are configured (fail-closed)', () => {
    const token = jwt.sign(PAYLOAD, SECRETS['axis-tracker']);

    const { res, next } = runMiddleware(token, { secretsBySlug: {} });

    expect(res.statusCode).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_webhook_token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('never leaks the token through the failure log (privacy rule)', () => {
    const token = jwt.sign(PAYLOAD, UNKNOWN_SECRET);

    const { logger } = runMiddleware(token);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(logger.warn.mock.calls[0]);
    expect(serialized).not.toContain(token);
  });
});
