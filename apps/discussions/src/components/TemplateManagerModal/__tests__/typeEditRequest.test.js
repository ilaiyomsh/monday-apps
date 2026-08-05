import { describe, it, expect } from 'vitest';
import { shouldApplyTypeEdit } from '../typeEditRequest.js';

/*
 * round355 §gate — the create card's pencil asks the templates panel to open ONE
 * discussion type's editor. Two hazards make this more than "call startEditType":
 *
 *  1. THE WIPE. `startEditType` classifies new-vs-existing off `typeTemplates`.
 *     While TemplatesContext is still loading that list is empty, so an existing
 *     type opens as NEW/blank and saving it upserts over the stored template —
 *     destroying that type's roles, agenda and export template. The request must
 *     wait for the load.
 *  2. THE YANK. The request arrives as a prop; its effect re-runs on unrelated
 *     re-renders. Re-applying it resets the draft and throws the user back to the
 *     roles tab mid-edit. Each request carries a unique nonce, applied once.
 */
describe('round355 — shouldApplyTypeEdit', () => {
  const req = (over = {}) => ({ type: 'דיון צוות', nonce: 7, ...over });

  it('applies a fresh request once the templates have loaded', () => {
    expect(shouldApplyTypeEdit({ request: req(), loading: false, appliedNonce: null })).toBe(true);
  });

  it('REFUSES while the templates are still loading (else the save wipes the template)', () => {
    expect(shouldApplyTypeEdit({ request: req(), loading: true, appliedNonce: null })).toBe(false);
  });

  it('applies a request exactly once — the same nonce is refused on re-run', () => {
    expect(shouldApplyTypeEdit({ request: req({ nonce: 12 }), loading: false, appliedNonce: 12 })).toBe(false);
  });

  it('honours a NEW nonce for the same type (the user came back and clicked again)', () => {
    expect(shouldApplyTypeEdit({ request: req({ nonce: 13 }), loading: false, appliedNonce: 12 })).toBe(true);
  });

  it('refuses a request with no nonce — it could not be de-duplicated', () => {
    expect(shouldApplyTypeEdit({ request: { type: 'דיון צוות' }, loading: false, appliedNonce: null })).toBe(false);
    expect(shouldApplyTypeEdit({ request: { type: 'דיון צוות', nonce: null }, loading: false, appliedNonce: null })).toBe(false);
  });

  it('refuses an absent or blank type name', () => {
    expect(shouldApplyTypeEdit({ request: null, loading: false, appliedNonce: null })).toBe(false);
    expect(shouldApplyTypeEdit({ request: { type: '   ', nonce: 1 }, loading: false, appliedNonce: null })).toBe(false);
    expect(shouldApplyTypeEdit({ loading: false, appliedNonce: null })).toBe(false);
    expect(shouldApplyTypeEdit()).toBe(false);
  });

  it('treats nonce 0 as a real nonce (falsy but valid)', () => {
    expect(shouldApplyTypeEdit({ request: req({ nonce: 0 }), loading: false, appliedNonce: null })).toBe(true);
    expect(shouldApplyTypeEdit({ request: req({ nonce: 0 }), loading: false, appliedNonce: 0 })).toBe(false);
  });
});
