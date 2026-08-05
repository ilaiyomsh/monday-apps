/**
 * vacationService at scale — the read path that every view depends on.
 *
 * High-scale round (30+ users / year of requests): listEntries must (a) drain
 * the items_page cursor COMPLETELY — a year window at 30 users is several
 * hundred items, i.e. multiple 100-item pages; (b) push the [from,to] window
 * filter to the SERVER via query_params (contract §4.5 overlap form), so the
 * client never downloads the whole board; (c) back-stop with a client-side
 * overlap filter so server over-fetches never leak out of the window.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listEntries, type VacationCtx } from '../services/vacationService';
import { mondayApi } from '../services/mondayApi';
import type { KindValueMap, StatusValueMap } from '../types';

vi.mock('../services/mondayApi', () => ({
  mondayApi: { query: vi.fn() },
}));

vi.mock('../core', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const queryMock = vi.mocked(mondayApi.query);

interface RawColumnValue {
  id: string;
  type?: string;
  text?: string | null;
  value?: string | null;
}

interface RawItem {
  id: string | number;
  name?: string | null;
  created_at?: string | null;
  column_values?: RawColumnValue[] | null;
}

// Same board wiring as vacationService.test.ts: kind general id=0 / personal
// id=1; approval pending id=10 / approved id=11 / rejected id=12.
const COLS = {
  kindColumnId: 'kind',
  personColumnId: 'person',
  startDateColumnId: 'start',
  endDateColumnId: 'end',
  personalTypeColumnId: 'ptype',
  approvalStatusColumnId: 'approval',
  mandatoryColumnId: 'mand',
} as const;

const KIND_VALUES: KindValueMap = {
  general: 'Company',
  personal: 'Personal',
  generalLabelId: '0',
  personalLabelId: '1',
};

const STATUS_VALUES: StatusValueMap = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
  labelIds: { pending: '10', approved: '11', rejected: '12' },
};

function makeCtx(): VacationCtx {
  return {
    boardId: '777',
    cols: { ...COLS },
    kindValues: KIND_VALUES,
    personalTypes: [{ id: '5', title: 'Vacation', color: '#00c875', index: 0 }],
    statusValues: STATUS_VALUES,
  };
}

function statusCv(id: string, labelId: number, text: string): RawColumnValue {
  return { id, type: 'status', text, value: JSON.stringify({ index: labelId }) };
}

function personCv(userId: string): RawColumnValue {
  return {
    id: COLS.personColumnId,
    type: 'people',
    value: JSON.stringify({ personsAndTeams: [{ id: Number(userId), kind: 'person' }] }),
  };
}

function dateCv(id: string, day: string): RawColumnValue {
  return { id, type: 'date', text: day };
}

function personalItem(id: string, start: string, end: string, userId: string): RawItem {
  return {
    id,
    name: `Request ${id}`,
    created_at: '2026-01-01T08:00:00Z',
    column_values: [
      statusCv(COLS.kindColumnId, 1, 'Personal'),
      personCv(userId),
      dateCv(COLS.startDateColumnId, start),
      dateCv(COLS.endDateColumnId, end),
      statusCv(COLS.personalTypeColumnId, 5, 'Vacation'),
      statusCv(COLS.approvalStatusColumnId, 11, 'Approved'),
    ],
  };
}

function generalItem(id: string, day: string): RawItem {
  return {
    id,
    name: `Company day ${id}`,
    column_values: [
      statusCv(COLS.kindColumnId, 0, 'Company'),
      { id: COLS.personColumnId, type: 'people', value: null },
      dateCv(COLS.startDateColumnId, day),
      dateCv(COLS.endDateColumnId, day),
      { id: COLS.mandatoryColumnId, type: 'checkbox', value: JSON.stringify({ checked: 'true' }) },
    ],
  };
}

/** 30 employees × a year of requests → 348 personal in-window items. */
function buildYearItems(): { inWindow: RawItem[]; general: RawItem; outOfWindow: RawItem } {
  const inWindow: RawItem[] = [];
  for (let i = 0; i < 348; i++) {
    const userId = String(100 + (i % 30));
    const month = String(1 + (i % 12)).padStart(2, '0');
    const day = String(1 + (i % 27)).padStart(2, '0');
    inWindow.push(personalItem(`p${i}`, `2026-${month}-${day}`, `2026-${month}-${day}`, userId));
  }
  return {
    inWindow,
    general: generalItem('g1', '2026-05-01'),
    // The server should have filtered this; the client backstop must drop it.
    outOfWindow: personalItem('leak1', '2027-05-01', '2027-05-03', '130'),
  };
}

type Page = { cursor: string | null; items: RawItem[] };

function pageResponse(page: Page) {
  return { boards: [{ items_page: page }] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listEntries at year scale (multi-page board)', () => {
  it('drains every items_page cursor and returns all 348 requests across 3 pages', async () => {
    const { inWindow, general, outOfWindow } = buildYearItems();
    const pages: Page[] = [
      { cursor: 'c1', items: inWindow.slice(0, 150) },
      { cursor: 'c2', items: inWindow.slice(150, 300) },
      { cursor: null, items: [...inWindow.slice(300), general, outOfWindow] },
    ];
    queryMock.mockImplementation(async (_query: string, vars?: Record<string, unknown>) => {
      const cursor = (vars as { cursor: string | null }).cursor;
      if (cursor === null) return pageResponse(pages[0]);
      if (cursor === 'c1') return pageResponse(pages[1]);
      if (cursor === 'c2') return pageResponse(pages[2]);
      throw new Error(`unexpected cursor: ${String(cursor)}`);
    });

    const { requests, companyDays } = await listEntries(makeCtx(), 2026);

    expect(queryMock).toHaveBeenCalledTimes(3);
    // Cursor threading: null → c1 → c2, same board id on every page.
    const cursorsSent = queryMock.mock.calls.map((c) => (c[1] as { cursor: string | null }).cursor);
    expect(cursorsSent).toEqual([null, 'c1', 'c2']);
    for (const call of queryMock.mock.calls) {
      expect((call[1] as { id: string[] }).id).toEqual(['777']);
    }

    expect(requests).toHaveLength(348);
    expect(companyDays).toHaveLength(1);
    // No item lost or duplicated by the pagination loop.
    const ids = new Set(requests.map((r) => r.id));
    expect(ids.size).toBe(348);
    expect(ids.has('p0')).toBe(true);
    expect(ids.has('p149')).toBe(true); // last of page 1
    expect(ids.has('p150')).toBe(true); // first of page 2
    expect(ids.has('p347')).toBe(true); // last in-window of page 3
  });

  it('pushes the year window to the server as an end>=from AND start<=to rule pair', async () => {
    queryMock.mockResolvedValue(pageResponse({ cursor: null, items: [] }));

    await listEntries(makeCtx(), 2026);

    const query = queryMock.mock.calls[0][0] as string;
    expect(query).toContain('items_page(limit: 100, cursor: $cursor');
    expect(query).toContain(`column_id: "${COLS.endDateColumnId}", compare_value: ["2026-01-01"], operator: greater_than_or_equals`);
    expect(query).toContain(`column_id: "${COLS.startDateColumnId}", compare_value: ["2026-12-31"], operator: lower_than_or_equal`);
    expect(query).toContain('operator: and');
  });

  it('drops a server over-fetch (2027 item in a 2026 window) via the client-side overlap backstop', async () => {
    const { general, outOfWindow } = buildYearItems();
    queryMock.mockResolvedValue(
      pageResponse({ cursor: null, items: [personalItem('p1', '2026-06-01', '2026-06-02', '101'), general, outOfWindow] })
    );

    const { requests, companyDays } = await listEntries(makeCtx(), 2026);

    expect(requests.map((r) => r.id)).toEqual(['p1']);
    expect(companyDays).toHaveLength(1);
  });
});
