// Tests for GET /api/policy handler. The load-bearing property: a rejection from
// the body await (isPolicyOwner) is CAUGHT — it logs and returns 500 instead of
// becoming an unhandled promise rejection (the pre-fix behaviour).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const isPolicyOwner = vi.fn();
const loggerError = vi.fn();

vi.mock('../src/middlewares/authz.js', () => ({
  isPolicyOwner,
  loadPolicyWithAccountGuard: (_req, _res, next) => next(),
  requirePolicyOwnership: (_req, _res, next) => next(),
}));
vi.mock('../src/services/provider.js', () => ({
  isMicrosoftEnabled: () => true,
}));
vi.mock('../src/services/logger.js', () => ({
  default: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { getPolicyHandler } = await import('../src/routes/policy.js');

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPolicyHandler', () => {
  it('returns 404 policy_not_found when no policy attached', async () => {
    const res = fakeRes();
    await getPolicyHandler({ policy: null, session: { userId: '1', accountId: '9' } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'policy_not_found' });
  });

  it('returns policy + ownership + setupComplete on success', async () => {
    isPolicyOwner.mockResolvedValue(true);
    const res = fakeRes();
    const policy = { objectId: 'o1', boardId: 'b1', linkColumnId: 'l1', lockColumnId: 'k1' };
    await getPolicyHandler({ policy, session: { userId: '1', accountId: '9' } }, res);
    expect(res.statusCode).toBeNull(); // res.json without status = 200
    expect(res.body.policy).toBe(policy);
    expect(res.body.isOwner).toBe(true);
    expect(res.body.setupComplete).toBe(true);
    expect(res.body.microsoftEnabled).toBe(true);
  });

  it('reports setupComplete false when a required column is missing', async () => {
    isPolicyOwner.mockResolvedValue(false);
    const res = fakeRes();
    const policy = { objectId: 'o1', boardId: 'b1', linkColumnId: 'l1' }; // no lockColumnId
    await getPolicyHandler({ policy, session: { userId: '1', accountId: '9' } }, res);
    expect(res.body.setupComplete).toBe(false);
    expect(res.body.isOwner).toBe(false);
  });

  it('CATCHES an isPolicyOwner rejection: logs and returns 500 (no unhandled rejection)', async () => {
    isPolicyOwner.mockRejectedValue(new Error('storage down'));
    const res = fakeRes();
    const policy = { objectId: 'o1', accountId: '9', boardId: 'b1' };
    await getPolicyHandler({ policy, session: { userId: '1', accountId: '9' } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'policy_get_failed' });
    expect(loggerError).toHaveBeenCalledTimes(1);
    const [message, tag, ctx] = loggerError.mock.calls[0];
    expect(message).toBe('error');
    expect(tag).toBe('policy');
    expect(ctx.stage).toBe('policy_get');
    expect(ctx.cause).toBe('storage down');
  });
});
