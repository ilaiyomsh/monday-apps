import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module under test owns process-wide mutable state (the roster cache and the
// single-flight promise), so every test re-imports it through resetModules to get a
// fresh cache. Without that the first test's cache would answer the rest of them and
// they would pass without exercising anything.
const mockQuery = vi.fn();
const mockError = vi.fn();

vi.mock('./mondayService.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));
vi.mock('../utils/logger.js', () => ({
  default: { error: (...args) => mockError(...args) },
}));

async function freshModule() {
  vi.resetModules();
  return import('./rosterAccess.js');
}

beforeEach(() => {
  mockQuery.mockReset();
  mockError.mockReset();
});

describe('loadRoster', () => {
  it('queries the account roster once and serves every later call from cache', async () => {
    const { loadRoster } = await freshModule();
    mockQuery.mockResolvedValue({ users: [{ id: '1', name: 'דנה' }] });

    const first = await loadRoster();
    const second = await loadRoster();

    expect(first).toEqual([{ id: '1', name: 'דנה' }]);
    expect(second).toBe(first);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('is single-flight: concurrent callers share one in-flight query', async () => {
    const { loadRoster } = await freshModule();
    let release;
    mockQuery.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const a = loadRoster();
    const b = loadRoster();
    release({ users: [{ id: '7' }] });

    expect(await a).toEqual([{ id: '7' }]);
    expect(await b).toEqual([{ id: '7' }]);
    // Two pickers opening at once must not issue two account-wide user queries.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('treats a response with no users as an empty roster rather than undefined', async () => {
    const { loadRoster } = await freshModule();
    mockQuery.mockResolvedValue({});

    expect(await loadRoster()).toEqual([]);
  });

  it('on failure logs, resolves empty, and allows the NEXT open to retry', async () => {
    const { loadRoster } = await freshModule();
    const boom = new Error('roster exploded');
    mockQuery.mockRejectedValueOnce(boom);

    expect(await loadRoster()).toEqual([]);
    expect(mockError).toHaveBeenCalledWith(
      'PersonPicker',
      'Failed to load account roster',
      boom,
    );

    // The failed promise must have been cleared, or the picker would serve the
    // rejected attempt forever and never recover without a page reload.
    mockQuery.mockResolvedValue({ users: [{ id: '9' }] });
    expect(await loadRoster()).toEqual([{ id: '9' }]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('does not cache the empty result of a failure', async () => {
    const { loadRoster, getCachedRoster } = await freshModule();
    mockQuery.mockRejectedValueOnce(new Error('nope'));

    await loadRoster();

    // A cached [] would make getCachedRoster() truthy and PersonPicker would skip
    // its loading state on the next open while holding no roster at all.
    expect(getCachedRoster()).toBeNull();
  });
});

describe('getCachedRoster', () => {
  it('is null before the first load and the cached array afterwards', async () => {
    const { loadRoster, getCachedRoster } = await freshModule();
    mockQuery.mockResolvedValue({ users: [{ id: '3' }] });

    // PersonPicker seeds useState from this: null means "show the loading row".
    expect(getCachedRoster()).toBeNull();

    const roster = await loadRoster();
    expect(getCachedRoster()).toBe(roster);
  });

  it('does not resolve while a load is still in flight', async () => {
    const { loadRoster, getCachedRoster } = await freshModule();
    let release;
    mockQuery.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const pending = loadRoster();
    expect(getCachedRoster()).toBeNull();

    release({ users: [{ id: '4' }] });
    await pending;
    expect(getCachedRoster()).toEqual([{ id: '4' }]);
  });
});
