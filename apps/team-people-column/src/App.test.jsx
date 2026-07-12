// Routing test: App must render OnClickDialog for the column_view_click
// placement (context.placement === 'columnPickers') and ColumnSettings for
// column_view_settings (context.placement === 'settings'). What each child
// component renders internally is NOT under test here (that's their own
// concern) — only which one App mounts for a given monday context. Real
// dev-harness context fixtures are used (never hand-built), per test-guard's
// "real fixtures for monday-facing code" rule.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { harness } from './dev-harness/monday-sdk-stub.js';
import { CONTEXTS } from './dev-harness/fixtures.js';
import { installAppApiHandlers } from './test-utils/probeFixtures.js';
import App from './App';

describe('App routing by monday context placement', () => {
  beforeEach(() => {
    harness.reset();
    installAppApiHandlers(harness);
  });

  afterEach(() => {
    // vite.config.js's test block does not set `globals: true`, so RTL's
    // auto-detected `afterEach(cleanup)` never registers — without an
    // explicit cleanup() here, each render leaks into the next test's DOM
    // (observed: a later test finding the PREVIOUS test's "Column Settings"
    // heading still mounted).
    cleanup();
    harness.reset();
  });

  // Child-component identity markers (Hebrew — the app is RTL-only): the settings
  // pane's header vs the on-click dialog's unconfigured-state title.
  const SETTINGS_HEADING = 'הגדרות עמודת אנשי צוות';
  const ONCLICK_UNCONFIGURED = 'העמודה לא הוגדרה';

  it('mounts ColumnSettings (not OnClickDialog) for the column_view_settings placement', async () => {
    harness.setContext(CONTEXTS.column_view_settings);

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: SETTINGS_HEADING })
    ).toBeInTheDocument();
    // The on-click dialog's unconfigured title must NOT be mounted.
    expect(screen.queryByText(ONCLICK_UNCONFIGURED)).not.toBeInTheDocument();
  });

  it('mounts OnClickDialog (not ColumnSettings) for the column_view_click placement', async () => {
    harness.setContext(CONTEXTS.column_view_click);

    render(<App />);

    // No settings are seeded for this context, so OnClickDialog resolves to its
    // unconfigured state — that Hebrew title proves OnClickDialog, not the
    // settings pane, is the mounted child.
    expect(await screen.findByText(ONCLICK_UNCONFIGURED)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: SETTINGS_HEADING })).not.toBeInTheDocument();
  });

  it('shows the "not opened from a column" fallback when placement is absent', async () => {
    harness.setContext({ ...CONTEXTS.column_view_click, placement: undefined });

    render(<App />);

    expect(
      await screen.findByText('יש לפתוח רכיב זה מתוך עמודה ב-monday.com.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: SETTINGS_HEADING })).not.toBeInTheDocument();
    expect(screen.queryByText(ONCLICK_UNCONFIGURED)).not.toBeInTheDocument();
  });
});
