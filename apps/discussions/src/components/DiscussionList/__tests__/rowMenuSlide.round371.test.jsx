import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const ROW_NAME = 'דיון לבדיקה';

/*
 * The row renders the date through fmtListDateCompact → fmtTimeLabel, so the value
 * must be what parseValue produces for a date column: a real Date carrying a
 * `hasTime` flag. A plain ISO string throws on d.getDate(), and a Date WITHOUT the
 * flag renders "11/08" with no time — which would quietly remove the very text the
 * ⋯ was overlapping.
 */
const withTime = (iso) => {
  const d = new Date(iso);
  d.hasTime = true;
  return d;
};

vi.mock('@generated/hooks/useDiscussions', () => ({
  useDiscussions: () => ({
    items: [{
      id: 'D1',
      name: ROW_NAME,
      // A DATE is the whole point: it is the element the ⋯ collided with.
      discussionDateID: withTime('2026-08-11T15:47:00'),
      discussionCreatorID: [],
      discussionLeadID: [],
    }],
    loading: false,
    refetching: false,
    loadingMore: false,
    cursor: null,
    loadMore: () => {},
    softDeleteDiscussion: () => ({ undo: () => {} }),
  }),
  useDiscussionMonths: () => ({ months: [], loading: false }),
}));

vi.mock('@generated/hooks/useStatusOptions.js', () => ({
  useStatusOptions: () => ({ options: [], colorById: {} }),
}));

import { DiscussionList } from '../DiscussionList.jsx';
import { SettingsContext } from '../../../contexts/SettingsContext.jsx';
import { DEFAULT_PERMISSIONS } from '../../../utils/mondayApi/boards.config.js';

/*
 * round371 (owner bug report, with screenshot) — while the delete confirmation is
 * on screen the ⋯ printed ON TOP of the row's "11/08 · 15:47".
 *
 * The row keeps the timestamp clear of the kebab by widening its right padding,
 * and CSS turns that on for three states: `:hover`, `:focus-within`, and — added
 * in this round — `:has(.kebabBtnOpen)`. The first two both go false the instant
 * the menu opens and the pointer travels to מחק, because the menu is PORTALED to
 * document.body: it is not inside `.itemWrap`, so neither the hover nor the focus
 * is on the row any more.
 *
 * jsdom has no layout and no `:has()` evaluation, so what is asserted here is the
 * HOOK the CSS hangs on: `.kebabBtnOpen` must be present on the trigger for the
 * whole life of the menu, confirm step included. If it were dropped (or only set
 * on the first step), the selector would have nothing to match and the overlap
 * would come straight back.
 */
function renderList() {
  const permissions = DEFAULT_PERMISSIONS;
  return render(
    <SettingsContext.Provider value={{
      settings: { permissions },
      permissions,
      isConfigured: true,
      isLoading: false,
      updateSettings: async () => null,
    }}>
      <DiscussionList
        onSelect={() => {}}
        onEdit={() => {}}
        onExport={() => {}}
        onDelete={() => {}}
        onDuplicate={() => {}}
        onCopyLink={() => {}}
        canManageSettings
        currentUser={null}
      />
    </SettingsContext.Provider>
  );
}

const kebab = () => screen.getByRole('button', { name: `פעולות עבור ${ROW_NAME}` });

describe('round371 — the row slide survives the whole ⋯ menu, confirm included', () => {
  it('marks the trigger open as soon as the menu opens', () => {
    renderList();
    expect(kebab().className).not.toMatch(/kebabBtnOpen/);
    fireEvent.click(kebab());
    expect(kebab().className).toMatch(/kebabBtnOpen/);
  });

  it('KEEPS the open marker while "למחוק את הדיון?" is showing', () => {
    renderList();
    fireEvent.click(kebab());
    fireEvent.click(screen.getByRole('menuitem', { name: 'מחיקה' }));
    // the confirm step replaced the action list…
    expect(screen.getByText('למחוק את הדיון?')).toBeInTheDocument();
    // …and the row still carries the marker the slide selector needs
    expect(kebab().className).toMatch(/kebabBtnOpen/);
  });

  it('still open after backing out of the confirm with ביטול', () => {
    renderList();
    fireEvent.click(kebab());
    fireEvent.click(screen.getByRole('menuitem', { name: 'מחיקה' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'ביטול' }));
    expect(screen.getByRole('menuitem', { name: 'מחיקה' })).toBeInTheDocument();
    expect(kebab().className).toMatch(/kebabBtnOpen/);
  });

  it('drops the marker once the menu closes', () => {
    renderList();
    fireEvent.click(kebab());
    expect(kebab().className).toMatch(/kebabBtnOpen/);
    fireEvent.click(kebab()); // toggle shut
    expect(kebab().className).not.toMatch(/kebabBtnOpen/);
  });

  it('the trigger and the timestamp live in the SAME .itemWrap — what :has() needs', () => {
    renderList();
    fireEvent.click(kebab());
    // The selector is `.itemWrap:has(.kebabBtnOpen) .item`, so the open trigger and
    // the padded row must share one ancestor. Walk up from the trigger and require
    // that the ancestor also holds the date text.
    let wrap = kebab().parentElement;
    while (wrap && !/itemWrap/.test(wrap.className || '')) wrap = wrap.parentElement;
    expect(wrap).toBeTruthy();
    expect(wrap.textContent).toMatch(/15:47/);
  });
});
