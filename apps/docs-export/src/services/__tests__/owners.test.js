/**
 * isBoardOwner — a board_view context carries NO permissions, so ownership can
 * only be answered by the API. It gates the settings surface, therefore it must
 * fail CLOSED (false) on every uncertainty — and always log, so a permission
 * check that is failing for everyone is visible instead of silently locking the
 * owner out.
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

describe('isBoardOwner', () => {
  it('is true when the user is among the owners, comparing across id types', async () => {
    mocks.api.mockResolvedValue(ownersResponse(['12345678', '48274917']));

    await expect(isBoardOwner('18424252636', 48274917)).resolves.toBe(true);
    await expect(isBoardOwner('18424252636', '48274917')).resolves.toBe(true);
  });

  it('matches a NUMERIC owner id from the API against a string user id', async () => {
    // The other direction of the same coercion, and the one that actually locks
    // people out: when monday hands back `owners: [{ id: 48274917 }]` as a NUMBER
    // and the context carries the user id as a string, a `===` without String()
    // answers false and the real board owner loses the settings surface entirely.
    mocks.api.mockResolvedValue(ownersResponse([12345678, 48274917]));

    await expect(isBoardOwner('18424252636', '48274917')).resolves.toBe(true);
    await expect(isBoardOwner('18424252636', 48274917)).resolves.toBe(true);
    await expect(isBoardOwner('18424252636', '99999999')).resolves.toBe(false);
  });

  it('is false for a member who is not an owner', async () => {
    mocks.api.mockResolvedValue(ownersResponse(['12345678']));

    await expect(isBoardOwner('18424252636', '48274917')).resolves.toBe(false);
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

  it('fails CLOSED and logs when the API call throws', async () => {
    const boom = new Error('Failed to fetch');
    mocks.api.mockRejectedValue(boom);
    const errorSpy = vi.spyOn(logger, 'error');

    await expect(isBoardOwner('18424252636', '48274917')).resolves.toBe(false);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][2]).toBe(boom);
  });

  it('fails CLOSED and logs when the owners list is absent from the response', async () => {
    mocks.api.mockResolvedValue({ boards: [null] });
    const errorSpy = vi.spyOn(logger, 'error');

    await expect(isBoardOwner('18424252636', '48274917')).resolves.toBe(false);

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

  it('fails CLOSED with the same diagnostic when the board resolved but owners did not', async () => {
    const data = { boards: [{ id: '18424252636' }] };
    mocks.api.mockResolvedValue(data);
    const errorSpy = vi.spyOn(logger, 'error');

    await expect(isBoardOwner('18424252636', '48274917')).resolves.toBe(false);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][2]).toBeNull();
    expect(errorSpy.mock.calls[0][3]).toMatchObject({ response: data });
  });

  it('fails CLOSED without an API call when the board id or user id is missing', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');

    await expect(isBoardOwner('', '48274917')).resolves.toBe(false);
    await expect(isBoardOwner('18424252636', '')).resolves.toBe(false);
    await expect(isBoardOwner(undefined, undefined)).resolves.toBe(false);

    expect(mocks.api).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });
});
