import { describe, expect, it } from 'vitest';
import { columnText, cvSelection } from '../columnText.js';

// Every `cv` fixture below is a VERBATIM capture from the live probe on
// 2026-07-29 (API 2026-04) recorded in scratchpad/monday-probe-findings.md
// → FIXTURES, board 18424252636. Do not tidy the shapes: `text`/`value` really
// are null on the relation/mirror family, `display_value` really is "" (never
// null) on an empty mirror, and an empty date column really is "" not null.

const MIRROR_SINGLE = {
  id: 'wzmirror',
  type: 'mirror',
  text: null,
  value: null,
  display_value: 'Alpha',
  mirrored_items: [
    {
      linked_board_id: '18424252630',
      linked_item: { id: '12660747977', name: 'WZ-S1' },
      mirrored_value: { id: 'srctext', text: 'Alpha', value: '"Alpha"' },
    },
  ],
};

const MIRROR_MULTI = {
  id: 'wzmirror',
  type: 'mirror',
  text: null,
  value: null,
  display_value: 'Alpha, Beta',
  mirrored_items: [
    {
      linked_board_id: '18424252630',
      linked_item: { id: '12660747977', name: 'WZ-S1' },
      mirrored_value: { id: 'srctext', text: 'Alpha', value: '"Alpha"' },
    },
    {
      linked_board_id: '18424252630',
      linked_item: { id: '12660747980', name: 'WZ-S2' },
      mirrored_value: { id: 'srctext', text: 'Beta', value: '"Beta"' },
    },
  ],
};

const MIRROR_EMPTY = {
  id: 'wzmirror',
  type: 'mirror',
  text: null,
  value: null,
  display_value: '',
  mirrored_items: [],
};

// ONE mirrored value whose own text contains ", " — byte-identical to two values.
const MIRROR_AMBIGUOUS = {
  id: 'wzmirror',
  type: 'mirror',
  text: null,
  value: null,
  display_value: 'Gamma, Delta',
  mirrored_items: [
    {
      linked_board_id: '18424252630',
      linked_item: { id: '12660747982', name: 'WZ-S3' },
      mirrored_value: { id: 'srctext', text: 'Gamma, Delta', value: '"Gamma, Delta"' },
    },
  ],
};

const DATE_PLAIN = {
  id: 'wzdate',
  type: 'date',
  text: '2026-07-20',
  value: '{"date":"2026-07-20"}',
  date: '2026-07-20',
  time: '',
  updated_at: null,
};

// Probe 2026-07-28: a date WITH a time reads back as date + "HH:MM" (seconds
// already stripped by monday, and both parts already in the account timezone).
const DATE_WITH_TIME = {
  id: 'wzdate',
  type: 'date',
  text: '2026-07-28 00:30',
  value: '{"date":"2026-07-28","time":"00:30:00"}',
  date: '2026-07-28',
  time: '00:30',
  updated_at: null,
};

// Empty-value READ shapes probe (2026-07-14): an unset date is "" — not null.
const DATE_EMPTY = { id: 'wzdate', type: 'date', text: '', value: null, date: '', time: '' };

const PEOPLE_ASSIGNED = {
  id: 'wzpeople',
  type: 'people',
  text: 'עילי שלם',
  value: '{"personsAndTeams":[{"id":48274917,"kind":"person"}]}',
  persons_and_teams: [{ id: '48274917', kind: 'person' }],
  updated_at: null,
};

const PEOPLE_EMPTY = {
  id: 'wzpeople',
  type: 'people',
  text: '',
  value: null,
  persons_and_teams: [],
  updated_at: null,
};

const RELATION = {
  id: 'wzlink',
  type: 'board_relation',
  text: null,
  value: null,
  linked_item_ids: ['12660747977', '12660747980'],
  display_value: 'WZ-S1, WZ-S2',
};

describe('cvSelection', () => {
  it('always asks for id and text', () => {
    expect(cvSelection([])).toBe('id text');
  });

  it('asks for nothing beyond id/text for types whose text field is populated', () => {
    // status / dropdown / text / long_text / numbers all answer through the
    // ColumnValue interface `text`, so a typed fragment would be dead weight.
    expect(cvSelection(['status', 'dropdown', 'text', 'long_text', 'numbers'])).toBe('id text');
  });

  it('selects date and time for a date column', () => {
    expect(cvSelection(['date'])).toBe('id text ... on DateValue { date time }');
  });

  it('selects persons_and_teams with kind for a people column', () => {
    expect(cvSelection(['people'])).toBe(
      'id text ... on PeopleValue { persons_and_teams { id kind } text }'
    );
  });

  it('treats the role name "person" as the people column type', () => {
    expect(cvSelection(['person'])).toBe(cvSelection(['people']));
  });

  it('selects display_value ONLY for a mirror column', () => {
    // display_value is what the CELL renders and what domain/committees.js splits into
    // names. `mirrored_items { … mirrored_value { … } }` was here and is deliberately
    // gone: it cost ~+8 complexity per query and did not even work for the common case
    // (a status/dropdown source is not a probe-confirmed member of the MirroredValue
    // union, so it matched no fragment), which then drove a fallback that read the
    // linked item's TITLE as the committee name. Do not re-add it without probing the
    // union's membership first — see ../committees.js.
    expect(cvSelection(['mirror'])).toBe('id text ... on MirrorValue { display_value }');
  });

  it('selects display_value for a formula column', () => {
    expect(cvSelection(['formula'])).toBe('id text ... on FormulaValue { display_value }');
  });

  it('selects display_value and linked_item_ids for a board_relation column', () => {
    expect(cvSelection(['board_relation'])).toBe(
      'id text ... on BoardRelationValue { display_value linked_item_ids }'
    );
  });

  it('selects from and to for a timeline column', () => {
    expect(cvSelection(['timeline'])).toBe('id text ... on TimelineValue { from to }');
  });

  it('selects checked for a checkbox column', () => {
    expect(cvSelection(['checkbox'])).toBe('id text ... on CheckboxValue { checked }');
  });

  it('emits each fragment once for a repeated type', () => {
    expect(cvSelection(['date', 'date', 'date'])).toBe(cvSelection(['date']));
  });

  it('emits the people fragment once when both people and person are requested', () => {
    expect(cvSelection(['people', 'person'])).toBe(cvSelection(['people']));
  });

  it('keeps the fragments in first-appearance order of the requested types', () => {
    expect(cvSelection(['mirror', 'date'])).toBe(
      `id text ... on MirrorValue { display_value } ... on DateValue { date time }`
    );
    expect(cvSelection(['date', 'mirror'])).toBe(
      `id text ... on DateValue { date time } ... on MirrorValue { display_value }`
    );
  });

  it('adds no fragment for an unknown column type', () => {
    // An invented inline fragment is a hard UNAUTHORIZED_FIELD_OR_TYPE error
    // that kills the whole query — an unknown type must degrade to text.
    expect(cvSelection(['jackpot_column'])).toBe('id text');
  });

  it('survives a nullish types argument', () => {
    expect(cvSelection()).toBe('id text');
    expect(cvSelection(null)).toBe('id text');
  });

  it('ignores nullish entries inside the types array', () => {
    expect(cvSelection([null, 'date', undefined, ''])).toBe(cvSelection(['date']));
  });
});

describe('columnText — mirror', () => {
  it('renders the full display_value of a single-valued mirror', () => {
    expect(columnText('mirror', MIRROR_SINGLE)).toBe('Alpha');
  });

  it('renders the full comma-joined display_value of a multi-valued mirror', () => {
    expect(columnText('mirror', MIRROR_MULTI)).toBe('Alpha, Beta');
  });

  it('renders an empty mirror as an empty string', () => {
    expect(columnText('mirror', MIRROR_EMPTY)).toBe('');
  });

  it('renders a single value that itself contains ", " verbatim', () => {
    expect(columnText('mirror', MIRROR_AMBIGUOUS)).toBe('Gamma, Delta');
  });

  it('does not fall back to the always-null text field of a mirror', () => {
    expect(columnText('mirror', { ...MIRROR_SINGLE, display_value: '' })).toBe('');
  });
});

describe('columnText — date', () => {
  it('renders a date-only column as the ISO date', () => {
    expect(columnText('date', DATE_PLAIN)).toBe('2026-07-20');
  });

  it('appends HH:MM when the column carries a time', () => {
    expect(columnText('date', DATE_WITH_TIME)).toBe('2026-07-28 00:30');
  });

  it('trims seconds off a time that still carries them', () => {
    expect(columnText('date', { ...DATE_WITH_TIME, time: '09:05:00' })).toBe('2026-07-28 09:05');
  });

  it('renders an unset date (empty strings, not null) as an empty string', () => {
    expect(columnText('date', DATE_EMPTY)).toBe('');
  });

  it('falls back to text when the typed date field was not selected', () => {
    expect(columnText('date', { id: 'wzdate', type: 'date', text: '2026-07-20' })).toBe(
      '2026-07-20'
    );
  });
});

describe('columnText — people', () => {
  it('renders the joined display names of the assignees', () => {
    expect(columnText('people', PEOPLE_ASSIGNED)).toBe('עילי שלם');
  });

  it('renders an unassigned people column as an empty string', () => {
    expect(columnText('people', PEOPLE_EMPTY)).toBe('');
  });
});

describe('columnText — relation family', () => {
  it('renders a board_relation from display_value, never from its null text', () => {
    expect(columnText('board_relation', RELATION)).toBe('WZ-S1, WZ-S2');
  });

  it('renders a formula from display_value', () => {
    expect(
      columnText('formula', { id: 'f', type: 'formula', text: null, value: null, display_value: '17.5%' })
    ).toBe('17.5%');
  });

  it('renders an empty formula as an empty string', () => {
    expect(columnText('formula', { id: 'f', type: 'formula', text: null, display_value: null })).toBe(
      ''
    );
  });
});

describe('columnText — timeline', () => {
  it('slices the full ISO timestamps down to a YYYY-MM-DD range', () => {
    // Probe 2026-07-28: from/to come back as "2026-07-01T00:00:00+00:00".
    expect(
      columnText('timeline', {
        id: 't',
        type: 'timeline',
        text: null,
        from: '2026-07-01T00:00:00+00:00',
        to: '2026-07-10T00:00:00+00:00',
      })
    ).toBe('2026-07-01 - 2026-07-10');
  });

  it('renders a half-open timeline as the single endpoint it has', () => {
    expect(
      columnText('timeline', { id: 't', type: 'timeline', from: '2026-07-01T00:00:00+00:00', to: null })
    ).toBe('2026-07-01');
  });

  it('renders an empty timeline as an empty string', () => {
    expect(columnText('timeline', { id: 't', type: 'timeline', text: null, from: null, to: null })).toBe(
      ''
    );
  });
});

describe('columnText — plain and option types', () => {
  it('renders text and long_text from text', () => {
    expect(columnText('text', { id: 'a', type: 'text', text: 'שורה' })).toBe('שורה');
    expect(columnText('long_text', { id: 'b', type: 'long_text', text: 'פסקה\nשנייה' })).toBe(
      'פסקה\nשנייה'
    );
  });

  it('renders an empty text column as an empty string, never null', () => {
    expect(columnText('text', { id: 'a', type: 'text', text: null })).toBe('');
  });

  it('renders a status label from text', () => {
    expect(columnText('status', { id: 's', type: 'status', text: 'בעבודה', index: 0 })).toBe('בעבודה');
  });

  it('renders an unset status (text null) as an empty string', () => {
    expect(columnText('status', { id: 's', type: 'status', text: null, index: null })).toBe('');
  });

  it('renders a dropdown from text', () => {
    expect(columnText('dropdown', { id: 'd', type: 'dropdown', text: 'א, ב' })).toBe('א, ב');
  });

  it('renders numbers, which monday returns as a STRING, unchanged', () => {
    expect(columnText('numbers', { id: 'n', type: 'numbers', text: '42.5', value: '42.5' })).toBe(
      '42.5'
    );
  });

  it('renders a numeric zero rather than treating it as empty', () => {
    expect(columnText('numbers', { id: 'n', type: 'numbers', text: '0', value: '0' })).toBe('0');
    expect(columnText('numbers', { id: 'n', type: 'numbers', text: null, number: 0 })).toBe('0');
  });

  it('coerces a numbers value that arrives as a real number', () => {
    expect(columnText('numbers', { id: 'n', type: 'numbers', text: null, number: 42.5 })).toBe('42.5');
  });

  it('renders an empty numbers column as an empty string', () => {
    expect(columnText('numbers', { id: 'n', type: 'numbers', text: '', value: null })).toBe('');
  });

  it('renders a checked checkbox in Hebrew and an unchecked one as empty', () => {
    expect(columnText('checkbox', { id: 'c', type: 'checkbox', checked: true })).toBe('כן');
    expect(columnText('checkbox', { id: 'c', type: 'checkbox', checked: false })).toBe('');
    expect(columnText('checkbox', { id: 'c', type: 'checkbox', checked: null })).toBe('');
  });

  it('does not treat the string "false" as checked', () => {
    expect(columnText('checkbox', { id: 'c', type: 'checkbox', checked: 'false' })).toBe('');
  });
});

describe('columnText — fallbacks and guards', () => {
  it('falls back to text for an unknown column type', () => {
    expect(columnText('vote', { id: 'v', type: 'vote', text: '3' })).toBe('3');
  });

  it('returns an empty string for an unknown type with no text', () => {
    expect(columnText('vote', { id: 'v', type: 'vote', text: null })).toBe('');
  });

  it('returns an empty string when the column value is missing entirely', () => {
    // An items_page row omits column_values entries the item never had, so the
    // caller legitimately hands us undefined — this must not throw.
    expect(columnText('date', undefined)).toBe('');
    expect(columnText('mirror', null)).toBe('');
    expect(columnText(undefined, undefined)).toBe('');
  });

  it('never returns anything but a string for any supported type', () => {
    const cases = [
      ['mirror', MIRROR_EMPTY],
      ['formula', { display_value: null }],
      ['date', DATE_EMPTY],
      ['text', {}],
      ['long_text', {}],
      ['numbers', {}],
      ['status', {}],
      ['dropdown', {}],
      ['people', PEOPLE_EMPTY],
      ['checkbox', {}],
      ['board_relation', {}],
      ['timeline', {}],
      ['nonsense', {}],
    ];
    for (const [type, cv] of cases) {
      expect(typeof columnText(type, cv), `type ${type}`).toBe('string');
    }
  });
});
