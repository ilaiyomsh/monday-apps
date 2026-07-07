import { describe, it, expect } from 'vitest';
import { formatCost } from '../useProjectCosts';

/**
 * `formatCost` keeps the ILS currency identifier across languages — only the
 * locale (digits, separators, glyph order) follows the active UI culture.
 */
describe('formatCost (bilingual)', () => {
  it('he-IL renders RTL ILS currency form', () => {
    const result = formatCost(12345, 'he-IL');
    // Both the digits and the ₪ glyph are present in some order.
    expect(result).toContain('12');
    expect(result).toMatch(/₪|ILS/);
  });

  it('en-US renders LTR ILS currency form', () => {
    const result = formatCost(12345, 'en-US');
    expect(result).toContain('12');
    // en-US tends to render "ILS" or "₪" — accept either.
    expect(result).toMatch(/ILS|₪/);
    // Specifically, the ILS appears at the start (LTR currency placement).
    expect(result.trim().startsWith('ILS') || result.trim().startsWith('₪')).toBe(true);
  });

  it('zero amount renders as "-" regardless of locale', () => {
    expect(formatCost(0, 'he-IL')).toBe('-');
    expect(formatCost(0, 'en-US')).toBe('-');
  });

  it('he-IL and en-US produce different strings for the same non-zero amount', () => {
    const heResult = formatCost(12345, 'he-IL');
    const enResult = formatCost(12345, 'en-US');
    expect(heResult).not.toBe(enResult);
  });
});
