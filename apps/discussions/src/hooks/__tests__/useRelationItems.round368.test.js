import { describe, it, expect } from 'vitest';
import { parseRelationSettings } from '../useRelationItems.js';

/*
 * round368 §4 — the connected board of a CUSTOM board_relation column is not in
 * the app's mapping; it comes from monday's own column settings. This is the
 * pure part: typed `settings` (API 2025-10+) wins, legacy `settings_str` JSON is
 * the fallback, and anything malformed degrades to "no linked board" instead of
 * throwing inside a render path.
 */
describe('round368 — parseRelationSettings', () => {
  it('prefers the TYPED settings object', () => {
    const r = parseRelationSettings({
      settings: { boardIds: [123, 456], allowMultipleItems: true },
      settings_str: '{"boardIds":[999]}',
    });
    expect(r.boardIds).toEqual(['123', '456']);
    expect(r.allowMultiple).toBe(true);
  });

  it('falls back to legacy settings_str when there is no typed settings', () => {
    const r = parseRelationSettings({ settings_str: '{"boardIds":[777],"allowMultipleItems":false}' });
    expect(r.boardIds).toEqual(['777']);
    expect(r.allowMultiple).toBe(false);
  });

  it('a single-item column (allowMultipleItems:false) is reported as single', () => {
    expect(parseRelationSettings({ settings: { boardIds: [1], allowMultipleItems: false } }).allowMultiple).toBe(false);
    // absent ⇒ multi (monday omits the flag on multi columns)
    expect(parseRelationSettings({ settings: { boardIds: [1] } }).allowMultiple).toBe(true);
  });

  it('malformed / missing input degrades to no linked board — never throws', () => {
    expect(parseRelationSettings({ settings_str: 'not json{' }).boardIds).toEqual([]);
    expect(parseRelationSettings({}).boardIds).toEqual([]);
    expect(parseRelationSettings(null).boardIds).toEqual([]);
    expect(parseRelationSettings({ settings: { boardIds: 'nope' } }).boardIds).toEqual([]);
  });

  it('drops empty ids and stringifies the rest', () => {
    const r = parseRelationSettings({ settings: { boardIds: [0, '', null, 42] } });
    expect(r.boardIds).toEqual(['0', '42']);
  });
});
