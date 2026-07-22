// lifecycle-service tests — normalization (feature + app events), LRU dedup,
// back_to_url async ack, the privacy allowlists (details keys + nothing
// payload-derived in logger calls), and fail-soft (a throwing board or fetch
// can never reject the handler).
//
// The service receives an ALREADY-verified appSlug from the webhook-auth
// middleware, so no JWTs are involved at this layer (JWT verification is
// covered by webhook-auth.test.js / webhooks-routes.test.js). All
// collaborators are injected: eventsBoard, logger, fetchImpl — zero network,
// zero env.

import { describe, it, expect, vi } from 'vitest';
import { createLifecycleService } from '../src/services/lifecycle-service.js';

const BACK_TO_URL = 'https://apps-events.monday.com/ack/abc123';

/** App-logger shape: (message, tag, context) + track/health signal fns. */
function makeLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    track: vi.fn(),
    health: vi.fn(),
  };
}

function makeEventsBoard({ recordEventImpl } = {}) {
  return {
    recordEvent: vi.fn(recordEventImpl ?? (async () => 'item-1')),
  };
}

function makeService({ eventsBoard, logger, fetchImpl, debugRawPayload, slugResolver } = {}) {
  const log = logger ?? makeLogger();
  const board = eventsBoard === null ? null : (eventsBoard ?? makeEventsBoard());
  const doFetch = fetchImpl ?? vi.fn(async () => ({ ok: true, status: 200 }));
  const service = createLifecycleService({
    eventsBoard: board,
    logger: log,
    fetchImpl: doFetch,
    debugRawPayload,
    slugResolver,
  });
  return { service, logger: log, eventsBoard: board, fetchImpl: doFetch };
}

/** Every argument ever passed to any logger method, flattened to one string. */
function allLoggerArgs(logger) {
  return ['error', 'warn', 'info', 'debug', 'track', 'health']
    .flatMap((method) => logger[method].mock.calls)
    .map((args) => JSON.stringify(args))
    .join('\n');
}

/** Flush microtasks + timers so fire-and-forget .catch handlers run. */
function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Realistic feature-level lifecycle body — deliberately poisoned with
// free-text and PII-like keys that the allowlist must drop.
function featureBody(overrides = {}) {
  return {
    type: 'AppFeatureBoardView:delete',
    payload: {
      boardId: 4567890123,
      itemId: '111222333',
      instanceId: 987654,
      appFeatureId: 'af-42',
      app_feature: { name: 'Discussions View' },
      // Must NEVER pass the allowlist:
      user_email: 'victim@example.com',
      userEmail: 'victim2@example.com',
      user_name: 'Ilai Private Person',
      boardName: 'Secret Client Board',
      note: 'free text that must not leak',
    },
    accountId: 12345,
    userId: 67890,
    back_to_url: BACK_TO_URL,
    ...overrides,
  };
}

// Realistic app-level body (install / subscription events).
function appBody(type = 'install', overrides = {}) {
  return {
    type,
    data: {
      app_id: 11457413,
      user_id: 67890,
      user_email: 'buyer@example.com',
      user_name: 'Private Buyer',
      account_id: 55501,
      account_name: 'Acme Corp Ltd',
      account_slug: 'acme-corp',
      account_tier: 'pro',
      account_max_users: 25,
      timestamp: '2026-07-19T10:00:00Z',
      version_data: { major: 1, minor: 2, patch: 3, type: 'minor' },
      subscription: {
        plan_id: 'plan_basic_5',
        is_trial: false,
        billing_period: 'monthly',
        renewal_date: '2026-08-19T00:00:00Z',
      },
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Feature event normalization
// ---------------------------------------------------------------------------

describe('handleFeatureEvent — normalization', () => {
  it('records category Lifecycle, eventType = body.type, feature from app_feature.name', async () => {
    const { service, eventsBoard } = makeService();

    const result = await service.handleFeatureEvent({
      appSlug: 'discussions',
      body: featureBody(),
      eventId: 'evt-1',
    });

    expect(result).toEqual({ duplicate: false, itemId: 'item-1' });
    expect(eventsBoard.recordEvent).toHaveBeenCalledTimes(1);
    const evt = eventsBoard.recordEvent.mock.calls[0][0];
    expect(evt).toMatchObject({
      category: 'Lifecycle',
      eventType: 'AppFeatureBoardView:delete',
      appSlug: 'discussions',
      feature: 'Discussions View',
      accountId: '12345',
      userId: '67890',
      eventId: 'evt-1',
    });
    expect(Number.isNaN(new Date(evt.occurredAt).getTime())).toBe(false);
  });

  it('falls back to payload.appFeatureId (stringified) when app_feature.name is absent', async () => {
    const { service, eventsBoard } = makeService();
    const body = featureBody();
    delete body.payload.app_feature;
    body.payload.appFeatureId = 424242;

    await service.handleFeatureEvent({ appSlug: 'axis-planner', body, eventId: 'evt-2' });

    expect(eventsBoard.recordEvent.mock.calls[0][0].feature).toBe('424242');
  });

  it('uses empty-string feature when neither app_feature.name nor appFeatureId exists', async () => {
    const { service, eventsBoard } = makeService();
    const body = featureBody();
    delete body.payload.app_feature;
    delete body.payload.appFeatureId;

    await service.handleFeatureEvent({ appSlug: 'axis-planner', body, eventId: 'evt-3' });

    expect(eventsBoard.recordEvent.mock.calls[0][0].feature).toBe('');
  });

  it('accepts snake_case board_id as the boardId detail', async () => {
    const { service, eventsBoard } = makeService();
    const body = featureBody();
    delete body.payload.boardId;
    body.payload.board_id = 777;

    await service.handleFeatureEvent({ appSlug: 'axis-tracker', body, eventId: 'evt-4' });

    expect(eventsBoard.recordEvent.mock.calls[0][0].details.boardId).toBe('777');
  });

  it('survives a malformed body (null) — resolves and still records a Lifecycle event', async () => {
    const { service, eventsBoard, logger } = makeService();

    const result = await service.handleFeatureEvent({
      appSlug: 'axis-day-off',
      body: null,
      eventId: 'evt-5',
    });

    expect(result.duplicate).toBe(false);
    expect(eventsBoard.recordEvent).toHaveBeenCalledTimes(1);
    expect(eventsBoard.recordEvent.mock.calls[0][0]).toMatchObject({
      category: 'Lifecycle',
      eventType: '',
      feature: '',
      accountId: '',
      userId: '',
      details: {},
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Privacy allowlists
// ---------------------------------------------------------------------------

describe('privacy — details allowlist and logger hygiene', () => {
  it('feature details contain ONLY allowlisted id keys — no user_email-like keys pass through', async () => {
    const { service, eventsBoard } = makeService();

    await service.handleFeatureEvent({
      appSlug: 'discussions',
      body: featureBody(),
      eventId: 'evt-p1',
    });

    const details = eventsBoard.recordEvent.mock.calls[0][0].details;
    expect(Object.keys(details).sort()).toEqual(
      ['appFeatureId', 'boardId', 'instanceId', 'itemId'].sort(),
    );
    // Ids are stringified scalars only.
    expect(details).toEqual({
      boardId: '4567890123',
      itemId: '111222333',
      instanceId: '987654',
      appFeatureId: 'af-42',
    });
    const flat = JSON.stringify(details);
    expect(flat).not.toContain('user_email');
    expect(flat).not.toContain('example.com');
    expect(flat).not.toContain('Secret Client Board');
    expect(flat).not.toContain('free text');
  });

  it('app-event details keep only the allowlisted account/subscription fields', async () => {
    const { service, eventsBoard } = makeService();

    await service.handleAppEvent({
      appSlug: 'deadline-confirm',
      body: appBody('app_subscription_created'),
      eventId: 'evt-p2',
    });

    const details = eventsBoard.recordEvent.mock.calls[0][0].details;
    expect(details).toEqual({
      account_name: 'Acme Corp Ltd',
      account_slug: 'acme-corp',
      account_tier: 'pro',
      account_max_users: 25,
      plan_id: 'plan_basic_5',
      is_trial: false,
      billing_period: 'monthly',
    });
    // user_email / user_name / renewal_date / version_data must be dropped.
    expect(details).not.toHaveProperty('user_email');
    expect(details).not.toHaveProperty('user_name');
    expect(details).not.toHaveProperty('renewal_date');
    expect(details).not.toHaveProperty('version_data');
  });

  it('nothing payload-derived reaches the logger — no emails, names, or back_to_url in ANY log call', async () => {
    const failingBoard = makeEventsBoard({
      recordEventImpl: async () => {
        throw new Error('board down');
      },
    });
    const { service, logger } = makeService({ eventsBoard: failingBoard });

    // Exercise every logging path: success-less record (error), duplicate
    // (debug), app event (error again).
    await service.handleFeatureEvent({ appSlug: 'discussions', body: featureBody(), eventId: 'evt-p3' });
    await service.handleFeatureEvent({ appSlug: 'discussions', body: featureBody(), eventId: 'evt-p3' });
    await service.handleAppEvent({ appSlug: 'discussions', body: appBody('install'), eventId: 'evt-p4' });
    await flushAsync();

    const logged = allLoggerArgs(logger);
    expect(logged).not.toContain('example.com');
    expect(logged).not.toContain('Acme Corp');
    expect(logged).not.toContain('acme-corp');
    expect(logged).not.toContain('Private');
    expect(logged).not.toContain('Secret Client Board');
    expect(logged).not.toContain(BACK_TO_URL);
  });

  it('logger.track carries only app/type/kind enums on a recorded event', async () => {
    const { service, logger } = makeService();

    await service.handleFeatureEvent({ appSlug: 'discussions', body: featureBody(), eventId: 'evt-p5' });

    expect(logger.track).toHaveBeenCalledTimes(1);
    expect(logger.track).toHaveBeenCalledWith('lifecycle_event', {
      app: 'discussions',
      type: 'AppFeatureBoardView:delete',
      kind: 'Lifecycle',
    });
  });

  it('does NOT track when the board write fails — recordEvent resolves null (finding #143-10)', async () => {
    const { service, eventsBoard, logger } = makeService();
    // events-board's contract: never throws, resolves null on failure.
    eventsBoard.recordEvent.mockResolvedValue(null);

    const result = await service.handleFeatureEvent({
      appSlug: 'discussions',
      body: featureBody(),
      eventId: 'evt-p6',
    });

    expect(result).toEqual({ duplicate: false, itemId: null });
    expect(eventsBoard.recordEvent).toHaveBeenCalledTimes(1);
    expect(logger.track).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// App event normalization (category routing)
// ---------------------------------------------------------------------------

describe('handleAppEvent — normalization', () => {
  it("maps type 'install' to category Install with account/user ids from data", async () => {
    const { service, eventsBoard, logger } = makeService();

    const result = await service.handleAppEvent({
      appSlug: 'team-people-column',
      body: appBody('install'),
      eventId: 'evt-a1',
    });

    expect(result).toEqual({ duplicate: false, itemId: 'item-1' });
    const evt = eventsBoard.recordEvent.mock.calls[0][0];
    expect(evt).toMatchObject({
      category: 'Install',
      eventType: 'install',
      appSlug: 'team-people-column',
      feature: '',
      accountId: '55501',
      userId: '67890',
      eventId: 'evt-a1',
    });
    expect(logger.track).toHaveBeenCalledWith('lifecycle_event', {
      app: 'team-people-column',
      type: 'install',
      kind: 'Install',
    });
  });

  it("maps type 'uninstall' to category Install", async () => {
    const { service, eventsBoard } = makeService();

    await service.handleAppEvent({ appSlug: 'discussions', body: appBody('uninstall'), eventId: 'evt-a2' });

    expect(eventsBoard.recordEvent.mock.calls[0][0].category).toBe('Install');
  });

  it("maps 'app_subscription_created' to category Subscription", async () => {
    const { service, eventsBoard } = makeService();

    await service.handleAppEvent({
      appSlug: 'discussions',
      body: appBody('app_subscription_created'),
      eventId: 'evt-a3',
    });

    expect(eventsBoard.recordEvent.mock.calls[0][0]).toMatchObject({
      category: 'Subscription',
      eventType: 'app_subscription_created',
    });
  });

  it('normalizes data.timestamp into an ISO occurredAt', async () => {
    const { service, eventsBoard } = makeService();

    await service.handleAppEvent({
      appSlug: 'discussions',
      body: appBody('app_trial_subscription_started'),
      eventId: 'evt-a4',
    });

    expect(eventsBoard.recordEvent.mock.calls[0][0].occurredAt).toBe('2026-07-19T10:00:00.000Z');
  });

  it('falls back to a valid "now" ISO timestamp when data.timestamp is garbage', async () => {
    const { service, eventsBoard } = makeService();
    const before = Date.now();

    await service.handleAppEvent({
      appSlug: 'discussions',
      body: appBody('install', { timestamp: 'not-a-date' }),
      eventId: 'evt-a5',
    });

    const occurredAt = new Date(eventsBoard.recordEvent.mock.calls[0][0].occurredAt).getTime();
    expect(occurredAt).toBeGreaterThanOrEqual(before);
    expect(occurredAt).toBeLessThanOrEqual(Date.now());
  });
});

// ---------------------------------------------------------------------------
// Dedup (LRU by X-Apps-Event-Id)
// ---------------------------------------------------------------------------

describe('dedup', () => {
  it('same eventId delivered twice → one recordEvent, second returns { duplicate: true }', async () => {
    const { service, eventsBoard, fetchImpl } = makeService();

    const first = await service.handleFeatureEvent({
      appSlug: 'discussions',
      body: featureBody(),
      eventId: 'dup-1',
    });
    const second = await service.handleFeatureEvent({
      appSlug: 'discussions',
      body: featureBody(),
      eventId: 'dup-1',
    });

    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ duplicate: true });
    expect(eventsBoard.recordEvent).toHaveBeenCalledTimes(1);
    // The redelivery creates no item but IS re-acked — a redelivery means
    // monday never accepted the previous ack, so withholding it would loop
    // the redelivery forever (finding #143-2). Recording stays at-most-once.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenLastCalledWith(BACK_TO_URL, expect.objectContaining({ method: 'POST' }));
  });

  it('dedup spans both handlers (one shared event-id space)', async () => {
    const { service, eventsBoard } = makeService();

    await service.handleFeatureEvent({ appSlug: 'discussions', body: featureBody(), eventId: 'dup-2' });
    const result = await service.handleAppEvent({
      appSlug: 'discussions',
      body: appBody('install'),
      eventId: 'dup-2',
    });

    expect(result).toEqual({ duplicate: true });
    expect(eventsBoard.recordEvent).toHaveBeenCalledTimes(1);
  });

  it('missing eventId (null) is never dedup’d — both deliveries record', async () => {
    const { service, eventsBoard } = makeService();

    const a = await service.handleAppEvent({ appSlug: 'discussions', body: appBody('install'), eventId: null });
    const b = await service.handleAppEvent({ appSlug: 'discussions', body: appBody('install'), eventId: null });

    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(false);
    expect(eventsBoard.recordEvent).toHaveBeenCalledTimes(2);
  });

  it('LRU cap 500: after 500 newer ids the oldest id is evicted and records again', async () => {
    const { service, eventsBoard } = makeService();

    await service.handleAppEvent({ appSlug: 'discussions', body: appBody('install'), eventId: 'oldest' });
    for (let i = 0; i < 500; i += 1) {
      await service.handleAppEvent({
        appSlug: 'discussions',
        body: appBody('install'),
        eventId: `fill-${i}`,
      });
    }

    const replay = await service.handleAppEvent({
      appSlug: 'discussions',
      body: appBody('install'),
      eventId: 'oldest',
    });

    expect(replay.duplicate).toBe(false);
    expect(eventsBoard.recordEvent).toHaveBeenCalledTimes(502);
  });
});

// ---------------------------------------------------------------------------
// back_to_url async ack
// ---------------------------------------------------------------------------

describe('back_to_url ack', () => {
  it('POSTs {"success":true} exactly once to the https back_to_url', async () => {
    const { service, fetchImpl } = makeService();

    await service.handleFeatureEvent({ appSlug: 'discussions', body: featureBody(), eventId: 'ack-1' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(BACK_TO_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe('{"success":true}');
    expect(JSON.parse(init.body)).toEqual({ success: true });
  });

  it('does not fetch when back_to_url is absent', async () => {
    const { service, fetchImpl } = makeService();

    await service.handleFeatureEvent({
      appSlug: 'discussions',
      body: featureBody({ back_to_url: undefined }),
      eventId: 'ack-2',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects non-https and non-string back_to_url values', async () => {
    const { service, fetchImpl } = makeService();

    await service.handleFeatureEvent({
      appSlug: 'discussions',
      body: featureBody({ back_to_url: 'http://insecure.example.com/ack' }),
      eventId: 'ack-3',
    });
    await service.handleFeatureEvent({
      appSlug: 'discussions',
      body: featureBody({ back_to_url: { url: BACK_TO_URL } }),
      eventId: 'ack-4',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a rejecting ack fetch is fire-and-forget: handler resolves, logger.warn fires, no crash', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network unreachable');
    });
    const { service, logger } = makeService({ fetchImpl });

    const result = await service.handleFeatureEvent({
      appSlug: 'discussions',
      body: featureBody(),
      eventId: 'ack-5',
    });
    await flushAsync();

    expect(result.duplicate).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(allLoggerArgs(logger)).not.toContain(BACK_TO_URL);
  });

  it('a synchronously-throwing fetch impl cannot break the handler', async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error('sync boom');
    });
    const { service, logger } = makeService({ fetchImpl });

    const result = await service.handleFeatureEvent({
      appSlug: 'discussions',
      body: featureBody(),
      eventId: 'ack-6',
    });

    expect(result.duplicate).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fail-soft
// ---------------------------------------------------------------------------

describe('fail-soft', () => {
  it('recordEvent throwing → handleFeatureEvent resolves { duplicate:false, itemId:null } and logger.error is called', async () => {
    const eventsBoard = makeEventsBoard({
      recordEventImpl: async () => {
        throw new Error('monday outage');
      },
    });
    const { service, logger } = makeService({ eventsBoard });

    const result = await service.handleFeatureEvent({
      appSlug: 'discussions',
      body: featureBody(),
      eventId: 'fs-1',
    });

    expect(result).toEqual({ duplicate: false, itemId: null });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('recordEvent throwing → handleAppEvent resolves and logs, never rethrows', async () => {
    const eventsBoard = makeEventsBoard({
      recordEventImpl: async () => {
        throw new Error('board deleted');
      },
    });
    const { service, logger } = makeService({ eventsBoard });

    const result = await service.handleAppEvent({
      appSlug: 'discussions',
      body: appBody('install'),
      eventId: 'fs-2',
    });

    expect(result).toEqual({ duplicate: false, itemId: null });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.track).not.toHaveBeenCalled();
  });

  it('null eventsBoard (unconfigured) → resolves with itemId null, warns lifecycle_not_configured ONCE per route', async () => {
    const { service, logger } = makeService({ eventsBoard: null });

    const r1 = await service.handleFeatureEvent({ appSlug: 'discussions', body: featureBody(), eventId: 'fs-3' });
    const r2 = await service.handleFeatureEvent({ appSlug: 'discussions', body: featureBody(), eventId: 'fs-4' });
    const r3 = await service.handleAppEvent({ appSlug: 'discussions', body: appBody('install'), eventId: 'fs-5' });

    expect(r1).toEqual({ duplicate: false, itemId: null });
    expect(r2).toEqual({ duplicate: false, itemId: null });
    expect(r3).toEqual({ duplicate: false, itemId: null });
    // Once for the lifecycle route + once for the app-events route — not per event.
    const notConfiguredWarns = logger.warn.mock.calls.filter(
      ([message]) => message === 'lifecycle_not_configured',
    );
    expect(notConfiguredWarns).toHaveLength(2);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.track).not.toHaveBeenCalled();
  });
});

describe('debugRawPayload — env-gated raw capture (console-only, never ships)', () => {
  it('when ENABLED, handleFeatureEvent logs the FULL raw body once as debug_lifecycle_raw', async () => {
    const { service, logger } = makeService({ debugRawPayload: true });

    await service.handleFeatureEvent({ appSlug: 'axis-tracker', body: featureBody(), eventId: 'ev-raw-1' });

    const call = logger.info.mock.calls.find((c) => c[0] === 'debug_lifecycle_raw');
    expect(call).toBeTruthy();
    expect(call[1]).toBe('lifecycle');
    // The raw dump must carry the WHOLE body (incl. keys the allowlist drops)
    // so the operator can see everything monday actually sends.
    expect(call[2].raw).toContain('user_email');
    expect(call[2].raw).toContain('AppFeatureBoardView:delete');
  });

  it('when ENABLED, handleAppEvent logs the raw body too', async () => {
    const { service, logger } = makeService({ debugRawPayload: true });

    await service.handleAppEvent({
      appSlug: 'axis-tracker',
      body: { type: 'install', data: { app_id: 1, user_id: 2, account_id: 3 } },
      eventId: 'ev-raw-2',
    });

    const call = logger.info.mock.calls.find((c) => c[0] === 'debug_lifecycle_raw');
    expect(call).toBeTruthy();
    expect(call[2].raw).toContain('account_id');
  });

  it('by DEFAULT (flag absent) no debug_lifecycle_raw log is ever emitted', async () => {
    const { service, logger } = makeService();

    await service.handleFeatureEvent({ appSlug: 'axis-tracker', body: featureBody(), eventId: 'ev-raw-3' });

    expect(logger.info.mock.calls.find((c) => c[0] === 'debug_lifecycle_raw')).toBeUndefined();
    expect(allLoggerArgs(logger)).not.toContain('user_email');
  });
});

// ---------------------------------------------------------------------------
// REAL payload shape (Change #145) — fixture captured live on 2026-07-22 via
// DEBUG_LIFECYCLE_PAYLOAD from a tracker AppFeatureObject:create. monday nests
// EVERYTHING under `data` (payload/back_to_url/ids/timestamp) — the original
// handler read them at the top level and got empties.
// ---------------------------------------------------------------------------

function realFeatureBody(overrides = {}) {
  return {
    type: 'AppFeatureObject:create',
    data: {
      payload: {
        object_id: 18423229216,
        object_name: 'Tracker',
        workspace_id: 15426602,
        source_object_id: null,
        source_workspace_id: null,
        creation_attributes: null,
        tracing_data: { trace_event_id: 'a37b-trace', object_app_feature_id: 23902080 },
      },
      back_to_url: BACK_TO_URL,
      app_id: 10684862,
      app_feature_reference_id: 15361233,
      app_feature_id: 23902080,
      user_id: 48274917,
      account_id: 14334098,
      timestamp: '2026-07-22T08:40:56.057Z',
      ...overrides,
    },
  };
}

function makeSlugResolver(slug = 'yomsheni-il') {
  return { getSlug: vi.fn(async () => slug) };
}

describe('handleFeatureEvent — REAL data.* payload shape (#145)', () => {
  it('extracts account/user/timestamp/feature from data.* and the object fields from data.payload', async () => {
    const { service, eventsBoard } = makeService();

    await service.handleFeatureEvent({ appSlug: 'axis-tracker', body: realFeatureBody(), eventId: 'ev-real-1' });

    const evt = eventsBoard.recordEvent.mock.calls[0][0];
    expect(evt).toMatchObject({
      category: 'Lifecycle',
      eventType: 'AppFeatureObject:create',
      appSlug: 'axis-tracker',
      accountId: '14334098',
      userId: '48274917',
      feature: '23902080',
      workspace: '15426602',
      objectName: 'Tracker',
      occurredAt: new Date('2026-07-22T08:40:56.057Z').toISOString(),
    });
    expect(evt.details).toMatchObject({
      object_id: '18423229216',
      app_feature_reference_id: '15361233',
      app_id: '10684862',
    });
  });

  it('acks data.back_to_url (the REAL location — the old top-level read never fired)', async () => {
    const { service, fetchImpl } = makeService();

    await service.handleFeatureEvent({ appSlug: 'axis-tracker', body: realFeatureBody(), eventId: 'ev-real-2' });
    await flushAsync();

    const ack = fetchImpl.mock.calls.find((c) => String(c[0]) === BACK_TO_URL);
    expect(ack).toBeTruthy();
    expect(JSON.parse(ack[1].body)).toEqual({ success: true });
  });

  it('builds objectUrl from the injected slug resolver (owner-gated)', async () => {
    const resolver = makeSlugResolver();
    const { service, eventsBoard } = makeService({ slugResolver: resolver });

    await service.handleFeatureEvent({ appSlug: 'axis-tracker', body: realFeatureBody(), eventId: 'ev-real-3' });

    expect(resolver.getSlug).toHaveBeenCalledWith('14334098');
    const evt = eventsBoard.recordEvent.mock.calls[0][0];
    expect(evt.objectUrl).toBe('https://yomsheni-il.monday.com/boards/18423229216');
    // No user lookup by design (owner decision): feature events carry ids only.
    expect(evt.userName).toBe('');
    expect(evt.userEmail).toBe('');
  });

  it('a failing/absent slug resolver degrades to empty objectUrl (record still happens)', async () => {
    const failing = { getSlug: vi.fn(async () => { throw new Error('api down'); }) };
    const { service, eventsBoard } = makeService({ slugResolver: failing });

    await service.handleFeatureEvent({ appSlug: 'axis-tracker', body: realFeatureBody(), eventId: 'ev-real-4' });

    const evt = eventsBoard.recordEvent.mock.calls[0][0];
    expect(evt.objectUrl).toBe('');
    expect(eventsBoard.recordEvent).toHaveBeenCalledTimes(1);
  });

  it('PRIVACY: the slug/url NEVER reach any logger call', async () => {
    const { service, logger } = makeService({ slugResolver: makeSlugResolver() });

    await service.handleFeatureEvent({ appSlug: 'axis-tracker', body: realFeatureBody(), eventId: 'ev-real-5' });

    const logged = allLoggerArgs(logger);
    expect(logged).not.toContain('yomsheni-il');
    expect(logged).not.toContain('boards/18423229216');
  });

  it('LEGACY top-level shape still parses (docs-era bodies keep working)', async () => {
    const { service, eventsBoard } = makeService();

    await service.handleFeatureEvent({ appSlug: 'discussions', body: featureBody(), eventId: 'ev-real-6' });

    expect(eventsBoard.recordEvent.mock.calls[0][0]).toMatchObject({
      accountId: '12345',
      userId: '67890',
    });
  });
});

describe('handleAppEvent — identity + version enrichment (#145)', () => {
  it('maps user_name/user_email straight from data and version_data to appVersion', async () => {
    const { service, eventsBoard } = makeService();

    await service.handleAppEvent({ appSlug: 'discussions', body: appBody('install'), eventId: 'ev-app-1' });

    const evt = eventsBoard.recordEvent.mock.calls[0][0];
    expect(evt.userName).toBe('Private Buyer');
    expect(evt.userEmail).toBe('buyer@example.com');
    expect(evt.appVersion).toBe('1.2.3');
  });
});
