import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { useLocale } from '../../../hooks/useLocale';
import { LOCALE_TABLE } from '../../../utils/locale-table';
import { FilterDropdown } from '../FilterDropdown';

// Inert useGantt mock so FilterDropdown can mount without the full provider
// tree — we're only verifying that `dir={locale.dir}` propagates to the
// popover, not exercising filter logic.
vi.mock('../../../hooks/useGantt', () => ({
  useGantt: () => ({
    timeframeFilter: [],
    setTimeframeFilter: vi.fn(),
    utilizationFilter: [],
    setUtilizationFilter: vi.fn(),
    hidePastAllocations: false,
    setHidePastAllocations: vi.fn(),
  }),
}));

/**
 * Direction contract for Increment 10:
 *   - he ⇒ document direction RTL, useLocale.dir === 'rtl', isRtl === true
 *   - en ⇒ document direction LTR, useLocale.dir === 'ltr', isLtr === true
 *   - timeline scroll container stays direction:'ltr' in both — verified by
 *     VirtualRowList.test.tsx (separate file).
 */

describe('Direction contract — Increment 10', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('he locale reports RTL across the board', () => {
    expect(LOCALE_TABLE.he.dir).toBe('rtl');
    expect(LOCALE_TABLE.he.isRtl).toBe(true);
    expect(LOCALE_TABLE.he.isLtr).toBe(false);
  });

  it('en locale reports LTR across the board (Increment 10 flip)', () => {
    expect(LOCALE_TABLE.en.dir).toBe('ltr');
    expect(LOCALE_TABLE.en.isLtr).toBe(true);
    expect(LOCALE_TABLE.en.isRtl).toBe(false);
  });

  it('useLocale().dir flips when language flips', async () => {
    const { result, rerender } = renderHook(() => useLocale());
    expect(result.current.dir).toBe('rtl');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    rerender();
    expect(result.current.dir).toBe('ltr');
    await act(async () => {
      await i18n.changeLanguage('he');
    });
    rerender();
    expect(result.current.dir).toBe('rtl');
  });
});

/**
 * Render-based dir-flip coverage (Finding 28). The Hebrew-inventory
 * snapshot tests catch text drift but not missing `dir={locale.dir}` on
 * portal-rendered popovers. This test mounts FilterDropdown under each
 * locale and asserts the popover's `dir` attribute follows along.
 */
describe('Render-based dir flip — FilterDropdown popover', () => {
  it('he: popover dir="rtl"', async () => {
    await act(async () => {
      await i18n.changeLanguage('he');
    });
    render(<FilterDropdown />);
    const user = userEvent.setup();
    const trigger = document.querySelector('button')!;
    await act(async () => {
      await user.click(trigger);
    });
    const popover = document.querySelector<HTMLElement>('[data-testid="filter-dropdown-popover"]');
    expect(popover).not.toBeNull();
    expect(popover!.getAttribute('dir')).toBe('rtl');
  });

  it('en: popover dir="ltr"', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    render(<FilterDropdown />);
    const user = userEvent.setup();
    const trigger = document.querySelector('button')!;
    await act(async () => {
      await user.click(trigger);
    });
    const popover = document.querySelector<HTMLElement>('[data-testid="filter-dropdown-popover"]');
    expect(popover).not.toBeNull();
    expect(popover!.getAttribute('dir')).toBe('ltr');
  });
});
