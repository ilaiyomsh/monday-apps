export function buildVersionLabel({ version, buildSha, isRelease }) {
  const semanticVersion = String(version || '0.0.0').replace(/^v/, '');
  if (isRelease) return `v${semanticVersion}`;
  const shortSha = String(buildSha || '').trim().slice(0, 7) || 'local';
  return `v${semanticVersion}-draft+${shortSha}`;
}

export const VERSION_LABEL = buildVersionLabel({
  version: typeof __APP_VERSION__ === 'undefined' ? '0.0.0' : __APP_VERSION__,
  buildSha: typeof __BUILD_SHA__ === 'undefined' ? 'local' : __BUILD_SHA__,
  isRelease: typeof __IS_RELEASE__ === 'undefined' ? false : __IS_RELEASE__,
});
