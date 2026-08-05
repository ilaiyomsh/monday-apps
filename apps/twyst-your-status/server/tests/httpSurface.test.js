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
    tokenStore: {
      getReaderToken: vi.fn(),
      getOwnerToken: vi.fn(),
      setOwnerToken: vi.fn(),
    },
    enrollmentStore: { get: vi.fn(), set: vi.fn() },
    rulesStore: { getRules: vi.fn() },
    bypassLog: { queryRange: vi.fn() },
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
    // A delivery emits a single greppable trace line so a status change is
    // followable in code:logs from the moment it enters the guard.
    const traceLine = deps.logger.info.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.startsWith('webhook received'),
    );
    expect(traceLine).toBeDefined();
    expect(traceLine[0]).toContain('col=status_col');
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

    expect(deps.tokenStore.getReaderToken).not.toHaveBeenCalled();
    expect(deps.api.createColumnWebhook).not.toHaveBeenCalled();
    expect(deps.enrollmentStore.set).not.toHaveBeenCalled();
  });

  it('responds 409 { error: "not_activated" } and skips webhook creation when the account has no reader token', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockResolvedValue(null);
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/enroll')
      .set('Authorization', sessionToken())
      .send(enrollBody);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'not_activated' });
    expect(deps.tokenStore.getReaderToken).toHaveBeenCalledWith('999');
    expect(deps.api.createColumnWebhook).not.toHaveBeenCalled();
  });

  it('responds 403 { error: "not_board_owner" } when the actor is neither an owner nor in any owning team', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockResolvedValue({ token: 'tok', userId: '50' });
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
    deps.tokenStore.getReaderToken.mockResolvedValue({ token: 'tok', userId: '50' });
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
    deps.tokenStore.getReaderToken.mockResolvedValue({ token: 'tok', userId: '50' });
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
    deps.tokenStore.getReaderToken.mockResolvedValue({ token: 'tok', userId: '50' });
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

  /** rules blob whose PRIMARY owner is user 50 */
  const rulesWithPrimary50 = () => ({
    version: 1,
    hiddenLabelIds: [],
    labels: {},
    owners: { ownerIds: ['41', '50'], primaryOwnerId: '50' },
  });

  it('reports enrolled + primaryAuthorized: true when the column is enrolled and the PRIMARY owner holds a token', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockResolvedValue({ token: 'tok', userId: '41' });
    deps.enrollmentStore.get.mockResolvedValue('55501');
    deps.rulesStore.getRules.mockResolvedValue(rulesWithPrimary50());
    deps.tokenStore.getOwnerToken.mockResolvedValue('tok50');
    const app = createApp(deps);

    const res = await request(app).get(statusPath).set('Authorization', sessionToken());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activated: true, enrolled: true, primaryAuthorized: true, meAuthorized: true });
    // The check must target the column's PRIMARY owner — not the reader's user.
    expect(deps.tokenStore.getOwnerToken).toHaveBeenCalledWith('999', '50');
  });

  it('splits the two signals: requester authorized but the stored PRIMARY not — meAuthorized true, primaryAuthorized false (Codex P2: a draft self-crowning must not read as connected via the stale stored primary, nor as disconnected for the requester)', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockResolvedValue({ token: 'tok', userId: '41' });
    deps.enrollmentStore.get.mockResolvedValue('55501');
    deps.rulesStore.getRules.mockResolvedValue(rulesWithPrimary50());
    // Requesting user 41 holds a token; stored primary 50 does not.
    deps.tokenStore.getOwnerToken.mockImplementation(async (accountId, userId) => (userId === '41' ? 'tok41' : null));
    const app = createApp(deps);

    const res = await request(app).get(statusPath).set('Authorization', sessionToken());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activated: true, enrolled: true, primaryAuthorized: false, meAuthorized: true });
  });

  it('reports primaryAuthorized: false when the account is activated but the PRIMARY owner never authorized (round327 — the line must not say connected while reverts would be skipped)', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockResolvedValue({ token: 'tok', userId: '41' });
    deps.enrollmentStore.get.mockResolvedValue('55501');
    deps.rulesStore.getRules.mockResolvedValue(rulesWithPrimary50());
    deps.tokenStore.getOwnerToken.mockResolvedValue(null);
    const app = createApp(deps);

    const res = await request(app).get(statusPath).set('Authorization', sessionToken());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activated: true, enrolled: true, primaryAuthorized: false, meAuthorized: false });
  });

  it('reports primaryAuthorized: null (unknowable) when the column has no rules/owners yet', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockResolvedValue({ token: 'tok', userId: '41' });
    deps.enrollmentStore.get.mockResolvedValue(null);
    deps.rulesStore.getRules.mockResolvedValue(null);
    const app = createApp(deps);

    const res = await request(app).get(statusPath).set('Authorization', sessionToken());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activated: true, enrolled: false, primaryAuthorized: null, meAuthorized: false });
    // meAuthorized asks about the REQUESTER only — no primary-owner lookup happened.
    expect(deps.tokenStore.getOwnerToken).toHaveBeenCalledTimes(1);
    expect(deps.tokenStore.getOwnerToken).toHaveBeenCalledWith('999', '41');
  });

  it('reports activated: false, enrolled: false, primaryAuthorized: false when the account has no reader token', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockResolvedValue(null);
    deps.enrollmentStore.get.mockResolvedValue(null);
    const app = createApp(deps);

    const res = await request(app).get(statusPath).set('Authorization', sessionToken());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activated: false, enrolled: false, primaryAuthorized: false, meAuthorized: false });
  });

  it('rejects with 401 when no session token is presented', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app).get(statusPath);

    expect(res.status).toBe(401);
    expect(deps.tokenStore.getReaderToken).not.toHaveBeenCalled();
  });
});

describe('GET /api/guard/bypasses', () => {
  const BOARD_ID = '5098';
  const COLUMN_ID = 'status_col';
  const FROM = '1000';
  const TO = '2000';
  const bypassesPath = `/api/guard/bypasses?boardId=${BOARD_ID}&columnId=${COLUMN_ID}&from=${FROM}&to=${TO}`;

  /** rules blob whose owners list does NOT include the requesting user (41) */
  function rulesOwnedByOthers() {
    return {
      version: 1,
      hiddenLabelIds: [],
      labels: {},
      owners: { ownerIds: ['77'], primaryOwnerId: '77' },
    };
  }

  /** rules blob whose owners list DOES include the requesting user (41) */
  function rulesOwnedByRequester() {
    return {
      version: 1,
      hiddenLabelIds: [],
      labels: {},
      owners: { ownerIds: ['41', '50'], primaryOwnerId: '50' },
    };
  }

  it('rejects with 401 and touches nothing when the Authorization header is missing', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app).get(bypassesPath);

    expect(res.status).toBe(401);
    expect(deps.tokenStore.getReaderToken).not.toHaveBeenCalled();
    expect(deps.rulesStore.getRules).not.toHaveBeenCalled();
    expect(deps.bypassLog.queryRange).not.toHaveBeenCalled();
  });

  it('rejects with 401 and touches nothing when the session token is signed with the wrong secret', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app)
      .get(bypassesPath)
      .set('Authorization', sessionToken('not-the-client-secret'));

    expect(res.status).toBe(401);
    expect(deps.tokenStore.getReaderToken).not.toHaveBeenCalled();
    expect(deps.rulesStore.getRules).not.toHaveBeenCalled();
    expect(deps.bypassLog.queryRange).not.toHaveBeenCalled();
  });

  it('rejects with 400 { error: "bad_request" } and never queries the log when columnId is missing', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app)
      .get(`/api/guard/bypasses?boardId=${BOARD_ID}&from=${FROM}&to=${TO}`)
      .set('Authorization', sessionToken());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad_request' });
    expect(deps.bypassLog.queryRange).not.toHaveBeenCalled();
  });

  it('rejects with 400 { error: "bad_request" } and never queries the log when from is not a numeric value', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app)
      .get(`/api/guard/bypasses?boardId=${BOARD_ID}&columnId=${COLUMN_ID}&from=notanumber&to=${TO}`)
      .set('Authorization', sessionToken());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad_request' });
    expect(deps.bypassLog.queryRange).not.toHaveBeenCalled();
  });

  it('rejects with 400 { error: "bad_request" } and never queries the log when to is not a numeric value', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app)
      .get(`/api/guard/bypasses?boardId=${BOARD_ID}&columnId=${COLUMN_ID}&from=${FROM}&to=notanumber`)
      .set('Authorization', sessionToken());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad_request' });
    expect(deps.bypassLog.queryRange).not.toHaveBeenCalled();
  });

  it('responds 409 { error: "not_activated" } and never queries the log when the account has no reader token', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockResolvedValue(null);
    const app = createApp(deps);

    const res = await request(app).get(bypassesPath).set('Authorization', sessionToken());

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'not_activated' });
    expect(deps.tokenStore.getReaderToken).toHaveBeenCalledWith('999');
    expect(deps.bypassLog.queryRange).not.toHaveBeenCalled();
  });

  it('responds 403 { error: "not_column_owner" } and never queries the log when the requester is not in the rules owner list', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockResolvedValue({ token: 'tok', userId: '50' });
    deps.rulesStore.getRules.mockResolvedValue(rulesOwnedByOthers());
    const app = createApp(deps);

    const res = await request(app).get(bypassesPath).set('Authorization', sessionToken());

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'not_column_owner' });
    expect(deps.rulesStore.getRules).toHaveBeenCalledWith('tok', BOARD_ID, COLUMN_ID);
    expect(deps.bypassLog.queryRange).not.toHaveBeenCalled();
  });

  it('responds 403 { error: "not_column_owner" } and never queries the log when the column is unadopted (rules is null)', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockResolvedValue({ token: 'tok', userId: '50' });
    deps.rulesStore.getRules.mockResolvedValue(null);
    const app = createApp(deps);

    const res = await request(app).get(bypassesPath).set('Authorization', sessionToken());

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'not_column_owner' });
    expect(deps.rulesStore.getRules).toHaveBeenCalledWith('tok', BOARD_ID, COLUMN_ID);
    expect(deps.bypassLog.queryRange).not.toHaveBeenCalled();
  });

  it('responds 200 with { count, events } and queries the log with numeric from/to when the requester is a column owner (happy path)', async () => {
    const deps = makeDeps();
    const events = [
      { at: 1100, userId: 41, from: 'ממתין', to: 'בוצע' },
      { at: 1900, userId: 50, from: 'בעבודה', to: 'בוצע' },
    ];
    deps.tokenStore.getReaderToken.mockResolvedValue({ token: 'tok', userId: '50' });
    deps.rulesStore.getRules.mockResolvedValue(rulesOwnedByRequester());
    deps.bypassLog.queryRange.mockResolvedValue(events);
    const app = createApp(deps);

    const res = await request(app).get(bypassesPath).set('Authorization', sessionToken());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 2, events });
    expect(deps.bypassLog.queryRange).toHaveBeenCalledWith('999', BOARD_ID, COLUMN_ID, 1000, 2000);
  });

  it('responds 502 { error: "bypasses_failed" } when the log query rejects', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockResolvedValue({ token: 'tok', userId: '50' });
    deps.rulesStore.getRules.mockResolvedValue(rulesOwnedByRequester());
    deps.bypassLog.queryRange.mockRejectedValue(new Error('log store down'));
    const app = createApp(deps);

    const res = await request(app).get(bypassesPath).set('Authorization', sessionToken());

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'bypasses_failed' });
    // The failure CAUSE must be in the message itself — code:logs renders only
    // `message`, dropping context, so a static "bypasses query failed" would hide
    // the reason (the blindness this fold fixes).
    const errLine = deps.logger.error.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('bypasses query failed'),
    );
    expect(errLine).toBeDefined();
    expect(errLine[0]).toContain('log store down');
  });
});
