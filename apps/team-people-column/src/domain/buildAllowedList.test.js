import { describe, it, expect } from 'vitest';

import teamsMembers from '../test-utils/probes/GetTeamsMembers.json';
import usersDetails from '../test-utils/probes/GetUsersDetails.json';
import linkedItemsPeople from '../test-utils/probes/GetLinkedItemsPeople.json';
import { buildAllowedList } from './buildAllowedList.js';

// --- Real fixture slices (transcribed from captured probes) ---
// GetTeamsMembers.json holds the real team "test ilai" (id 1348990) with its
// three real members. GetUsersDetails.json holds the same three users as
// standalone user records. GetLinkedItemsPeople.json holds the real target
// item (12511510366) whose people column references that team.
const realTeam = teamsMembers.data.teams[0]; // { id:'1348990', name:'test ilai', users:[3] }
const realUsers = usersDetails.data.users; // [עידו, עילי, רוני]
const realLinkedItemId = linkedItemsPeople.data.items[0].id; // '12511510366'

const ido = realUsers.find((u) => u.id === '37022703'); // עידו פיוטרקובסקי
const ilai = realUsers.find((u) => u.id === '48274917'); // עילי שלם
const roni = realUsers.find((u) => u.id === '96863017'); // רוני ארגמן

// usersById map, keyed by string id, exactly as the service layer would hand it.
const usersById = {
  [ido.id]: ido,
  [ilai.id]: ilai,
  [roni.id]: roni,
};

// teamsMap: the real team plus two extra teams assembled ONLY from the real
// user records (same {id,name,photo_thumb} shape) so overlap/dedup is testable.
const TEAM_A = '1348990'; // real "test ilai": ido, ilai, roni
const TEAM_B = '2000001'; // צוות בטא: ilai, roni  (overlaps A on 2 members)
const TEAM_C = '2000002'; // צוות גמא: ilai only   (single, fully-overlapping member)

const teamsMap = {
  [TEAM_A]: realTeam, // carries no `picture` key -> must resolve to picture: null
  [TEAM_B]: { id: TEAM_B, name: 'צוות בטא', picture: 'https://example.test/beta.png', users: [ilai, roni] },
  [TEAM_C]: { id: TEAM_C, name: 'צוות גמא', users: [ilai] },
};

const UNION = { aggregation: 'union', includeListedPersons: true };
const STRICT = { aggregation: 'strict', includeListedPersons: true };

describe('buildAllowedList — union across items and teams', () => {
  it('unions two linked items referencing two teams into a deduped, he-name-sorted member set', () => {
    const perItemEntries = [
      { itemId: realLinkedItemId, entries: [{ id: TEAM_A, kind: 'team' }] },
      { itemId: '12511510367', entries: [{ id: TEAM_B, kind: 'team' }] },
    ];

    const result = buildAllowedList(perItemEntries, teamsMap, UNION, usersById);

    // Hand-computed: A={ido,ilai,roni} ∪ B={ilai,roni} = {ido,ilai,roni},
    // deduped on ilai & roni, sorted he: עידו < עילי < רוני.
    expect(result.users).toEqual([
      { id: ido.id, name: ido.name, photo_thumb: ido.photo_thumb },
      { id: ilai.id, name: ilai.name, photo_thumb: ilai.photo_thumb },
      { id: roni.id, name: roni.name, photo_thumb: roni.photo_thumb },
    ]);
    // Both referenced teams resolved, in encounter order. The team picture is
    // passed through for the dialog-title avatar (null when the map has none).
    expect(result.teams).toEqual([
      { id: TEAM_A, name: 'test ilai', picture: null },
      { id: TEAM_B, name: 'צוות בטא', picture: 'https://example.test/beta.png' },
    ]);
    expect(result.emptyChain).toBe(false);
    expect(result.missingTeamIds).toEqual([]);
  });

  it('dedupes a user that appears in two different teams to a single entry under union', () => {
    const perItemEntries = [
      { itemId: 'i1', entries: [{ id: TEAM_A, kind: 'team' }] },
      { itemId: 'i2', entries: [{ id: TEAM_C, kind: 'team' }] }, // ilai only
    ];

    const result = buildAllowedList(perItemEntries, teamsMap, UNION, usersById);

    const ids = result.users.map((u) => u.id);
    expect(ids).toEqual([ido.id, ilai.id, roni.id]); // ilai present exactly once
    expect(ids.filter((id) => id === ilai.id)).toHaveLength(1);
  });
});

describe('buildAllowedList — strict (intersection across items)', () => {
  it('returns only members common to both items under strict aggregation', () => {
    const perItemEntries = [
      { itemId: 'i1', entries: [{ id: TEAM_A, kind: 'team' }] }, // {ido,ilai,roni}
      { itemId: 'i2', entries: [{ id: TEAM_B, kind: 'team' }] }, // {ilai,roni}
    ];

    const result = buildAllowedList(perItemEntries, teamsMap, STRICT, usersById);

    // Intersection = {ilai, roni}, sorted he: עילי < רוני.
    expect(result.users.map((u) => u.id)).toEqual([ilai.id, roni.id]);
    expect(result.emptyChain).toBe(false);
  });

  it('yields an empty set with emptyChain true when items have no common members under strict', () => {
    const perItemEntries = [
      { itemId: 'i1', entries: [{ id: TEAM_C, kind: 'team' }] }, // {ilai}
      // person-only item resolving to a disjoint user (ido)
      { itemId: 'i2', entries: [{ id: ido.id, kind: 'person' }] }, // {ido}
    ];

    const result = buildAllowedList(perItemEntries, teamsMap, STRICT, usersById);

    expect(result.users).toEqual([]);
    expect(result.emptyChain).toBe(true);
  });
});

describe('buildAllowedList — listed persons', () => {
  it('resolves a person entry via usersById and unions it with the item team members when includeListedPersons is true', () => {
    const perItemEntries = [
      {
        itemId: 'i1',
        entries: [
          { id: TEAM_B, kind: 'team' }, // {ilai, roni}
          { id: ido.id, kind: 'person' }, // + עידו
        ],
      },
    ];

    const result = buildAllowedList(perItemEntries, teamsMap, UNION, usersById);

    expect(result.users.map((u) => u.id)).toEqual([ido.id, ilai.id, roni.id]);
  });

  it('ignores person entries entirely when includeListedPersons is false', () => {
    const perItemEntries = [
      {
        itemId: 'i1',
        entries: [
          { id: TEAM_B, kind: 'team' }, // {ilai, roni}
          { id: ido.id, kind: 'person' }, // must be ignored
        ],
      },
    ];
    const policy = { aggregation: 'union', includeListedPersons: false };

    const result = buildAllowedList(perItemEntries, teamsMap, policy, usersById);

    expect(result.users.map((u) => u.id)).toEqual([ilai.id, roni.id]);
    expect(result.users.map((u) => u.id)).not.toContain(ido.id);
  });

  it('dedupes a listed person already present as a team member to a single entry', () => {
    const perItemEntries = [
      {
        itemId: 'i1',
        entries: [
          { id: TEAM_A, kind: 'team' }, // {ido,ilai,roni}
          { id: ido.id, kind: 'person' }, // ido again
        ],
      },
    ];

    const result = buildAllowedList(perItemEntries, teamsMap, UNION, usersById);

    const ids = result.users.map((u) => u.id);
    expect(ids).toEqual([ido.id, ilai.id, roni.id]);
    expect(ids.filter((id) => id === ido.id)).toHaveLength(1);
  });
});

describe('buildAllowedList — missing team ids', () => {
  it('flags a team id absent from teamsMap in missingTeamIds and lets it contribute no members', () => {
    const perItemEntries = [
      {
        itemId: 'i1',
        entries: [
          { id: TEAM_A, kind: 'team' }, // resolves to {ido,ilai,roni}
          { id: '999999999', kind: 'team' }, // absent from teamsMap
        ],
      },
    ];

    const result = buildAllowedList(perItemEntries, teamsMap, UNION, usersById);

    expect(result.missingTeamIds).toEqual(['999999999']);
    // The missing team contributes nothing; only TEAM_A members survive.
    expect(result.users.map((u) => u.id)).toEqual([ido.id, ilai.id, roni.id]);
    // Only the resolved team is listed.
    expect(result.teams).toEqual([{ id: TEAM_A, name: 'test ilai', picture: null }]);
    expect(result.emptyChain).toBe(false);
  });
});

describe('buildAllowedList — empty inputs', () => {
  it('returns an empty result with emptyChain true for an empty perItemEntries array', () => {
    const result = buildAllowedList([], teamsMap, UNION, usersById);

    expect(result.users).toEqual([]);
    expect(result.teams).toEqual([]);
    expect(result.missingTeamIds).toEqual([]);
    expect(result.emptyChain).toBe(true);
  });

  it('returns emptyChain true when the only item has no entries', () => {
    const result = buildAllowedList(
      [{ itemId: 'i1', entries: [] }],
      teamsMap,
      UNION,
      usersById,
    );

    expect(result.users).toEqual([]);
    expect(result.emptyChain).toBe(true);
  });
});

describe('buildAllowedList — Hebrew name sort stability', () => {
  it('sorts members by he locale regardless of the order they arrive in the team', () => {
    // Same three real users, deliberately scrambled inside the team.
    const scrambledTeam = {
      id: 'scrambled',
      name: 'מעורבב',
      users: [roni, ido, ilai],
    };
    const perItemEntries = [
      { itemId: 'i1', entries: [{ id: 'scrambled', kind: 'team' }] },
    ];

    const result = buildAllowedList(
      perItemEntries,
      { scrambled: scrambledTeam },
      UNION,
      usersById,
    );

    expect(result.users.map((u) => u.name)).toEqual([
      ido.name, // עידו פיוטרקובסקי
      ilai.name, // עילי שלם
      roni.name, // רוני ארגמן
    ]);
  });

  it('coerces every output user id to a string', () => {
    const perItemEntries = [
      { itemId: 'i1', entries: [{ id: TEAM_A, kind: 'team' }] },
    ];

    const result = buildAllowedList(perItemEntries, teamsMap, UNION, usersById);

    for (const u of result.users) {
      expect(typeof u.id).toBe('string');
    }
  });
});
