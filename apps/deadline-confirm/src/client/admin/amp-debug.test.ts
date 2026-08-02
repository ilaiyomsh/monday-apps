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

describe('defaultDebugSubject', () => {
  it('reuses the configured digest subject when there is one', () => {
    expect(defaultDebugSubject('המשימות שלך')).toBe('המשימות שלך');
  });

  it('falls back to a non-empty subject when the config has none', () => {
    expect(defaultDebugSubject('').length).toBeGreaterThan(0);
    expect(defaultDebugSubject(null).length).toBeGreaterThan(0);
  });
});
