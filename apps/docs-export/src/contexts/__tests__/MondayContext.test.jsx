/**
 * Characterization tests for MondayProvider.
 *
 * Scope is deliberate: the two mechanisms that regress silently.
 *   - the 4s WATCHDOG, which is the only reason the app renders a "not inside
 *     monday" state instead of an eternal spinner, and which must NEVER stomp a
 *     real context that already arrived (mobile delivers context via listen()
 *     only, sometimes after the get() resolves empty);
 *   - the serialized-DIFF GUARD, which drops monday's identical context re-emits.
 *     Without it every effect keyed on `context` re-runs several times a second.
 *
 * The three collaborators are mocked so the emissions can be driven precisely:
 * services/monday-sdk (get/listen), @mapps/error-kit/browser (setAxiomContext),
 * utils/logger (so the warn ARGUMENTS are assertable and nothing prints).
 * Context payloads come from the dev-harness fixtures — the shapes the live SDK
 * actually delivers (string user/account ids, numeric boardId/instanceId).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { CONTEXTS } from '../../dev-harness/fixtures';
import { MondayProvider, useMonday } from '../MondayContext';
import { setAxiomContext } from '@mapps/error-kit/browser';
import logger from '../../utils/logger';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  listen: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('../../services/monday-sdk', () => ({
  monday: { get: mocks.get, listen: mocks.listen },
  default: { get: mocks.get, listen: mocks.listen },
  API_VERSION: '2026-04',
}));

vi.mock('@mapps/error-kit/browser', () => ({ setAxiomContext: vi.fn() }));

vi.mock('../../utils/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mirrors CONTEXT_TIMEOUT_MS in the source: a change there must surface as a
// failing boundary test rather than a silently longer spinner.
const CONTEXT_TIMEOUT_MS = 4000;

const BOARD_VIEW = CONTEXTS.board_view;

/** The listen('context') callback the provider registered. */
let emitContext;
/** Latest value the provider handed down, plus a render counter for the diff guard. */
let latest;
const renderSpy = vi.fn();

function Probe() {
  const value = useMonday();
  latest = value;
  renderSpy(value.context);
  return null;
}

function renderProvider() {
  return render(
    <MondayProvider>
      <Probe />
    </MondayProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  emitContext = undefined;
  latest = undefined;
  delete window.__mondayContext;
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
  document.body.className = '';

  // Default wiring: get() resolves EMPTY (the mobile / outside-iframe case) and
  // listen() captures the callback without emitting. Individual tests override.
  mocks.get.mockResolvedValue({ data: null });
  mocks.listen.mockImplementation((type, callback) => {
    if (type === 'context') emitContext = callback;
    return mocks.unsubscribe;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Mount and let the get() microtask settle. */
async function mount() {
  let utils;
  await act(async () => {
    utils = renderProvider();
  });
  return utils;
}

describe('watchdog', () => {
  it('installs {} once CONTEXT_TIMEOUT_MS passes with no context at all', async () => {
    await mount();

    expect(latest.context).toBeNull();

    act(() => {
      vi.advanceTimersByTime(CONTEXT_TIMEOUT_MS - 1);
    });
    expect(latest.context).toBeNull(); // still inside the window

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(latest.context).toEqual({});
    expect(latest.currentUser).toBeNull();
    expect(latest.isMobile).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('MondayContext', 'context_timeout_using_empty', {
      timeoutMs: CONTEXT_TIMEOUT_MS,
    });
  });

  it('does NOT overwrite a real context that arrived first, and does not warn', async () => {
    mocks.get.mockResolvedValue({ data: BOARD_VIEW });

    await mount();
    expect(latest.context).toEqual(BOARD_VIEW);

    act(() => {
      vi.advanceTimersByTime(CONTEXT_TIMEOUT_MS * 2);
    });

    expect(latest.context).toEqual(BOARD_VIEW);
    expect(logger.warn).not.toHaveBeenCalledWith(
      'MondayContext',
      'context_timeout_using_empty',
      expect.anything()
    );
  });

  it('does not overwrite a context that arrived via listen() after an empty get()', async () => {
    await mount();

    await act(async () => {
      emitContext({ data: BOARD_VIEW });
    });

    act(() => {
      vi.advanceTimersByTime(CONTEXT_TIMEOUT_MS * 2);
    });

    expect(latest.context).toEqual(BOARD_VIEW);
    expect(logger.warn).not.toHaveBeenCalledWith(
      'MondayContext',
      'context_timeout_using_empty',
      expect.anything()
    );
  });

  it('logs the initial fetch failure and still lets the watchdog install {}', async () => {
    const failure = new Error('bridge unavailable');
    mocks.get.mockRejectedValue(failure);

    await mount();

    expect(logger.warn).toHaveBeenCalledWith(
      'MondayContext',
      'initial_context_fetch_failed',
      failure
    );

    act(() => {
      vi.advanceTimersByTime(CONTEXT_TIMEOUT_MS);
    });
    expect(latest.context).toEqual({});
  });
});

describe('serialized-diff guard', () => {
  it('an identical repeated emit produces no further render', async () => {
    await mount();

    await act(async () => {
      emitContext({ data: BOARD_VIEW });
    });
    const rendersAfterFirst = renderSpy.mock.calls.length;

    // A DIFFERENT object with identical content — monday re-emits exactly this.
    await act(async () => {
      emitContext({ data: JSON.parse(JSON.stringify(BOARD_VIEW)) });
    });

    expect(renderSpy.mock.calls.length).toBe(rendersAfterFirst);
  });

  it('a genuinely changed context does produce exactly one further render', async () => {
    await mount();

    await act(async () => {
      emitContext({ data: BOARD_VIEW });
    });
    const rendersAfterFirst = renderSpy.mock.calls.length;

    await act(async () => {
      emitContext({ data: { ...BOARD_VIEW, theme: 'dark' } });
    });

    expect(renderSpy.mock.calls.length).toBe(rendersAfterFirst + 1);
    expect(latest.context.theme).toBe('dark');
  });

  it('ignores an emit with no data instead of clearing the context', async () => {
    await mount();

    await act(async () => {
      emitContext({ data: BOARD_VIEW });
    });
    const rendersAfterFirst = renderSpy.mock.calls.length;

    await act(async () => {
      emitContext({ data: null });
      emitContext(undefined);
    });

    expect(latest.context).toEqual(BOARD_VIEW);
    expect(renderSpy.mock.calls.length).toBe(rendersAfterFirst);
  });

  it('accepts an unserializable (circular) context and reports why the guard is off', async () => {
    const circular = { ...BOARD_VIEW };
    circular.self = circular;

    await mount();
    await act(async () => {
      emitContext({ data: circular });
    });

    expect(latest.context).toBe(circular);
    expect(logger.warn).toHaveBeenCalledWith(
      'MondayContext',
      'context_not_serializable',
      expect.any(TypeError)
    );
  });
});

describe('setAxiomContext enrichment', () => {
  it('prefers account.id and boardId over their fallbacks', async () => {
    // Both branches present AND different, so the precedence is pinned.
    const context = {
      ...BOARD_VIEW,
      account: { id: '9999999' },
      accountId: 'FALLBACK-ACCOUNT',
      boardId: 1234567890,
      boardIds: [777000777],
      instanceId: 55555555,
    };
    mocks.get.mockResolvedValue({ data: context });

    await mount();

    expect(setAxiomContext).toHaveBeenCalledTimes(1);
    expect(setAxiomContext).toHaveBeenCalledWith({
      accountId: '9999999',
      userId: '11111111',
      boardId: 1234567890,
      instanceId: 55555555,
    });
  });

  it('falls back to accountId and boardIds[0] when the preferred fields are absent', async () => {
    const context = {
      ...CONTEXTS.dashboard_widget,
      account: undefined,
      accountId: 'ACC-FALLBACK',
    };
    mocks.get.mockResolvedValue({ data: context });

    await mount();

    expect(setAxiomContext).toHaveBeenCalledWith({
      accountId: 'ACC-FALLBACK',
      userId: '11111111',
      // dashboard_widget carries boardIds only — first entry wins.
      boardId: 1234567890,
      instanceId: 55555555,
    });
  });

  it('is not called at all when only the watchdog fired', async () => {
    await mount();
    act(() => {
      vi.advanceTimersByTime(CONTEXT_TIMEOUT_MS);
    });

    expect(setAxiomContext).not.toHaveBeenCalled();
  });
});

describe('locale and theme side effects', () => {
  it("sets dir=rtl and lang=he for a Hebrew user", async () => {
    mocks.get.mockResolvedValue({ data: BOARD_VIEW }); // currentLanguage: 'he'

    await mount();

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('he');
  });

  it("sets dir=ltr and lang=en for an English user", async () => {
    mocks.get.mockResolvedValue({
      data: { ...BOARD_VIEW, user: { ...BOARD_VIEW.user, currentLanguage: 'en' } },
    });

    await mount();

    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('leaves dir untouched when the context carries no language', async () => {
    document.documentElement.setAttribute('dir', 'rtl'); // index.html's default
    mocks.get.mockResolvedValue({ data: { ...BOARD_VIEW, user: { id: '11111111' } } });

    await mount();

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });

  it('puts the theme class on document.body and swaps it on a theme change', async () => {
    mocks.get.mockResolvedValue({ data: BOARD_VIEW }); // theme: 'light'

    await mount();
    expect(document.body.classList.contains('light-app-theme')).toBe(true);

    await act(async () => {
      emitContext({ data: { ...BOARD_VIEW, theme: 'night' } });
    });

    expect(document.body.classList.contains('night-app-theme')).toBe(true);
    expect(document.body.classList.contains('light-app-theme')).toBe(false);
  });

  it('exposes the raw context on window.__mondayContext for console debugging', async () => {
    mocks.get.mockResolvedValue({ data: BOARD_VIEW });

    await mount();

    expect(window.__mondayContext).toEqual(BOARD_VIEW);
  });
});

describe('derived value', () => {
  it('reports isMobile only for mode === "mobile" and passes the user through', async () => {
    mocks.get.mockResolvedValue({ data: { ...BOARD_VIEW, mode: 'mobile' } });

    await mount();

    expect(latest.isMobile).toBe(true);
    expect(latest.currentUser).toEqual(BOARD_VIEW.user);
  });

  it('reports isMobile false for a desktop context', async () => {
    mocks.get.mockResolvedValue({ data: BOARD_VIEW });

    await mount();

    expect(latest.isMobile).toBe(false);
  });
});

describe('teardown', () => {
  it('clears the watchdog timer and unsubscribes from listen() on unmount', async () => {
    const utils = await mount();

    expect(vi.getTimerCount()).toBe(1); // the watchdog is the only timer in play

    act(() => {
      utils.unmount();
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not throw on unmount when listen() returned no unsubscribe function', async () => {
    mocks.listen.mockImplementation((type, callback) => {
      if (type === 'context') emitContext = callback;
      return undefined;
    });

    const utils = await mount();

    expect(() => act(() => utils.unmount())).not.toThrow();
  });
});
