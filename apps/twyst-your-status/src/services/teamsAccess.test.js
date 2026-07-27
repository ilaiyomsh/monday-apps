import { describe, expect, it } from 'vitest';
import { isTeamsScopeError } from './teamsAccess.js';

describe('isTeamsScopeError', () => {
  it('detects monday teams scope / unauthorized field errors', () => {
    expect(isTeamsScopeError({
      message: "Unauthorized to load field 'Query.teams', Reason: missing required scopes.",
    })).toBe(true);
    expect(isTeamsScopeError({
      message: "Unauthorized to load field 'Query.users.teams', Reason: missing required scopes.",
    })).toBe(true);
    expect(isTeamsScopeError({
      message: 'Reason: missing required scopes.',
    })).toBe(true);
    expect(isTeamsScopeError(new Error('Graphql validation errors'))).toBe(true);
  });

  it('does not treat unrelated failures as a teams scope gap', () => {
    expect(isTeamsScopeError(new Error('הלוח לא נמצא'))).toBe(false);
    expect(isTeamsScopeError(new Error('Network Error'))).toBe(false);
  });
});
