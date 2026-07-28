import { describe, it, expect } from 'vitest';
import { resolveExportTemplate, typeExportTemplateFor } from '../exportTemplateResolve.js';

describe('exportTemplateResolve — 3-tier precedence (round254)', () => {
  const own = { tag: 'own' };
  const type = { tag: 'type' };
  const inst = { tag: 'instance' };

  describe('resolveExportTemplate', () => {
    it('the per-discussion (own) override wins over everything', () => {
      expect(resolveExportTemplate(own, type, inst)).toBe(own);
      expect(resolveExportTemplate(own, null, null)).toBe(own);
    });
    it('the TYPE template wins over the instance default when there is no own override', () => {
      expect(resolveExportTemplate(null, type, inst)).toBe(type);
      expect(resolveExportTemplate(undefined, type, inst)).toBe(type);
    });
    it('falls back to the instance default when neither own nor type exists', () => {
      expect(resolveExportTemplate(null, null, inst)).toBe(inst);
    });
    it('returns null when no tier exists (caller seeds the built-in default)', () => {
      expect(resolveExportTemplate(null, null, null)).toBeNull();
      expect(resolveExportTemplate(undefined, undefined, undefined)).toBeNull();
    });
  });

  describe('typeExportTemplateFor', () => {
    const templates = [
      { discussionType: 'סבב', exportTemplate: { tag: 'roundTpl' } },
      { discussionType: 'תכנון', exportTemplate: null },
    ];
    it('returns the matching type\'s exportTemplate', () => {
      expect(typeExportTemplateFor(templates, 'סבב')).toEqual({ tag: 'roundTpl' });
    });
    it('returns null when the matched type has no export template', () => {
      expect(typeExportTemplateFor(templates, 'תכנון')).toBeNull();
    });
    it('returns null for an unknown type, empty name, or non-array input', () => {
      expect(typeExportTemplateFor(templates, 'לא-קיים')).toBeNull();
      expect(typeExportTemplateFor(templates, '')).toBeNull();
      expect(typeExportTemplateFor(null, 'סבב')).toBeNull();
    });
  });
});
