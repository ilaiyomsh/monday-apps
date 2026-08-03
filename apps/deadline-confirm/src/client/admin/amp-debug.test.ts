// TDD — pure rules behind the AMP debug editor in DigestSection: how big the
// edited document is, when to warn, and which client-side guards stop a send
// before it leaves the browser.

import { describe, it, expect } from 'vitest';
import {
  AMP_PART_LIMIT_BYTES,
  ampByteLength,
  ampSizeWarning,
  validateRawSend,
  defaultDebugSubject,
  PART_ORDER_OPTIONS,
  DEFAULT_PART_ORDER,
  isPartOrder,
} from './amp-debug';

describe('ampByteLength', () => {
  it('counts UTF-8 BYTES, not characters (Hebrew is two bytes each)', () => {
    expect(ampByteLength('abc')).toBe(3);
    expect(ampByteLength('שלום')).toBe(8);
    expect(ampByteLength('')).toBe(0);
  });
});

describe('ampSizeWarning', () => {
  it('is silent at and below the Gmail AMP-part limit', () => {
    expect(ampSizeWarning('x'.repeat(AMP_PART_LIMIT_BYTES))).toBeNull();
    expect(ampSizeWarning('')).toBeNull();
  });

  it('warns above the limit and names the actual size', () => {
    const warning = ampSizeWarning('x'.repeat(AMP_PART_LIMIT_BYTES + 1));
    expect(warning).not.toBeNull();
    expect(warning).toContain('100');
  });
});

describe('validateRawSend', () => {
  it('accepts a filled document with a plausible address', () => {
    expect(validateRawSend({ amp: '<html>x</html>', to: 'dev@example.com' })).toBeNull();
  });

  it.each([
    ['empty document', { amp: '   ', to: 'dev@example.com' }],
    ['missing address', { amp: '<html>x</html>', to: '' }],
    ['address without @', { amp: '<html>x</html>', to: 'dev.example.com' }],
    ['address with a space', { amp: '<html>x</html>', to: 'dev @example.com' }],
    ['address with a header break', { amp: '<html>x</html>', to: 'a@b.com\nBcc: c@d.com' }],
  ])('rejects %s with a Hebrew message', (_label, input) => {
    const error = validateRawSend(input);
    expect(error).toBeTruthy();
    expect(error).toMatch(/[֐-׿]/);
  });
});

describe('PART_ORDER_OPTIONS', () => {
  // These values are sent verbatim to the server, which REFUSES anything it does
  // not recognize. A drifted string here surfaces as a 400 on a send the operator
  // believed was a valid variant, so the exact set is pinned.
  it('offers exactly the three orders the server accepts', () => {
    expect(PART_ORDER_OPTIONS.map((o) => o.value)).toEqual([
      'plain-amp-html',
      'plain-html-amp',
      'plain-amp',
    ]);
  });

  it('defaults to the production order, so a debug send is production-shaped unless changed', () => {
    expect(DEFAULT_PART_ORDER).toBe('plain-amp-html');
    expect(PART_ORDER_OPTIONS[0].value).toBe(DEFAULT_PART_ORDER);
  });

  it('labels every option with something a human can tell apart', () => {
    for (const option of PART_ORDER_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.label).toContain('plain');
    }
  });
});

describe('isPartOrder', () => {
  it('accepts every offered order', () => {
    for (const option of PART_ORDER_OPTIONS) expect(isPartOrder(option.value)).toBe(true);
  });

  it.each(['amp-first', '', 'plain', 'PLAIN-AMP-HTML'])('rejects %o', (value) => {
    expect(isPartOrder(value)).toBe(false);
  });
});

describe('defaultDebugSubject', () => {
  it('reuses the configured digest subject when there is one', () => {
    expect(defaultDebugSubject('המשימות שלך')).toBe('המשימות שלך');
  });

  it('falls back to a non-empty subject when the config has none', () => {
    expect(defaultDebugSubject('').length).toBeGreaterThan(0);
    expect(defaultDebugSubject(null).length).toBeGreaterThan(0);
  });
});
