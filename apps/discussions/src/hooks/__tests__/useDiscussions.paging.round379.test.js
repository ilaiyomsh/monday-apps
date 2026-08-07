import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasActiveFilters, appendUniqueById } from '../useDiscussions.js';

/*
 * round379 (owner spec) — the side list drops its "current month" default. It now
 * paints the 15 most recent discussions, then keeps loading the rest in the
 * background, so the menu is populated at once AND ends up complete.
 *
 * The two pure pieces the whole round turns on are tested directly; the wiring
 * that cannot be reached without a live BoardSDK is pinned against the source, and
 * each of those assertions names the regression it blocks.
 */

const SRC = readFileSync(join(process.cwd(), 'src/hooks/useDiscussions.js'), 'utf-8');
const LIST = readFileSync(
  join(process.cwd(), 'src/components/DiscussionList/DiscussionList.jsx'),
  'utf-8'
);

describe('hasActiveFilters — one answer, three readers', () => {
  /*
   * Three decisions read this and MUST agree: may the boot prefetch seed this
   * mount, is the first page the small paint-first one, and does the background
   * drain run. A disagreement is what made the boot seed dead before this round.
   */
  it('is false for the DEFAULT list — the one that paints small and drains', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters()).toBe(false);
    expect(hasActiveFilters({ type: [] })).toBe(false); // an empty type list is no filter
  });

  it('is true for every server-side scope the list can be in', () => {
    expect(hasActiveFilters({ search: 'דיון' })).toBe(true);
    expect(hasActiveFilters({ month: '2026-08' })).toBe(true);
    expect(hasActiveFilters({ type: ['3'] })).toBe(true);
    expect(hasActiveFilters({ range: { from: '2026-08-01', to: '2026-08-31' } })).toBe(true);
  });

  it('needs BOTH ends of a calendar range — a half range is not a scope', () => {
    expect(hasActiveFilters({ range: { from: '2026-08-01' } })).toBe(false);
    expect(hasActiveFilters({ range: { to: '2026-08-31' } })).toBe(false);
  });
});

describe('appendUniqueById — the drain appends, it never duplicates', () => {
  it('appends a page in order', () => {
    expect(appendUniqueById([{ id: '1' }], [{ id: '2' }, { id: '3' }]).map((i) => i.id))
      .toEqual(['1', '2', '3']);
  });

  /*
   * A discussion CREATED while the drain walks shifts the paging window, and monday
   * can hand back a row already held. Without the dedup it renders twice and React
   * warns on the duplicate key.
   */
  it('drops ids already held, comparing as strings', () => {
    expect(appendUniqueById([{ id: '1' }, { id: 2 }], [{ id: 1 }, { id: '2' }, { id: '3' }]).map((i) => String(i.id)))
      .toEqual(['1', '2', '3']);
  });

  it('returns the SAME array when a page adds nothing, so React skips the re-render', () => {
    const prev = [{ id: '1' }];
    expect(appendUniqueById(prev, [{ id: '1' }])).toBe(prev);
    expect(appendUniqueById(prev, [])).toBe(prev);
    expect(appendUniqueById(prev, null)).toBe(prev);
  });

  it('survives a junk row instead of crashing the list', () => {
    expect(appendUniqueById([], [null, { id: '1' }]).map((i) => i.id)).toEqual(['1']);
  });
});

describe('the paint-first page and the drain are actually wired', () => {
  it('asks for 15 rows first, and keeps 500 for the background pages', () => {
    expect(SRC).toMatch(/const FIRST_PAGE_SIZE = 15;/);
    expect(SRC).toMatch(/const PAGE_SIZE = 500;/);
    // the small page applies to the DEFAULT list only — a filtered list still
    // takes one full page and offers "טען עוד"
    expect(SRC).toContain('const drains = !hasActiveFilters(filters);');
    expect(SRC).toContain('const limit = drains ? FIRST_PAGE_SIZE : PAGE_SIZE;');
  });

  it('starts the drain WITHOUT awaiting it — otherwise nothing paints first', () => {
    expect(SRC).toMatch(/if \(drains\) drainRemainingPages\(gen\);/);
    expect(SRC).not.toMatch(/await drainRemainingPages/);
  });

  it('drains the BOOT-SEEDED mount too', () => {
    // The seed is only 15 rows now. Skipping the drain here would leave a
    // boot-seeded session showing 15 discussions for the whole session.
    const seeded = SRC.slice(SRC.indexOf('if (skipInitialFetchRef.current) {'));
    expect(seeded.slice(0, seeded.indexOf('return;'))).toContain('drainRemainingPages(gen)');
  });

  it('makes the boot prefetch ask for the same first page as the list', () => {
    const pf = SRC.slice(SRC.indexOf('export async function prefetchDiscussions'));
    expect(pf).toContain('withPagination({ limit: FIRST_PAGE_SIZE })');
    expect(pf).not.toContain('withPagination({ limit: PAGE_SIZE })');
  });

  /*
   * The abort token is what keeps a stale page out of a fresh list. The generation
   * is bumped before the new items are applied, and re-checked after every await
   * inside the loop; an unmount bumps it too.
   */
  it('aborts a running drain on a filter change and on unmount', () => {
    expect(SRC).toContain('if (drainGenRef.current !== gen) return;');
    expect(SRC).toContain('useEffect(() => () => { drainGenRef.current += 1; }, []);');
  });

  it('caps the drain and LOGS when the cap is hit, never truncating silently', () => {
    expect(SRC).toMatch(/const MAX_BACKGROUND_PAGES = \d+;/);
    const guard = SRC.slice(SRC.indexOf('if (pages >= MAX_BACKGROUND_PAGES)'));
    expect(guard.slice(0, 400)).toContain('logger.warn');
  });

  it('keeps the manual load-more from racing the drain for the same cursor', () => {
    expect(SRC).toContain('if (!cursor || loadingMore || autoLoading) return;');
  });
});

describe('the list opens unfiltered', () => {
  it('has NO default month', () => {
    expect(LIST).toContain("const [monthFilter, setMonthFilter] = useState('all');");
    // the old default computed the current month right there
    expect(LIST).not.toMatch(/useState\(\(\) => \{\s*const now = new Date\(\);/);
  });

  it('counts an explicit month in the filter badge now that it is a real choice', () => {
    // While the month was a native default it was deliberately excluded (round177).
    // Now that the list opens unfiltered, a chosen month must be visible as a filter
    // or rows go missing with nothing on screen explaining why.
    expect(LIST).toContain("(typeFilter !== 'all' ? 1 : 0) + (monthFilter !== 'all' ? 1 : 0)");
  });

  it('shows drain progress instead of a button the hook is already pressing', () => {
    expect(LIST).toContain('{autoLoading && (');
    expect(LIST).toContain('{cursor && !autoLoading && (');
  });
});
