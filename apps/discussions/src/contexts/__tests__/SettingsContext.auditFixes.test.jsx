import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// Round-75 audit fix U-ctx: SettingsContext must reload when the resolved
// storage key changes. If the real monday context (with an instanceId) arrives
// AFTER the 4s watchdog installed an empty {} (which resolves to the 'default'
// key), the boolean latch would leave a configured board stuck on empty
// 'default' settings. The fix keys the latch on the storage key, not first
// non-null context, so a key change triggers a fresh load.
const getItem = vi.hoisted(() => vi.fn(async () => ({ data: { value: null } })));
vi.mock('../../utils/mondayApi/monday-client.js', () => ({
  monday: { storage: { getItem, setItem: vi.fn(async () => {}) } },
}));

let ctxValue = { context: null };
vi.mock('../MondayContext.jsx', () => ({
  useMondayContext: () => ctxValue,
}));
vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { SettingsProvider } from '../SettingsContext.jsx';

const keysLoaded = () => getItem.mock.calls.map((c) => c[0]);

beforeEach(() => { getItem.mockClear(); ctxValue = { context: null }; });

describe('SettingsContext — U-ctx: reload when the resolved storage key changes', () => {
  it('loads under the real instanceId key after the watchdog empty context loaded default', async () => {
    // First render: watchdog empty context → resolves to the 'default' key.
    ctxValue = { context: {} };
    const { rerender } = render(<SettingsProvider><div /></SettingsProvider>);
    await waitFor(() => expect(keysLoaded()).toContain('discussions_settings_default'));

    // The real context lands with an instanceId — MUST trigger a fresh load.
    ctxValue = { context: { instanceId: 'inst-42' } };
    rerender(<SettingsProvider><div /></SettingsProvider>);
    await waitFor(() => expect(keysLoaded()).toContain('discussions_settings_inst-42'));
  });

  it('does NOT reload when the context re-emits with the same instanceId', async () => {
    ctxValue = { context: { instanceId: 'inst-9' } };
    const { rerender } = render(<SettingsProvider><div /></SettingsProvider>);
    await waitFor(() => expect(keysLoaded()).toContain('discussions_settings_inst-9'));
    const countAfterFirst = getItem.mock.calls.length;

    // Same key on a re-render — no extra load.
    ctxValue = { context: { instanceId: 'inst-9' } };
    rerender(<SettingsProvider><div /></SettingsProvider>);
    await new Promise((r) => setTimeout(r, 0));
    expect(getItem.mock.calls.length).toBe(countAfterFirst);
  });
});
