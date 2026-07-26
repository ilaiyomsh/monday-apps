/*
 * round254 — WHICH export template wins for a given discussion.
 *
 * Three tiers, most-specific first (owner spec):
 *   1. own       — this discussion's ad-hoc override (edited/saved in the export
 *                  dialog, per discussion). Highest precedence.
 *   2. typeTpl   — the discussion TYPE's own export template (defined per
 *                  discussion type in the templates manager). Overrides the
 *                  system default when the discussion has a type that carries one.
 *   3. instance  — the system/instance default export template (Settings).
 *
 * Returns the first non-nullish tier, or null when none exists (callers then
 * seed the built-in DEFAULT_EXPORT_TEMPLATE). Pure — no storage, no seeding —
 * so the precedence is unit-testable on its own.
 */
export function resolveExportTemplate(own, typeTpl, instance) {
  if (own != null) return own;
  if (typeTpl != null) return typeTpl;
  if (instance != null) return instance;
  return null;
}

/**
 * The per-type export template for a discussion's type, or null.
 * @param typeTemplates array of TypeTemplate ({ discussionType, exportTemplate, ... })
 * @param typeName the discussion's type = the dropdown label TEXT (discussionTypeID)
 */
export function typeExportTemplateFor(typeTemplates, typeName) {
  if (!typeName || !Array.isArray(typeTemplates)) return null;
  const match = typeTemplates.find((t) => t && t.discussionType === typeName);
  return match?.exportTemplate ?? null;
}
