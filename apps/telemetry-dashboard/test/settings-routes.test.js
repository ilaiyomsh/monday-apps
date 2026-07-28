// Route-level tests for createSettingsRouter, driven through the REAL
// requireSession gate (createSessionTokenMiddleware + real JWTs) via supertest.
// storage / provisioner / tokenProvider are recording fakes. Contract:
//   - all routes are behind the session gate (401 without a valid token,
//     403 when an allowlist excludes the account);
//   - GET /api/settings            → { oauthStatus, oauthConnected, board };
//   - POST /api/settings/board     → { board } on success;
//                                    409 { error: 'not_authorized' } when the
//                                    provisioner throws code 'no_write_token';
//                                    502 { error: 'provision_failed' } otherwise;
//   - POST /api/settings/disconnect → revokes via the token provider, always
//                                    200 { status: 'disconnected', revoked }.
// Privacy: no log call ever carries token material.

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createSettingsRouter } from '../src/routes/settings.js';
import { createSessionTokenMiddleware } from '../src/middlewares/session-token.js';

const CLIENT_SECRET = 'test-client-secret';
const ACCOUNT_ID = '777';
const CONFIG = { boardId: 'b1', groupId: 'g1', columns: { app: 'text_1' } };

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function token({ accountId = ACCOUNT_ID, userId = '12' } = {}) {
  return jwt.sign({ dat: { account_id: accountId, user_id: userId } }, CLIENT_SECRET);
}

function buildApp({ storage, provisioner, tokenProvider, allowedAccountIds = [] } = {}) {
  const logger = makeLogger();
  const app = express();
  app.use(express.json());
  const requireSession = createSessionTokenMiddleware({ clientSecret: CLIENT_SECRET, allowedAccountIds });
  app.use(
    '/api/settings',
    requireSession,
    createSettingsRouter({ storage, provisioner, tokenProvider, logger })
  );
  return { app, logger };
}

function makeStorage(overrides = {}) {
  return {
    getBoardConfig: vi.fn(async () => CONFIG),
    ...overrides,
  };
}

function makeProvisioner(overrides = {}) {
  return { provision: vi.fn(async () => CONFIG), ...overrides };
}

function makeTokenProvider(overrides = {}) {
  return {
    getStatus: vi.fn(async () => 'connected'),
    disconnect: vi.fn(async () => ({ revoked: true })),
    ...overrides,
  };
}

function deps(overrides = {}) {
  return {
    storage: makeStorage(),
    provisioner: makeProvisioner(),
    tokenProvider: makeTokenProvider(),
    ...overrides,
  };
}

describe('settings routes — session gate', () => {
  it('401 without a token on GET', async () => {
    const { app } = buildApp(deps());
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('401 without a token on POST /board (no provisioning happens)', async () => {
    const provisioner = makeProvisioner();
    const { app } = buildApp(deps({ provisioner }));
    const res = await request(app).post('/api/settings/board').send({});
    expect(res.status).toBe(401);
    expect(provisioner.provision).not.toHaveBeenCalled();
  });

  it('401 without a token on POST /disconnect (no revocation happens)', async () => {
    const tokenProvider = makeTokenProvider();
    const { app } = buildApp(deps({ tokenProvider }));
    const res = await request(app).post('/api/settings/disconnect').send({});
    expect(res.status).toBe(401);
    expect(tokenProvider.disconnect).not.toHaveBeenCalled();
  });

  it('403 when a non-empty allowlist excludes the account', async () => {
    const { app } = buildApp({ ...deps(), allowedAccountIds: ['999'] });
    const res = await request(app).get('/api/settings').set('Authorization', token());
    expect(res.status).toBe(403);
  });
});

describe('GET /api/settings', () => {
  it('returns oauthStatus:connected + oauthConnected:true + board config', async () => {
    const { app } = buildApp(deps());

    const res = await request(app).get('/api/settings').set('Authorization', token());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ oauthStatus: 'connected', oauthConnected: true, board: CONFIG });
  });

  it('reports oauthStatus:disconnected (oauthConnected:false) and board:null when nothing is stored', async () => {
    const { app } = buildApp(
      deps({
        storage: makeStorage({ getBoardConfig: vi.fn(async () => null) }),
        tokenProvider: makeTokenProvider({ getStatus: vi.fn(async () => 'disconnected') }),
      })
    );

    const res = await request(app).get('/api/settings').set('Authorization', token());

    expect(res.body).toEqual({ oauthStatus: 'disconnected', oauthConnected: false, board: null });
  });

  it('surfaces reauth_required (6-month refresh death) with oauthConnected:false', async () => {
    const { app } = buildApp(
      deps({ tokenProvider: makeTokenProvider({ getStatus: vi.fn(async () => 'reauth_required') }) })
    );

    const res = await request(app).get('/api/settings').set('Authorization', token());

    expect(res.body).toMatchObject({ oauthStatus: 'reauth_required', oauthConnected: false });
  });
});

describe('POST /api/settings/board', () => {
  it('provisions and returns the board config', async () => {
    const provisioner = makeProvisioner();
    const { app } = buildApp(deps({ provisioner }));

    const res = await request(app)
      .post('/api/settings/board')
      .set('Authorization', token())
      .send({ name: 'My Events' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ board: CONFIG });
    expect(provisioner.provision).toHaveBeenCalledWith({ name: 'My Events', workspaceId: null });
  });

  it('maps a no_write_token provisioner error to 409 not_authorized', async () => {
    const provisioner = makeProvisioner({
      provision: vi.fn(async () => {
        throw Object.assign(new Error('no_write_token'), { code: 'no_write_token' });
      }),
    });
    const { app } = buildApp(deps({ provisioner }));

    const res = await request(app).post('/api/settings/board').set('Authorization', token()).send({});

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'not_authorized' });
  });

  it('maps any other provisioner failure to 502 provision_failed', async () => {
    const provisioner = makeProvisioner({
      provision: vi.fn(async () => {
        throw new Error('monday API HTTP 500');
      }),
    });
    const { app } = buildApp(deps({ provisioner }));

    const res = await request(app).post('/api/settings/board').set('Authorization', token()).send({});

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'provision_failed' });
  });
});

describe('POST /api/settings/disconnect', () => {
  it('calls tokenProvider.disconnect and returns { status: disconnected, revoked: true }', async () => {
    const tokenProvider = makeTokenProvider();
    const { app } = buildApp(deps({ tokenProvider }));

    const res = await request(app)
      .post('/api/settings/disconnect')
      .set('Authorization', token())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'disconnected', revoked: true });
    expect(tokenProvider.disconnect).toHaveBeenCalledTimes(1);
  });

  it('still 200s (local clear always wins) when the best-effort revoke failed', async () => {
    const tokenProvider = makeTokenProvider({ disconnect: vi.fn(async () => ({ revoked: false })) });
    const { app } = buildApp(deps({ tokenProvider }));

    const res = await request(app)
      .post('/api/settings/disconnect')
      .set('Authorization', token())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'disconnected', revoked: false });
  });
});
