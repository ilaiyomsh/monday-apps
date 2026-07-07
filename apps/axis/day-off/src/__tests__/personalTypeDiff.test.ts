import { describe, it, expect } from 'vitest';
import {
  kindSelectionDiverged,
  approvalSelectionDiverged,
  samePersonalTypeOptions,
} from '../components/Settings/personalTypeDiff';
import he from '../i18n/locales/he/translation.json';
import en from '../i18n/locales/en/translation.json';
import type { PersonalTypeOption, KindValueMap, StatusValueMap } from '../types';

// W1.5, relocated by change #78: the consumer warning belongs on the mappings
// whose label IDs Planner/tracker actually cache — KIND (general/personal) and
// APPROVAL STATUS. The personal-type labels are an open set (D1), read live and
// display-only, so editing them must NOT warn. The warning fires when the draft
// SELECTION diverges from the SAVED one (a semantic re-pick).

const label = (over: Partial<PersonalTypeOption> = {}): PersonalTypeOption => ({
  id: '1',
  title: 'Vacation',
  color: '#00c875',
  colorValue: 1,
  index: 0,
  isDone: false,
  isDeactivated: false,
  ...over,
});

const live: PersonalTypeOption[] = [
  label({ id: '1', title: 'Vacation', color: '#00c875', index: 0 }),
  label({ id: '5', title: 'Sick', color: '#e2445c', colorValue: 2, index: 1 }),
];

const savedKind: KindValueMap = { general: '', personal: '', generalLabelId: '3', personalLabelId: '7' };
const savedStatus: StatusValueMap = {
  pending: '',
  approved: '',
  rejected: '',
  labelIds: { pending: '0', approved: '1', rejected: '2' },
};

describe('kindSelectionDiverged (change #78 consumer-warning gate)', () => {
  it('is false when the draft matches the saved selection', () => {
    expect(kindSelectionDiverged(savedKind, { ...savedKind })).toBe(false);
  });

  it('is false on first-time mapping (nothing saved yet)', () => {
    expect(kindSelectionDiverged(undefined, savedKind)).toBe(false);
    expect(kindSelectionDiverged({ general: '', personal: '' }, savedKind)).toBe(false);
  });

  it('is false for a legacy text-only saved blob (no label IDs saved)', () => {
    expect(
      kindSelectionDiverged({ general: 'כללי', personal: 'אישי' }, savedKind),
    ).toBe(false);
  });

  it('detects a re-pick of either kind label', () => {
    expect(kindSelectionDiverged(savedKind, { ...savedKind, generalLabelId: '9' })).toBe(true);
    expect(kindSelectionDiverged(savedKind, { ...savedKind, personalLabelId: '9' })).toBe(true);
  });

  it('detects clearing a saved selection', () => {
    expect(kindSelectionDiverged(savedKind, { ...savedKind, generalLabelId: undefined })).toBe(true);
  });
});

describe('approvalSelectionDiverged (change #78 consumer-warning gate)', () => {
  it('is false when the draft matches the saved selection', () => {
    expect(
      approvalSelectionDiverged(savedStatus, { ...savedStatus, labelIds: { ...savedStatus.labelIds } }),
    ).toBe(false);
  });

  it('is false on first-time mapping (nothing saved yet)', () => {
    expect(approvalSelectionDiverged(undefined, savedStatus)).toBe(false);
    expect(
      approvalSelectionDiverged({ pending: '', approved: '', rejected: '' }, savedStatus),
    ).toBe(false);
  });

  it('detects a re-pick of any status label', () => {
    for (const key of ['pending', 'approved', 'rejected'] as const) {
      const draft: StatusValueMap = {
        ...savedStatus,
        labelIds: { ...savedStatus.labelIds, [key]: '9' },
      };
      expect(approvalSelectionDiverged(savedStatus, draft)).toBe(true);
    }
  });
});

describe('samePersonalTypeOptions', () => {
  it('compares element-wise by id/title/color/index', () => {
    expect(samePersonalTypeOptions(live, live.map((l) => ({ ...l })))).toBe(true);
    expect(samePersonalTypeOptions(live, [live[0]])).toBe(false);
    expect(samePersonalTypeOptions(live, [live[0], { ...live[1], id: '9' }])).toBe(false);
  });
});

describe('consumer-warning i18n (he+en)', () => {
  it.each([
    ['he', he],
    ['en', en],
  ] as const)('%s: kind + status sections carry the warning; the type section does NOT', (_lng, bundle) => {
    for (const section of [bundle.settings.kindValues, bundle.settings.statusValues] as {
      consumerWarning?: string;
    }[]) {
      const text = section.consumerWarning;
      expect(typeof text).toBe('string');
      expect(text!.trim().length).toBeGreaterThan(0);
      // The warning must name both external consumers explicitly.
      expect(text).toContain('Planner');
      expect(text!.toLowerCase()).toContain('tracker');
    }
    // Relocated away from the personal-type editor (open set per D1).
    expect((bundle.settings.typeValues as { consumerWarning?: string }).consumerWarning).toBeUndefined();
  });
});
