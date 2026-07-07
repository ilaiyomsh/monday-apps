import { describe, it, expect } from 'vitest';
import { classifyProject } from '../projectClassification';
import type { PlannerSettings } from '../../types/settings.types';

const baseSettings = {
  enableProjectClassification: true,
  projectClassificationColumnId: 'status',
  internalProjectStatusValues: ['0'],
  externalProjectStatusValues: ['1'],
} as unknown as PlannerSettings;

describe('classifyProject', () => {
  it('matches by label index (preferred path)', () => {
    expect(classifyProject({ status: 'Whatever', status_index: '1' }, baseSettings)).toBe('external');
    expect(classifyProject({ status: 'Whatever', status_index: '0' }, baseSettings)).toBe('internal');
  });

  it('falls back to label text when index is absent (backward compat)', () => {
    const textSettings = {
      ...baseSettings,
      internalProjectStatusValues: ['Internal'],
      externalProjectStatusValues: ['External'],
    } as PlannerSettings;
    expect(classifyProject({ status: 'External' }, textSettings)).toBe('external');
    expect(classifyProject({ status: 'Internal' }, textSettings)).toBe('internal');
  });

  it('returns "other" when neither index nor text matches', () => {
    expect(classifyProject({ status: 'Unrelated', status_index: '99' }, baseSettings)).toBe('other');
    expect(classifyProject({}, baseSettings)).toBe('other');
    expect(classifyProject(null, baseSettings)).toBe('other');
  });

  it('returns "other" when classification is disabled', () => {
    const disabled = { ...baseSettings, enableProjectClassification: false } as PlannerSettings;
    expect(classifyProject({ status: 'Internal', status_index: '0' }, disabled)).toBe('other');
  });
});
