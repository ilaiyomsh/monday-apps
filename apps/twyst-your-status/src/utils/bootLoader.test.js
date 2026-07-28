import { describe, expect, it, beforeEach } from 'vitest';
import { BOOT_LOADER_ID, dismissBootLoader } from './bootLoader.js';

/**
 * The boot overlay is the ONE DOM node that must survive the whole boot: it is
 * declared in index.html so it paints before the JS bundle parses, and it is the
 * visual continuation of the spinner monday shows while the dialog iframe loads.
 * Re-creating it in React would restart the CSS animation mid-spin — the exact
 * jump this exists to remove — so the only operation on it is removal.
 */
function mountBootLoader() {
  document.body.innerHTML = `
    <div id="${BOOT_LOADER_ID}"><svg></svg></div>
    <div id="root"></div>
  `;
}

describe('dismissBootLoader', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('removes the boot overlay so the app underneath becomes visible', () => {
    mountBootLoader();
    expect(document.getElementById(BOOT_LOADER_ID)).not.toBeNull();

    dismissBootLoader();

    expect(document.getElementById(BOOT_LOADER_ID)).toBeNull();
  });

  it('leaves the rest of the document alone — only the overlay goes', () => {
    mountBootLoader();

    dismissBootLoader();

    expect(document.getElementById('root')).not.toBeNull();
  });

  it('is idempotent: two dismissers race on every boot (App and OnClickDialog)', () => {
    mountBootLoader();

    dismissBootLoader();
    expect(() => dismissBootLoader()).not.toThrow();
    expect(document.getElementById(BOOT_LOADER_ID)).toBeNull();
  });

  it('tolerates a document that never had the overlay (dev harness, tests)', () => {
    document.body.innerHTML = '<div id="root"></div>';

    expect(() => dismissBootLoader()).not.toThrow();
    expect(document.getElementById('root')).not.toBeNull();
  });
});
