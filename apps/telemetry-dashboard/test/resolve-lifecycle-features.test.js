// resolve-lifecycle-features + register-lifecycle-subscriptions tests —
// the pure planning/parsing layer of the lifecycle wiring scripts: mapps
// console.table parsing, draft/live version selection, feature→lifecycle-kind
// normalization, multi-version registration planning, and post-registration
// verification. The mapps/network calls themselves are NOT covered here (the
// scripts are run manually with --dry-run first); everything below is pure.

import { describe, it, expect } from 'vitest';
import { EVENTS_BY_KIND, lifecycleKindFor } from '../scripts/lifecycle-kinds.mjs';
import {
  parseMappsTable,
  pickTargetVersions,
  buildVersionEntry,
} from '../scripts/resolve-lifecycle-features.mjs';
import {
  planRegistrations,
  verifySubscriptions,
  isLiveImmutableError,
} from '../scripts/register-lifecycle-subscriptions.mjs';

// Real `mapps app-version:list -i 11459177` output captured 2026-07-22,
// including the stderr noise mapps prints before the table.
const VERSION_TABLE = `(node:12147) [DEP0040] DeprecationWarning: The \`punycode\` module is deprecated. Please use a userland alternative instead.
(Use \`node --trace-deprecation ...\` to show where the warning was created)
┌─────────┬──────────┬───────────┬───────────────┬──────────┬──────────────┬──────────────────────────┐
│ (index) │ id       │ name      │ versionNumber │ appId    │ status       │ mondayCodeConfig         │
├─────────┼──────────┼───────────┼───────────────┼──────────┼──────────────┼──────────────────────────┤
│ 0       │ 15901666 │ 'Day-off' │ 'v4'          │ 11459177 │ 'draft'      │ { isMultiRegion: false } │
│ 1       │ 15465529 │ 'Day-off' │ 'v3'          │ 11459177 │ 'live'       │ { isMultiRegion: false } │
│ 2       │ 15403474 │ 'Day-off' │ 'v2'          │ 11459177 │ 'deprecated' │ { isMultiRegion: false } │
│ 3       │ 15124901 │ 'Day-off' │ 'v1'          │ 11459177 │ 'deprecated' │ { isMultiRegion: false } │
└─────────┴──────────┴───────────┴───────────────┴──────────┴──────────────┴──────────────────────────┘`;

// Real `mapps app-features:list -a 11459177 -i 15901666` output (same day).
const FEATURES_TABLE = `┌─────────┬──────────┬───────────┬────────────────────┬──────────┬────────────────────────────────────────┐
│ (index) │ id       │ name      │ type               │ status   │ build                                  │
├─────────┼──────────┼───────────┼────────────────────┼──────────┼────────────────────────────────────────┤
│ 0       │ 23902093 │ 'Day-off' │ 'AppFeatureObject' │ 'active' │ 'https://ilaiyomsh.github.io/day-off/' │
└─────────┴──────────┴───────────┴────────────────────┴──────────┴────────────────────────────────────────┘`;

describe('lifecycleKindFor', () => {
  it('passes the four lifecycle kinds through unchanged', () => {
    for (const kind of [
      'AppFeatureObject',
      'AppFeatureBoardView',
      'AppFeatureBoardColumnExtension',
      'AppFeatureColumn',
    ]) {
      expect(lifecycleKindFor(kind)).toBe(kind);
    }
  });

  it('normalizes concrete column subtypes to AppFeatureColumn', () => {
    // team-people-column's manifest type (verified in app-features:list).
    expect(lifecycleKindFor('AppFeaturePeopleColumn')).toBe('AppFeatureColumn');
    expect(lifecycleKindFor('AppFeatureStatusColumn')).toBe('AppFeatureColumn');
  });

  it('returns null for surfaces without lifecycle events', () => {
    expect(lifecycleKindFor('AppFeatureDialog')).toBeNull();
    expect(lifecycleKindFor('AppFeatureItemView')).toBeNull();
    expect(lifecycleKindFor('AppFeatureIntegration')).toBeNull();
  });

  it('every kind in EVENTS_BY_KIND resolves to itself (no dead entries)', () => {
    for (const kind of Object.keys(EVENTS_BY_KIND)) {
      expect(lifecycleKindFor(kind)).toBe(kind);
    }
  });
});

describe('parseMappsTable', () => {
  it('parses version rows, ignoring stderr noise and the (index) column', () => {
    const rows = parseMappsTable(VERSION_TABLE);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      id: '15901666',
      name: 'Day-off',
      versionNumber: 'v4',
      appId: '11459177',
      status: 'draft',
      mondayCodeConfig: '{ isMultiRegion: false }',
    });
    // Quoted strings come back unquoted; bare numbers stay strings.
    expect(rows[1].status).toBe('live');
    expect(rows[3].id).toBe('15124901');
  });

  it('parses feature rows including the build URL', () => {
    const rows = parseMappsTable(FEATURES_TABLE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: '23902093',
      name: 'Day-off',
      type: 'AppFeatureObject',
      status: 'active',
      build: 'https://ilaiyomsh.github.io/day-off/',
    });
  });

  it('returns an empty array when there is no table in the output', () => {
    expect(parseMappsTable('nothing here\njust noise')).toEqual([]);
  });
});

describe('pickTargetVersions', () => {
  const rows = parseMappsTable(VERSION_TABLE);

  it('picks the draft and live versions, ignoring deprecated ones', () => {
    const { draft, live } = pickTargetVersions(rows);
    expect(draft?.id).toBe('15901666');
    expect(live?.id).toBe('15465529');
  });

  it('returns null live when the app has no live version (sync-calender case)', () => {
    const draftOnly = rows.filter((r) => r.status === 'draft');
    const { draft, live } = pickTargetVersions(draftOnly);
    expect(draft?.id).toBe('15901666');
    expect(live).toBeNull();
  });

  it('picks the highest version number per status when several exist', () => {
    const twoDrafts = [
      { id: '1', versionNumber: 'v9', status: 'draft' },
      { id: '2', versionNumber: 'v10', status: 'draft' },
    ];
    expect(pickTargetVersions(twoDrafts).draft?.id).toBe('2');
  });
});

describe('buildVersionEntry', () => {
  const versionRow = { id: '16067214', versionNumber: 'v4', status: 'draft' };

  it('keeps lifecycle features (normalized kind + raw type) and skips the rest', () => {
    const entry = buildVersionEntry(versionRow, [
      { id: '24310172', name: 'Team People', type: 'AppFeaturePeopleColumn', status: 'active' },
      { id: '24310174', name: 'Team People Dialog', type: 'AppFeatureDialog', status: 'active' },
    ]);
    expect(entry).toMatchObject({
      versionId: '16067214',
      versionNumber: 'v4',
      versionStatus: 'draft',
    });
    expect(entry.features).toEqual([
      {
        featureId: 24310172,
        name: 'Team People',
        type: 'AppFeaturePeopleColumn',
        kind: 'AppFeatureColumn',
      },
    ]);
    // Skipped surfaces stay visible in the config for review, with their type.
    expect(entry.skippedFeatures).toEqual([
      { featureId: 24310174, name: 'Team People Dialog', type: 'AppFeatureDialog' },
    ]);
  });

  it('produces empty lists for a version with no features', () => {
    const entry = buildVersionEntry(versionRow, []);
    expect(entry.features).toEqual([]);
    expect(entry.skippedFeatures).toEqual([]);
  });
});

describe('planRegistrations', () => {
  const config = {
    webhookBaseUrl: 'https://e3a28-service-14334098-f09ca9de.us.monday.app',
    apps: [
      {
        name: 'axis-tracker',
        appId: '10684862',
        versions: [
          {
            versionId: '15901660',
            versionNumber: 'v25',
            versionStatus: 'draft',
            features: [
              { featureId: 23902080, name: 'Tracker', type: 'AppFeatureObject', kind: 'AppFeatureObject' },
              { featureId: 23902079, name: 'Tracker', type: 'AppFeatureBoardView', kind: 'AppFeatureBoardView' },
            ],
          },
          {
            versionId: '14244869',
            versionNumber: 'v24',
            versionStatus: 'live',
            features: [
              { featureId: 19856477, name: 'Tracker', type: 'AppFeatureObject', kind: 'AppFeatureObject' },
              { featureId: 19856476, name: 'Tracker', type: 'AppFeatureBoardView', kind: 'AppFeatureBoardView' },
            ],
          },
        ],
      },
      {
        name: 'deadline-confirm',
        appId: '11704868',
        versions: [
          { versionId: '1', versionNumber: 'v1', versionStatus: 'live', features: [] },
        ],
      },
    ],
  };

  it('emits one job per feature per version with the right events', () => {
    const { jobs, warnings } = planRegistrations(config);
    expect(jobs).toHaveLength(4);
    expect(warnings).toEqual([]);
    const draftBoardView = jobs.find((j) => j.featureId === 23902079);
    expect(draftBoardView).toMatchObject({
      appId: '10684862',
      appName: 'axis-tracker',
      versionId: '15901660',
      versionStatus: 'draft',
      entityId: '23902079',
      kind: 'AppFeatureBoardView',
      events: EVENTS_BY_KIND.AppFeatureBoardView,
    });
  });

  it('filters by app name and by version status', () => {
    const byApp = planRegistrations(config, { app: 'axis-tracker' });
    expect(byApp.jobs).toHaveLength(4);
    const draftOnly = planRegistrations(config, { versionStatus: 'draft' });
    expect(draftOnly.jobs).toHaveLength(2);
    expect(draftOnly.jobs.every((j) => j.versionStatus === 'draft')).toBe(true);
    const none = planRegistrations(config, { app: 'no-such-app' });
    expect(none.jobs).toHaveLength(0);
  });

  it('warns and skips features with an unknown kind instead of guessing', () => {
    const broken = {
      webhookBaseUrl: 'https://x.monday.app',
      apps: [
        {
          name: 'a',
          appId: '1',
          versions: [
            {
              versionId: '10',
              versionNumber: 'v1',
              versionStatus: 'draft',
              features: [{ featureId: 5, name: 'f', type: 'Whatever', kind: 'AppFeatureNope' }],
            },
          ],
        },
      ],
    };
    const { jobs, warnings } = planRegistrations(broken);
    expect(jobs).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('AppFeatureNope');
  });
});

describe('isLiveImmutableError', () => {
  it('recognizes the real 403 message from monday (captured 2026-07-24)', () => {
    expect(
      isLiveImmutableError(
        'monday API errors: [{"message":"Lifecycle subscriptions cannot be modified for live app versions"}]'
      )
    ).toBe(true);
  });

  it('does not swallow other failures', () => {
    expect(isLiveImmutableError('monday API HTTP 500: upstream exploded')).toBe(false);
    expect(isLiveImmutableError(undefined)).toBe(false);
  });
});

describe('verifySubscriptions', () => {
  const webhookUrl = 'https://e3a28-service-14334098-f09ca9de.us.monday.app/api/webhooks/lifecycle';
  const job = {
    appName: 'axis-tracker',
    versionStatus: 'live',
    featureId: 19856476,
    entityId: '19856476',
    kind: 'AppFeatureBoardView',
    events: EVENTS_BY_KIND.AppFeatureBoardView,
  };
  const fullSubs = EVENTS_BY_KIND.AppFeatureBoardView.map((action, i) => ({
    id: String(100 + i),
    entity_id: '19856476',
    event_type: `AppFeatureBoardView:${action}`,
    webhook_url: webhookUrl,
    is_sync: false,
  }));

  it('passes when every expected event is subscribed at the right URL', () => {
    const problems = verifySubscriptions(fullSubs, [job], webhookUrl);
    expect(problems).toEqual([]);
  });

  it('reports missing events', () => {
    const problems = verifySubscriptions(fullSubs.slice(1), [job], webhookUrl);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('duplicate');
  });

  it('reports a wrong webhook URL even when the event exists', () => {
    const wrongUrl = fullSubs.map((s) => ({ ...s, webhook_url: 'https://old.monday.app/hook' }));
    const problems = verifySubscriptions(wrongUrl, [job], webhookUrl);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('ignores subscriptions of other entities (the other version\'s features)', () => {
    const withOther = [
      ...fullSubs,
      { id: '999', entity_id: '23902079', event_type: 'AppFeatureBoardView:delete', webhook_url: 'https://elsewhere', is_sync: false },
    ];
    expect(verifySubscriptions(withOther, [job], webhookUrl)).toEqual([]);
  });
});
