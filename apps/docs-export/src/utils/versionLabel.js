// Version layer (docs/monday-cicd-spec.md): builds the ONE label shown to users
// (settings footer) and logged at app load, from vite's build-time constants
// (__APP_VERSION__ / __BUILD_SHA__ / __IS_RELEASE__, see vite.config.js). Kept
// in a single module so the call sites never drift.
export function getVersionLabel() {
  return __IS_RELEASE__
    ? `v${__APP_VERSION__}`
    : `v${__APP_VERSION__} · draft · ${__BUILD_SHA__.slice(0, 7)}`;
}
