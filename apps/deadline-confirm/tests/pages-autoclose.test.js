// v4 phase 1 (owner decision 2026-07-19): the SUCCESS page auto-closes
// ~2s after render (window.close + visible fallback). The invalid and
// bad-request pages stay JS-free — a human should read them.

import { describe, it, expect } from 'vitest';
import { successPage, invalidPage, badRequestPage } from '../src/helpers/pages.js';

describe('successPage auto-close', () => {
  it('carries an inline script that window.close()s after 2000ms', () => {
    const html = successPage('בוצע');
    expect(html).toMatch(/<script\b/);
    expect(html).toContain('window.close()');
    expect(html).toContain('2000');
  });

  it('shows a visible fallback for browsers that refuse to close', () => {
    const html = successPage('בוצע');
    expect(html).toContain('אפשר לסגור את החלון');
  });

  it('still renders the target label, escaped', () => {
    const html = successPage('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
});

describe('the other pages stay JS-free', () => {
  it('invalid + bad-request pages contain NO script', () => {
    expect(invalidPage()).not.toMatch(/<script\b/);
    expect(badRequestPage()).not.toMatch(/<script\b/);
  });
});
