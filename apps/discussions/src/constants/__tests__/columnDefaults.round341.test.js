import { describe, it, expect } from 'vitest';
import {
  MY_TASKS_COLUMN_WIDTHS,
  TASKS_COLUMN_WIDTHS,
  DECISIONS_COLUMN_WIDTHS,
} from '../columnWidths.js';
import { applyColumnOrder } from '../../utils/columnOrder.js';

/*
 * round341 §11 (owner request) — "סידור העמודות הראשוני באפליקציה צריך להיות בכל מסך
 * כמו בתמונות המצורפות … כלומר רוחב העמודות והמיקום שלהן על גבי המסך."
 *
 * Two different kinds of claim, tested differently on purpose:
 *
 *   · The ORDER is stated exactly by the screenshots, so it is asserted exactly. The
 *     per-table starting orders live in their components (baseKeys / baseDefs arrays);
 *     what is pinned here is the MERGE rule they rely on — that a new default order only
 *     applies where nothing was stored, so this round cannot silently rearrange an
 *     instance whose owner already dragged their columns.
 *   · The WIDTHS were measured off pixels and are accurate to roughly ±15px. Asserting
 *     exact numbers would just restate the source file, so what is pinned is the
 *     INVARIANT that makes them safe: every default is inside its own [min, max], and the
 *     name column stays the widest. A typo that puts a default below its min — which
 *     would render a column the owner cannot drag back — fails here.
 */

const ALL = {
  myTasks: MY_TASKS_COLUMN_WIDTHS,
  tasks: TASKS_COLUMN_WIDTHS,
  decisions: DECISIONS_COLUMN_WIDTHS,
};

describe('round341 — the measured width defaults stay inside their own bounds', () => {
  for (const [table, map] of Object.entries(ALL)) {
    it(`${table}: every default sits within [min, max]`, () => {
      for (const [key, w] of Object.entries(map)) {
        expect(w.default, `${table}.${key} default below min`).toBeGreaterThanOrEqual(w.min);
        expect(w.default, `${table}.${key} default above max`).toBeLessThanOrEqual(w.max);
      }
    });

    // The name column is the row's identity and the only pinned one; every screenshot
    // shows it dominating the row. A width edit that lets a state column overtake it is
    // a layout regression, not a preference.
    it(`${table}: name is the widest column by default`, () => {
      const others = Object.entries(map).filter(([k]) => k !== 'name').map(([, w]) => w.default);
      expect(Math.max(...others)).toBeLessThan(map.name.default);
    });
  }
});

/*
 * The merge rule the whole "starting order" idea rests on. round341 changes four default
 * orders at once, so the guarantee that matters to the owner — "my dragged layout is not
 * going to be rearranged under me" — is worth stating directly rather than inferred.
 */
describe('round341 — a new default order applies only where nothing was stored', () => {
  // The tasks table's new default: name · assignee · partners · priority · deadline · status
  const NEW_DEFAULT = ['name', 'assignee', 'partners', 'priority', 'deadline', 'status'];

  it('uses the new default order for an instance with nothing stored', () => {
    expect(applyColumnOrder(NEW_DEFAULT, null, ['name'])).toEqual(NEW_DEFAULT);
  });

  it('KEEPS a stored order the owner dragged, ignoring the new default', () => {
    const dragged = ['name', 'status', 'deadline', 'priority', 'partners', 'assignee'];
    expect(applyColumnOrder(NEW_DEFAULT, dragged, ['name'])).toEqual(dragged);
  });

  /*
   * The partial case, which is where a naive merge goes wrong: an instance that stored an
   * order BEFORE a column existed must keep its arrangement and receive the newcomer,
   * rather than being reset to the new default wholesale.
   */
  it('appends a newly-visible column to a stored order instead of resetting it', () => {
    const storedBeforePartners = ['name', 'status', 'assignee'];
    const out = applyColumnOrder(NEW_DEFAULT, storedBeforePartners, ['name']);
    expect(out.slice(0, 3)).toEqual(storedBeforePartners);
    expect(out).toContain('partners');
    expect(new Set(out)).toEqual(new Set(NEW_DEFAULT));
  });
});
