/**
 * migrateSettings carries the per-column OWNER list (round322, owner decision).
 * The invariant that protects 18 existing toEqual pins of the 3-key shape:
 * owners are carried ONLY when present and valid — an unadopted column's blob
 * keeps exactly { version, hiddenLabelIds, labels } with no phantom owners key.
 */

import { describe, expect, it } from 'vitest';

import { migrateSettings } from './settingsSchema.js';

describe('migrateSettings — owners', () => {
  it('carries a valid owners record through, normalized', () => {
    const migrated = migrateSettings({
      version: 1,
      hiddenLabelIds: [],
      labels: {},
      owners: { ownerIds: [7, '9', '9'], primaryOwnerId: '9' },
    });
    expect(migrated.owners).toEqual({ ownerIds: ['7', '9'], primaryOwnerId: '9' });
  });

  it('omits the owners key entirely when absent — a pre-round322 blob keeps the 3-key shape', () => {
    const migrated = migrateSettings({ version: 1, hiddenLabelIds: ['2'], labels: {} });
    expect('owners' in migrated).toBe(false);
    expect(migrated).toEqual({ version: 1, hiddenLabelIds: ['2'], labels: {} });
  });

  it('omits the owners key when the record has no usable ids (empty list is not adoption)', () => {
    const migrated = migrateSettings({
      version: 1, hiddenLabelIds: [], labels: {}, owners: { ownerIds: [] },
    });
    expect('owners' in migrated).toBe(false);
  });

  it('carries autoRevert only when strictly true — a monitoring column keeps its lean shape', () => {
    expect(migrateSettings({ version: 1, hiddenLabelIds: [], labels: {}, autoRevert: true }).autoRevert).toBe(true);
    expect('autoRevert' in migrateSettings({ version: 1, hiddenLabelIds: [], labels: {}, autoRevert: false })).toBe(false);
    expect('autoRevert' in migrateSettings({ version: 1, hiddenLabelIds: [], labels: {} })).toBe(false);
    // a non-boolean truthy value is NOT carried — the guard reads it as a strict flag
    expect('autoRevert' in migrateSettings({ version: 1, hiddenLabelIds: [], labels: {}, autoRevert: 'yes' })).toBe(false);
  });

  it('keeps owners beside labels and hidden ids without disturbing them', () => {
    const migrated = migrateSettings({
      version: 1,
      hiddenLabelIds: ['3'],
      labels: { 0: { nextLabelIds: ['1'] } },
      owners: { ownerIds: ['7'], primaryOwnerId: '7' },
    });
    expect(migrated.hiddenLabelIds).toEqual(['3']);
    expect(migrated.labels['0'].nextLabelIds).toEqual(['1']);
    expect(migrated.owners).toEqual({ ownerIds: ['7'], primaryOwnerId: '7' });
  });
});
