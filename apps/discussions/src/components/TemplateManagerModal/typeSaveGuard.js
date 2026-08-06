/*
 * round362 (owner, with screenshot) — the type editor's save gate required CONTENT
 * (a non-blank topic or a person in some role). A template-less type ("ללא תבנית —
 * הקליקו להגדרה") opens with one blank seeded topic row, so an owner who only
 * uploaded an export .docx — or only picked a color, or only flipped מחליט=מוביל —
 * left `canSave` false: the שמור button stayed disabled and the whole save was
 * silently skipped. That is why the export file "saved" on types that already had
 * a template and vanished on types that did not.
 *
 * The gate now accepts EITHER content OR an actual edit to one of the type's
 * template-independent facets (export template/assets, color, decider default).
 * Pure and separate from the component so the rule is testable.
 */

/**
 * @param {object} args
 * @param {object|null} args.draft the type editor draft (topics carry the blank seeded row)
 * @param {Array} args.lead / coordinator / participants — the three role pickers
 * @param {boolean} args.exportDirty the export sub-tab was edited (config or assets)
 * @param {string|null} args.colorDraft the color currently picked in the editor
 * @param {string|null} args.storedColor the color stored for this type (editor's entry value)
 * @param {boolean} args.deciderIsLead the editor's מחליט=מוביל toggle
 * @param {boolean} args.storedDeciderIsLead the stored value it opened with
 */
export function canSaveType({
  draft,
  lead,
  coordinator,
  participants,
  externalParticipants,
  exportDirty,
  colorDraft,
  storedColor,
  deciderIsLead,
  storedDeciderIsLead,
}) {
  if (!draft) return false;
  const hasContent =
    (draft.topics || []).some((t) => String(t?.name || '').trim()) ||
    (lead?.length || 0) > 0 ||
    (coordinator?.length || 0) > 0 ||
    (participants?.length || 0) > 0 ||
    // round367 — a type whose only content is its external participants still saves.
    (externalParticipants?.length || 0) > 0;
  const edited =
    exportDirty === true ||
    (colorDraft != null && colorDraft !== storedColor) ||
    (deciderIsLead === true) !== (storedDeciderIsLead === true);
  return hasContent || edited;
}

/**
 * The topics actually worth persisting: blank-name rows (including the seeded one)
 * are dropped, so an export-only save does not mint an empty agenda item.
 */
export function cleanTypeTopics(topics) {
  return (Array.isArray(topics) ? topics : [])
    .filter((t) => String(t?.name || '').trim())
    .map((t) => ({ name: t.name, points: (t.points || []).map((p) => p.text) }));
}
