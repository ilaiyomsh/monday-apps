import { describe, expect, it } from 'vitest';
import {
  columnValuesSelection,
  dropdownOptionsFrom,
  getFieldSpec,
  isFieldValueEmpty,
  isSupportedFormColumnType,
  prefillFieldValue,
  sanitizeColumnValue,
  sanitizeColumnValues,
  serializeFieldValue,
} from './columnFields.js';

describe('isSupportedFormColumnType', () => {
  it('accepts every type the registry can render and write', () => {
    [
      'text', 'long_text', 'numbers', 'date', 'email', 'phone', 'link',
      'dropdown', 'people', 'checkbox', 'timeline', 'rating', 'status',
    ].forEach((type) => {
      expect(isSupportedFormColumnType(type)).toBe(true);
    });
  });

  it('rejects types monday refuses to write through column_values', () => {
    ['formula', 'mirror', 'file', 'auto_number', 'creation_log', 'button', 'progress']
      .forEach((type) => {
        expect(isSupportedFormColumnType(type)).toBe(false);
      });
  });

  it('rejects an unknown, null or empty type instead of throwing', () => {
    expect(isSupportedFormColumnType('not_a_column_type')).toBe(false);
    expect(isSupportedFormColumnType(null)).toBe(false);
    expect(isSupportedFormColumnType('')).toBe(false);
  });
});

describe('getFieldSpec', () => {
  it('names the control each type renders with', () => {
    expect(getFieldSpec('people').control).toBe('people');
    expect(getFieldSpec('checkbox').control).toBe('checkbox');
    expect(getFieldSpec('timeline').control).toBe('timeline');
    expect(getFieldSpec('rating').control).toBe('rating');
    expect(getFieldSpec('status').control).toBe('status');
    expect(getFieldSpec('dropdown').control).toBe('dropdown');
    expect(getFieldSpec('long_text').control).toBe('textarea');
    expect(getFieldSpec('numbers').control).toBe('number');
    expect(getFieldSpec('text').control).toBe('text');
  });

  it('returns null for an unregistered type', () => {
    expect(getFieldSpec('formula')).toBeNull();
  });
});

describe('columnValuesSelection', () => {
  it('emits only the typed fragments the requested types need', () => {
    const selection = columnValuesSelection(['people', 'checkbox']);
    expect(selection).toContain('... on PeopleValue { persons_and_teams { id kind } }');
    expect(selection).toContain('... on CheckboxValue { checked }');
    expect(selection).not.toContain('RatingValue');
    expect(selection).not.toContain('TimelineValue');
  });

  it('always selects the column metadata the controls need for their options', () => {
    // dropdown/status/rating controls read their labels off column.settings.
    expect(columnValuesSelection(['text'])).toContain('column { id title type settings }');
  });

  it('emits one fragment per value type even when two column types share it', () => {
    // people and person are distinct column types backed by the same PeopleValue.
    const selection = columnValuesSelection(['people', 'person', 'people']);
    expect(selection.match(/on PeopleValue/g)).toHaveLength(1);
  });

  it('ignores unregistered types rather than emitting a broken fragment', () => {
    const selection = columnValuesSelection(['formula', 'people']);
    expect(selection).toContain('... on PeopleValue { persons_and_teams { id kind } }');
    expect(selection).not.toContain('undefined');
    expect(selection).not.toContain('Formula');
  });
});

describe('dropdownOptionsFrom', () => {
  // PROBE-CAPTURED settings (board 18424030023, API 2026-04). monday normalizes a
  // column created with `name` to `label`, and ids come back as NUMBERS here while
  // the cell's values come back as STRINGS — the control has to match the form
  // value shape, so options expose string ids.
  const PROBE_SETTINGS = {
    labels: [
      { id: 1, label: 'Design', is_deactivated: false },
      { id: 2, label: 'QA', is_deactivated: false },
    ],
  };

  it('maps the column labels to string-id options in board order', () => {
    expect(dropdownOptionsFrom(PROBE_SETTINGS)).toEqual([
      { id: '1', label: 'Design' },
      { id: '2', label: 'QA' },
    ]);
  });

  it('hides a deactivated label so it cannot be picked', () => {
    expect(dropdownOptionsFrom({
      labels: [
        { id: 1, label: 'Design', is_deactivated: false },
        { id: 2, label: 'Retired', is_deactivated: true },
      ],
    })).toEqual([{ id: '1', label: 'Design' }]);
  });

  it('accepts settings that arrived as a JSON string', () => {
    expect(dropdownOptionsFrom(JSON.stringify(PROBE_SETTINGS))).toEqual([
      { id: '1', label: 'Design' },
      { id: '2', label: 'QA' },
    ]);
  });

  it('returns no options for missing, empty or unparseable settings', () => {
    expect(dropdownOptionsFrom(null)).toEqual([]);
    expect(dropdownOptionsFrom({})).toEqual([]);
    expect(dropdownOptionsFrom('{not json')).toEqual([]);
    expect(dropdownOptionsFrom({ labels: 'nope' })).toEqual([]);
  });

  it('skips a label with no usable id rather than offering a broken option', () => {
    expect(dropdownOptionsFrom({
      labels: [{ id: null, label: 'Orphan' }, { id: 4, label: 'Real' }],
    })).toEqual([{ id: '4', label: 'Real' }]);
  });
});

describe('prefillFieldValue', () => {
  it('reads a people column as id+kind entries, keeping teams distinguishable', () => {
    expect(prefillFieldValue('people', {
      persons_and_teams: [{ id: 4012345, kind: 'person' }, { id: 99, kind: 'team' }],
    })).toEqual([{ id: '4012345', kind: 'person' }, { id: '99', kind: 'team' }]);
  });

  it('reads a dropdown column as label ids, not display text', () => {
    expect(prefillFieldValue('dropdown', {
      text: 'Design, QA',
      values: [{ id: 3, label: 'Design' }, { id: 7, label: 'QA' }],
    })).toEqual(['3', '7']);
  });

  it('reads label id 0 off a status column as a real selection', () => {
    // Label id 0 is a valid monday label — truthiness checks lose it.
    expect(prefillFieldValue('status', { index: 0, text: 'Working on it' })).toBe('0');
  });

  it('reads an unset status column as no selection', () => {
    expect(prefillFieldValue('status', { index: null, text: '' })).toBe('');
  });

  it('reads a checked and an unchecked checkbox as booleans', () => {
    expect(prefillFieldValue('checkbox', { checked: true })).toBe(true);
    expect(prefillFieldValue('checkbox', { checked: false })).toBe(false);
  });

  it('reads a timeline column as two plain dates, not the ISO timestamps monday sends', () => {
    // PROBE-CAPTURED shape (board 18424030023, API 2026-04): TimelineValue.from/to
    // come back as full ISO timestamps with an offset, which an <input type="date">
    // rejects outright.
    expect(prefillFieldValue('timeline', {
      from: '2026-07-01T00:00:00+00:00',
      to: '2026-07-09T00:00:00+00:00',
    })).toEqual({ from: '2026-07-01', to: '2026-07-09' });
  });

  it('reads a rating as a number and an unrated cell as null', () => {
    expect(prefillFieldValue('rating', { rating: 4 })).toBe(4);
    expect(prefillFieldValue('rating', { rating: null })).toBeNull();
  });

  it('reads a date-only cell without inventing a time', () => {
    expect(prefillFieldValue('date', { date: '2026-07-28', time: null }))
      .toEqual({ date: '2026-07-28', time: '' });
  });

  it('reads a date+time cell as the wall clock monday already localized, with no second shift', () => {
    // PROBE-CAPTURED (board 18424030023, API 2026-04): writing UTC 2026-07-27
    // 21:30:00 read back as date 2026-07-28 / time 00:30 — DateValue's typed
    // fields arrive in the ACCOUNT timezone, so converting again double-shifts.
    // The WRITE side is still UTC (see serializeFieldValue) — the asymmetry is
    // monday's, not ours.
    expect(prefillFieldValue('date', { date: '2026-07-28', time: '00:30' }))
      .toEqual({ date: '2026-07-28', time: '00:30' });
  });

  it('trims the seconds off a stored time so a time input can hold it', () => {
    expect(prefillFieldValue('date', { date: '2026-07-28', time: '09:05:00' }))
      .toEqual({ date: '2026-07-28', time: '09:05' });
  });

  it('reads the contact columns off the stored JSON, not the display text', () => {
    expect(prefillFieldValue('email', { text: 'Ilai', value: '{"email":"a@b.com","text":"Ilai"}' }))
      .toBe('a@b.com');
    expect(prefillFieldValue('phone', { text: '', value: '{"phone":"+972500000000"}' }))
      .toBe('+972500000000');
    expect(prefillFieldValue('link', { text: 'site', value: '{"url":"https://x.co","text":"site"}' }))
      .toBe('https://x.co');
  });

  it('falls back to the display text when the stored JSON is corrupt', () => {
    expect(prefillFieldValue('email', { text: 'a@b.com', value: '{not json' })).toBe('a@b.com');
  });

  it('reads an absent column value as that type empty value', () => {
    expect(prefillFieldValue('people', null)).toEqual([]);
    expect(prefillFieldValue('dropdown', null)).toEqual([]);
    expect(prefillFieldValue('checkbox', null)).toBe(false);
    expect(prefillFieldValue('rating', null)).toBeNull();
    expect(prefillFieldValue('timeline', null)).toEqual({ from: '', to: '' });
    expect(prefillFieldValue('date', null)).toEqual({ date: '', time: '' });
    expect(prefillFieldValue('text', null)).toBe('');
  });
});

describe('serializeFieldValue', () => {
  it('writes people as personsAndTeams with numeric ids and their kind', () => {
    expect(serializeFieldValue('people', [{ id: '4012345', kind: 'person' }, { id: '99', kind: 'team' }]))
      .toEqual({ personsAndTeams: [{ id: 4012345, kind: 'person' }, { id: 99, kind: 'team' }] });
  });

  it('defaults a people entry with no kind to a person', () => {
    expect(serializeFieldValue('people', [{ id: 7 }]))
      .toEqual({ personsAndTeams: [{ id: 7, kind: 'person' }] });
  });

  it('writes a dropdown by label ids and never mixes in labels', () => {
    const payload = serializeFieldValue('dropdown', ['3', '7']);
    expect(payload).toEqual({ ids: ['3', '7'] });
    expect(payload).not.toHaveProperty('labels');
  });

  it('writes a checked checkbox as checked:"true"', () => {
    expect(serializeFieldValue('checkbox', true)).toEqual({ checked: 'true' });
  });

  it('writes an unchecked checkbox as null, the only shape that clears it', () => {
    // {checked:"false"} does NOT uncheck — verified in column-formats.md.
    expect(serializeFieldValue('checkbox', false)).toBeNull();
  });

  it('writes a status by its label id, including id 0', () => {
    expect(serializeFieldValue('status', '2')).toEqual({ index: 2 });
    expect(serializeFieldValue('status', '0')).toEqual({ index: 0 });
  });

  it('writes a timeline as its two ends', () => {
    expect(serializeFieldValue('timeline', { from: '2026-07-01', to: '2026-07-09' }))
      .toEqual({ from: '2026-07-01', to: '2026-07-09' });
  });

  it('writes a rating as a number', () => {
    expect(serializeFieldValue('rating', 4)).toEqual({ rating: 4 });
  });

  it('writes a date-only value verbatim, with no time key', () => {
    const payload = serializeFieldValue('date', { date: '2026-07-28', time: '' });
    expect(payload).toEqual({ date: '2026-07-28' });
  });

  it('writes a date+time as one UTC instant, never a local date beside a UTC time', () => {
    // The bug this pins: 00:30 local in Asia/Jerusalem falls on the PREVIOUS UTC
    // date, so both parts must come from the same instant.
    const payload = serializeFieldValue('date', { date: '2026-07-28', time: '00:30' });
    expect(payload.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(new Date(`${payload.date}T${payload.time}Z`).getTime())
      .toBe(new Date(2026, 6, 28, 0, 30, 0, 0).getTime());
  });

  it('writes the monday clear shape for every type when the value is empty', () => {
    expect(serializeFieldValue('date', { date: '', time: '' })).toEqual({});
    expect(serializeFieldValue('timeline', { from: '', to: '' })).toEqual({});
    expect(serializeFieldValue('status', '')).toEqual({});
    expect(serializeFieldValue('rating', null)).toEqual({});
    expect(serializeFieldValue('people', [])).toEqual({ personsAndTeams: [] });
    expect(serializeFieldValue('dropdown', [])).toEqual({ ids: [] });
    expect(serializeFieldValue('email', '')).toEqual({});
    expect(serializeFieldValue('numbers', '')).toBe('');
  });

  it('keeps writing the v1 types exactly as before', () => {
    expect(serializeFieldValue('text', 'hello')).toBe('hello');
    expect(serializeFieldValue('long_text', 'hello')).toEqual({ text: 'hello' });
    expect(serializeFieldValue('numbers', 12)).toBe('12');
    expect(serializeFieldValue('email', 'a@b.com')).toEqual({ email: 'a@b.com', text: 'a@b.com' });
    expect(serializeFieldValue('phone', '+972500000000'))
      .toEqual({ phone: '+972500000000', countryShortName: 'IL' });
    expect(serializeFieldValue('link', 'https://x.co'))
      .toEqual({ url: 'https://x.co', text: 'https://x.co' });
  });
});

describe('isFieldValueEmpty', () => {
  it('treats an unchecked required checkbox as unfilled', () => {
    // The browser's `required` attribute cannot express this — an unchecked box
    // is a valid form value, but a required checkbox must be CHECKED.
    expect(isFieldValueEmpty('checkbox', false)).toBe(true);
    expect(isFieldValueEmpty('checkbox', true)).toBe(false);
  });

  it('treats status label id 0 as filled', () => {
    expect(isFieldValueEmpty('status', '0')).toBe(false);
    expect(isFieldValueEmpty('status', '')).toBe(true);
  });

  it('treats a half-entered timeline as unfilled', () => {
    expect(isFieldValueEmpty('timeline', { from: '2026-07-01', to: '' })).toBe(true);
    expect(isFieldValueEmpty('timeline', { from: '', to: '2026-07-09' })).toBe(true);
    expect(isFieldValueEmpty('timeline', { from: '2026-07-01', to: '2026-07-09' })).toBe(false);
  });

  it('treats a zero rating as unfilled and one star as filled', () => {
    expect(isFieldValueEmpty('rating', 0)).toBe(true);
    expect(isFieldValueEmpty('rating', null)).toBe(true);
    expect(isFieldValueEmpty('rating', 1)).toBe(false);
  });

  it('treats an empty people or dropdown selection as unfilled', () => {
    expect(isFieldValueEmpty('people', [])).toBe(true);
    expect(isFieldValueEmpty('people', [{ id: '1', kind: 'person' }])).toBe(false);
    expect(isFieldValueEmpty('dropdown', [])).toBe(true);
    expect(isFieldValueEmpty('dropdown', ['3'])).toBe(false);
  });

  it('treats a date with no day as unfilled, and time alone as not enough', () => {
    expect(isFieldValueEmpty('date', { date: '', time: '09:00' })).toBe(true);
    expect(isFieldValueEmpty('date', { date: '2026-07-28', time: '' })).toBe(false);
  });

  it('treats whitespace-only text as unfilled', () => {
    expect(isFieldValueEmpty('text', '   ')).toBe(true);
    expect(isFieldValueEmpty('text', 'x')).toBe(false);
    expect(isFieldValueEmpty('numbers', '')).toBe(true);
  });

  it('treats the number zero as filled', () => {
    expect(isFieldValueEmpty('numbers', 0)).toBe(false);
    expect(isFieldValueEmpty('numbers', '0')).toBe(false);
  });
});

describe('sanitizeColumnValue', () => {
  it('drops a people payload whose every entry lacks a usable id', () => {
    expect(sanitizeColumnValue({ personsAndTeams: [{ id: null, kind: 'person' }] }))
      .toBeUndefined();
  });

  it('keeps the valid people entries and drops only the junk ones', () => {
    expect(sanitizeColumnValue({
      personsAndTeams: [{ id: 7, kind: 'person' }, { id: NaN, kind: 'person' }],
    })).toEqual({ personsAndTeams: [{ id: 7, kind: 'person' }] });
  });

  it('preserves a deliberately empty selection so a required field can be cleared', () => {
    expect(sanitizeColumnValue({ personsAndTeams: [] })).toEqual({ personsAndTeams: [] });
    expect(sanitizeColumnValue({ ids: [] })).toEqual({ ids: [] });
  });

  it('drops a dropdown payload of blank ids', () => {
    expect(sanitizeColumnValue({ ids: ['', null] })).toBeUndefined();
  });

  it('drops a status payload whose label id is not a number', () => {
    expect(sanitizeColumnValue({ index: NaN })).toBeUndefined();
    expect(sanitizeColumnValue({ index: 0 })).toEqual({ index: 0 });
  });

  it('passes the clear shapes through untouched', () => {
    expect(sanitizeColumnValue({})).toEqual({});
    expect(sanitizeColumnValue(null)).toBeNull();
    expect(sanitizeColumnValue('plain text')).toBe('plain text');
    expect(sanitizeColumnValue({ date: '2026-07-28' })).toEqual({ date: '2026-07-28' });
  });
});

describe('sanitizeColumnValues', () => {
  it('omits only the columns that sanitized to nothing', () => {
    expect(sanitizeColumnValues({
      status: { index: 2 },
      owner: { personsAndTeams: [{ id: null }] },
      notes: 'kept',
    })).toEqual({ status: { index: 2 }, notes: 'kept' });
  });

  it('returns an empty map for no input rather than throwing', () => {
    expect(sanitizeColumnValues(null)).toEqual({});
  });
});
