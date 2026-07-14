// Version layer (docs/monday-cicd-spec.md): build-time constants injected by
// vite.config.ts. One label, computed once, shown in Settings and logged at boot.
export const versionLabel: string = __IS_RELEASE__
  ? `v${__APP_VERSION__}`
  : `v${__APP_VERSION__} · draft · ${__BUILD_SHA__.slice(0, 7)}`;
