// Route-level tests for createWebhooksRouter (spec "Tests" bullet 4) —
// supertest drives a minimal express app with the REAL router and the REAL
// createWebhookAuthMiddleware (real JWTs signed via jsonwebtoken); only the
// lifecycleService and logger are recording fakes. Contract under test:
//   { challenge } handshake → 200 echo BEFORE auth (no token needed);
//   missing/invalid token   → 401 { error: 'invalid_webhook_token' } (fail-closed);
//   valid token             → 202 { ok: true }, then the service is invoked
//                             off-request with { appSlug, body, eventId } where
//                             eventId comes from the X-Apps-Event-Id header.

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createWebhooksRouter } from '../src/routes/webhooks.js';
import { createWebhookAuthMiddleware } from '../src/middlewares/webhook-auth.js';

// Distinct per-app secret maps: feature-level lifecycle webhooks are signed
// with Signing Secrets, app-level webhooks with Client Secrets.
const SIGNING_SECRETS = {
  'axis-planner': 'planner-signing-secret',
  'axis-tracker': 'tracker-signing-secret',
  discussions: 'discussions-signing-secret',
};
const CLIENT_SECRETS = {
  'axis-planner': 'planner-client-secret',
  'deadline-confirm': 'deadline-client-secret',
};

const FEATURE_BODY = {
  type: 'AppFeatureBoardView:delete',
  payload: { boardId: 111, appFeatureId: 222 },
  accountId: 777,
  userId: 12,
  back_to_url: null,
};

const APP_EVENT_BODY = {
  type: 'install',
  data: { app_id: 10787117, account_id: 777, user_id: 12 },
};

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    track: vi.fn(),
    health: vi.fn(),
  };
}

function buildApp({ lifecycleSecrets = SIGNING_SECRETS, appEventsSecrets = CLIENT_SECRETS } = {}) {
  const logger = makeLogger();
  const lifecycleService = {
    handleFeatureEvent: vi.fn().mockResolvedValue({ recorded: true }),
    handleAppEvent: vi.fn().mockResolvedValue({ recorded: true }),
  };
  const router = createWebhooksRouter({
    lifecycleService,
    lifecycleAuth: createWebhookAuthMiddleware({
      secretsBySlug: lifecycleSecrets,
      logger,
      tag: 'lifecycle_auth',
    }),
    appEventsAuth: createWebhookAuthMiddleware({
      secretsBySlug: appEventsSecrets,
      logger,
      tag: 'app_events_auth',
    }),
    logger,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks', router);
  return { app, lifecycleService, logger };
}

// The router acks 202 and defers the service call via setImmediate — drain the
// immediate queue (twice, to outlast the promise chain) before asserting on it.
function flushDispatch() {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

describe('POST /api/webhooks/lifecycle', () => {
  it('echoes a { challenge } handshake as 200 JSON WITHOUT any Authorization header', async () => {
    const { app, lifecycleService } = buildApp();

    const res = await request(app)
      .post('/api/webhooks/lifecycle')
      .send({ challenge: 'hs-abc-123' });

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ challenge: 'hs-abc-123' });
    await flushDispatch();
    expect(lifecycleService.handleFeatureEvent).not.toHaveBeenCalled();
  });

  it('echoes the challenge even when NO secrets are configured (handshake precedes auth)', async () => {
    const { app } = buildApp({ lifecycleSecrets: {}, appEventsSecrets: {} });

    const res = await request(app)
      .post('/api/webhooks/lifecycle')
      .send({ challenge: 'zero-config' });

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ challenge: 'zero-config' });
  });

  it('does NOT echo a non-string challenge — the body falls through to auth (401 without a token)', async () => {
    const { app, lifecycleService } = buildApp();

    const res = await request(app)
      .post('/api/webhooks/lifecycle')
      .send({ challenge: 12345 });

    expect(res.status).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_webhook_token' });
    await flushDispatch();
    expect(lifecycleService.handleFeatureEvent).not.toHaveBeenCalled();
  });

  it('responds 401 invalid_webhook_token when the Authorization header is missing', async () => {
    const { app, lifecycleService, logger } = buildApp();

    const res = await request(app).post('/api/webhooks/lifecycle').send(FEATURE_BODY);

    expect(res.status).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_webhook_token' });
    await flushDispatch();
    expect(lifecycleService.handleFeatureEvent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('responds 401 for a token signed with a secret NOT in the lifecycle map', async () => {
    const { app, lifecycleService } = buildApp();
    const token = jwt.sign({ accountId: 777 }, 'some-unknown-secret');

    const res = await request(app)
      .post('/api/webhooks/lifecycle')
      .set('Authorization', token)
      .send(FEATURE_BODY);

    expect(res.status).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_webhook_token' });
    await flushDispatch();
    expect(lifecycleService.handleFeatureEvent).not.toHaveBeenCalled();
  });

  it('responds 401 to a validly-signed token when the secret map is EMPTY (fail-closed)', async () => {
    const { app } = buildApp({ lifecycleSecrets: {} });
    const token = jwt.sign({ accountId: 777 }, SIGNING_SECRETS['axis-planner']);

    const res = await request(app)
      .post('/api/webhooks/lifecycle')
      .set('Authorization', token)
      .send(FEATURE_BODY);

    expect(res.status).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_webhook_token' });
  });

  it('acks 202 { ok: true } for a valid token and invokes handleFeatureEvent with the matching appSlug, body, and X-Apps-Event-Id', async () => {
    const { app, lifecycleService } = buildApp();
    const token = jwt.sign({ accountId: 777 }, SIGNING_SECRETS['axis-tracker']);

    const res = await request(app)
      .post('/api/webhooks/lifecycle')
      .set('Authorization', token)
      .set('X-Apps-Event-Id', 'evt-42')
      .send(FEATURE_BODY);

    expect(res.status).toBe(202);
    expect(res.body).toStrictEqual({ ok: true });
    await flushDispatch();
    expect(lifecycleService.handleFeatureEvent).toHaveBeenCalledTimes(1);
    expect(lifecycleService.handleFeatureEvent).toHaveBeenCalledWith({
      appSlug: 'axis-tracker',
      body: FEATURE_BODY,
      eventId: 'evt-42',
    });
    expect(lifecycleService.handleAppEvent).not.toHaveBeenCalled();
  });

  it('picks the CORRECT slug among several configured secrets (sender identified by which secret verifies)', async () => {
    const { app, lifecycleService } = buildApp();
    const token = jwt.sign({ accountId: 777 }, SIGNING_SECRETS.discussions);

    await request(app)
      .post('/api/webhooks/lifecycle')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Apps-Event-Id', 'evt-disc')
      .send(FEATURE_BODY)
      .expect(202);

    await flushDispatch();
    expect(lifecycleService.handleFeatureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ appSlug: 'discussions', eventId: 'evt-disc' })
    );
  });

  it('passes eventId: null when the X-Apps-Event-Id header is absent', async () => {
    const { app, lifecycleService } = buildApp();
    const token = jwt.sign({ accountId: 777 }, SIGNING_SECRETS['axis-planner']);

    await request(app)
      .post('/api/webhooks/lifecycle')
      .set('Authorization', token)
      .send(FEATURE_BODY)
      .expect(202);

    await flushDispatch();
    expect(lifecycleService.handleFeatureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: null })
    );
  });

  it('still acks 202 and logs (never 5xx, never unhandledRejection) when the service handler REJECTS', async () => {
    const { app, lifecycleService, logger } = buildApp();
    lifecycleService.handleFeatureEvent.mockRejectedValue(new Error('board exploded'));
    const token = jwt.sign({ accountId: 777 }, SIGNING_SECRETS['axis-planner']);

    const res = await request(app)
      .post('/api/webhooks/lifecycle')
      .set('Authorization', token)
      .set('X-Apps-Event-Id', 'evt-boom')
      .send(FEATURE_BODY);

    expect(res.status).toBe(202);
    expect(res.body).toStrictEqual({ ok: true });
    await flushDispatch();
    expect(logger.error).toHaveBeenCalledWith(
      'webhook_dispatch_failed',
      expect.any(String),
      expect.objectContaining({ eventId: 'evt-boom', error: expect.stringContaining('board exploded') })
    );
  });
});

describe('POST /api/webhooks/app-events', () => {
  it('echoes a { challenge } handshake as 200 JSON without auth', async () => {
    const { app, lifecycleService } = buildApp();

    const res = await request(app)
      .post('/api/webhooks/app-events')
      .send({ challenge: 'app-hs-9' });

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ challenge: 'app-hs-9' });
    await flushDispatch();
    expect(lifecycleService.handleAppEvent).not.toHaveBeenCalled();
  });

  it('responds 401 when the Authorization header is missing', async () => {
    const { app, lifecycleService } = buildApp();

    const res = await request(app).post('/api/webhooks/app-events').send(APP_EVENT_BODY);

    expect(res.status).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_webhook_token' });
    await flushDispatch();
    expect(lifecycleService.handleAppEvent).not.toHaveBeenCalled();
  });

  it('responds 401 to a token signed with a lifecycle SIGNING secret (the routes use separate secret maps)', async () => {
    const { app, lifecycleService } = buildApp();
    const token = jwt.sign({ accountId: 777 }, SIGNING_SECRETS['axis-planner']);

    const res = await request(app)
      .post('/api/webhooks/app-events')
      .set('Authorization', token)
      .send(APP_EVENT_BODY);

    expect(res.status).toBe(401);
    expect(res.body).toStrictEqual({ error: 'invalid_webhook_token' });
    await flushDispatch();
    expect(lifecycleService.handleAppEvent).not.toHaveBeenCalled();
  });

  it('acks 202 { ok: true } for a valid CLIENT-secret token and invokes handleAppEvent with appSlug, body, and X-Apps-Event-Id', async () => {
    const { app, lifecycleService } = buildApp();
    const token = jwt.sign({ accountId: 777 }, CLIENT_SECRETS['deadline-confirm']);

    const res = await request(app)
      .post('/api/webhooks/app-events')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Apps-Event-Id', 'evt-app-7')
      .send(APP_EVENT_BODY);

    expect(res.status).toBe(202);
    expect(res.body).toStrictEqual({ ok: true });
    await flushDispatch();
    expect(lifecycleService.handleAppEvent).toHaveBeenCalledTimes(1);
    expect(lifecycleService.handleAppEvent).toHaveBeenCalledWith({
      appSlug: 'deadline-confirm',
      body: APP_EVENT_BODY,
      eventId: 'evt-app-7',
    });
    expect(lifecycleService.handleFeatureEvent).not.toHaveBeenCalled();
  });
});
