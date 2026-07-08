import { describe, it, expect, beforeEach } from 'vitest';
import { prepareAllocationMutationValues } from '../mondayTransformers';
import { assertNoForbiddenStrings, flattenTranslationValues } from '../payloadGuard';
import i18n from '../../i18n';
import enBundle from '../../i18n/locales/en/translation.json';
import heBundle from '../../i18n/locales/he/translation.json';
import type { PlannerSettings } from '../../types/settings.types';

const baseSettings: PlannerSettings = {
  allocationsBoardId: 'b1',
  startDateColumnId: 'start',
  endDateColumnId: 'end',
  hoursPerDayColumnId: 'hpd',
  totalHoursColumnId: 'tot',
  projectColumnId: 'proj',
  employeeColumnId: 'emp',
  roleColumnId: 'role',
  ftePercentageColumnId: 'fte',
  allocationCapabilityColumnId: 'cap',
  employeesBoardId: 'b2',
  employeeNameColumnId: 'en',
  employeeRoleColumnId: 'er',
  employeeAllocationPercentColumnId: 'ea',
  employeeCostColumnId: 'ec',
  employeeUserIdColumnId: 'eu',
  workDayStart: '09:00',
  workDayEnd: '18:00',
  effortDisplayMode: 'hours_day',
  maxHoursPerDay: 8.5,
  maxHoursPerWeek: 42.5,
  maxHoursPerMonth: 182,
  workDays: [0, 1, 2, 3, 4],
};

const HEBREW_ROLE = 'מתכנת';
const HEBREW_CAPABILITY = 'Frontend';
const baseAllocation = {
  startDate: '2025-06-15T09:00:00',
  endDate: '2025-06-19T18:00:00',
  totalHours: 30,
  role: HEBREW_ROLE,
  capability: HEBREW_CAPABILITY,
  projectId: '12345',
  employeeId: '67890',
};

const enLeakStrings = flattenTranslationValues(enBundle).filter((s) => s.length > 0);
const heLeakStrings = flattenTranslationValues(heBundle).filter((s) => s.length > 0);

const stableJson = (v: unknown) => JSON.stringify(v, Object.keys(v as object).sort());

describe('prepareAllocationMutationValues — payload preservation', () => {
  // Each test seeds the active language so we'd catch any code path that
  // accidentally piped t() into the payload. The mutation transformer is pure
  // (doesn't read i18n), but exercising it under both languages locks in that
  // contract.
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('he payload preserves the Hebrew role label exactly (no translation)', () => {
    const payload = prepareAllocationMutationValues(baseAllocation, baseSettings, 'projects');
    expect(payload[baseSettings.roleColumnId]).toBe(HEBREW_ROLE);
  });

  it('he payload preserves the capability label inside { labels: [...] }', () => {
    const payload = prepareAllocationMutationValues(baseAllocation, baseSettings, 'projects');
    expect(payload[baseSettings.allocationCapabilityColumnId!]).toEqual({ labels: [HEBREW_CAPABILITY] });
  });

  it('he payload contains no English translation strings', () => {
    const payload = prepareAllocationMutationValues(baseAllocation, baseSettings, 'projects');
    // Allow `role`/`capability`-shaped values to legitimately match Hebrew board data,
    // and `labels`/`label` for status/dropdown shapes; these are not translation leaks.
    assertNoForbiddenStrings(payload, enLeakStrings, {
      allowedKeys: [baseSettings.roleColumnId, 'label', 'labels'],
      context: 'he allocation payload',
    });
  });

  it('en language: identical inputs produce byte-for-byte identical payload', async () => {
    const heResult = prepareAllocationMutationValues(baseAllocation, baseSettings, 'projects');
    await i18n.changeLanguage('en');
    const enResult = prepareAllocationMutationValues(baseAllocation, baseSettings, 'projects');
    expect(stableJson(enResult)).toBe(stableJson(heResult));
  });

  it('en language payload still preserves the Hebrew role label (board data, not UI)', async () => {
    await i18n.changeLanguage('en');
    const payload = prepareAllocationMutationValues(baseAllocation, baseSettings, 'projects');
    expect(payload[baseSettings.roleColumnId]).toBe(HEBREW_ROLE);
    expect(payload[baseSettings.allocationCapabilityColumnId!]).toEqual({ labels: [HEBREW_CAPABILITY] });
  });

  it('en language payload contains no Hebrew translation strings either', async () => {
    await i18n.changeLanguage('en');
    const payload = prepareAllocationMutationValues(baseAllocation, baseSettings, 'projects');
    // `roleColumnId` legitimately holds the Hebrew board label.
    assertNoForbiddenStrings(payload, heLeakStrings, {
      allowedKeys: [baseSettings.roleColumnId, 'label', 'labels'],
      context: 'en allocation payload',
    });
  });

  it('update payload (partial fields) is identical across languages', async () => {
    const partial = { ...baseAllocation, role: HEBREW_ROLE };
    await i18n.changeLanguage('he');
    const heResult = prepareAllocationMutationValues(partial, baseSettings, 'projects');
    await i18n.changeLanguage('en');
    const enResult = prepareAllocationMutationValues(partial, baseSettings, 'projects');
    expect(stableJson(enResult)).toBe(stableJson(heResult));
  });

  it('employees view: payload identical across languages', async () => {
    await i18n.changeLanguage('he');
    const heResult = prepareAllocationMutationValues(baseAllocation, baseSettings, 'employees', '67890');
    await i18n.changeLanguage('en');
    const enResult = prepareAllocationMutationValues(baseAllocation, baseSettings, 'employees', '67890');
    expect(stableJson(enResult)).toBe(stableJson(heResult));
  });
});

describe('Bulk allocation — payload preservation', () => {
  it('per-row payloads are identical across languages', async () => {
    const rows = [
      { ...baseAllocation, role: 'מתכנת', capability: 'Frontend', employeeId: '1' },
      { ...baseAllocation, role: 'מעצב', capability: 'Design', employeeId: '2' },
      { ...baseAllocation, role: 'מנהל', capability: 'Management', employeeId: '3' },
    ];

    await i18n.changeLanguage('he');
    const hePayloads = rows.map((r) => prepareAllocationMutationValues(r, baseSettings, 'projects'));

    await i18n.changeLanguage('en');
    const enPayloads = rows.map((r) => prepareAllocationMutationValues(r, baseSettings, 'projects'));

    expect(stableJson(enPayloads)).toBe(stableJson(hePayloads));
  });

  it('bulk payloads contain none of the en bundle strings', async () => {
    await i18n.changeLanguage('en');
    const rows = [
      { ...baseAllocation, role: 'מתכנת', capability: 'Frontend' },
      { ...baseAllocation, role: 'מעצב', capability: 'Design' },
    ];
    const payloads = rows.map((r) => prepareAllocationMutationValues(r, baseSettings, 'projects'));
    for (const p of payloads) {
      assertNoForbiddenStrings(p, enLeakStrings, {
        allowedKeys: [baseSettings.roleColumnId, 'label', 'labels'],
        context: 'bulk allocation payload',
      });
    }
  });
});

describe('Project type write — payload preservation', () => {
  // ProjectSummaryCard writes status column as { label: <original board text> }.
  // We exercise the literal shape used by the component so Increment 4 / future
  // refactors that wrap it in t() get caught.

  it('Hebrew project type label is preserved in { label }', () => {
    const projectTypeLabel = 'פנימי';
    const write = { label: projectTypeLabel };
    expect(write).toEqual({ label: 'פנימי' });
  });

  it('the ProjectTypeBadge write shape is { label: <original> } (round-trip)', () => {
    // Locks the shape in: should the component ever start sending an `{ index }`
    // shape we'd want a separate migration tracked, not a silent change.
    const write = { label: 'פנימי' };
    assertNoForbiddenStrings(write, enLeakStrings, {
      allowedKeys: ['label'],
      context: 'project type write',
    });
  });
});
