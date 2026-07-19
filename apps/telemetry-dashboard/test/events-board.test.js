// Contract tests for src/services/events-board.js — the CONFIG-DRIVEN board
// writer. Config (boardId, single groupId, logical→column-id map) is resolved
// per event via the injected getConfig() (SecureStorage-backed at runtime).
// Under test: column_values built with the EXACT configured column ids, the
// single group used for every event (no per-app group), inert-when-unconfigured
// (warn once, no API), and fail-soft (any failure → null, never a throw, every
// catch logs). mondayApi/getConfig/logger are injected fakes — zero network.

import { describe, it, expect, vi } from 'vitest';
import { createEventsBoardService } from '../src/services/events-board.js';

const BOARD_ID = '9988776655';
const GROUP_ID = 'group_events_1';

// Logical key → monday column id, full map (realistic monday-style ids).
const COLUMNS = {
  event_time: 'date_evt1',
  category: 'color_cat1',
  event_type: 'text_type1',
  app: 'text_app1',
  feature: 'text_feat1',
  account_id: 'text_acct1',
  user_id: 'text_user1',
  details: 'long_text_det1',
  event_id: 'text_eid1',
};

const CONFIG = { boardId: BOARD_ID, groupId: GROUP_ID, columns: COLUMNS };

/** App-logger fake — `(message, tag, context)` shape, all levels spied. */
function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    health: vi.fn(),
    track: vi.fn(),
  };
}

/** mondayApi fake: createItem succeeds (the only method events-board calls now). */
function makeMondayApi(overrides = {}) {
  return {
    createItem: vi.fn(async () => 'item-1'),
    ...overrides,
  };
}

function makeService({ mondayApi = makeMondayApi(), config = CONFIG, logger = makeLogger() } = {}) {
  const getConfig = typeof config === 'function' ? config : vi.fn(async () => config);
  return {
    mondayApi,
    logger,
    getConfig,
    service: createEventsBoardService({ mondayApi, getConfig, logger }),
  };
}

/** Normalized event as lifecycle-service produces it (feature-event shape). */
function sampleEvent(overrides = {}) {
  return {
    category: 'Lifecycle',
    eventType: 'AppFeatureBoardView:delete',
    appSlug: 'axis-tracker',
    feature: 'tracker-board-view',
    accountId: 12345,
    userId: 67890,
    occurredAt: '2026-07-19T15:34:56+03:00', // UTC 12:34:56
    details: { boardId: 111, itemId: 222 },
    eventId: 'evt-abc-1',
    ...overrides,
  };
}

describe('events-board — column mapping (from config)', () => {
  it('builds column_values keyed by the EXACT configured column ids, with typed cell values', async () => {
    const { service, mondayApi } = makeService();

    const itemId = await service.recordEvent(sampleEvent());

    expect(itemId).toBe('item-1');
    expect(mondayApi.createItem).toHaveBeenCalledTimes(1);
    const call = mondayApi.createItem.mock.calls[0][0];
    expect(call.boardId).toBe(BOARD_ID);
    expect(call.groupId).toBe(GROUP_ID);
    expect(call.itemName).toBe('AppFeatureBoardView:delete · axis-tracker');
    expect(call.columnValues).toEqual({
      date_evt1: { date: '2026-07-19', time: '12:34:56' }, // UTC, not the +03:00 wall clock
      color_cat1: { label: 'Lifecycle' },
      text_type1: 'AppFeatureBoardView:delete',
      text_app1: 'axis-tracker',
      text_feat1: 'tracker-board-view',
      text_acct1: '12345', // numbers stringified for text columns
      text_user1: '67890',
      long_text_det1: { text: JSON.stringify({ boardId: 111, itemId: 222 }) },
      text_eid1: 'evt-abc-1',
    });
  });

  it('uses the category as the status label verbatim (Install / Subscription events)', async () => {
    const { service, mondayApi } = makeService();

    await service.recordEvent(sampleEvent({ category: 'Install', eventType: 'install' }));
    await service.recordEvent(
      sampleEvent({ category: 'Subscription', eventType: 'app_subscription_created' })
    );

    const labels = mondayApi.createItem.mock.calls.map((c) => c[0].columnValues.color_cat1);
    expect(labels).toEqual([{ label: 'Install' }, { label: 'Subscription' }]);
  });

  it('omits every column whose id is missing from the map — no undefined keys leak through', async () => {
    const partial = { ...COLUMNS };
    delete partial.feature;
    delete partial.account_id;
    delete partial.event_id;
    const { service, mondayApi } = makeService({
      config: { boardId: BOARD_ID, groupId: GROUP_ID, columns: partial },
    });

    await service.recordEvent(sampleEvent());

    const { columnValues } = mondayApi.createItem.mock.calls[0][0];
    expect(columnValues).toEqual({
      date_evt1: { date: '2026-07-19', time: '12:34:56' },
      color_cat1: { label: 'Lifecycle' },
      text_type1: 'AppFeatureBoardView:delete',
      text_app1: 'axis-tracker',
      text_user1: '67890',
      long_text_det1: { text: JSON.stringify({ boardId: 111, itemId: 222 }) },
    });
    expect(Object.keys(columnValues)).not.toContain('undefined');
  });

  it('still creates the item (with empty column_values) when the column map is empty', async () => {
    const { service, mondayApi } = makeService({
      config: { boardId: BOARD_ID, groupId: GROUP_ID, columns: {} },
    });

    const itemId = await service.recordEvent(sampleEvent());

    expect(itemId).toBe('item-1');
    expect(mondayApi.createItem.mock.calls[0][0].columnValues).toEqual({});
  });

  it('caps the details long_text at 2000 chars', async () => {
    const { service, mondayApi } = makeService();

    await service.recordEvent(sampleEvent({ details: { blob: 'x'.repeat(5000) } }));

    const { text } = mondayApi.createItem.mock.calls[0][0].columnValues.long_text_det1;
    expect(text).toHaveLength(2000);
    expect(text.startsWith('{"blob":"xxx')).toBe(true);
  });

  it('passes groupId null through when the config group is null (board default group)', async () => {
    const { service, mondayApi } = makeService({
      config: { boardId: BOARD_ID, groupId: null, columns: COLUMNS },
    });

    await service.recordEvent(sampleEvent());

    expect(mondayApi.createItem.mock.calls[0][0].groupId).toBeNull();
  });

  it('resolves config PER EVENT (no boot-time snapshot) — a second event re-reads getConfig', async () => {
    const { service, getConfig } = makeService();

    await service.recordEvent(sampleEvent());
    await service.recordEvent(sampleEvent({ eventId: 'evt-abc-2' }));

    expect(getConfig).toHaveBeenCalledTimes(2);
  });
});

describe('events-board — inert when unconfigured', () => {
  it('returns null and does NOT call the API when getConfig yields null; warns exactly once across events', async () => {
    const { service, mondayApi, logger } = makeService({ config: null });

    await expect(service.recordEvent(sampleEvent())).resolves.toBeNull();
    await expect(service.recordEvent(sampleEvent({ eventId: 'e2' }))).resolves.toBeNull();

    expect(mondayApi.createItem).not.toHaveBeenCalled();
    const notConfigured = logger.warn.mock.calls.filter((c) => c[0] === 'lifecycle_not_configured');
    expect(notConfigured).toHaveLength(1); // throttled to once
  });

  it('treats a config object with no boardId as unconfigured (null return, no API)', async () => {
    const { service, mondayApi } = makeService({ config: { groupId: GROUP_ID, columns: COLUMNS } });

    await expect(service.recordEvent(sampleEvent())).resolves.toBeNull();
    expect(mondayApi.createItem).not.toHaveBeenCalled();
  });

  it('a getConfig rejection fails soft: null return, logged, no API call', async () => {
    const getConfig = vi.fn(async () => {
      throw new Error('storage backend down');
    });
    const { service, mondayApi, logger } = makeService({ config: getConfig });

    await expect(service.recordEvent(sampleEvent())).resolves.toBeNull();

    expect(mondayApi.createItem).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'board_config_resolve_failed',
      'events_board',
      expect.objectContaining({ error: expect.stringContaining('storage backend down') })
    );
  });
});

describe('events-board — fail-soft (failure → null, never a throw, every catch logs)', () => {
  it('returns null (no throw) when createItem rejects, and logs the failure with ids only', async () => {
    const mondayApi = makeMondayApi({
      createItem: vi.fn(async () => {
        throw new Error('monday API HTTP 500');
      }),
    });
    const { service, logger } = makeService({ mondayApi });
    const evt = sampleEvent({ details: { boardId: 111, secretMarker: 'PRIVATE-BOARD-ONLY' } });

    await expect(service.recordEvent(evt)).resolves.toBeNull();

    expect(logger.error).toHaveBeenCalledWith('record_event_failed', 'events_board', expect.any(Object));
    // Privacy: the log carries ids/enums + error.message — never the details payload.
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain('PRIVATE-BOARD-ONLY');
    expect(logged).toContain('axis-tracker');
  });

  it('returns null and skips the API entirely for a non-object event', async () => {
    const { service, mondayApi, logger } = makeService();

    await expect(service.recordEvent(null)).resolves.toBeNull();

    expect(mondayApi.createItem).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('record_event_invalid', 'events_board', {});
  });
});
