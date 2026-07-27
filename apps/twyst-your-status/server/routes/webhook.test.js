// @vitest-environment node
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebhookRouter } from './webhook.js';

const env = { signingSecret: 'signing-secret', clientId: 'client-1' };
const servers = [];

async function serve(router) {
  const app = express();
  app.use(express.json());
  app.use('/webhooks', router);
  app.use((error, _req, res, _next) => res.status(500).json({ error: String(error.message) }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('status-change webhook', () => {
  it('echoes monday verification challenges before authentication', async () => {
    const router = createWebhookRouter({
      tokenProvider: {}, enforcementService: {}, env,
    });
    const base = await serve(router);

    const response = await fetch(`${base}/webhooks/status-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: 'challenge-1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: 'challenge-1' });
  });

  it('acknowledges an authenticated delivery before queued enforcement begins', async () => {
    const jobs = [];
    const schedule = vi.fn((job) => jobs.push(job));
    const tokenProvider = { getFreshAccessToken: vi.fn().mockResolvedValue('account-token') };
    const enforcementService = { handleStatusChange: vi.fn().mockResolvedValue({ kind: 'allow' }) };
    const router = createWebhookRouter({ tokenProvider, enforcementService, env, schedule });
    const base = await serve(router);
    const auth = jwt.sign({ accountId: '100' }, env.signingSecret, { audience: env.clientId });
    const event = { event: { boardId: 200, pulseId: 300, columnId: 'status' } };

    const response = await fetch(`${base}/webhooks/status-change`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(schedule).toHaveBeenCalledOnce();
    expect(enforcementService.handleStatusChange).not.toHaveBeenCalled();
    await jobs[0]();
    expect(tokenProvider.getFreshAccessToken).toHaveBeenCalledWith('100');
    expect(enforcementService.handleStatusChange).toHaveBeenCalledWith({
      accountId: '100', event, token: 'account-token',
    });
  });

  it('rejects an invalid signature without scheduling work', async () => {
    const schedule = vi.fn();
    const router = createWebhookRouter({
      tokenProvider: {}, enforcementService: {}, env, schedule,
    });
    const base = await serve(router);

    const response = await fetch(`${base}/webhooks/status-change`, {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid', 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(401);
    expect(schedule).not.toHaveBeenCalled();
  });
});
