/**
 * vacationService read-path tests.
 *
 * W1.2 (DAY-OFF-INTEGRATION, decision D8): kind/approvalStatus matching is
 * label-ID-first (org standard), with a case-insensitive text fallback for
 * legacy settings saved before label IDs were stored, and a LOUD error (never
 * a silent `pending` default) when an approval label matches nothing configured.
 *
 * W1.1 (DAY-OFF-INTEGRATION): listEntries reads arbitrary inclusive [from,to]
 * windows (cross-year capable, contract §4.5); the calendar-year number form
 * stays as a back-compatible legacy scope.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listEntries, getRequestById, ApprovalStatusMismatchError, type VacationCtx } from '../services/vacationService';
import { mondayApi } from '../services/mondayApi';
import { logger } from '../core';
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

function mockBoardItems(items: RawItem[]): void {
  queryMock.mockResolvedValue({ boards: [{ items_page: { cursor: null, items } }] });
}

// ---------------------------------------------------------------------------
// Fixtures. Board labels: kind general id=0 "Company", personal id=1 "Personal";
// approval pending id=10 "Waiting", approved id=11 "Approved", rejected id=12 "Rejected".
// ---------------------------------------------------------------------------

const COLS = {
  kindColumnId: 'kind',
  personColumnId: 'person',
  startDateColumnId: 'start',
  endDateColumnId: 'end',
  personalTypeColumnId: 'ptype',
  approvalStatusColumnId: 'approval',
  mandatoryColumnId: 'mand',
} as const;

const ID_KIND_VALUES: KindValueMap = {
  general: 'Company',
  personal: 'Personal',
  generalLabelId: '0',
  personalLabelId: '1',
};

const ID_STATUS_VALUES: StatusValueMap = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
  labelIds: { pending: '10', approved: '11', rejected: '12' },
};

/** Legacy settings blob — text only, no label ids (pre-W1.2 shape). */
const TEXT_KIND_VALUES: KindValueMap = { general: 'Company', personal: 'Personal' };
const TEXT_STATUS_VALUES: StatusValueMap = { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected' };

function makeCtx(overrides: Partial<VacationCtx> = {}): VacationCtx {
  return {
    boardId: '777',
    cols: { ...COLS },
    kindValues: ID_KIND_VALUES,
    personalTypes: [{ id: '5', title: 'Vacation', color: '#00c875', index: 0 }],
    statusValues: ID_STATUS_VALUES,
    ...overrides,
  };
}

function statusCv(id: string, labelId: number | null, text: string): RawColumnValue {
  return { id, type: 'status', text, value: labelId == null ? null : JSON.stringify({ index: labelId }) };
}

function personCv(userId?: string): RawColumnValue {
  return {
    id: COLS.personColumnId,
    type: 'people',
    value: userId ? JSON.stringify({ personsAndTeams: [{ id: Number(userId), kind: 'person' }] }) : null,
  };
}

function dateCv(id: string, day: string): RawColumnValue {
  return { id, type: 'date', text: day };
}

function personalItem(opts: {
  id?: string;
  kind?: RawColumnValue;
  approval?: RawColumnValue;
  person?: RawColumnValue;
}): RawItem {
  return {
    id: opts.id ?? '1',
    name: 'Someone - Vacation',
    created_at: '2026-03-01T08:00:00Z',
    column_values: [
      opts.kind ?? statusCv(COLS.kindColumnId, 1, 'Personal'),
      opts.person ?? personCv('42'),
      dateCv(COLS.startDateColumnId, '2026-03-10'),
      dateCv(COLS.endDateColumnId, '2026-03-12'),
      statusCv(COLS.personalTypeColumnId, 5, 'Vacation'),
      opts.approval ?? statusCv(COLS.approvalStatusColumnId, 11, 'Approved'),
    ],
  };
}

function generalItem(opts: { id?: string; kind?: RawColumnValue } = {}): RawItem {
  return {
    id: opts.id ?? '2',
    name: 'Independence Day',
    column_values: [
      opts.kind ?? statusCv(COLS.kindColumnId, 0, 'Company'),
      personCv(undefined),
      dateCv(COLS.startDateColumnId, '2026-05-01'),
      dateCv(COLS.endDateColumnId, '2026-05-01'),
      { id: COLS.mandatoryColumnId, type: 'checkbox', value: JSON.stringify({ checked: 'true' }) },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('vacationService kind matching (W1.2)', () => {
  it('matches kind by label ID', async () => {
    mockBoardItems([personalItem({}), generalItem()]);
    const { requests, companyDays } = await listEntries(makeCtx(), 2026);
    expect(requests).toHaveLength(1);
    expect(companyDays).toHaveLength(1);
    expect(requests[0].employeeId).toBe('42');
    expect(companyDays[0].name).toBe('Independence Day');
  });

  it('label ID wins over a renamed label text (ID-first)', async () => {
    // Board label 0 (general) was renamed — its text no longer matches any
    // configured text; the stored id still resolves it as a general day.
    mockBoardItems([generalItem({ kind: statusCv(COLS.kindColumnId, 0, 'Office Closed') })]);
    const { requests, companyDays } = await listEntries(makeCtx(), 2026);
    expect(companyDays).toHaveLength(1);
    expect(requests).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('ID match beats a contradicting text match', async () => {
    // value id says GENERAL while the text coincidentally equals the personal
    // label text — the stable id must win.
    mockBoardItems([generalItem({ kind: statusCv(COLS.kindColumnId, 0, 'Personal') })]);
    const { requests, companyDays } = await listEntries(makeCtx(), 2026);
    expect(companyDays).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });

  it('falls back to case-insensitive text for legacy settings without label ids', async () => {
    const ctx = makeCtx({ kindValues: TEXT_KIND_VALUES, statusValues: TEXT_STATUS_VALUES });
    mockBoardItems([
      personalItem({ kind: statusCv(COLS.kindColumnId, 1, 'PERSONAL') }),
      generalItem({ kind: statusCv(COLS.kindColumnId, 0, 'company') }),
    ]);
    const { requests, companyDays } = await listEntries(ctx, 2026);
    expect(requests).toHaveLength(1);
    expect(companyDays).toHaveLength(1);
  });

  it('unknown kind label falls back to person presence (contract §4.1) and warn-logs the drift', async () => {
    mockBoardItems([
      personalItem({ kind: statusCv(COLS.kindColumnId, 7, 'Mystery') }),
      generalItem({ kind: statusCv(COLS.kindColumnId, 8, 'Enigma') }),
    ]);
    const { requests, companyDays } = await listEntries(makeCtx(), 2026);
    expect(requests).toHaveLength(1); // has person → personal
    expect(companyDays).toHaveLength(1); // no person → general
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logger.warn).mock.calls[0][0]).toBe('vacationService');
  });

  it('empty kind resolves by person presence without warning', async () => {
    mockBoardItems([
      personalItem({ kind: statusCv(COLS.kindColumnId, null, '') }),
      generalItem({ kind: statusCv(COLS.kindColumnId, null, '') }),
    ]);
    const { requests, companyDays } = await listEntries(makeCtx(), 2026);
    expect(requests).toHaveLength(1);
    expect(companyDays).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not treat label id 0 as matching an empty configured id', async () => {
    // kindValues with blank ids must not match via Number('') === 0.
    const ctx = makeCtx({
      kindValues: { general: '', personal: '', generalLabelId: '', personalLabelId: '' },
    });
    mockBoardItems([generalItem({ kind: statusCv(COLS.kindColumnId, 0, 'Whatever') })]);
    const { companyDays } = await listEntries(ctx, 2026);
    expect(companyDays).toHaveLength(1); // resolved by (missing) person, not by ''==0
    expect(logger.warn).toHaveBeenCalled(); // drift is logged
  });
});

describe('vacationService approval-status matching (W1.2)', () => {
  it('matches approval status by label ID even when the label text was renamed', async () => {
    mockBoardItems([personalItem({ approval: statusCv(COLS.approvalStatusColumnId, 11, 'Green-lit') })]);
    const { requests } = await listEntries(makeCtx(), 2026);
    expect(requests[0].status).toBe('approved');
  });

  it('resolves all three statuses by ID', async () => {
    mockBoardItems([
      personalItem({ id: 'a', approval: statusCv(COLS.approvalStatusColumnId, 10, 'x') }),
      personalItem({ id: 'b', approval: statusCv(COLS.approvalStatusColumnId, 11, 'y') }),
      personalItem({ id: 'c', approval: statusCv(COLS.approvalStatusColumnId, 12, 'z') }),
    ]);
    const { requests } = await listEntries(makeCtx(), 2026);
    expect(requests.map((r) => [r.id, r.status])).toEqual([
      ['a', 'pending'],
      ['b', 'approved'],
      ['c', 'rejected'],
    ]);
  });

  it('falls back to case-insensitive text for legacy settings without label ids', async () => {
    const ctx = makeCtx({ kindValues: TEXT_KIND_VALUES, statusValues: TEXT_STATUS_VALUES });
    mockBoardItems([personalItem({ approval: statusCv(COLS.approvalStatusColumnId, 12, 'REJECTED') })]);
    const { requests } = await listEntries(ctx, 2026);
    expect(requests[0].status).toBe('rejected');
  });

  it('an item with no approval value at all is pending (semantic default, not a mismatch)', async () => {
    mockBoardItems([personalItem({ approval: statusCv(COLS.approvalStatusColumnId, null, '') })]);
    const { requests } = await listEntries(makeCtx(), 2026);
    expect(requests[0].status).toBe('pending');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a non-empty approval label that matches nothing fails LOUDLY (no silent pending default)', async () => {
    mockBoardItems([personalItem({ id: '99', approval: statusCv(COLS.approvalStatusColumnId, 33, 'Limbo') })]);
    await expect(listEntries(makeCtx(), 2026)).rejects.toThrow(ApprovalStatusMismatchError);
    // logged loudly: once at the mismatch site, once by the listEntries catch.
    expect(logger.error).toHaveBeenCalledWith(
      'vacationService',
      'approval-status label matches no configured status mapping',
      expect.objectContaining({ itemId: '99', labelId: 33, labelText: 'Limbo' }),
    );
    expect(logger.error).toHaveBeenCalledWith('vacationService', 'listEntries failed', expect.anything());
  });

  it('the mismatch error carries the diagnostic details and i18n key', async () => {
    mockBoardItems([personalItem({ id: '7', approval: statusCv(COLS.approvalStatusColumnId, null, 'Ghost') })]);
    const err = await listEntries(makeCtx(), 2026).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApprovalStatusMismatchError);
    const mismatch = err as ApprovalStatusMismatchError;
    expect(mismatch.details).toEqual({ itemId: '7', labelId: null, labelText: 'Ghost' });
    expect(mismatch.i18nKey).toBe('errors.approvalStatusMismatch');
  });

  it('half-configured legacy settings (all-blank texts, no ids) reject instead of reading everything as pending', async () => {
    const ctx = makeCtx({
      kindValues: TEXT_KIND_VALUES,
      statusValues: { pending: '', approved: '', rejected: '' },
    });
    mockBoardItems([personalItem({ approval: statusCv(COLS.approvalStatusColumnId, 11, 'Approved') })]);
    await expect(listEntries(ctx, 2026)).rejects.toThrow(ApprovalStatusMismatchError);
  });
});

// ---------------------------------------------------------------------------
// W1.1 — arbitrary [from,to] read windows (cross-year capable, contract §4.5)
// ---------------------------------------------------------------------------

/** A personal item with explicit start/end day-keys. */
function rangedPersonalItem(id: string, start: string, end: string): RawItem {
  return {
    id,
    name: 'Someone - Vacation',
    created_at: '2025-12-01T08:00:00Z',
    column_values: [
      statusCv(COLS.kindColumnId, 1, 'Personal'),
      personCv('42'),
      dateCv(COLS.startDateColumnId, start),
      dateCv(COLS.endDateColumnId, end),
      statusCv(COLS.personalTypeColumnId, 5, 'Vacation'),
      statusCv(COLS.approvalStatusColumnId, 11, 'Approved'),
    ],
  };
}

/** A general (company-day) item with explicit start/end day-keys. */
function rangedGeneralItem(id: string, name: string, start: string, end: string): RawItem {
  return {
    id,
    name,
    column_values: [
      statusCv(COLS.kindColumnId, 0, 'Company'),
      personCv(undefined),
      dateCv(COLS.startDateColumnId, start),
      dateCv(COLS.endDateColumnId, end),
      { id: COLS.mandatoryColumnId, type: 'checkbox', value: JSON.stringify({ checked: 'true' }) },
    ],
  };
}

describe('vacationService window-scoped reads (W1.1)', () => {
  const DEC_JAN = { from: '2025-12-01', to: '2026-01-31' };

  it('returns a Dec–Jan personal request for a window spanning the year boundary', async () => {
    // The exact case the calendar-year scope missed: an absence crossing Dec 31.
    mockBoardItems([rangedPersonalItem('x1', '2025-12-28', '2026-01-03')]);
    const { requests } = await listEntries(makeCtx(), DEC_JAN);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ id: 'x1', start: '2025-12-28', end: '2026-01-03' });
  });

  it('returns general days from both sides of the year boundary in one window read', async () => {
    mockBoardItems([
      rangedGeneralItem('g1', 'New Year Eve', '2025-12-31', '2025-12-31'),
      rangedGeneralItem('g2', 'Founders Day', '2026-01-15', '2026-01-15'),
    ]);
    const { companyDays } = await listEntries(makeCtx(), DEC_JAN);
    expect(companyDays.map((d) => d.id)).toEqual(['g1', 'g2']);
  });

  it('includes an item spanning the ENTIRE window (start before from, end after to)', async () => {
    mockBoardItems([rangedPersonalItem('span', '2025-11-15', '2026-02-15')]);
    const { requests } = await listEntries(makeCtx(), DEC_JAN);
    expect(requests).toHaveLength(1);
    expect(requests[0].id).toBe('span');
  });

  it('clips server over-fetch: items outside the window are filtered client-side', async () => {
    mockBoardItems([
      rangedPersonalItem('in', '2026-01-10', '2026-01-12'),
      rangedPersonalItem('before', '2025-11-01', '2025-11-30'), // ends the day before `from`
      rangedGeneralItem('after', 'Out of window', '2026-02-01', '2026-02-01'), // starts the day after `to`
    ]);
    const { requests, companyDays } = await listEntries(makeCtx(), DEC_JAN);
    expect(requests.map((r) => r.id)).toEqual(['in']);
    expect(companyDays).toHaveLength(0);
  });

  it('sends the window bounds to monday as the AND-of-two-rules overlap query', async () => {
    mockBoardItems([]);
    await listEntries(makeCtx(), DEC_JAN);
    const query = queryMock.mock.calls[0][0] as string;
    // end >= from
    expect(query).toContain(`column_id: "${COLS.endDateColumnId}", compare_value: ["2025-12-01"], operator: greater_than_or_equals`);
    // start <= to
    expect(query).toContain(`column_id: "${COLS.startDateColumnId}", compare_value: ["2026-01-31"], operator: lower_than_or_equal`);
  });

  it('legacy calendar-year scope still reads as that year window (back-compat)', async () => {
    mockBoardItems([
      rangedPersonalItem('inYear', '2026-03-10', '2026-03-12'),
      rangedPersonalItem('lastYear', '2025-06-01', '2025-06-05'),
    ]);
    const { requests } = await listEntries(makeCtx(), 2026);
    expect(requests.map((r) => r.id)).toEqual(['inYear']);
    const query = queryMock.mock.calls[0][0] as string;
    expect(query).toContain('compare_value: ["2026-01-01"]');
    expect(query).toContain('compare_value: ["2026-12-31"]');
  });

  it('a year-boundary item is visible to BOTH adjacent year scopes (inclusive overlap)', async () => {
    mockBoardItems([rangedPersonalItem('xy', '2025-12-28', '2026-01-03')]);
    const r2025 = await listEntries(makeCtx(), 2025);
    const r2026 = await listEntries(makeCtx(), 2026);
    expect(r2025.requests.map((r) => r.id)).toEqual(['xy']);
    expect(r2026.requests.map((r) => r.id)).toEqual(['xy']);
  });

  it('omits query_params (full-board read) when date columns are unmapped, still window-filters client-side', async () => {
    const ctx = makeCtx({
      cols: { ...COLS, startDateColumnId: undefined, endDateColumnId: undefined },
    });
    mockBoardItems([]);
    await listEntries(ctx, DEC_JAN);
    const query = queryMock.mock.calls[0][0] as string;
    expect(query).not.toContain('query_params');
  });
});

// ---------------------------------------------------------------------------
// getRequestById — the deep-link single-item fetch (item may be outside the
// loaded year window, so it's fetched by id rather than via listEntries).
// ---------------------------------------------------------------------------
describe('getRequestById (deep link)', () => {
  /** getRequestById queries `items(ids:)` → { items: [...] }, not boards. */
  function mockItems(items: RawItem[]): void {
    queryMock.mockResolvedValue({ items });
  }

  it('maps a personal item to a DayOffRequest, ignoring any year window', async () => {
    mockItems([rangedPersonalItem('99', '2024-08-01', '2024-08-05')]);
    const r = await getRequestById(makeCtx(), '99');
    expect(r).not.toBeNull();
    expect(r?.id).toBe('99');
    expect(r?.employeeId).toBe('42');
    expect(r?.start).toBe('2024-08-01');
    expect(r?.end).toBe('2024-08-05');
  });

  it('queries items(ids:) by the requested id (string-coerced)', async () => {
    mockItems([personalItem({ id: '7' })]);
    await getRequestById(makeCtx(), '7');
    const query = queryMock.mock.calls[0][0] as string;
    const vars = queryMock.mock.calls[0][1] as { ids: string[] };
    expect(query).toContain('items(ids: $ids)');
    expect(vars.ids).toEqual(['7']);
  });

  it('returns null when the item does not exist', async () => {
    mockItems([]);
    expect(await getRequestById(makeCtx(), 'missing')).toBeNull();
  });

  it('returns null for a general (company) day — not a personal request', async () => {
    mockItems([generalItem({ id: '2' })]);
    expect(await getRequestById(makeCtx(), '2')).toBeNull();
  });

  it('propagates query errors (surfaced via handleError by the caller)', async () => {
    queryMock.mockRejectedValue(new Error('network'));
    await expect(getRequestById(makeCtx(), '1')).rejects.toThrow('network');
  });
});
