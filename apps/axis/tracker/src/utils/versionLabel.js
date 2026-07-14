/**
 * versionLabel.js — single source for the human-readable version caption:
 * shown at the bottom of the Settings dialog and logged once at app boot.
 * Version layer — docs/monday-cicd-spec.md.
 */
export function getVersionLabel() {
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
  const sha = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'local';
  const isRelease = typeof __IS_RELEASE__ !== 'undefined' ? __IS_RELEASE__ : false;

  return isRelease ? `v${version}` : `v${version} · draft · ${sha.slice(0, 7)}`;
}
