// account-slug resolver tests (#145, simplified per owner decision: NO user
// name/email API lookup — only the account slug, fetched ONCE via me{} for
// building instance URLs). Owner-account gate: a foreign accountId gets no
// slug (no cross-account URL guessing). Fail-soft + cached.

import { describe, it, expect, vi } from 'vitest';
import { createAccountSlugResolver } from '../src/services/account-slug.js';

function makeLogger() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function makeApi(meImpl) {
  return {
    fetchMe: vi.fn(meImpl ?? (async () => ({ accountId: '14334098', accountSlug: 'yomsheni-il' }))),
  };
}

describe('createAccountSlugResolver', () => {
  it('returns the owner slug for a same-account id, cached after one fetchMe', async () => {
    const api = makeApi();
    const resolver = createAccountSlugResolver({ mondayApi: api, logger: makeLogger() });

    await expect(resolver.getSlug('14334098')).resolves.toBe('yomsheni-il');
    await expect(resolver.getSlug('14334098')).resolves.toBe('yomsheni-il');
    expect(api.fetchMe).toHaveBeenCalledTimes(1);
  });

  it('owner gate: a FOREIGN account id resolves to empty string', async () => {
    const resolver = createAccountSlugResolver({ mondayApi: makeApi(), logger: makeLogger() });
    await expect(resolver.getSlug('999999')).resolves.toBe('');
  });

  it('fail-soft: a fetchMe failure resolves to empty string and warns (ids only)', async () => {
    const logger = makeLogger();
    const resolver = createAccountSlugResolver({
      mondayApi: makeApi(async () => { throw new Error('me down'); }),
      logger,
    });
    await expect(resolver.getSlug('14334098')).resolves.toBe('');
    expect(logger.warn).toHaveBeenCalled();
  });
});
