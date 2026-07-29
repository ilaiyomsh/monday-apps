import { describe, expect, it } from 'vitest';
import {
  COLUMN_ROLES,
  DEFAULT_SETTINGS,
  MAX_BLOCKS,
  isConfigured,
  normalizeSettings,
  validateSettings,
} from '../settingsSchema.js';

// The blob these functions defend against is HAND-EDITABLE: it lives in
// monday.storage, is written by an owner-facing panel, and is read on every boot
// to gate render. So every test below feeds a blob shape that a real storage read
// can actually produce — a partial write, a wrong type, a duplicated id, zero or
// two table blocks — not just the happy object the panel would save.

/** A fully mapped, valid blob — the baseline the negative cases deviate from. */
const CONFIGURED = {
  version: 1,
  boardId: '18424252636',
  columns: {
    action: 'text_action',
    committee: 'wzmirror',
    report: 'long_text_report',
    date: 'wzdate',
    person: 'wzpeople',
  },
  headers: { action: '', committee: '', report: '', date: '' },
  mergeAction: true,
  mergeCommittee: true,
  weekStartsOn: 0,
  blocks: [
    { id: 'b1', type: 'text', text: 'פתיח' },
    { id: 'b2', type: 'table' },
  ],
};

const tableBlocks = (s) => s.blocks.filter((b) => b.type === 'table');

describe('module constants', () => {
  it('lists the five column roles in the documented order', () => {
    expect(COLUMN_ROLES).toEqual(['action', 'committee', 'report', 'date', 'person']);
  });

  it('caps the block list at a positive limit', () => {
    expect(Number.isInteger(MAX_BLOCKS)).toBe(true);
    expect(MAX_BLOCKS).toBeGreaterThan(1);
  });

  it('ships defaults that are versioned, unconfigured, and already hold one table block', () => {
    expect(DEFAULT_SETTINGS.version).toBe(1);
    expect(DEFAULT_SETTINGS.boardId).toBe('');
    for (const role of COLUMN_ROLES) expect(DEFAULT_SETTINGS.columns[role]).toBe('');
    for (const role of ['action', 'committee', 'report', 'date']) {
      expect(DEFAULT_SETTINGS.headers[role]).toBe('');
    }
    expect(DEFAULT_SETTINGS.mergeAction).toBe(true);
    expect(DEFAULT_SETTINGS.mergeCommittee).toBe(true);
    expect(DEFAULT_SETTINGS.weekStartsOn).toBe(0);
    expect(tableBlocks(DEFAULT_SETTINGS)).toHaveLength(1);
    // A fresh instance is NOT configured — the gate must show the settings panel.
    expect(isConfigured(DEFAULT_SETTINGS)).toBe(false);
  });

  it('does not let a caller mutate the shared defaults', () => {
    const before = DEFAULT_SETTINGS.columns.action;
    const s = normalizeSettings(undefined);
    s.columns.action = 'mutated';
    s.blocks.push({ id: 'x', type: 'text', text: 'x' });
    expect(DEFAULT_SETTINGS.columns.action).toBe(before);
    expect(tableBlocks(DEFAULT_SETTINGS)).toHaveLength(1);
    // ...and a second normalize is unaffected by the first caller's mutation.
    expect(normalizeSettings(undefined).columns.action).toBe(before);
  });
});

describe('normalizeSettings — a blob that is missing or not an object', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a JSON string that was never parsed', '{"boardId":"1"}'],
    ['an array', []],
    ['a number', 7],
  ])('falls back to the defaults for %s', (_label, raw) => {
    const s = normalizeSettings(raw);
    expect(s.version).toBe(1);
    expect(s.boardId).toBe('');
    expect(s.columns).toEqual(DEFAULT_SETTINGS.columns);
    expect(tableBlocks(s)).toHaveLength(1);
  });
});

describe('normalizeSettings — partial and wrongly-typed fields', () => {
  it('keeps mapped roles and fills only the missing ones', () => {
    const s = normalizeSettings({ columns: { action: 'a', date: 'd' } });
    expect(s.columns).toEqual({
      action: 'a',
      committee: '',
      report: '',
      date: 'd',
      person: '',
    });
  });

  it('drops role keys that are not one of the five', () => {
    const s = normalizeSettings({ columns: { action: 'a', bogus: 'nope' } });
    expect(Object.keys(s.columns).sort()).toEqual([...COLUMN_ROLES].sort());
    expect(s.columns.bogus).toBeUndefined();
  });

  it('coerces a numeric boardId to a string, because monday ids arrive both ways', () => {
    expect(normalizeSettings({ boardId: 18424252636 }).boardId).toBe('18424252636');
  });

  it('treats a whitespace-only boardId as unset', () => {
    expect(normalizeSettings({ boardId: '   ' }).boardId).toBe('');
  });

  it('replaces a non-string column id with the empty string instead of keeping junk', () => {
    const s = normalizeSettings({ columns: { action: { id: 'a' }, committee: 42, report: null } });
    expect(s.columns.action).toBe('');
    // A numeric column id is still an id — monday column ids are strings, but a
    // hand-written blob may hold a number.
    expect(s.columns.committee).toBe('42');
    expect(s.columns.report).toBe('');
  });

  it('keeps header overrides and trims them, defaulting the rest to the empty string', () => {
    const s = normalizeSettings({ headers: { action: '  פעולה שלי  ', bogus: 'x' } });
    expect(s.headers.action).toBe('פעולה שלי');
    expect(s.headers.committee).toBe('');
    expect(s.headers.report).toBe('');
    expect(s.headers.date).toBe('');
    expect(s.headers.person).toBeUndefined(); // person is not a table column
    expect(s.headers.bogus).toBeUndefined();
  });

  it.each([
    ['false', false, false],
    ['the string "false"', 'false', false],
    ['0', 0, false],
    ['true', true, true],
    ['undefined', undefined, true],
  ])('normalizes mergeAction given %s', (_label, raw, expected) => {
    expect(normalizeSettings({ mergeAction: raw }).mergeAction).toBe(expected);
  });

  it('normalizes mergeCommittee independently of mergeAction', () => {
    const s = normalizeSettings({ mergeAction: false, mergeCommittee: true });
    expect(s.mergeAction).toBe(false);
    expect(s.mergeCommittee).toBe(true);
  });

  it.each([
    ['0', 0, 0],
    ['6', 6, 6],
    ['the string "1"', '1', 1],
    ['7 (out of range)', 7, 0],
    ['-1 (out of range)', -1, 0],
    ['1.5 (not an integer)', 1.5, 0],
    ['"sunday"', 'sunday', 0],
  ])('normalizes weekStartsOn given %s', (_label, raw, expected) => {
    expect(normalizeSettings({ weekStartsOn: raw }).weekStartsOn).toBe(expected);
  });
});

describe('normalizeSettings — the block list', () => {
  it('preserves the order of valid blocks', () => {
    const s = normalizeSettings({
      blocks: [
        { id: 'a', type: 'text', text: 'ראשון' },
        { id: 'b', type: 'table' },
        { id: 'c', type: 'text', text: 'אחרון' },
      ],
    });
    expect(s.blocks.map((b) => b.type)).toEqual(['text', 'table', 'text']);
    expect(s.blocks.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(s.blocks[2].text).toBe('אחרון');
  });

  it('appends a table block when the stored list has none', () => {
    const s = normalizeSettings({ blocks: [{ id: 'a', type: 'text', text: 'רק טקסט' }] });
    expect(s.blocks.map((b) => b.type)).toEqual(['text', 'table']);
    expect(tableBlocks(s)).toHaveLength(1);
    // The synthesised block takes the canonical id whenever it is free, so a blob
    // normalized from nothing and DEFAULT_SETTINGS name the same block identically.
    expect(tableBlocks(s)[0].id).toBe(DEFAULT_SETTINGS.blocks[0].id);
  });

  it('keeps the FIRST table block and drops any later one', () => {
    const s = normalizeSettings({
      blocks: [
        { id: 't1', type: 'table' },
        { id: 'a', type: 'text', text: 'בין הטבלאות' },
        { id: 't2', type: 'table' },
      ],
    });
    expect(tableBlocks(s)).toHaveLength(1);
    expect(s.blocks.map((b) => b.id)).toEqual(['t1', 'a']);
  });

  it('drops entries whose type is not text or table', () => {
    const s = normalizeSettings({
      blocks: [
        { id: 'a', type: 'image', url: 'x' },
        { id: 'b', type: 'table' },
        { id: 'c', type: 'text', text: 'ok' },
        null,
        'text',
      ],
    });
    expect(s.blocks.map((b) => b.id)).toEqual(['b', 'c']);
  });

  it('defaults a text block with no text to the empty string, never undefined', () => {
    const s = normalizeSettings({ blocks: [{ id: 'a', type: 'text' }, { id: 'b', type: 'table' }] });
    expect(s.blocks[0].text).toBe('');
  });

  it('coerces a non-string block text', () => {
    const s = normalizeSettings({
      blocks: [{ id: 'a', type: 'text', text: 5 }, { id: 'b', type: 'table' }],
    });
    expect(s.blocks[0].text).toBe('5');
  });

  it('does not put a text key on a table block', () => {
    const s = normalizeSettings({ blocks: [{ id: 'b', type: 'table', text: 'זליגה' }] });
    expect(s.blocks[0].type).toBe('table');
    expect(s.blocks[0].text).toBeUndefined();
  });

  it('gives every block a unique id, replacing missing and duplicated ones', () => {
    const s = normalizeSettings({
      blocks: [
        { type: 'text', text: 'ללא מזהה' },
        { id: 'dup', type: 'text', text: 'ראשון' },
        { id: 'dup', type: 'text', text: 'שני' },
        { id: 'dup', type: 'table' },
      ],
    });
    const ids = s.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    // The FIRST holder of a duplicated id keeps it; the texts stay put.
    expect(s.blocks.map((b) => b.text)).toEqual(['ללא מזהה', 'ראשון', 'שני', undefined]);
  });

  it('gives the SYNTHESISED table block an id no text block already holds', () => {
    // The nasty shape: a text block squats on 'table', so the synthesised block
    // falls back to `block-<length>` — which the second text block already holds.
    // A collision here is not cosmetic: blockOps.deleteBlock filters BY ID, so
    // deleting that text block would take the table block with it.
    const s = normalizeSettings({
      blocks: [
        { id: 'table', type: 'text', text: 'כותרת' },
        { id: 'block-2', type: 'text', text: 'הערה' },
      ],
    });
    const ids = s.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(tableBlocks(s)).toHaveLength(1);
    // The text blocks keep their stored ids; only the new table block moves.
    expect(ids.slice(0, 2)).toEqual(['table', 'block-2']);
  });

  it('keeps synthesised table ids unique however many block-<n> ids are taken', () => {
    // Every `block-<n>` for n in 0..4 is occupied, plus 'table' itself.
    const blocks = [{ id: 'table', type: 'text', text: 'כותרת' }];
    for (let i = 0; i < 5; i += 1) blocks.push({ id: `block-${i}`, type: 'text', text: `p${i}` });
    const s = normalizeSettings({ blocks });
    const ids = s.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(tableBlocks(s)).toHaveLength(1);
  });

  it('replaces a non-object block list with the default single table block', () => {
    for (const raw of ['[]', 42, {}, null]) {
      const s = normalizeSettings({ blocks: raw });
      expect(s.blocks.map((b) => b.type)).toEqual(['table']);
    }
  });

  it('caps the list at MAX_BLOCKS by dropping TRAILING text blocks', () => {
    const blocks = [{ id: 't', type: 'table' }];
    for (let i = 0; i < MAX_BLOCKS + 5; i += 1) {
      blocks.push({ id: `x${i}`, type: 'text', text: `p${i}` });
    }
    const s = normalizeSettings({ blocks });
    expect(s.blocks).toHaveLength(MAX_BLOCKS);
    expect(s.blocks[0].id).toBe('t');
    expect(s.blocks[s.blocks.length - 1].id).toBe(`x${MAX_BLOCKS - 2}`);
  });

  it('never drops the table block when capping, even when it sits last', () => {
    const blocks = [];
    for (let i = 0; i < MAX_BLOCKS + 3; i += 1) {
      blocks.push({ id: `x${i}`, type: 'text', text: `p${i}` });
    }
    blocks.push({ id: 'the-table', type: 'table' });
    const s = normalizeSettings({ blocks });
    expect(s.blocks).toHaveLength(MAX_BLOCKS);
    expect(tableBlocks(s)).toHaveLength(1);
    expect(s.blocks[s.blocks.length - 1].id).toBe('the-table');
  });
});

describe('normalizeSettings — versioning', () => {
  it('stamps the current version on a legacy blob that has none', () => {
    const s = normalizeSettings({ boardId: '1', columns: { action: 'a' } });
    expect(s.version).toBe(1);
    expect(s.boardId).toBe('1'); // migration must not lose data it understands
  });

  it('stamps the current version over a junk version value', () => {
    for (const raw of ['1', 0, -3, 1.5, 'v1', null]) {
      expect(normalizeSettings({ version: raw }).version).toBe(1);
    }
  });

  it('keeps a FUTURE version number rather than silently downgrading the blob', () => {
    // An older client must not re-stamp a newer blob as v1: the next new-client
    // boot would then run the 1→2 migration a second time.
    const s = normalizeSettings({ version: 99, boardId: '1' });
    expect(s.version).toBe(99);
  });

  it('preserves unrecognized top-level keys of a FUTURE blob so nothing is lost', () => {
    const s = normalizeSettings({ version: 99, boardId: '1', futureFlag: { deep: true } });
    expect(s.futureFlag).toEqual({ deep: true });
  });

  it('does NOT preserve unrecognized keys of a current-version blob', () => {
    // At the current version an unknown key is leftover junk, not future data.
    const s = normalizeSettings({ version: 1, boardId: '1', leftover: 'junk' });
    expect(s.leftover).toBeUndefined();
  });

  it('is idempotent — normalizing a normalized blob changes nothing', () => {
    const once = normalizeSettings(CONFIGURED);
    expect(normalizeSettings(once)).toEqual(once);
  });
});

describe('isConfigured', () => {
  it('is true for a fully mapped blob with exactly one table block', () => {
    expect(isConfigured(CONFIGURED)).toBe(true);
  });

  it.each(COLUMN_ROLES)('is false when the %s role is unmapped', (role) => {
    const s = { ...CONFIGURED, columns: { ...CONFIGURED.columns, [role]: '' } };
    expect(isConfigured(s)).toBe(false);
  });

  it('is false when boardId is missing', () => {
    expect(isConfigured({ ...CONFIGURED, boardId: '' })).toBe(false);
  });

  it('is false when there is no table block', () => {
    expect(isConfigured({ ...CONFIGURED, blocks: [{ id: 'a', type: 'text', text: 'x' }] })).toBe(
      false
    );
  });

  it('is false when a stored blob holds two table blocks', () => {
    const blocks = [{ id: 't1', type: 'table' }, { id: 't2', type: 'table' }];
    expect(isConfigured({ ...CONFIGURED, blocks })).toBe(false);
  });

  it('is false for a missing or non-object blob instead of throwing', () => {
    expect(isConfigured(undefined)).toBe(false);
    expect(isConfigured(null)).toBe(false);
    expect(isConfigured({})).toBe(false);
    expect(isConfigured('configured')).toBe(false);
  });

  it('accepts a numeric boardId, because the panel may hand one straight through', () => {
    expect(isConfigured({ ...CONFIGURED, boardId: 18424252636 })).toBe(true);
  });
});

describe('validateSettings', () => {
  it('reports ok with no errors for a valid blob', () => {
    expect(validateSettings(CONFIGURED)).toEqual({ ok: true, errors: [] });
  });

  it('reports one error per unmapped role, naming each role', () => {
    const s = {
      ...CONFIGURED,
      columns: { action: '', committee: '', report: 'r', date: 'd', person: 'p' },
    };
    const { ok, errors } = validateSettings(s);
    expect(ok).toBe(false);
    expect(errors).toHaveLength(2);
    expect(errors.join('|')).toContain('action');
    expect(errors.join('|')).toContain('committee');
  });

  it('reports a missing board', () => {
    const { ok, errors } = validateSettings({ ...CONFIGURED, boardId: '' });
    expect(ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/board|לוח/i);
  });

  it('reports a block list with no table block', () => {
    const { ok, errors } = validateSettings({
      ...CONFIGURED,
      blocks: [{ id: 'a', type: 'text', text: 'x' }],
    });
    expect(ok).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('reports a block list with two table blocks', () => {
    const { ok, errors } = validateSettings({
      ...CONFIGURED,
      blocks: [{ id: 't1', type: 'table' }, { id: 't2', type: 'table' }],
    });
    expect(ok).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('reports the same column mapped to two different roles', () => {
    const s = {
      ...CONFIGURED,
      columns: { ...CONFIGURED.columns, report: CONFIGURED.columns.action },
    };
    const { ok, errors } = validateSettings(s);
    expect(ok).toBe(false);
    expect(errors.join('|')).toContain(CONFIGURED.columns.action);
  });

  it('reports a block list longer than MAX_BLOCKS', () => {
    const blocks = [{ id: 't', type: 'table' }];
    for (let i = 0; i <= MAX_BLOCKS; i += 1) blocks.push({ id: `x${i}`, type: 'text', text: 'p' });
    const { ok, errors } = validateSettings({ ...CONFIGURED, blocks });
    expect(ok).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('reports an out-of-range weekStartsOn', () => {
    const { ok, errors } = validateSettings({ ...CONFIGURED, weekStartsOn: 9 });
    expect(ok).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('accepts weekStartsOn 6, the last valid weekday', () => {
    expect(validateSettings({ ...CONFIGURED, weekStartsOn: 6 })).toEqual({ ok: true, errors: [] });
  });

  it('collects EVERY problem at once rather than stopping at the first', () => {
    const { ok, errors } = validateSettings({
      boardId: '',
      columns: { action: '', committee: '', report: '', date: '', person: '' },
      blocks: [],
      weekStartsOn: 9,
    });
    expect(ok).toBe(false);
    // 1 board + 5 roles + 1 table-count + 1 weekStartsOn
    expect(errors).toHaveLength(8);
  });

  it('reports a missing blob as not ok instead of throwing', () => {
    for (const raw of [undefined, null, 'x', []]) {
      const { ok, errors } = validateSettings(raw);
      expect(ok).toBe(false);
      expect(errors.length).toBeGreaterThan(0);
    }
  });
});
