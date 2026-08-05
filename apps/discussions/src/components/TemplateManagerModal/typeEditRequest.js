/*
 * round355 — "open THIS discussion type's template editor", asked for from outside
 * the panel (the pencil next to a type in the create-discussion card).
 *
 * The panel already has `startEditType(name)`, but an EXTERNAL caller cannot just
 * invoke it on mount, for two reasons this predicate encodes:
 *
 *  1. THE WIPE HAZARD. `startEditType` decides new-vs-existing by looking the type
 *     up in `typeTemplates`. While TemplatesContext is still `loading` that list is
 *     empty, so an existing type would be treated as NEW, the editor would open
 *     blank, and saving it would `upsertTypeTemplate` over the stored template —
 *     silently destroying the type's roles / agenda / export template. So a request
 *     may only be applied once the templates have actually loaded.
 *  2. IDEMPOTENCY. The request arrives as a prop and the effect that consumes it
 *     re-runs on unrelated re-renders. Re-applying it would reset the draft and yank
 *     the user back to the roles tab mid-edit. Every request therefore carries a
 *     unique `nonce`, and each nonce is applied at most once. A request with no
 *     nonce is refused rather than applied unguarded — there would be no way to
 *     stop it repeating. `nonce: 0` is a legitimate nonce, so the check is against
 *     null/undefined, never falsiness.
 */
export function shouldApplyTypeEdit({ request, loading, appliedNonce } = {}) {
  const name = typeof request?.type === 'string' ? request.type.trim() : '';
  if (!name) return false;
  // (1) never enter the editor against a not-yet-loaded template list
  if (loading) return false;
  const nonce = request?.nonce;
  // (2) an un-nonced request cannot be de-duplicated, so it is not honoured
  if (nonce === undefined || nonce === null) return false;
  return appliedNonce !== nonce;
}
