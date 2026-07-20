import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub the heavy TipTap editor; capture its onReady/onChange so we can simulate
// typing and exercise the auto-save logic without ProseMirror in jsdom.
const cap = vi.hoisted(() => ({ onReady: null, onChange: null }));
vi.mock('@components/RichTextEditor', () => ({
  default: (props) => {
    cap.onReady = props.onReady;
    cap.onChange = props.onChange;
    return <div data-testid="rte">{props.initialValue}</div>;
  },
}));

const mockUseSummary = vi.fn();
vi.mock('@generated/hooks/useSummary.js', () => ({
  useSummary: (...args) => mockUseSummary(...args),
}));

import { SummaryTab } from '../SummaryTab';

const AUTOSAVE_DELAY = 1500;

async function flushLazy() {
  // let React.lazy resolve the (mocked) dynamic import + render the stub
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  cap.onReady = null;
  cap.onChange = null;
});
afterEach(() => { vi.useRealTimers(); });

describe('SummaryTab', () => {
  it('renders the editor + save button once loaded', async () => {
    mockUseSummary.mockReturnValue({
      html: '<p>סיכום קיים</p>', loading: false, author: 'דנה', updatedAt: '2026-01-02', save: vi.fn(),
    });
    render(<SummaryTab discussion={{ id: 'D1' }} />);
    expect(await screen.findByTestId('rte')).toHaveTextContent('סיכום קיים');
    // round183 — the box + save button reveal only once the editor reports ready
    // (the branded loader covers until then); simulate that readiness.
    act(() => { cap.onReady('<p>סיכום קיים</p>'); });
    expect(screen.getByRole('button', { name: 'שמור' })).toBeInTheDocument();
    expect(screen.getByText(/נערך לאחרונה/)).toBeInTheDocument();
  });

  it('shows a skeleton (no editor) while loading', () => {
    mockUseSummary.mockReturnValue({
      html: '', loading: true, author: null, updatedAt: null, save: vi.fn(),
    });
    render(<SummaryTab discussion={{ id: 'D1' }} />);
    expect(screen.queryByTestId('rte')).toBeNull();
    expect(screen.queryByRole('button', { name: 'שמור' })).toBeNull();
  });

  it('auto-saves (debounced) after an edit', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(true);
    mockUseSummary.mockReturnValue({ html: '', loading: false, author: null, updatedAt: null, save });
    render(<SummaryTab discussion={{ id: 'D1' }} />);
    await flushLazy();

    act(() => { cap.onReady('<p></p>'); });
    act(() => { cap.onChange('<p>שלום</p>'); });
    expect(save).not.toHaveBeenCalled(); // debounced, not immediate

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY + 100); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('<p>שלום</p>');
  });

  it('does not auto-save when nothing changed', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(true);
    mockUseSummary.mockReturnValue({ html: '<p>קיים</p>', loading: false, author: null, updatedAt: null, save });
    render(<SummaryTab discussion={{ id: 'D1' }} />);
    await flushLazy();

    act(() => { cap.onReady('<p>קיים</p>'); });
    act(() => { cap.onChange('<p>קיים</p>'); }); // same as baseline
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY + 100); });
    expect(save).not.toHaveBeenCalled();
  });

  it('the שמור button saves immediately (before the debounce)', async () => {
    const save = vi.fn().mockResolvedValue(true);
    mockUseSummary.mockReturnValue({ html: '', loading: false, author: null, updatedAt: null, save });
    render(<SummaryTab discussion={{ id: 'D1' }} />);
    await flushLazy();

    act(() => { cap.onReady('<p></p>'); });
    act(() => { cap.onChange('<p>מיידי</p>'); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'שמור' })); });
    expect(save).toHaveBeenCalledWith('<p>מיידי</p>');
  });

  it('shows unauthorized message near save controls when edit is forbidden', async () => {
    mockUseSummary.mockReturnValue({
      html: '<p>סיכום</p>',
      loading: false,
      author: null,
      updatedAt: null,
      save: vi.fn().mockResolvedValue(false),
      saveErrorCode: 'USER_UNAUTHORIZED',
    });
    render(<SummaryTab discussion={{ id: 'D1' }} />);
    await flushLazy();

    act(() => { cap.onReady('<p>סיכום</p>'); });
    act(() => { cap.onChange('<p>סיכום חדש</p>'); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'שמור' })); });

    expect(screen.getByText('אינך מורשה לערוך סיכום זה')).toBeInTheDocument();
  });
});
