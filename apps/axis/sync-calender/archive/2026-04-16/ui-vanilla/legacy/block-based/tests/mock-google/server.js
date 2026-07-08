// Mock Google Calendar + OAuth userinfo server for E2E tests.
// The app, when launched with GOOGLE_API_BASE_URL=http://localhost:9999,
// sends all googleapis traffic here instead of www.googleapis.com.
//
// Additionally, this server hosts a *mock monday relay* under
// POST /mock-monday/relay/:channelId. When the app fires a trigger to what it
// thinks is monday's webhookUrl, we receive the trigger body, re-sign a proper
// action JWT, and POST to the app's /actions/sync-events to close the loop.
//
//   node tests/mock-google/server.js
//   MOCK_PORT=9999 (override with env)
//
// Endpoints served:
//   GET  /admin/health                                 → { ok: true }
//   POST /admin/reset                                  → clears state
//   POST /admin/configure         body: { appBaseUrl, signingSecret, shortLivedToken,
//                                         appId, accountId, userId, boardId,
//                                         linkColumnId, mapping }  → configure relay
//   POST /admin/seed-events       body: { events:[…] } → replace event list
//   POST /admin/set-user-email    body: { email }      → override mock user email
//   POST /admin/force-next-sync-token   body: { token }→ set next syncToken
//   POST /admin/force-410-next                          → make the NEXT events.list return HTTP 410
//   GET  /admin/state                                  → inspect internal state
//
//   POST /calendar/v3/calendars/primary/events/watch   → watch channel response
//   POST /calendar/v3/channels/stop                    → 204
//   GET  /calendar/v3/calendars/primary/events         → events.list (initial or incremental)
//   GET  /oauth2/v2/userinfo                           → { email }
//
//   POST /mock-monday/relay/:channelId                 → accept trigger fire,
//                                                        re-sign JWT, forward to
//                                                        appBaseUrl/actions/sync-events

import express from 'express';
import jwt from 'jsonwebtoken';
import { promises as fs } from 'fs';

const PORT = Number(process.env.MOCK_PORT || 9999);

const initialState = () => ({
  events: [],
  userEmail: 'e2e-tester@example.com',
  syncCounter: 0,
  force410Once: false,
  forcedNextSyncToken: null,
  forcedPageSize: null, // when set, overrides client-requested maxResults
  requestLog: [],
  config: {
    appBaseUrl: '',
    signingSecret: '',
    shortLivedToken: '',
    appId: 0,
    accountId: 0,
    userId: 0,
    boardId: 0,
    linkColumnId: '',
    peopleColumnId: '',
    // Path to the app's LOCAL_STORAGE_FILE so the relay can read
    // trigger_cache_<triggerUuid> entries written by the webhook. Required
    // for the relay to enrich its log entries with cachedContext before
    // forwarding to /actions/sync-events.
    storageFile: '',
    // How to translate trigger outputFields into action inboundFieldValues.
    // This mimics what monday's recipe resolver does in production when the
    // user maps trigger outputs → action inputs in the workflow builder.
    mapping: {
      // action.itemName = outputFields[<source>]. If source is a string, it's
      // a trigger output key. Set to null to leave itemName empty.
      itemName: 'eventName',
      // action.item = { <columnId>: outputFields[<triggerField>], ... }
      item: {},
    },
  },
  // Recent relay activity for test assertions.
  relayLog: [],
});

let state = initialState();

function nextSyncToken() {
  if (state.forcedNextSyncToken) {
    const t = state.forcedNextSyncToken;
    state.forcedNextSyncToken = null;
    return t;
  }
  state.syncCounter++;
  return `mock-sync-${state.syncCounter}`;
}

function logRequest(req) {
  state.requestLog.push({
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    query: req.query,
  });
}

const app = express();
app.use(express.json({ limit: '5mb' }));

app.use((req, _res, next) => {
  logRequest(req);
  next();
});

// ─── Admin endpoints ──────────────────────────────────────────────────────
app.get('/admin/health', (_req, res) => res.json({ ok: true, port: PORT }));

app.post('/admin/reset', (_req, res) => {
  state = initialState();
  res.json({ ok: true });
});

app.post('/admin/seed-events', (req, res) => {
  state.events = Array.isArray(req.body?.events) ? req.body.events : [];
  res.json({ ok: true, count: state.events.length });
});

app.post('/admin/set-user-email', (req, res) => {
  if (typeof req.body?.email === 'string') state.userEmail = req.body.email;
  res.json({ ok: true, email: state.userEmail });
});

app.post('/admin/force-next-sync-token', (req, res) => {
  state.forcedNextSyncToken = String(req.body?.token || '');
  res.json({ ok: true });
});

app.post('/admin/force-410-next', (_req, res) => {
  state.force410Once = true;
  res.json({ ok: true });
});

app.post('/admin/set-page-size', (req, res) => {
  state.forcedPageSize = Number(req.body?.pageSize) || null;
  res.json({ ok: true, forcedPageSize: state.forcedPageSize });
});

app.post('/admin/configure', (req, res) => {
  state.config = {
    ...state.config,
    ...req.body,
    mapping: {
      ...state.config.mapping,
      ...(req.body?.mapping || {}),
      item: { ...(state.config.mapping?.item || {}), ...(req.body?.mapping?.item || {}) },
    },
  };
  res.json({ ok: true, config: state.config });
});

app.get('/admin/state', (_req, res) => {
  res.json({
    eventCount: state.events.length,
    userEmail: state.userEmail,
    syncCounter: state.syncCounter,
    config: state.config,
    recentRequests: state.requestLog.slice(-20),
    recentRelays: state.relayLog.slice(-10),
  });
});

// ─── Google Calendar API simulation ───────────────────────────────────────

// events.watch — register a push channel (we don't actually push until M3 relay).
app.post('/calendar/v3/calendars/:calendarId/events/watch', (req, res) => {
  const { id } = req.body || {};
  const expiration = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
  res.json({
    kind: 'api#channel',
    id,
    resourceId: `mock-resource-${id}`,
    resourceUri: `https://www.googleapis.com/calendar/v3/calendars/${req.params.calendarId}/events?alt=json`,
    token: req.body?.token,
    expiration,
  });
});

// channels.stop — acknowledge.
app.post('/calendar/v3/channels/stop', (_req, res) => res.status(204).end());

// events.list — supports both initial (timeMin) and incremental (syncToken) modes.
// Pagination is single-page for M2; edge-case scenarios in M6 will verify multi-page.
app.get('/calendar/v3/calendars/:calendarId/events', (req, res) => {
  if (state.force410Once) {
    state.force410Once = false;
    return res.status(410).json({
      error: { code: 410, message: 'Sync token is no longer valid, a full sync is required.' },
    });
  }

  const { syncToken, pageToken, maxResults } = req.query;
  const requestedLimit = state.forcedPageSize || Number(maxResults) || 250;
  const limit = Math.min(requestedLimit, state.events.length);
  const offset = pageToken ? Number(pageToken) : 0;
  const slice = state.events.slice(offset, offset + limit);
  const end = offset + slice.length;
  const hasMore = end < state.events.length;

  const payload = {
    kind: 'calendar#events',
    etag: `"mock-etag-${Date.now()}"`,
    summary: state.userEmail,
    description: '',
    updated: new Date().toISOString(),
    timeZone: 'Asia/Jerusalem',
    accessRole: 'owner',
    defaultReminders: [],
    items: slice,
  };

  if (hasMore) {
    payload.nextPageToken = String(end);
  } else {
    payload.nextSyncToken = nextSyncToken();
  }

  res.json(payload);
});

// oauth2 userinfo.
app.get('/oauth2/v2/userinfo', (_req, res) => {
  res.json({
    id: 'mock-user-id',
    email: state.userEmail,
    verified_email: true,
    hd: state.userEmail.split('@')[1],
  });
});

// ─── Mock monday relay ────────────────────────────────────────────────────
// The app fires a trigger to what it thinks is monday (webhookUrl). In the
// v3 (revised) architecture:
//   1) We generate a triggerUuid and respond IMMEDIATELY with {success, triggerUuid}.
//   2) The app's webhook handler receives triggerUuid and writes
//      trigger_cache_<triggerUuid> = { subscriptionId, eventId, eventStatus, eventLink }.
//   3) Asynchronously (after a short delay), we read back that cache entry
//      from the app's storage file, enrich the relay log so tests can still
//      identify which event triggered this fire, and forward to
//      /actions/sync-events with DOMAIN-ONLY inboundFieldValues plus
//      runtimeMetadata.triggerUuid.
const RELAY_FORWARD_DELAY_MS = 300;

function newTriggerUuid() {
  return `mock-trigger-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readTriggerCache(storageFile, triggerUuid) {
  if (!storageFile) return null;
  try {
    const raw = await fs.readFile(storageFile, 'utf8');
    const db = JSON.parse(raw);
    const hit = db[`trigger_cache_${triggerUuid}`];
    if (hit?.value) return JSON.parse(hit.value);
  } catch (err) {
    console.warn(`[mock-google] failed to read trigger cache: ${err.message}`);
  }
  return null;
}

async function forwardToAction({ entry, config, subscriptionId, triggerUuid, outputFields }) {
  try {
    entry.cachedContext = await readTriggerCache(config.storageFile, triggerUuid);

    const mapping = config.mapping || {};
    const itemName = typeof mapping.itemName === 'string' ? outputFields[mapping.itemName] ?? '' : '';
    const item = {};
    for (const [columnId, triggerField] of Object.entries(mapping.item || {})) {
      if (outputFields[triggerField] !== undefined) {
        item[columnId] = outputFields[triggerField];
      }
    }

    // Domain-only inbound values. Routing (subscriptionId, eventId, eventStatus,
    // eventLink) is resolved server-side via the trigger cache keyed by triggerUuid.
    const inboundFieldValues = {
      boardId: config.boardId,
      linkColumnId: config.linkColumnId,
      itemName,
      item,
    };
    if (config.peopleColumnId) {
      inboundFieldValues.peopleColumnId = config.peopleColumnId;
    }

    const now = Math.floor(Date.now() / 1000);
    const audUrl = `${config.appBaseUrl}/actions/sync-events`;
    const outerJwt = jwt.sign(
      {
        accountId: config.accountId,
        userId: config.userId,
        platformAppId: config.appId,
        aud: audUrl,
        exp: now + 300,
        shortLivedToken: config.shortLivedToken,
        iat: now,
      },
      config.signingSecret,
      { algorithm: 'HS256' }
    );

    const body = {
      payload: {
        blockKind: 'action',
        credentialsValues: {
          google_credentials: {
            userCredentialsId: 0,
            accessToken: 'mock-access-token',
            userCredentialsParams: {},
            tokenRequestedParams: {},
          },
        },
        inboundFieldValues,
        inputFields: {},
        recipeId: 0,
        integrationId: 0,
      },
      runtimeMetadata: {
        actionUuid: `mock-action-${Date.now()}`,
        triggerUuid,
      },
    };

    const r = await fetch(audUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: outerJwt },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    entry.status = 'forwarded';
    entry.forwardedStatus = r.status;
    entry.forwardedBody = text.slice(0, 500);
    entry.inboundFieldValues = inboundFieldValues;
  } catch (err) {
    entry.status = 'error';
    entry.error = err.message;
    console.error('[mock-google] relay forward failed:', err.message);
  }
}

app.post('/mock-monday/relay/:channelId', async (req, res) => {
  const { config } = state;
  const outputFields = req.body?.trigger?.outputFields || {};
  const subscriptionId = req.params.channelId; // new arch: channelId === subscriptionId
  const triggerUuid = newTriggerUuid();

  const entry = {
    timestamp: new Date().toISOString(),
    subscriptionId,
    channelId: subscriptionId,
    triggerUuid,
    outputFields,
  };

  if (!config.signingSecret || !config.shortLivedToken || !config.appBaseUrl) {
    entry.status = 'not-configured';
    state.relayLog.push(entry);
    console.warn('[mock-google] relay called before /admin/configure — ignoring');
    return res.status(200).json({ success: false, reason: 'not-configured' });
  }

  state.relayLog.push(entry);
  // Respond FIRST with triggerUuid so the webhook can write trigger_cache.
  res.json({ success: true, triggerUuid });

  // Then forward to the action asynchronously, giving the webhook time to
  // populate trigger_cache_<triggerUuid> before the action reads it.
  setTimeout(
    () => forwardToAction({ entry, config, subscriptionId, triggerUuid, outputFields }),
    RELAY_FORWARD_DELAY_MS
  );
});

// ─── Default 404 with logging so leaks are obvious ────────────────────────
app.use((req, res) => {
  console.log(`[mock-google] UNHANDLED ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'not-mocked', method: req.method, path: req.originalUrl });
});

app.listen(PORT, () => {
  console.log(`[mock-google] listening on http://localhost:${PORT}`);
});
