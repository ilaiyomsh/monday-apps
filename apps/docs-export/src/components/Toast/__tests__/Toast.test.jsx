/**
 * Characterization tests for ToastContainer.
 *
 * WHAT IS OBSERVABLE IN JSDOM (and therefore what these tests assert on):
 * @vibe/core's Toast exposes `data-testid="toast"` per toast,
 * `data-testid="toast-close-button"` only when `closeable`,
 * `data-testid="toast-button"` per entry in `actions`, and it really does run the
 * `autoHideDuration` timer — so the duration mapping is asserted BEHAVIOURALLY
 * (fake timers + onRemove) rather than by reading a prop.
 *
 * The one thing with no semantic handle is the `type` mapping: @vibe/core renders
 * it as a hashed CSS-module class (`typeNegative_de6ff…`). The tests below match
 * that class prefix and say so explicitly — it is the only observable trace of
 * TYPE_MAP in jsdom, and a wrong mapping is exactly the regression worth catching
 * (an error rendered as `positive` is a green "success" toast for a failure).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../../../i18n';
import { ToastContainer } from '../Toast';

const DEFAULT_DURATION_MS = 3000;

function toast(overrides = {}) {
  return {
    id: 't1',
    message: 'הדוח הופק',
    type: 'success',
    duration: DEFAULT_DURATION_MS,
    errorDetails: null,
    ...overrides,
  };
}

const toastEls = () => screen.queryAllByTestId('toast');

afterEach(() => {
  vi.useRealTimers();
});

describe('rendering the queue', () => {
  it('renders one toast per queue entry, in order, with its message', () => {
    render(
      <ToastContainer
        toasts={[
          toast({ id: 't1', message: 'מפיק דוח…', type: 'loading', duration: 0 }),
          toast({ id: 't2', message: 'הדוח הופק והורד', type: 'success' }),
          toast({ id: 't3', message: 'אירעה שגיאה', type: 'error' }),
        ]}
        onRemove={vi.fn()}
      />
    );

    expect(toastEls().map((el) => el.textContent)).toEqual([
      // The loading toast prefixes an aria-hidden hourglass.
      '⏳מפיק דוח…',
      'הדוח הופק והורד',
      'אירעה שגיאה',
    ]);
  });

  it('renders nothing when the queue is empty (and tolerates an omitted toasts prop)', () => {
    const { rerender } = render(<ToastContainer toasts={[]} onRemove={vi.fn()} />);
    expect(toastEls()).toHaveLength(0);

    rerender(<ToastContainer onRemove={vi.fn()} />);
    expect(toastEls()).toHaveLength(0);
  });

  it('maps each useToast type onto the matching @vibe/core toast type', () => {
    render(
      <ToastContainer
        toasts={[
          toast({ id: 't1', type: 'success' }),
          toast({ id: 't2', type: 'error' }),
          toast({ id: 't3', type: 'warning' }),
          toast({ id: 't4', type: 'info' }),
          toast({ id: 't5', type: 'loading' }),
          toast({ id: 't6', type: 'not-a-known-type' }),
        ]}
        onRemove={vi.fn()}
      />
    );

    // @vibe/core encodes the `type` prop ONLY as a hashed CSS-module class, so the
    // class prefix is the sole observable in jsdom.
    const vibeType = (el) =>
      Array.from(el.classList)
        .find((c) => c.startsWith('type'))
        ?.replace(/_.*$/, '');

    expect(toastEls().map(vibeType)).toEqual([
      'typePositive',
      'typeNegative',
      'typeWarning',
      'typeNormal',
      'typeNormal',
      // Unknown types fall back to 'normal' rather than crashing.
      'typeNormal',
    ]);
  });

  it('shows the status icon only on error toasts', () => {
    render(
      <ToastContainer
        toasts={[toast({ id: 't1', type: 'error' }), toast({ id: 't2', type: 'success' })]}
        onRemove={vi.fn()}
      />
    );

    // The status icon is a direct child wrapper of the toast root (the close
    // button's icon is nested inside the button, so :scope keeps them apart).
    const [errorToast, successToast] = toastEls();
    expect(errorToast.querySelector(':scope > div[class^="icon_"]')).not.toBeNull();
    expect(successToast.querySelector(':scope > div[class^="icon_"]')).toBeNull();
  });
});

describe('error details action', () => {
  it('renders a details action for an error toast carrying errorDetails and passes them through on click', async () => {
    const user = userEvent.setup();
    const onShowErrorDetails = vi.fn();
    const errorDetails = { module: 'ReportView', message: 'export_failed', correlationId: 'log_9' };

    render(
      <ToastContainer
        toasts={[toast({ type: 'error', message: 'אירעה שגיאה', errorDetails })]}
        onRemove={vi.fn()}
        onShowErrorDetails={onShowErrorDetails}
      />
    );

    const action = screen.getByTestId('toast-button');
    expect(action).toHaveTextContent('פרטים');

    await user.click(action);

    expect(onShowErrorDetails).toHaveBeenCalledTimes(1);
    // The SAME details object, not a copy — ErrorDetailsModal reads the stack off it.
    expect(onShowErrorDetails).toHaveBeenCalledWith(errorDetails);
  });

  it('renders no action for a toast without errorDetails', () => {
    render(
      <ToastContainer
        toasts={[toast({ type: 'success', errorDetails: null })]}
        onRemove={vi.fn()}
        onShowErrorDetails={vi.fn()}
      />
    );

    expect(screen.queryByTestId('toast-button')).toBeNull();
  });

  it('renders no action when errorDetails exist but no onShowErrorDetails handler was passed', () => {
    render(
      <ToastContainer
        toasts={[toast({ type: 'error', errorDetails: { correlationId: 'log_9' } })]}
        onRemove={vi.fn()}
      />
    );

    expect(screen.queryByTestId('toast-button')).toBeNull();
  });

  it('gives each error toast its OWN details, not the last one in the queue', async () => {
    const user = userEvent.setup();
    const onShowErrorDetails = vi.fn();
    const first = { correlationId: 'log_1' };
    const second = { correlationId: 'log_2' };

    render(
      <ToastContainer
        toasts={[
          toast({ id: 't1', type: 'error', errorDetails: first }),
          toast({ id: 't2', type: 'error', errorDetails: second }),
        ]}
        onRemove={vi.fn()}
        onShowErrorDetails={onShowErrorDetails}
      />
    );

    await user.click(screen.getAllByTestId('toast-button')[0]);

    expect(onShowErrorDetails).toHaveBeenCalledWith(first);
  });
});

describe('closing and auto-hide', () => {
  it('calls onRemove with the toast id when its close button is used', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();

    render(
      <ToastContainer
        toasts={[toast({ id: 't1' }), toast({ id: 't2' })]}
        onRemove={onRemove}
      />
    );

    await user.click(screen.getAllByTestId('toast-close-button')[1]);

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('t2');
  });

  it('a loading toast is not closeable by the user', () => {
    render(
      <ToastContainer
        toasts={[toast({ id: 't1', type: 'loading', duration: 0 })]}
        onRemove={vi.fn()}
      />
    );

    expect(screen.queryByTestId('toast-close-button')).toBeNull();
  });

  it('auto-hides a normal toast exactly at its duration', () => {
    vi.useFakeTimers();
    const onRemove = vi.fn();

    render(<ToastContainer toasts={[toast({ id: 't1', duration: 5000 })]} onRemove={onRemove} />);

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(onRemove).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onRemove).toHaveBeenCalledWith('t1');
  });

  it(`falls back to ${DEFAULT_DURATION_MS}ms when the toast carries no duration`, () => {
    vi.useFakeTimers();
    const onRemove = vi.fn();

    render(
      <ToastContainer toasts={[toast({ id: 't1', duration: undefined })]} onRemove={onRemove} />
    );

    act(() => {
      vi.advanceTimersByTime(DEFAULT_DURATION_MS - 1);
    });
    expect(onRemove).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onRemove).toHaveBeenCalledWith('t1');
  });

  it('never auto-hides a loading toast — it waits for removeToast(id)', () => {
    vi.useFakeTimers();
    const onRemove = vi.fn();

    render(
      <ToastContainer
        toasts={[toast({ id: 't1', type: 'loading', duration: 0 })]}
        onRemove={onRemove}
      />
    );

    act(() => {
      vi.advanceTimersByTime(600000);
    });

    expect(onRemove).not.toHaveBeenCalled();
  });

  it('never auto-hides an explicit duration-0 toast even when it is not a loading toast', () => {
    vi.useFakeTimers();
    const onRemove = vi.fn();

    render(
      <ToastContainer
        toasts={[toast({ id: 't1', type: 'error', duration: 0 })]}
        onRemove={onRemove}
      />
    );

    act(() => {
      vi.advanceTimersByTime(600000);
    });

    expect(onRemove).not.toHaveBeenCalled();
  });

  it('does not throw when onRemove is omitted and the toast auto-hides', () => {
    vi.useFakeTimers();

    render(<ToastContainer toasts={[toast({ id: 't1', duration: 1000 })]} />);

    expect(() =>
      act(() => {
        vi.advanceTimersByTime(1000);
      })
    ).not.toThrow();
  });
});
