// v4 digest — getBoardItems funnel contract: items_page → next_items_page
// cursor pagination + normalization to { text, statusLabelId, date,
// personIds }. Response SHAPES follow the monday-api skill docs (items_page
// cursor pagination, typed value fragments); flagged for sandbox probe
// verification before release — see tests/fixtures/README.md.

import { describe, it, expect, vi } from 'vitest';
import { createMondayApi, MondayApiError } from '../src/services/monday-api.js';
import settingsFixture from './fixtures/board-columns-settings.probe.json';

function gqlResponse(data) {
  return { ok: true, status: 200, json: () => Promise.resolve({ data }) };
}

function itemsPageData({ viaNext = false, cursor = null, items = [], columns } = {}) {
  const page = { cursor, items };
  return viaNext
    ? { next_items_page: page }
    : { boards: [{ ...(columns !== undefined ? { columns } : {}), items_page: page }] };
}

const RAW_ITEM = {
  id: '9001',
  name: 'גיבוש תכנית עבודה',
  column_values: [
    { id: 'people_t', text: 'דנה כהן', persons_and_teams: [{ id: '501', kind: 'person' }, { id: '77', kind: 'team' }] },
    { id: 'status_a', text: 'בעבודה', index: 0 },
    { id: 'date_start', text: '2026-07-10', date: '2026-07-10' },
  ],
};

const RAW_EMPTY_ITEM = {
  id: '9002',
  name: 'ריקה',
  column_values: [
    { id: 'people_t', text: '', persons_and_teams: [] },
    { id: 'status_a', text: '', index: null },
    { id: 'date_start', text: '', date: '' },
  ],
};

describe('getBoardItems', () => {
  it('single page: normalizes columns (label id 0 kept, ""→null date, person-kind ids only), truncated=false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      gqlResponse(itemsPageData({ cursor: null, items: [RAW_ITEM, RAW_EMPTY_ITEM] }))
    );
    const api = createMondayApi({ fetchImpl });
    const res = await api.getBoardItems({
      token: 't',
      boardId: '111',
      columnIds: ['people_t', 'status_a', 'date_start'],
    });

    expect(res.truncated).toBe(false);
    expect(res.items).toEqual([
      {
        id: '9001',
        name: 'גיבוש תכנית עבודה',
        columns: {
          people_t: { text: 'דנה כהן', statusLabelId: null, date: null, personIds: ['501'] },
          status_a: { text: 'בעבודה', statusLabelId: 0, date: null, personIds: [] },
          date_start: { text: '2026-07-10', statusLabelId: null, date: '2026-07-10', personIds: [] },
        },
      },
      {
        id: '9002',
        name: 'ריקה',
        columns: {
          people_t: { text: '', statusLabelId: null, date: null, personIds: [] },
          status_a: { text: '', statusLabelId: null, date: null, personIds: [] },
          date_start: { text: '', statusLabelId: null, date: null, personIds: [] },
        },
      },
    ]);
  });

  it('paginates: second request goes through next_items_page with the returned cursor; items concatenated', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(gqlResponse(itemsPageData({ cursor: 'CUR1', items: [RAW_ITEM] })))
      .mockResolvedValueOnce(
        gqlResponse(itemsPageData({ viaNext: true, cursor: null, items: [RAW_EMPTY_ITEM] }))
      );
    const api = createMondayApi({ fetchImpl });
    const res = await api.getBoardItems({ token: 't', boardId: '111', columnIds: ['people_t'] });

    expect(res.items.map((i) => i.id)).toEqual(['9001', '9002']);
    expect(res.truncated).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(secondBody.query).toContain('next_items_page');
    expect(secondBody.variables.cursor).toBe('CUR1');
  });

  it('honors the page cap: cursor still present after maxPages → truncated=true (no silent cap)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(gqlResponse(itemsPageData({ cursor: 'MORE', items: [RAW_ITEM] })));
    const api = createMondayApi({ fetchImpl });
    const res = await api.getBoardItems({
      token: 't',
      boardId: '111',
      columnIds: ['people_t'],
      maxPages: 1,
    });
    expect(res.truncated).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // Real status label colors (owner decision 2026-08-04): the boards query also
  // reads columns { id type settings } — ONE extra field on the first page, not
  // per item. Shape from tests/fixtures/board-columns-settings.probe.json:
  // settings.labels[] with { id, hex } on status-type columns.
  describe('statusColumnColors (probe: board-columns-settings.probe.json)', () => {
    const fixtureColumns = settingsFixture.data.boards[0].columns;

    it('fetches columns settings with the first page and maps status columns to { labelId → hex }', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        gqlResponse(itemsPageData({ cursor: null, items: [RAW_ITEM], columns: fixtureColumns }))
      );
      const api = createMondayApi({ fetchImpl });
      const res = await api.getBoardItems({ token: 't', boardId: '111', columnIds: ['people_t'] });

      const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
      expect(firstBody.query).toMatch(/columns\s*\{[^}]*settings[^}]*\}/);
      // people/date columns (settings without labels) contribute nothing.
      expect(res.statusColumnColors).toEqual({
        color_mm58mbec: { 0: '#fdab3d', 1: '#00c875' },
      });
      // Additive: the existing shape is untouched.
      expect(res.items.map((i) => i.id)).toEqual(['9001']);
      expect(res.truncated).toBe(false);
    });

    it('answers {} when the response carries no columns (older double / defensive)', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        gqlResponse(itemsPageData({ cursor: null, items: [RAW_ITEM] }))
      );
      const api = createMondayApi({ fetchImpl });
      const res = await api.getBoardItems({ token: 't', boardId: '111', columnIds: ['people_t'] });
      expect(res.statusColumnColors).toEqual({});
    });

    it('skips malformed labels (no hex / no id) without dropping the healthy ones', async () => {
      const columns = [
        {
          id: 'color_mm58mbec',
          type: 'status',
          settings: {
            labels: [
              { id: 0, hex: '#fdab3d' },
              { id: 1 }, // hex missing
              { hex: '#00c875' }, // id missing
              null,
            ],
          },
        },
        { id: 'status_no_settings', type: 'status', settings: null },
      ];
      const fetchImpl = vi.fn().mockResolvedValue(
        gqlResponse(itemsPageData({ cursor: null, items: [], columns }))
      );
      const api = createMondayApi({ fetchImpl });
      const res = await api.getBoardItems({ token: 't', boardId: '111', columnIds: ['people_t'] });
      expect(res.statusColumnColors).toEqual({ color_mm58mbec: { 0: '#fdab3d' } });
    });
  });

  it('GraphQL soft errors inside a 200 body are thrown as MondayApiError (funnel rule)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ errors: [{ message: 'boom' }] }),
    });
    const api = createMondayApi({ fetchImpl });
    await expect(
      api.getBoardItems({ token: 't', boardId: '111', columnIds: ['people_t'] })
    ).rejects.toBeInstanceOf(MondayApiError);
  });
});
