import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round315 — the user-profile reads behind the export's participant titles.
 * Both are BEST-EFFORT by design: the export must still download when the profile
 * read fails, so a failure resolves to empty AND is logged (never silent).
 */

const api = vi.fn();
vi.mock('../monday-client.js', () => ({ api: (...a) => api(...a) }));
const warn = vi.fn();
vi.mock('../../logger.js', () => ({ default: { warn: (...a) => warn(...a), error: vi.fn(), info: vi.fn() } }));

import {
  fetchUserProfiles,
  fetchUserCustomFieldMetas,
  resetUserCustomFieldMetasCache,
} from '../userProfiles.js';

beforeEach(() => {
  api.mockReset();
  warn.mockReset();
  resetUserCustomFieldMetasCache();
});

describe('fetchUserProfiles', () => {
  it('maps Title and custom fields per user id', async () => {
    api.mockResolvedValue({
      users: [
        { id: 1, title: 'מנהל מחלקת מכירות', custom_field_values: [{ custom_field_meta_id: 750658, value: 'מר' }] },
        { id: 2, title: '', custom_field_values: [] },
      ],
    });
    await expect(fetchUserProfiles(['1', '2'])).resolves.toEqual({
      1: { title: 'מנהל מחלקת מכירות', customFields: { 750658: 'מר' } },
      2: { title: '', customFields: {} },
    });
  });

  it('asks for the fields the composition needs', async () => {
    api.mockResolvedValue({ users: [] });
    await fetchUserProfiles(['7']);
    const [query, variables] = api.mock.calls[0];
    expect(query).toContain('title');
    expect(query).toContain('custom_field_values');
    expect(query).toContain('custom_field_meta_id');
    expect(variables).toEqual({ ids: ['7'] });
  });

  it('dedupes and stringifies the ids', async () => {
    api.mockResolvedValue({ users: [] });
    await fetchUserProfiles([5, '5', 6, null, undefined, '']);
    expect(api.mock.calls[0][1]).toEqual({ ids: ['5', '6'] });
  });

  it('never touches the network for an empty id list', async () => {
    await expect(fetchUserProfiles([])).resolves.toEqual({});
    await expect(fetchUserProfiles(undefined)).resolves.toEqual({});
    expect(api).not.toHaveBeenCalled();
  });

  it('degrades to plain names on failure — and says so in the log', async () => {
    api.mockRejectedValue(new Error('boom'));
    await expect(fetchUserProfiles(['1'])).resolves.toEqual({});
    expect(warn).toHaveBeenCalled();
  });

  it('ignores a user row with no id, and a value that is not a string', async () => {
    api.mockResolvedValue({
      users: [
        { id: null, title: 'x', custom_field_values: [] },
        { id: 3, title: null, custom_field_values: [{ custom_field_meta_id: 9, value: null }, { value: 'orphan' }] },
      ],
    });
    await expect(fetchUserProfiles(['3'])).resolves.toEqual({ 3: { title: '', customFields: { 9: '' } } });
  });
});

describe('fetchUserCustomFieldMetas', () => {
  it('returns the account definitions as { id, title } strings', async () => {
    api.mockResolvedValue({ me: { custom_field_metas: [{ id: 750658, title: 'Pluga' }, { id: 2, title: null }] } });
    await expect(fetchUserCustomFieldMetas()).resolves.toEqual([
      { id: '750658', title: 'Pluga' },
      { id: '2', title: '' },
    ]);
  });

  it('is fetched ONCE per session (the definitions are account-level)', async () => {
    api.mockResolvedValue({ me: { custom_field_metas: [] } });
    await fetchUserCustomFieldMetas();
    await fetchUserCustomFieldMetas();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('leaves the editor with שם + תפקיד on failure — and logs it', async () => {
    api.mockRejectedValue(new Error('nope'));
    await expect(fetchUserCustomFieldMetas()).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});
