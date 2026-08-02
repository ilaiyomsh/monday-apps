import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/*
 * round314 (owner request) — the three panes of ניהול הדיון carry OWNER-SET names
 * (Settings → העדפות), instead of the hardcoded רקע / התייחסויות / סיכום.
 *
 * Two halves are tested together on purpose: the pure resolver (what a stored value
 * means) and the tab band that consumes it (that a rename actually reaches the UI).
 * A resolver test alone would have passed against the version that still hardcoded
 * the titles.
 */

const emptyPane = { html: '', loading: false, author: null, updatedAt: null, save: async () => true, saveErrorCode: null };
vi.mock('@generated/hooks/useBackground.js', () => ({ useBackground: () => emptyPane }));
vi.mock('@generated/hooks/useReferences.js', () => ({ useReferences: () => emptyPane }));
vi.mock('@generated/hooks/useSummary.js', () => ({ useSummary: () => emptyPane }));
vi.mock('@generated/utils/backgroundStore.js', () => ({ loadBackgroundLinks: async () => [], saveBackgroundLinks: () => {} }));
vi.mock('@api/itemFiles.js', () => ({ getItemFiles: async () => [] }));
vi.mock('@api/board-config-store.js', () => ({ getColumns: () => ({}), getBoardId: () => '1' }));
vi.mock('@api/monday-client.js', () => ({ monday: { execute: async () => {} } }));
vi.mock('@generated/utils/lazyRetry.js', () => ({ default: (fn) => fn }));
// The placeholder is surfaced as an attribute so the last test can prove a rename
// leaves it untouched (the real editor renders it internally).
vi.mock('@components/RichTextEditor', () => ({ default: ({ onReady, placeholder }) => { onReady?.('<p></p>'); return <div data-testid="rte" data-placeholder={placeholder || ''} />; } }));
vi.mock('@components/BrandLoader', () => ({ BrandLoader: () => <div data-testid="loader" /> }));

import { UpdatesTripleBox } from '../UpdatesTripleBox.jsx';
import { SettingsContext } from '@generated/contexts/SettingsContext.jsx';
import { resolveBoxLabels, BOX_LABEL_KEYS, DEFAULT_PREFERENCES, DEFAULT_PERMISSIONS } from '@api/boards.config.js';

// Only `settings` is read by the box; the rest of the shape keeps the context honest.
const withPrefs = (preferences) => ({
  settings: preferences ? { preferences } : null,
  permissions: DEFAULT_PERMISSIONS,
  isConfigured: true,
  isLoading: false,
  updateSettings: async () => null,
});

const mount = (preferences) => render(
  <SettingsContext.Provider value={withPrefs(preferences)}>
    <UpdatesTripleBox discussionId="D1" canEdit />
  </SettingsContext.Provider>,
);

const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent.trim());

describe('resolveBoxLabels — what a stored box name means', () => {
  it('returns the shipped names when nothing is stored', () => {
    expect(resolveBoxLabels(undefined)).toEqual({ background: 'רקע', references: 'התייחסויות', summary: 'סיכום' });
    expect(resolveBoxLabels(null)).toEqual({ background: 'רקע', references: 'התייחסויות', summary: 'סיכום' });
    expect(resolveBoxLabels({})).toEqual({ background: 'רקע', references: 'התייחסויות', summary: 'סיכום' });
  });

  it('lets a stored name win, per key, leaving the untouched keys on their default', () => {
    expect(resolveBoxLabels({ boxLabels: { references: 'הערות הצוות' } })).toEqual({
      background: 'רקע', references: 'הערות הצוות', summary: 'סיכום',
    });
  });

  it('renames all three independently', () => {
    expect(resolveBoxLabels({ boxLabels: { background: 'א', references: 'ב', summary: 'ג' } })).toEqual({
      background: 'א', references: 'ב', summary: 'ג',
    });
  });

  it('falls back to the default for a blank or whitespace-only name (a nameless tab is unusable)', () => {
    const out = resolveBoxLabels({ boxLabels: { background: '', references: '   ', summary: '\n\t' } });
    expect(out).toEqual({ background: 'רקע', references: 'התייחסויות', summary: 'סיכום' });
  });

  it('falls back to the default for a non-string that survived a bad write', () => {
    const out = resolveBoxLabels({ boxLabels: { background: 7, references: null, summary: { a: 1 } } });
    expect(out).toEqual({ background: 'רקע', references: 'התייחסויות', summary: 'סיכום' });
  });

  it('trims the stored name so a stray space cannot shift the tab band', () => {
    expect(resolveBoxLabels({ boxLabels: { background: '  סקירה  ' } }).background).toBe('סקירה');
  });

  it('always returns exactly the three known keys', () => {
    expect(Object.keys(resolveBoxLabels({ boxLabels: { nope: 'x' } })).sort()).toEqual([...BOX_LABEL_KEYS].sort());
  });

  it('ships the original names as the defaults, so an untouched instance reads as before', () => {
    expect(DEFAULT_PREFERENCES.boxLabels).toEqual({ background: 'רקע', references: 'התייחסויות', summary: 'סיכום' });
  });
});

describe('the ניהול-דיון tab band uses the owner-set names', () => {
  it('shows the shipped names when the owner never renamed anything', async () => {
    mount(undefined);
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(3));
    expect(tabNames()).toEqual(['רקע', 'התייחסויות', 'סיכום']);
  });

  it('shows the renamed titles instead of the hardcoded ones', async () => {
    mount({ boxLabels: { background: 'סקירה', references: 'הערות', summary: 'החלטות שהתקבלו' } });
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(3));
    expect(tabNames()).toEqual(['סקירה', 'הערות', 'החלטות שהתקבלו']);
  });

  it('renames one pane without touching the other two', async () => {
    mount({ boxLabels: { summary: 'מה סוכם' } });
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(3));
    expect(tabNames()).toEqual(['רקע', 'התייחסויות', 'מה סוכם']);
  });

  it('falls back to the shipped name for a pane the owner cleared', async () => {
    mount({ boxLabels: { background: '  ', references: 'הערות' } });
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(3));
    expect(tabNames()).toEqual(['רקע', 'הערות', 'סיכום']);
  });

  it('keeps the pane KEYS (and therefore the stored content) independent of the names', async () => {
    const { container } = mount({ boxLabels: { background: 'סקירה', references: 'הערות', summary: 'מה סוכם' } });
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(3));
    // Three panes, one visible — the rename is display-only and cannot drop a pane.
    const wraps = container.querySelectorAll('.paneWrap');
    expect(wraps.length).toBe(3);
    expect([...wraps].filter((w) => w.style.display !== 'none').length).toBe(1);
  });

  it('leaves the editor placeholders alone — they explain what to write, which a rename does not change', async () => {
    mount({ boxLabels: { background: 'סקירה' } });
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(3));
    expect(screen.getByRole('tab', { name: 'סקירה' })).toBeTruthy();
    const holders = [...document.querySelectorAll('[data-testid="rte"]')].map((n) => n.getAttribute('data-placeholder'));
    expect(holders).toContain('כתבו כאן רקע והכנה לדיון…');
  });
});
