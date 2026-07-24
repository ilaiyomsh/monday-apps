// Route-level tests for GET /api/telemetry/error-detail, driven through the
// REAL requireSession gate (createSessionTokenMiddleware + real JWTs) via
// supertest and the real createApp wiring. Contract:
//   - behind the session gate (401 without a valid token, and no query runs);
//   - 400 when err_name is missing (no query runs);
//   - 200 → { rows } from telemetry.getErrorDetail(window, err_name);
//   - 502 when the service throws (never leak the error to the client).

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';

const CLIENT_SECRET = 'test-client-secret';

function token({ accountId = '777', userId = '12' } = {}) {
  return jwt.sign({ dat: { account_id: accountId, user_id: userId } }, CLIENT_SECRET);
}

function buildApp(telemetryOverrides = {}) {
  const telemetry = {
    enabled: true,
    getTelemetry: vi.fn(async () => ({ seed: false })),
    getErrorDetail: vi.fn(async () => ({ rows: [{ _time: 't', app: 'planner', err_name: 'X' }] })),
    ...telemetryOverrides,
  };
  const app = createApp({ telemetry, env: { clientSecret: CLIENT_SECRET, allowedAccountIds: [] } });
  return { app, telemetry };
}

describe('GET /api/telemetry/error-detail — session gate', () => {
  it('401 without a token (and never queries)', async () => {
    const { app, telemetry } = buildApp();
    const res = await request(app).get('/api/telemetry/error-detail?err_name=X');
    expect(res.status).toBe(401);
    expect(telemetry.getErrorDetail).not.toHaveBeenCalled();
  });
});

describe('GET /api/telemetry/error-detail — behavior', () => {
  it('400 when err_name is missing (no query runs)', async () => {
    const { app, telemetry } = buildApp();
    const res = await request(app).get('/api/telemetry/error-detail').set('Authorization', token());
    expect(res.status).toBe(400);
    expect(telemetry.getErrorDetail).not.toHaveBeenCalled();
  });

  it('200 returns the occurrence rows for the requested err_name + window', async () => {
    const { app, telemetry } = buildApp();
    const res = await request(app)
      .get('/api/telemetry/error-detail?window=24h&err_name=TimeoutError')
      .set('Authorization', token());
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(telemetry.getErrorDetail).toHaveBeenCalledWith('24h', 'TimeoutError');
  });

  it('502 when the service throws (error is not leaked)', async () => {
    const { app } = buildApp({
      getErrorDetail: vi.fn(async () => {
        throw new Error('axiom down');
      }),
    });
    const res = await request(app)
      .get('/api/telemetry/error-detail?err_name=X')
      .set('Authorization', token());
    expect(res.status).toBe(502);
    expect(res.body).not.toHaveProperty('stack');
  });
});
