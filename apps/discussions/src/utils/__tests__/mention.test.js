import { describe, it, expect } from 'vitest';
import { buildMentionRoster, matchMentionQuery, filterMentionRoster } from '../mention.js';

describe('buildMentionRoster', () => {
  const discussion = {
    discussionLeadID: [{ id: 1, name: 'לאה מובילה' }],
    discussionCoordinatorID: [{ id: 2, name: 'רון רכז' }],
    participantsID: [
      { id: 3, name: 'דנה משתתפת' },
      { id: 1, name: 'לאה מובילה' }, // dup of the lead — collapses
      { name: 'אורח ללא מזהה' }, // id-less — kept, keyed by name
    ],
  };

  it('orders lead → coordinator → participants and dedupes by id', () => {
    const roster = buildMentionRoster(discussion);
    expect(roster.map((p) => p.name)).toEqual([
      'לאה מובילה', 'רון רכז', 'דנה משתתפת', 'אורח ללא מזהה',
    ]);
    // ids are stringified; the id-less guest is keyed by name.
    expect(roster[0].id).toBe('1');
    expect(roster[3].id).toBe('name:אורח ללא מזהה');
  });

  it('skips people with no name and tolerates missing columns', () => {
    expect(buildMentionRoster({ discussionLeadID: [{ id: 9 }, { id: 10, name: '' }] })).toEqual([]);
    expect(buildMentionRoster(null)).toEqual([]);
    expect(buildMentionRoster({})).toEqual([]);
  });

  it('round223 — appends EXTERNAL (text-only) participants after the mapped people', () => {
    const roster = buildMentionRoster({
      discussionLeadID: [{ id: 1, name: 'לאה מובילה' }],
      externalParticipantsID: 'אורח א, אורח ב',
    });
    expect(roster.map((p) => p.name)).toEqual(['לאה מובילה', 'אורח א', 'אורח ב']);
    // external names have no monday id → keyed by name.
    expect(roster[1].id).toBe('name:אורח א');
  });
});

describe('matchMentionQuery', () => {
  it('matches an @token at the caret (line start or after whitespace)', () => {
    expect(matchMentionQuery('@דנה')).toEqual({ query: 'דנה' });
    expect(matchMentionQuery('שלום @רון')).toEqual({ query: 'רון' });
    expect(matchMentionQuery('היי @')).toEqual({ query: '' }); // bare @ opens the full list
  });

  it('returns null when the @ is mid-word or absent', () => {
    expect(matchMentionQuery('email@host')).toBeNull(); // @ not after whitespace
    expect(matchMentionQuery('@דנה ')).toBeNull(); // a space ended the token
    expect(matchMentionQuery('no token here')).toBeNull();
    expect(matchMentionQuery('')).toBeNull();
  });
});

describe('filterMentionRoster', () => {
  const people = [
    { id: '1', name: 'דנה כהן' },
    { id: '2', name: 'דני לוי' },
    { id: '3', name: 'רון בר' },
  ];

  it('filters case-insensitively by substring and caps the list', () => {
    expect(filterMentionRoster(people, 'דנ').map((p) => p.id)).toEqual(['1', '2']);
    expect(filterMentionRoster(people, '').length).toBe(3); // empty query = all
    expect(filterMentionRoster(people, 'רון').map((p) => p.name)).toEqual(['רון בר']);
    expect(filterMentionRoster(people, 'רון', 1)).toHaveLength(1);
    expect(filterMentionRoster([], 'x')).toEqual([]);
  });
});
