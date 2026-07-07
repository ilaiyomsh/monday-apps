import { describe, it, expect, vi } from 'vitest';

// monday-client is imported transitively (peopleColumns → api); stub it so the
// module loads without a live SDK. This test exercises the REAL board-config
// store, which is the point — it guards the getColumns import that shipped
// missing and crashed the header (ReferenceError: getColumns is not defined).
vi.mock('../monday-client.js', () => ({ api: vi.fn(async () => ({})) }));

import { setActiveConfig } from '../board-config-store.js';
import { getColumnTitle } from '../peopleColumns.js';

describe('peopleColumns.getColumnTitle', () => {
  it('returns null (does NOT throw) when the alias is unmapped', () => {
    setActiveConfig({ boards: {}, columns: { discussions: {} } });
    expect(() => getColumnTitle('discussions', 'discussionLeadID')).not.toThrow();
    expect(getColumnTitle('discussions', 'discussionLeadID')).toBeNull();
  });

  it('reads the mapped column id from the store without throwing', () => {
    setActiveConfig({
      boards: {},
      columns: { discussions: { discussionLeadID: { id: 'people_x' } } },
    });
    // No live columns cached yet → null (callers fall back to the schema title).
    // The assertion that matters is that getColumns() resolves at all.
    expect(getColumnTitle('discussions', 'discussionLeadID')).toBeNull();
  });
});
