/**
 * Static SPA serving (round324 same-origin unification): the guard server also
 * serves the built app pages from server/public, so the client is same-origin
 * with /api/guard/* and /oauth/*. Contract under test:
 *   - when the public dir exists, express.static serves the root index, hashed
 *     assets, and each feature sub-page (multi-page build) via directory index;
 *   - the static layer never shadows the API (/health answers even when mounted);
 *   - when the public dir is absent (tests / local server), nothing is served
 *     and an unknown GET is a 404 — the fs.existsSync gate is real.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';

import { createApp } from '../src/app.js';

function makeDeps(publicDir) {
  return {
    handleEvent: vi.fn(),
    tokenStore: {}, enrollmentStore: {}, rulesStore: {}, bypassLog: {},
    api: {}, oauthClient: {},
    env: { signingSecret: 's', clientSecret: 'c', clientId: 'i', baseUrl: 'https://g.example' },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    publicDir,
  };
}

describe('static SPA serving when public/ exists', () => {
  let dir;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'twyst-public-'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>root</title>');
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log("spa")');
    mkdirSync(path.join(dir, 'settings'));
    writeFileSync(path.join(dir, 'settings', 'index.html'), '<!doctype html><title>settings</title>');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the root index.html at /', async () => {
    const res = await request(createApp(makeDeps(dir))).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>root</title>');
  });

  it('serves a hashed asset with its bytes', async () => {
    const res = await request(createApp(makeDeps(dir))).get('/assets/app-abc123.js');
    expect(res.status).toBe(200);
    expect(res.text).toBe('console.log("spa")');
  });

  it('serves a feature sub-page via its directory index (multi-page build)', async () => {
    const res = await request(createApp(makeDeps(dir))).get('/settings/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>settings</title>');
  });

  it('does not shadow the API: /health still answers ok', async () => {
    const res = await request(createApp(makeDeps(dir))).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('when public/ is absent (the fs.existsSync gate)', () => {
  it('does not serve a root page — an unknown GET is 404', async () => {
    const missing = path.join(tmpdir(), 'twyst-public-does-not-exist-xyz');
    const res = await request(createApp(makeDeps(missing))).get('/');
    expect(res.status).toBe(404);
  });
});
