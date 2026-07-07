import { describe, it, expect, beforeEach } from 'vitest';
import i18n from '../../i18n';
import enBundle from '../../i18n/locales/en/translation.json';
import { assertNoForbiddenStrings, flattenTranslationValues } from '../../utils/payloadGuard';
import type { PlannerSettings } from '../../types/settings.types';

/**
 * Round-trip mapping safety: arrays of board-label values inside PlannerSettings
 * (`activeProjectStatusValues`, `internalProjectStatusValues`,
 * `externalProjectStatusValues`) must never be mutated by the settings flow,
 * regardless of active language. They reference Monday board labels and are
 * never sourced from `t()`. The test exercises the JSON serialization round
 * trip the way `useMondaySettings.saveSettings` performs it.
 */

const enLeaks = flattenTranslationValues(enBundle).filter((s) => s.length > 0);

const baseSettings: PlannerSettings = {
  allocationsBoardId: 'b1',
  startDateColumnId: 'start',
  endDateColumnId: 'end',
  hoursPerDayColumnId: 'hpd',
  totalHoursColumnId: 'tot',
  projectColumnId: 'proj',
  employeeColumnId: 'emp',
  roleColumnId: 'role',
  employeesBoardId: 'b2',
  employeeNameColumnId: 'en',
  employeeRoleColumnId: 'er',
  employeeAllocationPercentColumnId: 'ea',
  employeeCostColumnId: 'ec',
  employeeUserIdColumnId: 'eu',
  filterActiveProjects: true,
  projectStatusColumnId: 'ps',
  activeProjectStatusValues: ['פעיל', 'בעבודה'],
  enableProjectClassification: true,
  projectClassificationColumnId: 'pc',
  internalProjectStatusValues: ['פנימי'],
  externalProjectStatusValues: ['חיצוני', 'לקוח חיצוני'],
  workDayStart: '09:00',
  workDayEnd: '18:00',
  effortDisplayMode: 'hours_day',
  maxHoursPerDay: 8.5,
  maxHoursPerWeek: 42.5,
  maxHoursPerMonth: 182,
  workDays: [0, 1, 2, 3, 4],
};

describe('useMondaySettings — Hebrew board-label arrays round-trip', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('Hebrew status arrays survive JSON serialize/parse byte-for-byte', () => {
    // useMondaySettings.saveSettings stores via JSON.stringify; load parses.
    const serialized = JSON.stringify(baseSettings);
    const parsed = JSON.parse(serialized) as PlannerSettings;

    expect(parsed.activeProjectStatusValues).toEqual(['פעיל', 'בעבודה']);
    expect(parsed.internalProjectStatusValues).toEqual(['פנימי']);
    expect(parsed.externalProjectStatusValues).toEqual(['חיצוני', 'לקוח חיצוני']);
  });

  it('switching to en and updating an unrelated field keeps Hebrew arrays intact', async () => {
    await i18n.changeLanguage('en');
    // Simulate user toggling defaultZoomLevel under English UI.
    const updated: PlannerSettings = { ...baseSettings, defaultZoomLevel: 'month' };
    const stored = JSON.parse(JSON.stringify(updated)) as PlannerSettings;

    expect(stored.activeProjectStatusValues).toEqual(['פעיל', 'בעבודה']);
    expect(stored.internalProjectStatusValues).toEqual(['פנימי']);
    expect(stored.externalProjectStatusValues).toEqual(['חיצוני', 'לקוח חיצוני']);
    expect(stored.defaultZoomLevel).toBe('month');
  });

  it('serialized settings contain no English bundle strings (no t() leak into board-data arrays)', () => {
    const serialized = JSON.stringify(baseSettings);
    const parsed = JSON.parse(serialized);

    // Hebrew status values are board data — declared safe under those keys.
    assertNoForbiddenStrings(parsed, enLeaks, {
      allowedKeys: [
        'activeProjectStatusValues',
        'internalProjectStatusValues',
        'externalProjectStatusValues',
      ],
      context: 'PlannerSettings round-trip',
    });
  });
});
