/**
 * isBoardOwner — a board_view context carries NO permissions, so ownership can
 * only be answered by the API. It gates the settings surface.
 *
 * The answer is TRI-STATE: `{ isOwner, determined }`. `determined` records whether
 * monday actually ANSWERED the question, and every test below pins which of the two
 * fields a given situation is allowed to move.
 *
 * WHY the shape changed (this is the regression these tests exist to prevent):
 * it used to return a bare boolean, so "provably not an owner" and "could not tell"
 * were the same value. `SettingsGate` then refused both, and on an UNCONFIGURED
 * instance that was a dead end with no exit — the board owner was shown a screen
 * telling them to ask the board owner, and configuring was the only way out, so the
 * instance could never become usable. Collapsing these two states back into one
 * boolean re-breaks that, which is why `determined` is asserted separately
 * everywhere and never just inferred from `isOwner`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import logger from '../../utils/logger';
import { isBoardOwner } from '../owners';
import { BOARD_OWNERS_QUERY } from '../queries';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../monday-client.js', () => ({ api: mocks.api }));

const ownersResponse = (ids) => ({ boards: [{ id: '18424252636', owners: ids.map((id) => ({ id })) }] });

beforeEach(() => {
  mocks.api.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'group').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const OWNER = { isOwner: true, determined: true };
/** Provably NOT an owner — the question was answered, the answer was no. */
const NOT_OWNER = { isOwner: false, determined: true };
/** The question could not be answered at all. NOT the same as NOT_OWNER. */
const UNDETERMINED = { isOwner: false, determined: false };

describe('isBoardOwner', () => {
  it('is a determined true when the user is among the owners, comparing across id types', async () => {
    mocks.api.mockResolvedValue(ownersResponse(['12345678', '48274917']));

    await expect(isBoardOwner('18424252636', 48274917)).resolves.toEqual(OWNER);
    await expect(isBoardOwner('18424252636', '48274917')).resolves.toEqual(OWNER);
  });

  it('matches a NUMERIC owner id from the API against a string user id', async () => {
    // The other direction of the same coercion, and the one that actually locks
    // people out: when monday hands back `owners: [{ id: 48274917 }]` as a NUMBER
    // and the context carries the user id as a string, a `===` without String()
    // answers false and the real board owner loses the settings surface entirely.
    mocks.api.mockResolvedValue(ownersResponse([12345678, 48274917]));

    await expect(isBoardOwner('18424252636', '48274917')).resolves.toEqual(OWNER);
    await expect(isBoardOwner('18424252636', 48274917)).resolves.toEqual(OWNER);
    await expect(isBoardOwner('18424252636', '99999999')).resolves.toEqual(NOT_OWNER);
  });

  it('is a DETERMINED false for a member who is not an owner', async () => {
    // The load-bearing case: a real answer of "no". This must stay `determined: true`
    // so SettingsGate keeps refusing this person — it is the only state that still
    // closes the gate on an unconfigured instance.
    mocks.api.mockResolvedValue(ownersResponse(['12345678']));

    await expect(isBoardOwner('18424252636', '48274917')).resolves.toEqual(NOT_OWNER);
  });

  it('sends the board id as a string array and names itself for the logs', async () => {
    mocks.api.mockResolvedValue(ownersResponse(['1']));

    await isBoardOwner(18424252636, '1');

    expect(mocks.api).toHaveBeenCalledWith(
      BOARD_OWNERS_QUERY,
      { boardId: ['18424252636'] },
      'isBoardOwner'
    );
  });

  it('is UNDETERMINED (not "no") and logs when the API call throws', async () => {
    // The real-world trigger: the app missing the `boards:read` scope surfaces as a
    // failed request. Answering a determined "no" here is what bricked the app.
    const boom = new Error('Failed to fetch');
    mocks.api.mockRejectedValue(boom);
    const errorSpy = vi.spyOn(logger, 'error');

    await expect(isBoardOwner('18424252636', '48274917')).resolves.toEqual(UNDETERMINED);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][2]).toBe(boom);
  });

  it('is UNDETERMINED and logs when the owners list is absent from the response', async () => {
    mocks.api.mockResolvedValue({ boards: [null] });
    const errorSpy = vi.spyOn(logger, 'error');

    await expect(isBoardOwner('18424252636', '48274917')).resolves.toEqual(UNDETERMINED);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    // A missing field is a RESPONSE-SHAPE finding, not an exception: the error slot
    // stays null and the response goes to the 4th (context) argument, which is the
    // only place the Axiom sink and ErrorDetailsModal read it from. Letting this
    // reach the generic catch instead would ship a TypeError with no response body,
    // i.e. "the settings gate is shut for everyone" with nothing to diagnose it by.
    expect(errorSpy.mock.calls[0][2]).toBeNull();
    expect(errorSpy.mock.calls[0][3]).toMatchObject({
      boardId: '18424252636',
      response: { boards: [null] },
    });
  });

  it('is UNDETERMINED with the same diagnostic when the board resolved but owners did not', async () => {
    const data = { boards: [{ id: '18424252636' }] };
    mocks.api.mockResolvedValue(data);
    const errorSpy = vi.spyOn(logger, 'error');

    await expect(isBoardOwner('18424252636', '48274917')).resolves.toEqual(UNDETERMINED);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][2]).toBeNull();
    expect(errorSpy.mock.calls[0][3]).toMatchObject({ response: data });
  });

  it('is UNDETERMINED without an API call when the board id or user id is missing', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(isBoardOwner('', '48274917')).resolves.toEqual(UNDETERMINED);
    await expect(isBoardOwner('18424252636', '')).resolves.toEqual(UNDETERMINED);
    await expect(isBoardOwner(undefined, undefined)).resolves.toEqual(UNDETERMINED);

    expect(mocks.api).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it('never reports determined:true without having compared against a real owners array', async () => {
    // A guard against the specific regression: any future shortcut that returns
    // `determined: true` on a failure path silently restores the dead end. Sweep every
    // failure shape and assert none of them claims to have answered the question.
    const failures = [
      () => mocks.api.mockRejectedValue(new Error('scope missing')),
      () => mocks.api.mockResolvedValue({ boards: [null] }),
      () => mocks.api.mockResolvedValue({ boards: [] }),
      () => mocks.api.mockResolvedValue({}),
      () => mocks.api.mockResolvedValue({ boards: [{ id: '1', owners: null }] }),
    ];

    for (const arrange of failures) {
      mocks.api.mockReset();
      arrange();
      const answer = await isBoardOwner('18424252636', '48274917');
      expect(answer.determined).toBe(false);
      expect(answer.isOwner).toBe(false);
    }
  });
});
