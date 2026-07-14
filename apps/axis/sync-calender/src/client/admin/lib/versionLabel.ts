// Version layer (docs/monday-cicd-spec.md): build-time constants injected by
// vite.config.ts. One label, computed once, shown in the admin footer and
// logged at client boot. Mirrors apps/axis/planner/src/utils/versionLabel.ts.
export const versionLabel: string = __IS_RELEASE__
  ? `v${__APP_VERSION__}`
  : `v${__APP_VERSION__} · draft · ${__BUILD_SHA__.slice(0, 7)}`;
