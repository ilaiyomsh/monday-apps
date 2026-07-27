import { describe, expect, it } from 'vitest';
import { buildVersionLabel } from './versionLabel.js';

describe('buildVersionLabel', () => {
  it('shows only the semantic version for a live release', () => {
    expect(buildVersionLabel({ version: '2.1.0', buildSha: 'abcdef123', isRelease: true }))
      .toBe('v2.1.0');
  });

  it('identifies a draft build with a short immutable commit id', () => {
    expect(buildVersionLabel({ version: '2.1.0', buildSha: 'abcdef123', isRelease: false }))
      .toBe('v2.1.0-draft+abcdef1');
  });

  it('uses a safe local marker when the build SHA is absent', () => {
    expect(buildVersionLabel({ version: '2.1.0', buildSha: '', isRelease: false }))
      .toBe('v2.1.0-draft+local');
  });
});
