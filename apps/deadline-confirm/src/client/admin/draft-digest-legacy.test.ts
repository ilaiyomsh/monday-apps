// TDD red phase (V5 hotfix) — digestFromConfig must survive a PRE-0.6.0 config.
//
// PRODUCTION INCIDENT 2026-07-26: v0.6.0 added two required section fields
// (`includeStatusLabelIds`, `dateColumnTitle`) but `digestFromConfig` spreads
// the array unconditionally. Accounts whose digest was saved by an earlier
// version have sections without those keys, so the moment v5 became the live
// version the admin SPA died at boot with
//   TypeError: a.includeStatusLabelIds is not iterable
// The server was never affected (digest-service reads `?? []`, and validation
// runs only on write) — this is purely the client's read path.
//
// Rule pinned here: reading a stored config NEVER throws. A missing status
// condition becomes an empty list, which `digestIsComplete` then reports as
// incomplete — so the operator is asked to pick labels instead of the panel
// crashing or silently inventing a condition.

import { describe, it, expect } from 'vitest';
import { digestClusters, digestFromConfig, digestIsComplete } from './draft';

// 0.14.0: a config this old has no `blocks` key either, so reading it also
// reconstructs the 0.13.x text blocks around these clusters — asserted at the
// bottom. The clusters themselves are read through digestClusters().

/** A digest block exactly as v0.5.x persisted it — no 0.6.0 fields. */
const LEGACY_DIGEST = {
  usersBoardId: '222',
  usersPeopleColumnId: 'people_u',
  usersEmailColumnId: 'email_u',
  subject: 'המשימות שלך',
  sections: [
    { id: 's_start001', title: 'להתחיל:', dateColumnId: 'date_start', buttonId: 'b_start001' },
    { id: 's_done0001', title: 'לסיים:', dateColumnId: 'date_due', buttonId: 'b_done0001' },
  ],
} as never;

const MODERN_SECTION = {
  id: 's_new00001',
  title: 'להתחיל:',
  dateColumnId: 'date_start',
  dateColumnTitle: 'תאריך התחלה',
  buttonId: 'b_start001',
  includeStatusLabelIds: [0, 2],
};

describe('digestFromConfig — pre-0.6.0 stored config', () => {
  it('does not throw on sections that predate the status condition', () => {
    expect(() => digestFromConfig(LEGACY_DIGEST)).not.toThrow();
  });

  it('defaults a missing status condition to an empty list', () => {
    const draft = digestFromConfig(LEGACY_DIGEST);
    expect(digestClusters(draft).map((s) => s.includeStatusLabelIds)).toEqual([[], []]);
  });

  it('defaults a missing date-column title to an empty string', () => {
    const draft = digestFromConfig(LEGACY_DIGEST);
    expect(digestClusters(draft).map((s) => s.dateColumnTitle)).toEqual(['', '']);
  });

  it('keeps every field the legacy config did carry', () => {
    const draft = digestFromConfig(LEGACY_DIGEST);
    expect(draft.enabled).toBe(true);
    expect(draft.subject).toBe('המשימות שלך');
    expect(digestClusters(draft)[0]).toMatchObject({
      id: 's_start001',
      title: 'להתחיל:',
      dateColumnId: 'date_start',
      buttonId: 'b_start001',
    });
  });

  it('reports the legacy digest as INCOMPLETE so the operator must pick labels', () => {
    expect(digestIsComplete(digestFromConfig(LEGACY_DIGEST))).toBe(false);
  });
});

describe('digestFromConfig — a current config is unaffected', () => {
  it('carries the status condition through verbatim', () => {
    const draft = digestFromConfig({ ...(LEGACY_DIGEST as object), sections: [MODERN_SECTION] } as never);
    expect(digestClusters(draft)[0].includeStatusLabelIds).toEqual([0, 2]);
    expect(digestClusters(draft)[0].dateColumnTitle).toBe('תאריך התחלה');
    expect(digestIsComplete(draft)).toBe(true);
  });

  it('copies the array instead of aliasing the stored one', () => {
    const source = { ...(LEGACY_DIGEST as object), sections: [MODERN_SECTION] } as never;
    const draft = digestFromConfig(source);
    digestClusters(draft)[0].includeStatusLabelIds.push(99);
    expect(MODERN_SECTION.includeStatusLabelIds).toEqual([0, 2]);
  });
});

describe('digestFromConfig — a config with no blocks key (0.14.0 migration)', () => {
  it('rebuilds the greeting/lead/footer text blocks around the clusters', () => {
    const draft = digestFromConfig(LEGACY_DIGEST);
    expect(draft.blocks.map((b) => b.type)).toEqual(['text', 'text', 'cluster', 'cluster', 'text']);
    const texts = draft.blocks.filter((b) => b.type === 'text').map((b) => b.text);
    expect(texts[0]).toContain('{{שם}}');
    expect(texts[texts.length - 1]).toContain('מייל אוטומטי');
  });
});
