import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';

// Round-77 hook: right-click a group header → palette → shared color. Mock the
// storage layer so we can assert load-on-mount and save-on-pick without monday.
const { loadGroupColors, saveGroupColors } = vi.hoisted(() => ({
  loadGroupColors: vi.fn(async () => ({ g1: '#111111' })),
  saveGroupColors: vi.fn(async () => {}),
}));
vi.mock('../../utils/groupColors.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadGroupColors, saveGroupColors };
});
vi.mock('../../contexts/MondayContext.jsx', () => ({
  MondayContext: React.createContext({ context: { instanceId: 'inst-7' } }),
}));
vi.mock('../../utils/logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { useGroupColors } from '../useGroupColors.jsx';

// Harness renders the returned `menu` (a portal) so the palette DOM exists, and
// exposes the latest hook api via a captured ref.
let api;
function Harness() {
  api = useGroupColors();
  return <div>{api.menu}</div>;
}

const evt = (x = 10, y = 10) => ({ preventDefault() {}, stopPropagation() {}, clientX: x, clientY: y });

beforeEach(() => {
  loadGroupColors.mockClear();
  saveGroupColors.mockClear();
  loadGroupColors.mockResolvedValue({ g1: '#111111' });
  api = undefined;
});

describe('useGroupColors', () => {
  it('loads the shared override map on mount', async () => {
    render(<Harness />);
    await waitFor(() => expect(api.colorsByKey).toEqual({ g1: '#111111' }));
    expect(loadGroupColors).toHaveBeenCalledTimes(1);
  });

  it('picking a swatch after openMenuFor SAVES and optimistically updates the map', async () => {
    render(<Harness />);
    await waitFor(() => expect(api.colorsByKey).toEqual({ g1: '#111111' }));

    await act(async () => { api.openMenuFor('g2', evt()); });
    const swatch = document.querySelector('[aria-label^="צבע "]');
    expect(swatch).toBeTruthy();
    await act(async () => { swatch.click(); });

    await waitFor(() => expect(api.colorsByKey.g2).toBeTruthy());
    expect(saveGroupColors).toHaveBeenCalled();
    const savedArg = saveGroupColors.mock.calls.at(-1)[1];
    expect(savedArg.g1).toBe('#111111'); // keeps the existing override
    expect(savedArg.g2).toBe(api.colorsByKey.g2); // + the newly-picked one
  });

  it('"צבע אוטומטי" clears an override back to auto', async () => {
    render(<Harness />);
    await waitFor(() => expect(api.colorsByKey).toEqual({ g1: '#111111' }));

    await act(async () => { api.openMenuFor('g1', evt(5, 5)); });
    const clearBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'צבע אוטומטי');
    expect(clearBtn).toBeTruthy();
    await act(async () => { clearBtn.click(); });

    await waitFor(() => expect(api.colorsByKey.g1).toBeUndefined());
    expect(saveGroupColors).toHaveBeenCalled();
  });
});
