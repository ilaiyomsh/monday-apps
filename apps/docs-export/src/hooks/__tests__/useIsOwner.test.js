/**
 * useIsOwner — the SETTINGS gate: is the current user an owner of the board this
 * view sits on?
 *
 * The behaviours that matter here are all about what happens when the answer is
 * NOT a clean "yes":
 *
 *   - The monday context arrives asynchronously. Until it does, the hook must stay
 *     LOADING — an early `false` would flash "you are not an owner" at the owner,
 *     and (worse) an early `true` would flash the settings surface at everyone.
 *   - The watchdog context `{}` (no monday around us) carries no boardId/userId.
 *     There is nothing to ask the API, so the answer is a logged, fail-closed
 *     `false` — never a query with `undefined` ids.
 *   - `services/owners.js` already fails closed and logs, but a REJECTION from it
 *     would still leave this hook loading forever. So the rejection path is
 *     tested: closed, logged, settled.
 *   - The board/user pair can change mid-flight (a re-mounted view, a context
 *     re-emit). The answer for the abandoned pair must never land.
 *
 * `services/owners`, `utils/logger` and `contexts/MondayContext` are mocked: the
 * first so resolution ORDER is controllable and its ARGUMENTS are assertable, the
 * second so the fail-closed log is assertable, the third so the context can be
 * driven without an iframe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { isBoardOwner } from '../../services/owners';
import logger from '../../utils/logger';
import { useMonday } from '../../contexts/MondayContext';
import { useIsOwner } from '../useIsOwner';

vi.mock('../../services/owners', () => ({ isBoardOwner: vi.fn() }));
vi.mock('../../utils/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../contexts/MondayContext', () => ({ useMonday: vi.fn() }));

/** A board_view context, shaped like the live one (numeric board id, string user id). */
const BOARD_ID = 1234567890;
const USER_ID = '11111111';
const contextFor = (boardId, userId) => ({
  instanceType: 'board_view',
  instanceId: 55555555,
  boardId,
  user: userId === undefined ? undefined : { id: userId },
});

const mountWith = (context) => {
  useMonday.mockReturnValue({ context, currentUser: context?.user ?? null, isMobile: false });
  return renderHook(() => useIsOwner());
};

/** A promise plus its resolve/reject, so the test controls WHEN it settles. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('before the context resolves', () => {
  it('stays loading and asks nobody while context is still null', () => {
    const { result } = mountWith(null);

    expect(result.current).toEqual({ isOwner: false, isLoading: true, determined: false });
    expect(isBoardOwner).not.toHaveBeenCalled();
  });
});

describe('a real board_view context', () => {
  it('asks services/owners with the context board id and user id, verbatim', async () => {
    isBoardOwner.mockResolvedValue({ isOwner: true, determined: true });

    const { result } = mountWith(contextFor(BOARD_ID, USER_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(isBoardOwner).toHaveBeenCalledTimes(1);
    expect(isBoardOwner).toHaveBeenCalledWith(BOARD_ID, USER_ID);
  });

  it('reports isOwner true once the board owners include this user', async () => {
    const gate = deferred();
    isBoardOwner.mockReturnValue(gate.promise);

    const { result } = mountWith(contextFor(BOARD_ID, USER_ID));
    expect(result.current).toEqual({ isOwner: false, isLoading: true, determined: false });

    gate.resolve({ isOwner: true, determined: true });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isOwner).toBe(true);
    expect(result.current.determined).toBe(true);
  });

  it('reports isOwner false for a user who is not an owner, without logging an error', async () => {
    isBoardOwner.mockResolvedValue({ isOwner: false, determined: true });

    const { result } = mountWith(contextFor(BOARD_ID, USER_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isOwner).toBe(false);
    // A plain "no" is the expected answer for most users — not an incident.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not re-query when the same context object re-renders', async () => {
    isBoardOwner.mockResolvedValue({ isOwner: true, determined: true });
    const context = contextFor(BOARD_ID, USER_ID);

    const { result, rerender } = mountWith(context);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    rerender();
    await waitFor(() => expect(result.current.isOwner).toBe(true));

    expect(isBoardOwner).toHaveBeenCalledTimes(1);
  });
});

describe('the determined flag — the dead-end guard', () => {
  // SettingsGate opens an UNCONFIGURED instance when ownership is undetermined, and
  // refuses only a PROVEN non-owner. If the hook flattens the two, the board owner is
  // shown "ask the board owner" with no way out. These pin the passthrough.

  it('passes determined:true through for a proven non-owner', async () => {
    isBoardOwner.mockResolvedValue({ isOwner: false, determined: true });

    const { result } = mountWith(contextFor(BOARD_ID, USER_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current).toEqual({ isOwner: false, isLoading: false, determined: true });
  });

  it('passes determined:false through when the service could not answer', async () => {
    // e.g. the app is missing the boards:read scope — services/owners already logged it.
    isBoardOwner.mockResolvedValue({ isOwner: false, determined: false });

    const { result } = mountWith(contextFor(BOARD_ID, USER_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current).toEqual({ isOwner: false, isLoading: false, determined: false });
  });

  it('never claims determined when the service itself rejects', async () => {
    isBoardOwner.mockRejectedValue(new Error('module blew up'));

    const { result } = mountWith(contextFor(BOARD_ID, USER_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.determined).toBe(false);
  });

  it('never claims determined for a context it refused to ask about', async () => {
    const { result } = mountWith({});
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.determined).toBe(false);
  });

  it('treats a malformed service answer as undetermined rather than trusting it', async () => {
    // Defends the coercion in the hook: a bare boolean (the OLD contract) or undefined
    // must not read as "determined owner" just because it is truthy/absent.
    for (const bad of [true, false, undefined, null, {}]) {
      isBoardOwner.mockReset();
      isBoardOwner.mockResolvedValue(bad);
      cleanup();

      const { result } = mountWith(contextFor(BOARD_ID, USER_ID));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.determined).toBe(false);
      expect(result.current.isOwner).toBe(false);
    }
  });
});

describe('a context that cannot be asked about', () => {
  it.each([
    ['the watchdog empty context', {}],
    ['a context with no board id', contextFor(undefined, USER_ID)],
    ['a context with no user', contextFor(BOARD_ID, undefined)],
  ])('fails closed and logs for %s, without calling the API', async (_label, context) => {
    const { result } = mountWith(context);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isOwner).toBe(false);
    expect(isBoardOwner).not.toHaveBeenCalled();
    // Recorded, not silent: "the gate is closed for everyone" must be visible in
    // telemetry rather than look like an app with no settings button.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toBe('useIsOwner');
  });
});

describe('when the ownership check itself breaks', () => {
  it('fails closed, logs an ERROR, and stops loading when owners rejects', async () => {
    const boom = new Error('unexpected owners failure');
    isBoardOwner.mockRejectedValue(boom);

    const { result } = mountWith(contextFor(BOARD_ID, USER_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isOwner).toBe(false);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [module, , error] = logger.error.mock.calls[0];
    expect(module).toBe('useIsOwner');
    expect(error).toBe(boom);
  });
});

describe('a context that changes mid-flight', () => {
  it('ignores the answer for the board the view has already moved away from', async () => {
    const slowFirst = deferred();
    const fastSecond = deferred();
    isBoardOwner.mockImplementation((boardId) =>
      boardId === BOARD_ID ? slowFirst.promise : fastSecond.promise
    );
    const answer = (isOwner) => ({ isOwner, determined: true });

    const { result, rerender } = mountWith(contextFor(BOARD_ID, USER_ID));

    useMonday.mockReturnValue({ context: contextFor(999, USER_ID), currentUser: { id: USER_ID }, isMobile: false });
    rerender();
    fastSecond.resolve(answer(false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The abandoned board answers LAST, and says "owner" — the classic overwrite.
    slowFirst.resolve(answer(true));
    await waitFor(() => expect(isBoardOwner).toHaveBeenCalledTimes(2));

    expect(result.current.isOwner).toBe(false);
  });

  it('re-queries and updates when the user id changes', async () => {
    isBoardOwner.mockImplementation((_boardId, userId) =>
      Promise.resolve({ isOwner: userId === '22222222', determined: true })
    );

    const { result, rerender } = mountWith(contextFor(BOARD_ID, USER_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isOwner).toBe(false);

    useMonday.mockReturnValue({ context: contextFor(BOARD_ID, '22222222'), currentUser: { id: '22222222' }, isMobile: false });
    rerender();

    await waitFor(() => expect(result.current.isOwner).toBe(true));
    expect(isBoardOwner).toHaveBeenCalledTimes(2);
    expect(isBoardOwner).toHaveBeenLastCalledWith(BOARD_ID, '22222222');
  });
});

describe('the dev harness', () => {
  it('treats the harness user as an owner without an API call when VITE_MONDAY_MOCK is set', async () => {
    // pnpm dev:mock replaces the whole SDK with the stub, which has no owners
    // fixture — so the ONLY way the owner surface is reachable outside the iframe
    // is this build-time-flagged bypass.
    vi.stubEnv('VITE_MONDAY_MOCK', '1');
    isBoardOwner.mockResolvedValue({ isOwner: false, determined: true });

    const { result } = mountWith(contextFor(BOARD_ID, USER_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isOwner).toBe(true);
    expect(isBoardOwner).not.toHaveBeenCalled();
  });

  it('does NOT bypass the check when the flag is absent', async () => {
    isBoardOwner.mockResolvedValue({ isOwner: false, determined: true });

    const { result } = mountWith(contextFor(BOARD_ID, USER_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isOwner).toBe(false);
    expect(isBoardOwner).toHaveBeenCalledTimes(1);
  });
});
