import { describe, expect, it } from 'vitest';
import {
  actorMatchesPeopleAssignments,
  parsePeopleColumnAssignments,
} from './peopleColumnGate.js';

describe('parsePeopleColumnAssignments', () => {
  it('reads personsAndTeams from a JSON value string (write-shape)', () => {
    expect(parsePeopleColumnAssignments(
      '{"personsAndTeams":[{"id":111,"kind":"person"},{"id":7,"kind":"team"}]}',
    )).toEqual({
      personIds: ['111'],
      teamIds: ['7'],
    });
  });

  it('reads persons_and_teams from a typed PeopleValue payload', () => {
    expect(parsePeopleColumnAssignments({
      persons_and_teams: [
        { id: '42', kind: 'person' },
        { id: '9', kind: 'team' },
        { id: '55', kind: 'agent' },
      ],
    })).toEqual({
      personIds: ['42', '55'],
      teamIds: ['9'],
    });
  });

  it('returns empty assignments for null, blank, or malformed values', () => {
    expect(parsePeopleColumnAssignments(null)).toEqual({ personIds: [], teamIds: [] });
    expect(parsePeopleColumnAssignments('')).toEqual({ personIds: [], teamIds: [] });
    expect(parsePeopleColumnAssignments('{')).toEqual({ personIds: [], teamIds: [] });
    expect(parsePeopleColumnAssignments({ value: null })).toEqual({ personIds: [], teamIds: [] });
  });
});

describe('actorMatchesPeopleAssignments', () => {
  it('matches when the actor is a listed person or belongs to a listed team', () => {
    const cell = { personIds: ['42'], teamIds: ['7'] };
    expect(actorMatchesPeopleAssignments({ userId: '42', teamIds: [] }, cell)).toBe(true);
    expect(actorMatchesPeopleAssignments({ userId: '99', teamIds: ['7'] }, cell)).toBe(true);
    expect(actorMatchesPeopleAssignments({ userId: '99', teamIds: ['8'] }, cell)).toBe(false);
  });

  it('rejects an empty people cell — nobody satisfies the gate', () => {
    expect(actorMatchesPeopleAssignments(
      { userId: '42', teamIds: ['7'] },
      { personIds: [], teamIds: [] },
    )).toBe(false);
    expect(actorMatchesPeopleAssignments({ userId: '42', teamIds: [] }, null)).toBe(false);
  });
});
