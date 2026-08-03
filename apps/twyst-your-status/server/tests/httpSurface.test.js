/**
 * HTTP surface contract for the guard service: the webhook receiver
 * (POST /api/guard/webhook) and the enroll/status endpoints. Runs supertest
 * against the real express factory with all collaborators injected as mocks.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';

const SIGNING_SECRET = 'signsec';
const CLIENT_SECRET = 'clisec';

/** monday change_status_column_value delivery shape */
function eventBody() {
  return {
    event: {
      userId: 41,
      boardId: 5098,
      pulseId: 777,
      columnId: 'status_col',
      columnType: 'color',
      value: { label: { index: 2, text: 'בוצע' } },
      previousValue: { label: { index: 0, text: 'ממתין' } },
      app: 'monday',
      type: 'update_column_value',
    },
  };
}

function makeDeps(envOverrides = {}) {
  return {
    handleEvent: vi.fn().mockResolvedValue(undefined),
    tokenStore: { getActivation: vi.fn(), setActivation: vi.fn() },
    enrollmentStore: { get: vi.fn(), set: vi.fn() },
    api: {
      getBoardOwnership: vi.fn(),
      getUserTeamIds: vi.fn(),
      createColumnWebhook: vi.fn(),
      me: vi.fn(),
    },
    env: {
      signingSecret: SIGNING_SECRET,
      clientSecret: CLIENT_SECRET,
      clientId: 'cid',
      baseUrl: 'https://guard.example',
      allowUnsignedWebhooks: false,
      ...envOverrides,
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    fetchImpl: vi.fn(),
  };
}

function signedWebhookJwt(secret = SIGNING_SECRET) {
  return jwt.sign({}, secret);
}

function sessionToken(secret = CLIENT_SECRET) {
  return jwt.sign({ dat: { account_id: 999, user_id: 41 } }, secret);
}

describe('POST /api/guard/webhook', () => {
  it('echoes the challenge with 200 before any auth check when body carries a challenge and no Authorization header', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/webhook?account=999')
      .send({ challenge: 'abc123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ challenge: 'abc123' });
    expect(deps.handleEvent).not.toHaveBeenCalled();
  });

  it('rejects an unsigned event body with 401 and never dispatches when allowUnsignedWebhooks is false', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/webhook?account=999')
      .send(eventBody());

    expect(res.status).toBe(401);
    expect(deps.handleEvent).not.toHaveBeenCalled();
  });

  it('rejects a JWT signed with the wrong secret with 401 and never dispatches', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/webhook?account=999')
      .set('Authorization', signedWebhookJwt('not-the-signing-secret'))
      .send(eventBody());

    expect(res.status).toBe(401);
    expect(deps.handleEvent).not.toHaveBeenCalled();
  });

  it('accepts a validly signed event with 202 { ok: true } and dispatches handleEvent once with accountId from the query and the fields lifted from body.event', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/webhook?account=999')
      .set('Authorization', signedWebhookJwt())
      .send(eventBody());

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });

    await vi.waitFor(() => {
      expect(deps.handleEvent).toHaveBeenCalledTimes(1);
    });
    expect(deps.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: '999',
        userId: 41,
        boardId: 5098,
        pulseId: 777,
        columnId: 'status_col',
        value: { label: { index: 2, text: 'בוצע' } },
        previousValue: { label: { index: 0, text: 'ממתין' } },
      })
    );
  });

  it('rejects a validly signed event with 400 and never dispatches when the ?account= query param is missing', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/webhook')
      .set('Authorization', signedWebhookJwt())
      .send(eventBody());

    expect(res.status).toBe(400);
    expect(deps.handleEvent).not.toHaveBeenCalled();
  });

  it('rejects a validly signed body with 400 and never dispatches when it carries no event object', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/webhook?account=999')
      .set('Authorization', signedWebhookJwt())
      .send({ notAnEvent: true });

    expect(res.status).toBe(400);
    expect(deps.handleEvent).not.toHaveBeenCalled();
  });

  it('still returns 202 and logs via logger.error when handleEvent rejects after dispatch (fail-soft)', async () => {
    const deps = makeDeps();
    deps.handleEvent.mockRejectedValue(new Error('downstream boom'));
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/webhook?account=999')
      .set('Authorization', signedWebhookJwt())
      .send(eventBody());

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });

    await vi.waitFor(() => {
      expect(deps.logger.error).toHaveBeenCalled();
    });
  });

  it('accepts an unsigned event with 202 and dispatches when env.allowUnsignedWebhooks is true (sandbox escape hatch)', async () => {
    const deps = makeDeps({ allowUnsignedWebhooks: true });
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/webhook?account=999')
      .send(eventBody());

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });

    await vi.waitFor(() => {
      expect(deps.handleEvent).toHaveBeenCalledTimes(1);
    });
    expect(deps.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: '999', boardId: 5098 })
    );
  });
});

describe('POST /api/guard/enroll', () => {
  const enrollBody = { boardId: '5098', columnId: 'status_col' };

  it('rejects with 401 and touches nothing when the Authorization header is missing or signed with the wrong secret', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const noAuth = await request(app).post('/api/guard/enroll').send(enrollBody);
    expect(noAuth.status).toBe(401);

    const badAuth = await request(app)
      .post('/api/guard/enroll')
      .set('Authorization', sessionToken('not-the-client-secret'))
      .send(enrollBody);
    expect(badAuth.status).toBe(401);

    expect(deps.tokenStore.getActivation).not.toHaveBeenCalled();
    expect(deps.api.createColumnWebhook).not.toHaveBeenCalled();
    expect(deps.enrollmentStore.set).not.toHaveBeenCalled();
  });

  it('responds 409 { error: "not_activated" } and skips webhook creation when the account has no stored activation', async () => {
    const deps = makeDeps();
    deps.tokenStore.getActivation.mockResolvedValue(null);
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/enroll')
      .set('Authorization', sessionToken())
      .send(enrollBody);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'not_activated' });
    expect(deps.tokenStore.getActivation).toHaveBeenCalledWith('999');
    expect(deps.api.createColumnWebhook).not.toHaveBeenCalled();
  });

  it('responds 403 { error: "not_board_owner" } when the actor is neither an owner nor in any owning team', async () => {
    const deps = makeDeps();
    deps.tokenStore.getActivation.mockResolvedValue({ token: 'tok', botUserId: '1' });
    deps.api.getBoardOwnership.mockResolvedValue({ ownerIds: ['77'], teamOwnerIds: [] });
    deps.api.getUserTeamIds.mockResolvedValue([]);
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/enroll')
      .set('Authorization', sessionToken())
      .send(enrollBody);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'not_board_owner' });
    expect(deps.api.getBoardOwnership).toHaveBeenCalledWith('tok', '5098');
    expect(deps.api.createColumnWebhook).not.toHaveBeenCalled();
    expect(deps.enrollmentStore.set).not.toHaveBeenCalled();
  });

  it('creates the column webhook with the account-qualified callback URL, persists the enrollment, and responds 200 with the webhook id (happy path)', async () => {
    const deps = makeDeps();
    deps.tokenStore.getActivation.mockResolvedValue({ token: 'tok', botUserId: '1' });
    deps.api.getBoardOwnership.mockResolvedValue({ ownerIds: ['41'], teamOwnerIds: [] });
    deps.enrollmentStore.get.mockResolvedValue(null);
    deps.api.createColumnWebhook.mockResolvedValue('55501');
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/enroll')
      .set('Authorization', sessionToken())
      .send(enrollBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, webhookId: '55501' });
    expect(deps.api.createColumnWebhook).toHaveBeenCalledWith(
      'tok',
      '5098',
      'status_col',
      'https://guard.example/api/guard/webhook?account=999'
    );
    expect(deps.enrollmentStore.set).toHaveBeenCalledWith('999', '5098', 'status_col', '55501');
  });

  it('grants ownership through team membership: a user whose team id appears in teamOwnerIds enrolls with 200', async () => {
    const deps = makeDeps();
    deps.tokenStore.getActivation.mockResolvedValue({ token: 'tok', botUserId: '1' });
    deps.api.getBoardOwnership.mockResolvedValue({ ownerIds: [], teamOwnerIds: ['9'] });
    deps.api.getUserTeamIds.mockResolvedValue(['9']);
    deps.enrollmentStore.get.mockResolvedValue(null);
    deps.api.createColumnWebhook.mockResolvedValue('55501');
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/enroll')
      .set('Authorization', sessionToken())
      .send(enrollBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, webhookId: '55501' });
    expect(deps.api.getUserTeamIds).toHaveBeenCalled();
    expect(deps.api.createColumnWebhook).toHaveBeenCalledWith(
      'tok',
      '5098',
      'status_col',
      'https://guard.example/api/guard/webhook?account=999'
    );
  });

  it('is idempotent: an already-enrolled column returns 200 with the existing webhook id and never calls createColumnWebhook again', async () => {
    const deps = makeDeps();
    deps.tokenStore.getActivation.mockResolvedValue({ token: 'tok', botUserId: '1' });
    deps.api.getBoardOwnership.mockResolvedValue({ ownerIds: ['41'], teamOwnerIds: [] });
    deps.enrollmentStore.get.mockResolvedValue('55501');
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/enroll')
      .set('Authorization', sessionToken())
      .send(enrollBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, webhookId: '55501' });
    expect(deps.api.createColumnWebhook).not.toHaveBeenCalled();
  });
});

describe('GET /api/guard/status', () => {
  const statusPath = '/api/guard/status?boardId=5098&columnId=status_col';

  it('reports activated: true, enrolled: true when the account is activated and the column is enrolled', async () => {
    const deps = makeDeps();
    deps.tokenStore.getActivation.mockResolvedValue({ token: 'tok', botUserId: '1' });
    deps.enrollmentStore.get.mockResolvedValue('55501');
    const app = createApp(deps);

    const res = await request(app).get(statusPath).set('Authorization', sessionToken());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activated: true, enrolled: true });
  });

  it('reports activated: false, enrolled: false when the account has no activation', async () => {
    const deps = makeDeps();
    deps.tokenStore.getActivation.mockResolvedValue(null);
    deps.enrollmentStore.get.mockResolvedValue(null);
    const app = createApp(deps);

    const res = await request(app).get(statusPath).set('Authorization', sessionToken());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activated: false, enrolled: false });
  });

  it('rejects with 401 when no session token is presented', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app).get(statusPath);

    expect(res.status).toBe(401);
    expect(deps.tokenStore.getActivation).not.toHaveBeenCalled();
  });
});
