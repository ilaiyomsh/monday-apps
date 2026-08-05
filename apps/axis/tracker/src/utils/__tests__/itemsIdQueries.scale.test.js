/**
 * fetchItemsStatus / fetchItemsLinkedIds under a large id list.
 *
 * CHARACTERIZATION (high-scale round): both helpers interpolate EVERY id into
 * ONE root items(ids:[…]) query — no chunking, no limit: argument. Fine for a
 * calendar window (dozens of ids); a complexity/size risk if a caller ever
 * hands them hundreds. These tests pin the current single-call contract and
 * the full mapping of all ids; if chunking is added later, the call-count
 * assertions below are the ones to update (deliberately).
 *
 * NOTE the root items(ids:) 25-item default page: the planner guards it with
 * an explicit limit:100 (see planner mondayService). These helpers do NOT — a
 * real 800-id response would be truncated by the API. The mocked funnel
 * cannot prove server truncation; what it CAN pin is the query shape that
 * causes it. See FOLLOW-UPS (high-scale round).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../mondayApi/client', async (importOriginal) => ({
  ...(await importOriginal()),
  safeApi: vi.fn(),
}));

import { safeApi } from '../mondayApi/client';
import { fetchItemsStatus, fetchItemsLinkedIds } from '../mondayApi/items';

const monday = {}; // safeApi is mocked; the SDK instance is never touched.
const IDS = Array.from({ length: 800 }, (_, i) => String(5000001 + i));

beforeEach(() => {
  vi.mocked(safeApi).mockReset();
});

describe('fetchItemsStatus with 800 ids', () => {
  it('sends ONE un-chunked items(ids:[…]) query carrying all 800 ids and no limit argument (current contract — update on chunking)', async () => {
    vi.mocked(safeApi).mockResolvedValue({ data: { items: [] } });

    await fetchItemsStatus(monday, IDS, 'status_col');

    expect(safeApi).toHaveBeenCalledTimes(1);
    const query = vi.mocked(safeApi).mock.calls[0][2];
    expect(query).toContain(`items(ids: [${IDS.join(',')}])`);
    expect(query).not.toContain('limit');
    expect((query.match(/\b50\d{5}\b/g) || [])).toHaveLength(800);
  });

  it('maps every returned item to its status text — 800 in, 800 mapped, exact values', async () => {
    vi.mocked(safeApi).mockResolvedValue({
      data: {
        items: IDS.map((id, i) => ({
          id,
          column_values: [{ id: 'status_col', text: `סטטוס ${i % 7}`, index: i % 7 }],
        })),
      },
    });

    const map = await fetchItemsStatus(monday, IDS, 'status_col');

    expect(map.size).toBe(800);
    expect(map.get('5000001')).toBe('סטטוס 0');
    expect(map.get('5000800')).toBe(`סטטוס ${799 % 7}`);
  });

  it('returns status indexes as strings when useIndex is set, across the whole id list', async () => {
    vi.mocked(safeApi).mockResolvedValue({
      data: {
        items: IDS.map((id, i) => ({
          id,
          column_values: [{ id: 'status_col', text: `סטטוס ${i % 7}`, index: i % 7 }],
        })),
      },
    });

    const map = await fetchItemsStatus(monday, IDS, 'status_col', { useIndex: true });

    expect(map.size).toBe(800);
    expect(map.get('5000001')).toBe('0');
    expect(map.get('5000008')).toBe('0');
    expect(map.get('5000002')).toBe('1');
  });

  it('returns an empty map without any API call for an empty id list', async () => {
    const map = await fetchItemsStatus(monday, [], 'status_col');
    expect(map.size).toBe(0);
    expect(safeApi).not.toHaveBeenCalled();
  });
});

describe('fetchItemsLinkedIds with 800 ids', () => {
  it('sends ONE un-chunked items(ids:[…]) query and maps the FIRST linked item per id', async () => {
    vi.mocked(safeApi).mockResolvedValue({
      data: {
        items: IDS.map((id, i) => ({
          id,
          column_values: [
            { linked_items: [{ id: `proj-${i % 40}`, name: `פרויקט ${i % 40}` }, { id: 'proj-ignored', name: 'x' }] },
          ],
        })),
      },
    });

    const map = await fetchItemsLinkedIds(monday, IDS, 'rel_col');

    expect(safeApi).toHaveBeenCalledTimes(1);
    const query = vi.mocked(safeApi).mock.calls[0][2];
    expect(query).toContain(`items(ids: [${IDS.join(',')}])`);
    expect(query).not.toContain('limit');
    expect(map.size).toBe(800);
    expect(map.get('5000001')).toEqual({ id: 'proj-0', name: 'פרויקט 0' });
    expect(map.get('5000041')).toEqual({ id: 'proj-0', name: 'פרויקט 0' });
  });

  it('skips items whose relation column is empty instead of inventing entries', async () => {
    vi.mocked(safeApi).mockResolvedValue({
      data: {
        items: [
          { id: '5000001', column_values: [{ linked_items: [{ id: 'p1', name: 'פ1' }] }] },
          { id: '5000002', column_values: [{ linked_items: [] }] },
          { id: '5000003', column_values: [] },
        ],
      },
    });

    const map = await fetchItemsLinkedIds(monday, ['5000001', '5000002', '5000003'], 'rel_col');

    expect(map.size).toBe(1);
    expect(map.has('5000002')).toBe(false);
    expect(map.has('5000003')).toBe(false);
  });
});
