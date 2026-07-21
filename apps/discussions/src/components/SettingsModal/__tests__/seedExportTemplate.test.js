import { describe, it, expect } from 'vitest';
import { seedExportTemplate } from '../SettingsModal.jsx';
import { DEFAULT_EXPORT_TEMPLATE } from '../../../utils/mondayApi/boards.config.js';

// round203 — the "פתיחה" (freeText) export section was retired: the default
// template no longer carries it, and seeding a stored template DROPS it while
// still back-filling any missing current keys at their default position.
describe('seedExportTemplate (round203 — freeText retirement)', () => {
  it('the default template has no freeText section', () => {
    expect(DEFAULT_EXPORT_TEMPLATE.sections.some((s) => s.key === 'freeText')).toBe(false);
  });

  it('drops a stored freeText section and back-fills missing current keys', () => {
    const stored = {
      sections: [
        { key: 'freeText', enabled: true, title: 'הערות', body: 'טקסט' },
        { key: 'meta', enabled: true, fields: [] },
        { key: 'tasks', enabled: true },
      ],
    };
    const seeded = seedExportTemplate(stored);
    const keys = seeded.sections.map((s) => s.key);
    expect(keys).not.toContain('freeText');
    // Every current default key is present (back-filled where missing).
    DEFAULT_EXPORT_TEMPLATE.sections.forEach((def) => expect(keys).toContain(def.key));
    // The user's existing relative order (meta before tasks) is preserved.
    expect(keys.indexOf('meta')).toBeLessThan(keys.indexOf('tasks'));
  });

  it('keeps the user-owned order of existing keys verbatim', () => {
    const stored = {
      sections: [
        { key: 'tasks', enabled: true },
        { key: 'meta', enabled: true, fields: [] },
      ],
    };
    const keys = seedExportTemplate(stored).sections.map((s) => s.key);
    expect(keys.indexOf('tasks')).toBeLessThan(keys.indexOf('meta'));
  });
});
