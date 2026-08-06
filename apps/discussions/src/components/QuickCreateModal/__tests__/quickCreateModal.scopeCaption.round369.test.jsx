import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@generated/components/PersonPicker', () => ({ PersonPicker: () => <div data-testid="person-picker" /> }));
vi.mock('@generated/components/DatePickerPopover', () => ({ DatePickerPopover: () => <div data-testid="date-picker" /> }));

import { QuickCreateModal } from '../QuickCreateModal.jsx';

/*
 * round369 (owner request) — "תוריד את החלק המיותר שבו כתוב בפופאפ הזה משויך
 * לנקודה". A POINT-scoped open renders NO scope caption: the user reached this
 * card by clicking that very point's "+", so the line only repeats the click and
 * costs a row in an already-tight card.
 *
 * The discussion caption is a DIFFERENT case and must survive: the non-scoped
 * (FAB) open has no implied target, so "דיון: <name>" still tells the user where
 * the product will land.
 */
const POINT = { id: 'p1', name: 'תקציב רבעון שלישי' };
const DISCUSSION = { name: 'ישיבת הנהלה' };

describe('round369 — the point-scoped quick-create card drops the scope caption', () => {
  it('renders no "משויך לנקודה" line for a point-scoped open', () => {
    render(
      <QuickCreateModal open initialMode="task" scopedPoint={POINT} discussion={DISCUSSION}
        onClose={() => {}} onCreate={() => {}} />
    );
    expect(screen.queryByText(/משויך לנקודה/)).toBeNull();
    expect(screen.queryByText(POINT.name)).toBeNull();
  });

  it('renders no caption at all when scoped — not even the discussion fallback', () => {
    render(
      <QuickCreateModal open initialMode="task" scopedPoint={POINT} discussion={DISCUSSION}
        onClose={() => {}} onCreate={() => {}} />
    );
    expect(screen.queryByText(`דיון: ${DISCUSSION.name}`)).toBeNull();
  });

  it('still shows the discussion caption on a NON-scoped open', () => {
    render(
      <QuickCreateModal open initialMode="task" scopedPoint={null} discussion={DISCUSSION}
        onClose={() => {}} onCreate={() => {}} />
    );
    expect(screen.getByText(`דיון: ${DISCUSSION.name}`)).toBeInTheDocument();
  });
});
