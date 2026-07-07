import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { FilterDropdown } from '../FilterDropdown';

// Inert useGantt mock so FilterDropdown can mount without the full provider tree.
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
 * The popover positions itself using `left` (computed from the trigger's start
 * edge in either reading direction) and clamps to stay inside the viewport.
 * This prevents it from being clipped by narrow iframe parents in RTL.
 */
describe('FilterDropdown — popover position stays inside the viewport', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  const openAndGetPopover = async () => {
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: /סינון|Filter/ });
    await act(async () => {
      await user.click(trigger);
    });
    // The popover renders into document.body via createPortal with inline
    // position: fixed. Find it by that style.
    const popover = Array.from(document.body.querySelectorAll<HTMLElement>('div'))
      .find(el => el.style.position === 'fixed' && el.style.top !== '');
    expect(popover).toBeTruthy();
    return popover!;
  };

  it('he (RTL): popover uses `left` (not `right`) and stays within viewport', async () => {
    await act(async () => {
      await i18n.changeLanguage('he');
    });
    render(<FilterDropdown />);
    const popover = await openAndGetPopover();
    expect(popover.style.left).not.toBe('');
    expect(popover.style.right).toBe('');
    const leftPx = parseInt(popover.style.left, 10);
    expect(leftPx).toBeGreaterThanOrEqual(0);
    expect(leftPx + 260).toBeLessThanOrEqual(window.innerWidth);
  });

  it('en (LTR): popover uses `left` and stays within viewport', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    render(<FilterDropdown />);
    const popover = await openAndGetPopover();
    expect(popover.style.left).not.toBe('');
    expect(popover.style.right).toBe('');
    const leftPx = parseInt(popover.style.left, 10);
    expect(leftPx).toBeGreaterThanOrEqual(0);
    expect(leftPx + 260).toBeLessThanOrEqual(window.innerWidth);
  });
});
