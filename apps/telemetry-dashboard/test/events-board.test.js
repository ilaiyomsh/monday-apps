// Contract tests for src/services/events-board.js (lifecycle spec — Tests
// bullet 3): column_values built with the EXACT configured column ids,
// missing column id → key omitted, per-slug group cache (second call → no
// extra getBoardGroups; createGroup only when the title is absent), and
// fail-soft: any mondayApi failure → null return, never a throw, every
// catch logs. mondayApi/logger are injected fakes — zero network, zero env.

import { describe, it, expect, vi } from 'vitest';
import { createEventsBoardService } from '../src/services/events-board.js';

const BOARD_ID = '9988776655';

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

/** mondayApi fake: group 'axis-tracker' already exists, createItem succeeds. */
function makeMondayApi(overrides = {}) {
  return {
    createItem: vi.fn(async () => 'item-1'),
    getBoardGroups: vi.fn(async () => [{ id: 'grp-tracker', title: 'axis-tracker' }]),
    createGroup: vi.fn(async () => 'grp-created'),
    ...overrides,
  };
}

function makeService({ mondayApi = makeMondayApi(), columns = COLUMNS, logger = makeLogger() } = {}) {
  return {
    mondayApi,
    logger,
    service: createEventsBoardService({ mondayApi, boardId: BOARD_ID, columns, logger }),
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

describe('events-board — column mapping', () => {
  it('builds column_values keyed by the EXACT configured column ids, with typed cell values', async () => {
    const { service, mondayApi } = makeService();

    const itemId = await service.recordEvent(sampleEvent());

    expect(itemId).toBe('item-1');
    expect(mondayApi.createItem).toHaveBeenCalledTimes(1);
    const call = mondayApi.createItem.mock.calls[0][0];
    expect(call.boardId).toBe(BOARD_ID);
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
    const { service, mondayApi } = makeService({ columns: partial });

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
    const { service, mondayApi } = makeService({ columns: {} });

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
});

describe('events-board — group cache', () => {
  it('resolves an existing group by title and caches it: second event, same app → no extra getBoardGroups', async () => {
    const { service, mondayApi } = makeService();

    await service.recordEvent(sampleEvent());
    await service.recordEvent(sampleEvent({ eventId: 'evt-abc-2' }));

    expect(mondayApi.getBoardGroups).toHaveBeenCalledTimes(1);
    expect(mondayApi.getBoardGroups).toHaveBeenCalledWith(BOARD_ID);
    expect(mondayApi.createGroup).not.toHaveBeenCalled();
    const groupIds = mondayApi.createItem.mock.calls.map((c) => c[0].groupId);
    expect(groupIds).toEqual(['grp-tracker', 'grp-tracker']);
  });

  it('caches per app slug — a different app triggers its own group lookup', async () => {
    const mondayApi = makeMondayApi({
      getBoardGroups: vi.fn(async () => [
        { id: 'grp-tracker', title: 'axis-tracker' },
        { id: 'grp-disc', title: 'discussions' },
      ]),
    });
    const { service } = makeService({ mondayApi });

    await service.recordEvent(sampleEvent());
    await service.recordEvent(sampleEvent({ appSlug: 'discussions' }));

    expect(mondayApi.getBoardGroups).toHaveBeenCalledTimes(2);
    const groupIds = mondayApi.createItem.mock.calls.map((c) => c[0].groupId);
    expect(groupIds).toEqual(['grp-tracker', 'grp-disc']);
  });

  it('creates the group when no group with the slug title exists, then reuses the created id from cache', async () => {
    const mondayApi = makeMondayApi({
      getBoardGroups: vi.fn(async () => [{ id: 'grp-other', title: 'discussions' }]),
    });
    const { service } = makeService({ mondayApi });

    await service.recordEvent(sampleEvent());
    await service.recordEvent(sampleEvent({ eventId: 'evt-abc-2' }));

    expect(mondayApi.createGroup).toHaveBeenCalledTimes(1);
    expect(mondayApi.createGroup).toHaveBeenCalledWith({
      boardId: BOARD_ID,
      groupName: 'axis-tracker',
    });
    expect(mondayApi.getBoardGroups).toHaveBeenCalledTimes(1); // created id is cached too
    const groupIds = mondayApi.createItem.mock.calls.map((c) => c[0].groupId);
    expect(groupIds).toEqual(['grp-created', 'grp-created']);
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

    expect(logger.error).toHaveBeenCalledTimes(1);
    // Privacy: the log carries ids/enums + error.message — never the details payload.
    const logged = JSON.stringify(logger.error.mock.calls[0]);
    expect(logged).not.toContain('PRIVATE-BOARD-ONLY');
    expect(logged).toContain('axis-tracker');
  });

  it('group resolution failure is cosmetic: the item is still created UNGROUPED and its id returned', async () => {
    const mondayApi = makeMondayApi({
      getBoardGroups: vi.fn(async () => {
        throw new Error('monday API HTTP 429');
      }),
    });
    const { service, logger } = makeService({ mondayApi });

    const itemId = await service.recordEvent(sampleEvent());

    expect(itemId).toBe('item-1');
    expect(mondayApi.createItem).toHaveBeenCalledTimes(1);
    expect(mondayApi.createItem.mock.calls[0][0].groupId).toBeNull();
    expect(logger.warn).toHaveBeenCalled(); // the catch logs
  });

  it('ensureGroupForApp returns null (no throw) when both lookup and create fail', async () => {
    const mondayApi = makeMondayApi({
      getBoardGroups: vi.fn(async () => []),
      createGroup: vi.fn(async () => {
        throw new Error('monday API error: budget exhausted');
      }),
    });
    const { service, logger } = makeService({ mondayApi });

    await expect(service.ensureGroupForApp('axis-tracker')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns null and skips the API entirely for a non-object event', async () => {
    const { service, mondayApi, logger } = makeService();

    await expect(service.recordEvent(null)).resolves.toBeNull();

    expect(mondayApi.createItem).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
