import { describe, it, expect } from 'vitest';
import { withLogo, withoutLogo } from '../SettingsModal.jsx';
import { LOGO_MAX_PX } from '../../../utils/imageLogo.js';
import { DEFAULT_PREFERENCES } from '../../../utils/mondayApi/boards.config.js';

/*
 * round307 — the logo the owner uploads in Settings → העדפות. It is stored on
 * preferences.logoUrl, which is PER INSTANCE (settings live under
 * discussions_settings_${instanceId}), so every discussions view carries its own —
 * that was the owner's requirement. These are the pure transitions behind the
 * upload row; the modal itself is not mounted here, matching how the other
 * preference helpers in this folder are tested.
 */

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('withLogo', () => {
  it('stores the data-URI on logoUrl', () => {
    expect(withLogo({}, DATA_URL)).toEqual({ logoUrl: DATA_URL });
  });

  it('replaces an existing logo', () => {
    expect(withLogo({ logoUrl: 'data:image/png;base64,OLD' }, DATA_URL).logoUrl).toBe(DATA_URL);
  });

  it('keeps every other preference untouched', () => {
    const prefs = { showMyTasks: true, defaultLayoutRatio: 0.6, visibleComponents: { x: false } };
    expect(withLogo(prefs, DATA_URL)).toEqual({ ...prefs, logoUrl: DATA_URL });
  });

  it('does NOT write a falsy value — a failed decode must not wipe the current logo', () => {
    const prefs = { logoUrl: DATA_URL };
    expect(withLogo(prefs, null).logoUrl).toBe(DATA_URL);
    expect(withLogo(prefs, '').logoUrl).toBe(DATA_URL);
    expect(withLogo(prefs, undefined).logoUrl).toBe(DATA_URL);
  });

  it('is pure — the input object is not mutated', () => {
    const prefs = { logoUrl: null };
    withLogo(prefs, DATA_URL);
    expect(prefs.logoUrl).toBeNull();
  });
});

describe('withoutLogo', () => {
  it('clears the logo to null, matching the unset default', () => {
    expect(withoutLogo({ logoUrl: DATA_URL }).logoUrl).toBeNull();
    expect(DEFAULT_PREFERENCES.logoUrl).toBeNull();
  });

  it('keeps every other preference untouched', () => {
    const prefs = { logoUrl: DATA_URL, showMyTasks: true };
    expect(withoutLogo(prefs)).toEqual({ logoUrl: null, showMyTasks: true });
  });

  it('is a no-op on preferences that never had a logo', () => {
    expect(withoutLogo({}).logoUrl).toBeNull();
  });
});

describe('the stored image stays small', () => {
  it('caps the long edge at 320px', () => {
    // The value rides inside the settings JSON, and SettingsGate BLOCKS RENDER on
    // that read — so an un-downscaled upload would slow every app boot for every
    // user of the instance. 320px is already >2x the 190x56 box the splash paints.
    expect(LOGO_MAX_PX).toBe(320);
    expect(LOGO_MAX_PX).toBeLessThanOrEqual(512);
  });
});
