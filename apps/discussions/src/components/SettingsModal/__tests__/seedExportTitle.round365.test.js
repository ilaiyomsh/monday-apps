import { describe, it, expect } from 'vitest';
import { seedExportTemplate } from '../SettingsModal.jsx';
import { DEFAULT_EXPORT_TEMPLATE } from '../../../utils/mondayApi/boards.config.js';

/*
 * round365 — seedExportTemplate back-fills the new TITLE config into export
 * templates stored before the field existed, and merges a partial stored
 * title over the default (nested key: the top-level spread alone would leave
 * missing sub-keys undefined).
 */

describe('round365 — seedExportTemplate title back-fill', () => {
  it('a pre-title stored template gets the full shipped default title', () => {
    const seeded = seedExportTemplate({ font: 'brand', header: { text: 'x' } });
    expect(seeded.title).toEqual(DEFAULT_EXPORT_TEMPLATE.title);
  });

  it('a partial stored title keeps its values and gains the missing sub-keys', () => {
    const seeded = seedExportTemplate({ title: { free: 'פרוטוקול', align: 'right' } });
    expect(seeded.title.free).toBe('פרוטוקול');
    expect(seeded.title.align).toBe('right');
    expect(seeded.title.field2).toBe('discussionName');
    expect(seeded.title.sep12).toBe('dash');
    expect(seeded.title.order).toEqual(['free', 'field2', 'field3']);
  });

  it('null/undefined stored template still yields the default title', () => {
    expect(seedExportTemplate(null).title).toEqual(DEFAULT_EXPORT_TEMPLATE.title);
  });
});
