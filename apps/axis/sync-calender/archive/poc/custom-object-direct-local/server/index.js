import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';

import {
  consumeOauthState,
  getConfig,
  getConfigsByObject,
  getOrCreateConfig,
  getPolicy,
  storeOauthState,
  updateConfig,
  upsertPolicy,
} from './storage.js';
import { exchangeGoogleCodeForTokens, getGoogleUserEmail } from './google-client.js';
import { exchangeMondayCodeForToken } from './monday-client.js';
import { syncConfig } from './sync.js';

dotenv.config({
  path: path.resolve(process.cwd(), 'poc/custom-object-direct-local/.env'),
});

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-account-id,x-user-id,x-user-role');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function identityFromHeaders(req) {
  return {
    accountId: req.headers['x-account-id'] || 'demo-account',
    userId: req.headers['x-user-id'] || 'demo-user',
    role: req.headers['x-user-role'] || 'user',
  };
}

function assertAdmin(req, res) {
  const id = identityFromHeaders(req);
  if (id.role !== 'admin') {
    res.status(403).json({ error: 'admin_required' });
    return null;
  }
  return id;
}

function projectConfig(config) {
  return {
    configId: config.configId,
    accountId: config.accountId,
    objectId: config.objectId,
    userId: config.userId,
    mondayUserId: config.mondayUserId,
    googleUserEmail: config.googleUserEmail,
    hasGoogleConnection: Boolean(config.googleRefreshToken),
    hasMondayConnection: Boolean(config.mondayAccessToken),
    status: config.status,
    lastSyncAt: config.lastSyncAt,
    lastError: config.lastError,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/debug/whoami', (req, res) => {
  res.json(identityFromHeaders(req));
});

app.get('/api/policy', async (req, res) => {
  const objectId = req.query.objectId;
  if (!objectId) return res.status(400).json({ error: 'missing_objectId' });
  const policy = await getPolicy(objectId);
  res.json({
    objectId,
    policy: policy || {
      objectId,
      boardId: null,
      linkColumnId: null,
      peopleColumnId: null,
      itemNameSource: 'eventName',
      columnMapping: {},
    },
  });
});

app.patch('/api/policy', async (req, res) => {
  const identity = assertAdmin(req, res);
  if (!identity) return;

  const { objectId, boardId, linkColumnId, peopleColumnId, itemNameSource, columnMapping } = req.body || {};
  if (!objectId) return res.status(400).json({ error: 'missing_objectId' });

  const now = Date.now();
  const next = {
    accountId: String(identity.accountId),
    objectId: String(objectId),
    boardId: boardId ? String(boardId) : null,
    linkColumnId: linkColumnId || null,
    peopleColumnId: peopleColumnId || null,
    itemNameSource: itemNameSource || 'eventName',
    columnMapping: columnMapping || {},
    configuredByUserId: String(identity.userId),
    updatedAt: now,
    createdAt: now,
  };
  const current = await getPolicy(objectId);
  if (current?.createdAt) next.createdAt = current.createdAt;

  const saved = await upsertPolicy(next);
  res.json({ policy: saved });
});

app.get('/api/configs', async (req, res) => {
  const identity = identityFromHeaders(req);
  const objectId = req.query.objectId;
  if (!objectId) return res.status(400).json({ error: 'missing_objectId' });

  await getOrCreateConfig({
    accountId: String(identity.accountId),
    objectId: String(objectId),
    userId: String(identity.userId),
  });

  const all = await getConfigsByObject(String(objectId));
  res.json({ rows: all.map(projectConfig) });
});

app.patch('/api/configs/:configId', async (req, res) => {
  const identity = identityFromHeaders(req);
  const config = await getConfig(req.params.configId);
  if (!config) return res.status(404).json({ error: 'config_not_found' });
  if (String(config.accountId) !== String(identity.accountId)) {
    return res.status(403).json({ error: 'account_mismatch' });
  }
  if (String(config.userId) !== String(identity.userId)) {
    return res.status(403).json({ error: 'owner_required' });
  }

  const patch = {};
  if (typeof req.body?.status === 'string') patch.status = req.body.status;
  const updated = await updateConfig(config.configId, patch);
  res.json({ row: projectConfig(updated) });
});

app.post('/api/oauth/google/start', async (req, res) => {
  const identity = identityFromHeaders(req);
  const { configId } = req.body || {};
  const config = await getConfig(configId);
  if (!config) return res.status(404).json({ error: 'config_not_found' });
  if (String(config.userId) !== String(identity.userId)) {
    return res.status(403).json({ error: 'owner_required' });
  }

  const state = crypto.randomBytes(32).toString('hex');
  await storeOauthState(state, {
    type: 'google',
    configId,
    accountId: String(identity.accountId),
    userId: String(identity.userId),
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/userinfo.email',
    state,
  });

  res.json({
    authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    state,
  });
});

app.get('/api/oauth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send('missing code/state');

  const stored = await consumeOauthState(String(state));
  if (!stored || stored.type !== 'google') return res.status(400).send('invalid state');

  const tokens = await exchangeGoogleCodeForTokens({
    code: String(code),
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  });

  const email = await getGoogleUserEmail(tokens.access_token);
  const expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
  await updateConfig(stored.configId, {
    googleAccessToken: tokens.access_token,
    googleRefreshToken: tokens.refresh_token || null,
    googleAccessTokenExpiresAt: expiresAt,
    googleUserEmail: email,
    status: 'active',
  });

  res.redirect(`/admin?google=ok&configId=${encodeURIComponent(stored.configId)}`);
});

app.post('/api/oauth/monday/start', async (req, res) => {
  const identity = identityFromHeaders(req);
  const { configId } = req.body || {};
  const config = await getConfig(configId);
  if (!config) return res.status(404).json({ error: 'config_not_found' });
  if (String(config.userId) !== String(identity.userId)) {
    return res.status(403).json({ error: 'owner_required' });
  }

  const state = crypto.randomBytes(32).toString('hex');
  await storeOauthState(state, {
    type: 'monday',
    configId,
    accountId: String(identity.accountId),
    userId: String(identity.userId),
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    client_id: process.env.MONDAY_OAUTH_CLIENT_ID,
    redirect_uri: process.env.MONDAY_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: 'boards:read boards:write me:read',
    state,
  });

  res.json({
    authUrl: `https://auth.monday.com/oauth2/authorize?${params}`,
    state,
  });
});

app.get('/api/oauth/monday/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send('missing code/state');

  const stored = await consumeOauthState(String(state));
  if (!stored || stored.type !== 'monday') return res.status(400).send('invalid state');

  const tokens = await exchangeMondayCodeForToken({
    code: String(code),
    clientId: process.env.MONDAY_OAUTH_CLIENT_ID,
    clientSecret: process.env.MONDAY_OAUTH_CLIENT_SECRET,
    redirectUri: process.env.MONDAY_OAUTH_REDIRECT_URI,
  });

  await updateConfig(stored.configId, {
    mondayAccessToken: tokens.access_token,
    status: 'active',
  });

  res.redirect(`/admin?monday=ok&configId=${encodeURIComponent(stored.configId)}`);
});

app.post('/api/configs/:configId/force-sync', async (req, res) => {
  const identity = identityFromHeaders(req);
  const config = await getConfig(req.params.configId);
  if (!config) return res.status(404).json({ error: 'config_not_found' });
  if (String(config.userId) !== String(identity.userId)) {
    return res.status(403).json({ error: 'owner_required' });
  }
  const policy = await getPolicy(config.objectId);
  try {
    const result = await syncConfig({ config, policy });
    res.json({ ok: true, result });
  } catch (err) {
    await updateConfig(config.configId, {
      lastError: String(err.message || err),
    });
    res.status(500).json({ error: 'sync_failed', message: String(err.message || err) });
  }
});

app.post('/webhook/google', async (req, res) => {
  const configId = req.headers['x-goog-channel-token'];
  if (!configId) return res.status(400).json({ error: 'missing_channel_token' });

  const config = await getConfig(String(configId));
  if (!config) return res.status(200).json({ ok: true, skipped: 'config_not_found' });
  const policy = await getPolicy(config.objectId);

  try {
    const result = await syncConfig({ config, policy });
    res.json({ ok: true, result });
  } catch (err) {
    await updateConfig(config.configId, {
      lastError: String(err.message || err),
    });
    res.status(500).json({ error: 'sync_failed', message: String(err.message || err) });
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiDir = path.resolve(__dirname, '../ui');
app.use('/admin', express.static(uiDir));
app.get('/admin', (_req, res) => {
  res.sendFile(path.resolve(uiDir, 'index.html'));
});

const port = Number(process.env.PORT || 8090);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`POC server listening on http://localhost:${port}`);
});
