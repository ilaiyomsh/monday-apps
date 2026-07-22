// Shared lifecycle-kind knowledge for the lifecycle wiring scripts
// (resolve-lifecycle-features.mjs + register-lifecycle-subscriptions.mjs).
//
// ALL lifecycle event actions per feature kind. Live-verified against the
// server enum on 2026-07-19 (probed via an invalid enum value, which echoes
// the full accepted list in its error message) — the docs list was stale
// for AppFeatureObject, missing `hard_delete` and `multiple_duplicate`.
export const EVENTS_BY_KIND = {
  AppFeatureObject: [
    'create',
    'delete',
    'hard_delete',
    'archive',
    'restore',
    'duplicate',
    'multiple_duplicate',
    'import',
    'update_attributes',
    'publish',
    'unpublish',
  ],
  AppFeatureBoardView: ['duplicate', 'delete', 'restore'],
  AppFeatureBoardColumnExtension: ['duplicate', 'export', 'delete'],
  AppFeatureColumn: ['create', 'delete', 'board_deleted', 'board_restored'],
};

// Map the concrete feature `type` reported by `mapps app-features:list` to
// the kind the lifecycle-subscription API expects, or null when the surface
// has no lifecycle events at all (dialogs, item views, integrations, …).
//
// Column subtypes are the one known divergence: the manifest/CLI report the
// specific type (e.g. AppFeaturePeopleColumn for team-people-column), but the
// lifecycle enum only has the generic AppFeatureColumn bucket (verified
// 2026-07-19 against team-people-column). AppFeatureBoardColumnExtension is
// NOT part of that bucket — it has its own event set above.
export function lifecycleKindFor(featureType) {
  if (Object.prototype.hasOwnProperty.call(EVENTS_BY_KIND, featureType)) {
    return featureType;
  }
  if (/^AppFeature\w+Column$/.test(featureType)) return 'AppFeatureColumn';
  return null;
}
