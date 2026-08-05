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

/*
 * round304 — key-ORDER-insensitive comparison of two export-template configs.
 * The tiers are stored at different times by different screens, so the same
 * config can serialize with different key order; a plain JSON.stringify compare
 * would call identical templates different and defeat the checks below.
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** True when two export-template configs carry the same content. */
export function sameExportTemplate(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return canonicalJson(a) === canonicalJson(b);
}

/*
 * round304 — which own-template counts as a REAL per-discussion override.
 *
 * The export dialog used to persist the resolved template on EVERY "הפק מסמך",
 * so merely producing a document once froze a copy of whatever default was in
 * force at that moment — and that copy then shadowed the discussion type's
 * export template forever (the owner's report: a type's export template, and
 * especially its uploaded header/footer file, never reaching discussions of that
 * type). An own copy that is byte-identical to the tier it was seeded from
 * carries no customization, so it is treated as ABSENT and the type/instance
 * tier wins again. All three arguments must be seeded/normalized the same way
 * (run them through seedExportTemplate first) or the compare is meaningless.
 */
export function effectiveOwnTemplate(own, typeTpl, instance) {
  if (own == null) return null;
  if (sameExportTemplate(own, typeTpl)) return null;
  if (sameExportTemplate(own, instance)) return null;
  return own;
}

/**
 * round304 — does an asset bundle carry anything at all? Part of the same
 * precedence question: a type's ASSETS (its logos / uploaded header-footer .docx)
 * are used for a discussion of that type whenever they exist, independently of
 * whether the type also carries a template CONFIG — gating the file on the config
 * is what left a type's uploaded background unused.
 */
/*
 * round356 (owner spec) — the three asset FIELDS resolve INDEPENDENTLY, in the same
 * precedence the config uses (per-export edits -> the type -> the system default).
 *
 * They used to be picked as one bundle (own || type || global), so the first tier
 * holding anything discarded the rest: a header/footer .docx uploaded at the system
 * level was thrown away because the discussion's type happened to carry a logo, and
 * the export then rendered with NO headers at all (deliverDiscussionDocx needs both
 * headerMode==='upload' AND assets.templateDocx). Merging per field is what lets a
 * template file live at one tier and a logo at another.
 *
 * An empty/absent value is "nothing to contribute", never "override with nothing" —
 * clearing a logo on the type must not hide the system's template file.
 *
 * @param {...(object|null)} tiers highest precedence first
 * @returns {object|null} the merged assets, or null when no tier contributes
 */
export const EXPORT_ASSET_FIELDS = ['headerLogo', 'footerLogo', 'templateDocx'];

export function resolveExportAssets(...tiers) {
  const usable = tiers.filter((t) => t && typeof t === 'object');
  const out = {};
  EXPORT_ASSET_FIELDS.forEach((field) => {
    const tier = usable.find((t) => t[field]);
    if (tier) out[field] = tier[field];
  });
  return Object.keys(out).length ? out : null;
}

export function hasAssetContent(assets) {
  if (!assets || typeof assets !== 'object') return false;
  return Boolean(assets.headerLogo || assets.footerLogo || assets.templateDocx);
}

/**
 * round304 — persist a per-discussion override ONLY when the user actually
 * changed the template inside the dialog (compared against what it was seeded
 * with). Otherwise the discussion keeps following its type / the system default.
 */
export function shouldPersistOwnTemplate(seeded, current) {
  if (current == null) return false;
  return !sameExportTemplate(seeded, current);
}
