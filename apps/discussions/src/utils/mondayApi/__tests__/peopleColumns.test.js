import { describe, it, expect, vi } from 'vitest';

// monday-client is imported transitively (peopleColumns → api); stub it so the
// module loads without a live SDK. This test exercises the REAL board-config
// store, which is the point — it guards the getColumns import that shipped
// missing and crashed the header (ReferenceError: getColumns is not defined).
vi.mock('../monday-client.js', () => ({ api: vi.fn(async () => ({})) }));

import { setActiveConfig } from '../board-config-store.js';
import { getColumnTitle, isColumnMapped } from '../peopleColumns.js';

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

describe('peopleColumns.isColumnMapped (round219)', () => {
  it('is TRUE only when the alias carries a mapped id in the active config', () => {
    setActiveConfig({
      boards: {},
      columns: { discussions: { discussionCoordinatorID: { id: 'people_c' } } },
    });
    expect(isColumnMapped('discussions', 'discussionCoordinatorID')).toBe(true);
  });

  it('is FALSE for an unmapped alias (no entry) and for an entry without an id', () => {
    setActiveConfig({
      boards: {},
      columns: { discussions: { discussionCoordinatorID: { title: 'מרכז דיון' } } },
    });
    // Entry exists but has no `id` → not mapped.
    expect(isColumnMapped('discussions', 'discussionCoordinatorID')).toBe(false);
    // Wholly absent alias → not mapped.
    expect(isColumnMapped('discussions', 'discussionLeadID')).toBe(false);
    // Unknown board → not mapped (does not throw).
    expect(isColumnMapped('nope', 'whatever')).toBe(false);
  });
});
