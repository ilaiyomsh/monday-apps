import { describe, it, expect } from 'vitest';
import {
  resolveExportTemplate,
  typeExportTemplateFor,
  sameExportTemplate,
  effectiveOwnTemplate,
  shouldPersistOwnTemplate,
  canonicalJson,
  hasAssetContent,
} from '../exportTemplateResolve.js';

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

/*
 * round304 — the owner's report: an export template defined on a discussion TYPE
 * never reached discussions of that type (notably its uploaded header/footer
 * file). Cause: the dialog persisted the resolved template on EVERY produce, so
 * exporting a discussion once froze a per-discussion copy of the then-current
 * default, and that copy outranks the type tier forever after.
 */
describe('exportTemplateResolve — the frozen-own-copy fix (round304)', () => {
  const instance = { headerMode: 'config', font: 'assistant', sections: [{ key: 'meta', enabled: true }] };
  const typeTpl = { headerMode: 'upload', font: 'assistant', sections: [{ key: 'meta', enabled: true }] };

  describe('canonicalJson / sameExportTemplate', () => {
    it('compares by CONTENT, not by key order (the tiers are written by different screens)', () => {
      expect(sameExportTemplate({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
      expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    });
    it('array ORDER still matters (section order is part of the template)', () => {
      expect(sameExportTemplate({ s: ['a', 'b'] }, { s: ['b', 'a'] })).toBe(false);
    });
    it('treats real differences as different, and null as equal only to null', () => {
      expect(sameExportTemplate(instance, typeTpl)).toBe(false);
      expect(sameExportTemplate(null, null)).toBe(true);
      expect(sameExportTemplate(null, instance)).toBe(false);
      expect(sameExportTemplate(instance, undefined)).toBe(false);
    });
  });

  describe('effectiveOwnTemplate', () => {
    it('drops an own copy that merely ECHOES the system default, so the TYPE template applies', () => {
      const frozenEcho = { ...instance };
      expect(effectiveOwnTemplate(frozenEcho, typeTpl, instance)).toBeNull();
      expect(resolveExportTemplate(effectiveOwnTemplate(frozenEcho, typeTpl, instance), typeTpl, instance))
        .toBe(typeTpl);
    });
    it('drops an own copy identical to the type template as well', () => {
      expect(effectiveOwnTemplate({ ...typeTpl }, typeTpl, instance)).toBeNull();
    });
    it('KEEPS a genuinely customized own template', () => {
      const custom = { ...instance, font: 'david' };
      expect(effectiveOwnTemplate(custom, typeTpl, instance)).toBe(custom);
      expect(resolveExportTemplate(effectiveOwnTemplate(custom, typeTpl, instance), typeTpl, instance))
        .toBe(custom);
    });
    it('keeps the own template when there is nothing to compare it to', () => {
      const own = { ...instance };
      expect(effectiveOwnTemplate(own, null, null)).toBe(own);
      expect(effectiveOwnTemplate(null, typeTpl, instance)).toBeNull();
    });
  });

  describe('hasAssetContent', () => {
    it('is true for any real brand binary — the uploaded header/footer file included', () => {
      expect(hasAssetContent({ templateDocx: 'UEsDBBQ=' })).toBe(true);
      expect(hasAssetContent({ headerLogo: 'data:image/png;base64,AAA' })).toBe(true);
      expect(hasAssetContent({ footerLogo: 'data:image/png;base64,AAA' })).toBe(true);
    });
    it('is false for an empty bundle or nothing at all', () => {
      expect(hasAssetContent({ headerLogo: null, footerLogo: null, templateDocx: null })).toBe(false);
      expect(hasAssetContent({})).toBe(false);
      expect(hasAssetContent(null)).toBe(false);
      expect(hasAssetContent(undefined)).toBe(false);
    });
  });

  describe('shouldPersistOwnTemplate', () => {
    it('does NOT write an override when the user changed nothing in the dialog', () => {
      expect(shouldPersistOwnTemplate(instance, { ...instance })).toBe(false);
      // key order alone must not count as an edit
      expect(shouldPersistOwnTemplate({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    });
    it('writes an override once the template really differs from what was seeded', () => {
      expect(shouldPersistOwnTemplate(instance, { ...instance, font: 'david' })).toBe(true);
      expect(shouldPersistOwnTemplate(null, instance)).toBe(true);
    });
    it('never writes a null template', () => {
      expect(shouldPersistOwnTemplate(instance, null)).toBe(false);
    });
  });
});
