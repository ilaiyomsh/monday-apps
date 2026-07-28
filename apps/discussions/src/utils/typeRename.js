/*
 * round304 — RENAMING a discussion type (= renaming its template).
 *
 * A "תבנית לפי סוג דיון" is KEYED by the type's label TEXT, so the type name is
 * also the template's name — and it appears in five places at once:
 *   1. the "סוג דיון" dropdown column's label (the source of truth, on monday),
 *   2. the type template itself (TypeTemplate.discussionType),
 *   3. the per-type display color map (keyed by name),
 *   4. the `discussionType` assignment on standalone topic/participant templates,
 *   5. the per-type export-assets storage key (embeds the name).
 * Existing discussions need NO migration: a dropdown item stores the label ID, so
 * renaming the label re-labels every discussion of that type automatically.
 *
 * This module holds the pure parts — validation and the re-keying of each stored
 * shape — so the orchestration (TemplatesContext.renameDiscussionType) stays thin
 * and every rule here is unit-testable without storage or the monday API.
 */

const norm = (value) => String(value ?? '').trim();

/**
 * Can `oldName` be renamed to `newName`?
 * @returns {{ok:boolean, unchanged?:boolean, name?:string, error?:string|null}}
 *   ok:false ⇒ `error` is a Hebrew message for the user.
 *   ok:true + unchanged:true ⇒ nothing to do (same name).
 */
export function validateTypeRename({ oldName, newName, existingNames = [] } = {}) {
  const from = norm(oldName);
  const to = norm(newName);
  if (!from) return { ok: false, error: 'לא נבחר סוג דיון לשינוי שם' };
  if (!to) return { ok: false, error: 'שם סוג הדיון לא יכול להיות ריק' };
  if (to === from) return { ok: true, unchanged: true, name: to, error: null };
  const taken = (Array.isArray(existingNames) ? existingNames : [])
    .map(norm)
    .some((name) => name && name !== from && name.toLowerCase() === to.toLowerCase());
  if (taken) return { ok: false, error: `סוג דיון בשם "${to}" כבר קיים` };
  return { ok: true, unchanged: false, name: to, error: null };
}

/**
 * Re-key the TYPE templates (at most one per type). The renamed entry wins: a
 * stale entry already sitting on the target name is dropped, so the invariant
 * "one template per type" survives the rename.
 */
export function renameTypeTemplates(typeTemplates, oldName, newName) {
  const from = norm(oldName);
  const to = norm(newName);
  const list = (Array.isArray(typeTemplates) ? typeTemplates : []).filter(Boolean);
  if (!from || !to || from === to) return list;
  const source = list.find((t) => norm(t.discussionType) === from);
  if (!source) return list;
  return list
    .filter((t) => t === source || norm(t.discussionType) !== to)
    .map((t) => (t === source ? { ...t, discussionType: to } : t));
}

/**
 * Re-point the optional `discussionType` assignment on standalone topic /
 * participant templates. Returns a NEW array only when something changed, so the
 * caller can skip a needless storage write.
 */
export function renameTypeInAssignments(list, oldName, newName) {
  const from = norm(oldName);
  const to = norm(newName);
  const items = (Array.isArray(list) ? list : []).filter(Boolean);
  if (!from || !to || from === to) return { list: items, changed: false };
  let changed = false;
  const next = items.map((t) => {
    if (norm(t.discussionType) !== from) return t;
    changed = true;
    return { ...t, discussionType: to };
  });
  return { list: next, changed };
}

/** Move a type's display color to the new name (no-op when it has none). */
export function renameTypeColors(colors, oldName, newName) {
  const from = norm(oldName);
  const to = norm(newName);
  const next = { ...(colors && typeof colors === 'object' ? colors : {}) };
  if (!from || !to || from === to || !(from in next)) return next;
  next[to] = next[from];
  delete next[from];
  return next;
}
