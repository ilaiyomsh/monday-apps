// TDD — the column picker must offer TEXT columns. The note-column dropdown
// draws from the same fetchBoardColumns result as the date/status pickers, so a
// query that does not ask for `text` renders an empty dropdown and the operator
// cannot map anything — with no error to explain why.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMock = vi.fn();
vi.mock('monday-sdk-js', () => ({
  default: () => ({ api: apiMock, get: vi.fn() }),
}));

const { fetchBoardColumns } = await import('./monday');

beforeEach(() => {
  apiMock.mockReset();
});

describe('fetchBoardColumns', () => {
  it('asks monday for text columns alongside status/people/date/email', async () => {
    apiMock.mockResolvedValue({ data: { boards: [{ columns: [] }] } });
    await fetchBoardColumns('111');

    const query = apiMock.mock.calls[0][0] as string;
    const types = /columns\(types:\s*\[([^\]]+)\]/.exec(query)?.[1] ?? '';
    for (const wanted of ['status', 'people', 'date', 'email', 'text']) {
      expect(types).toContain(wanted);
    }
  });

  it('returns a text column with its type intact and no status labels', async () => {
    apiMock.mockResolvedValue({
      data: {
        boards: [
          {
            columns: [
              { id: 'text_note', title: 'סיכום ביצוע', type: 'text', settings: null },
              { id: 'status_a', title: 'סטטוס', type: 'status', settings: { labels: [] } },
            ],
          },
        ],
      },
    });

    const columns = await fetchBoardColumns('111');
    expect(columns).toContainEqual({ id: 'text_note', title: 'סיכום ביצוע', type: 'text', labels: [] });
  });
});
