import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../types';

describe('DEFAULT_SETTINGS', () => {
  it('starts unconfigured (custom object — the single board is picked in settings)', () => {
    expect(DEFAULT_SETTINGS.vacationBoardId).toBeNull();
  });

  it('has an empty column map', () => {
    expect(DEFAULT_SETTINGS.columns).toEqual({});
  });

  it('seeds blank kind/type/status settings and empty personal-type cache', () => {
    expect(DEFAULT_SETTINGS.kindValues).toEqual({ general: '', personal: '' });
    expect(DEFAULT_SETTINGS.typeValues).toEqual({ vacation: '', sick: '', reserves: '' });
    expect(DEFAULT_SETTINGS.personalTypes).toEqual([]);
    expect(DEFAULT_SETTINGS.statusValues).toEqual({ pending: '', approved: '', rejected: '' });
    expect(DEFAULT_SETTINGS.approvalStatusTypes).toEqual([]);
  });

  it('starts with no teams', () => {
    expect(DEFAULT_SETTINGS.teams).toEqual([]);
  });

  it('has null language override and lastModifiedAt', () => {
    expect(DEFAULT_SETTINGS.languageOverride).toBeNull();
    expect(DEFAULT_SETTINGS.lastModifiedAt).toBeNull();
  });
});
