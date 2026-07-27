// @vitest-environment node
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOAuthApiRouter, createOAuthCallbackRouter } from './oauth.js';

const env = {
  clientId: 'client-1',
  clientSecret: 'secret-1',
  baseUrl: 'https://workflow.example',
  oauthAppVersionId: 'version-7',
};

const servers = [];

async function serve(router, mount = '/api/oauth') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { accountId: '100', userId: '42' };
    next();
  });
  app.use(mount, router);
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: 'failed' }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  servers.push(server);
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('OAuth API routes', () => {
  it('issues a single-use state and returns a PKCE S256 authorization URL', async () => {
    const store = { issueOAuthState: vi.fn().mockResolvedValue(undefined) };
    const tokenProvider = { getStatus: vi.fn(), disconnect: vi.fn() };
    const randomBytesImpl = vi.fn()
      .mockReturnValueOnce(Buffer.alloc(32, 1))
      .mockReturnValueOnce(Buffer.alloc(32, 2));
    const base = await serve(createOAuthApiRouter({ store, tokenProvider, env, randomBytesImpl }));

    const response = await fetch(`${base}/api/oauth/start`, { method: 'POST' });
    const { url } = await response.json();
    const authorization = new URL(url);

    expect(response.status).toBe(200);
    expect(authorization.origin + authorization.pathname).toBe('https://auth.monday.com/oauth2/authorize');
    expect(Object.fromEntries(authorization.searchParams)).toMatchObject({
      client_id: 'client-1',
      redirect_uri: 'https://workflow.example/oauth/callback',
      state: Buffer.alloc(32, 1).toString('base64url'),
      code_challenge_method: 'S256',
      app_version_id: 'version-7',
    });
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.issueOAuthState).toHaveBeenCalledWith(
      Buffer.alloc(32, 1).toString('base64url'),
      {
        verifier: Buffer.alloc(32, 2).toString('base64url'),
        accountId: '100',
        userId: '42',
      },
    );
  });

  it('reports reauthorization status and disconnects through the token provider', async () => {
    const store = { issueOAuthState: vi.fn() };
    const tokenProvider = {
      getStatus: vi.fn().mockResolvedValue('reauth_required'),
      disconnect: vi.fn().mockResolvedValue({ revoked: true }),
    };
    const base = await serve(createOAuthApiRouter({ store, tokenProvider, env }));

    const statusResponse = await fetch(`${base}/api/oauth/status`);
    expect(await statusResponse.json()).toEqual({
      connected: false,
      status: 'reauth_required',
    });
    const deleteResponse = await fetch(`${base}/api/oauth/connection`, { method: 'DELETE' });
    expect(await deleteResponse.json()).toEqual({ disconnected: true, revoked: true });
    expect(tokenProvider.disconnect).toHaveBeenCalledWith('100');
  });
});

describe('OAuth callback route', () => {
  it('consumes the state, exchanges with its PKCE verifier, and stores the rotating pair', async () => {
    const store = {
      consumeOAuthState: vi.fn().mockResolvedValue({
        accountId: '100', userId: '42', verifier: 'verifier-secret', expiresAt: Date.now() + 1_000,
      }),
      saveOAuthTokenRecord: vi.fn().mockResolvedValue(undefined),
    };
    const oauthClient = {
      exchangeCode: vi.fn().mockResolvedValue({
        accessToken: 'access-1', refreshToken: 'refresh-1', expiresAtMs: 9_000, expUndecodable: false,
      }),
    };
    const base = await serve(createOAuthCallbackRouter({ store, oauthClient, env, now: () => 5_000 }), '/oauth');

    const response = await fetch(`${base}/oauth/callback?code=code-1&state=nonce-1`);

    expect(response.status).toBe(200);
    expect(store.consumeOAuthState).toHaveBeenCalledWith('nonce-1');
    expect(oauthClient.exchangeCode).toHaveBeenCalledWith({
      code: 'code-1',
      verifier: 'verifier-secret',
      redirectUri: 'https://workflow.example/oauth/callback',
    });
    expect(store.saveOAuthTokenRecord).toHaveBeenCalledWith('100', {
      v: 2,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 9_000,
      obtainedAt: 5_000,
      status: 'active',
    });
    expect(await response.text()).toContain('twyst-oauth-connected');
  });

  it('rejects a missing or already-consumed state before exchanging the code', async () => {
    const store = { consumeOAuthState: vi.fn().mockResolvedValue(null) };
    const oauthClient = { exchangeCode: vi.fn() };
    const base = await serve(createOAuthCallbackRouter({ store, oauthClient, env }), '/oauth');

    const response = await fetch(`${base}/oauth/callback?code=code-1&state=reused`);

    expect(response.status).toBe(400);
    expect(oauthClient.exchangeCode).not.toHaveBeenCalled();
  });
});
