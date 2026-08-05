import { describe, it, expect } from 'vitest';
import { resolveExportAssets } from '../exportTemplateResolve.js';

/*
 * round356 (owner spec) — the export template CASCADES: the system template is the
 * default, a discussion type's template overrides it for its discussions, and the
 * edits made inside the export dialog override both for THAT export only.
 *
 * The config already merged field-by-field. The ASSETS did not: the dialog picked
 * ONE tier whole (`ownAssets || typeAssets || globalAssets`), so the first tier that
 * held anything discarded the others. That is the bug the owner hit — a header/footer
 * .docx uploaded at the system level was thrown away because the discussion's type
 * happened to carry a logo, and the export then silently rendered with no headers
 * (deliverDiscussionDocx needs BOTH headerMode==='upload' AND assets.templateDocx).
 *
 * resolveExportAssets merges the three asset fields INDEPENDENTLY, with the same
 * precedence the config uses, so a .docx at one tier and a logo at another coexist.
 */

const DOCX = 'UEsDBBQABgAIAAAAIQ=='; // a stand-in for the uploaded template bytes

describe('round356 — resolveExportAssets merges each asset field on its own', () => {
  it('takes the .docx from the system tier even when the type tier holds a logo', () => {
    const merged = resolveExportAssets(
      null,                               // no per-export edits
      { headerLogo: 'type-logo' },        // the type: a logo, no template file
      { templateDocx: DOCX },             // the system: the uploaded template file
    );
    expect(merged).toEqual({ headerLogo: 'type-logo', templateDocx: DOCX });
  });

  it('a higher tier wins PER FIELD, it does not erase the tiers below it', () => {
    const merged = resolveExportAssets(
      { headerLogo: 'own-logo' },
      { headerLogo: 'type-logo', footerLogo: 'type-footer' },
      { templateDocx: DOCX, footerLogo: 'global-footer' },
    );
    expect(merged).toEqual({
      headerLogo: 'own-logo',       // per-export edit wins
      footerLogo: 'type-footer',    // type beats system
      templateDocx: DOCX,           // only the system has it
    });
  });

  it('empty values do not shadow a lower tier', () => {
    // A tier that was touched and cleared carries '' / null — that is "nothing to
    // contribute", not "override with nothing", or clearing a logo on the type would
    // hide the system's template file too.
    const merged = resolveExportAssets(
      { headerLogo: '', templateDocx: null },
      null,
      { headerLogo: 'global-logo', templateDocx: DOCX },
    );
    expect(merged).toEqual({ headerLogo: 'global-logo', templateDocx: DOCX });
  });

  it('returns null when no tier contributes anything', () => {
    expect(resolveExportAssets(null, null, null)).toBeNull();
    expect(resolveExportAssets({}, { headerLogo: '' }, undefined)).toBeNull();
  });

  it('ignores non-object tiers instead of throwing', () => {
    expect(resolveExportAssets('nope', 42, { footerLogo: 'f' })).toEqual({ footerLogo: 'f' });
  });

  it('carries no key for a field nobody set (so `in` checks stay meaningful)', () => {
    const merged = resolveExportAssets(null, null, { headerLogo: 'g' });
    expect(Object.keys(merged)).toEqual(['headerLogo']);
  });
});
