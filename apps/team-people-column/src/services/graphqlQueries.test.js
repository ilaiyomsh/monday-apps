// Shape gate for the six probed GraphQL operations. These are opaque strings at
// runtime, so the test pins the LOAD-BEARING tokens each operation must carry —
// the exact fields the service/domain layer reads out of the response and the
// exact operation names probeFixtures.js matches on. Transcribed against the
// probed, working operations in src/test-utils/probes/MANIFEST.md.
//
// This replaces the old test-guard placeholder waiver (graphqlQueries.js used to
// export empty strings) with a real gate: an empty/renamed/incomplete operation
// fails here.

import { describe, it, expect } from 'vitest';
import * as Q from './graphqlQueries.js';

describe('graphqlQueries — load-bearing tokens per probed operation', () => {
  it('GET_COLUMN_VALUE reads the relation linked_item_ids and the people persons_and_teams', () => {
    expect(Q.GET_COLUMN_VALUE).toContain('query GetColumnValue');
    expect(Q.GET_COLUMN_VALUE).toContain('linked_item_ids');
    expect(Q.GET_COLUMN_VALUE).toContain('persons_and_teams { id kind }');
    // `value` is the raw JSON string parseCellValue consumes for the own column.
    expect(Q.GET_COLUMN_VALUE).toContain('value');
  });

  it('GET_LINKED_ITEMS_PEOPLE reads the target items people persons_and_teams', () => {
    expect(Q.GET_LINKED_ITEMS_PEOPLE).toContain('query GetLinkedItemsPeople');
    expect(Q.GET_LINKED_ITEMS_PEOPLE).toContain('persons_and_teams { id kind }');
  });

  it('GET_TEAMS_MEMBERS reads team members and DROPS the complexity field (app version)', () => {
    expect(Q.GET_TEAMS_MEMBERS).toContain('query GetTeamsMembers');
    expect(Q.GET_TEAMS_MEMBERS).toContain('teams(ids:$teamIds)');
    // User photo migrated off the deprecated flat field to the typed sub-selection
    // (validated: User.photo_url: PhotoUrl { thumb ... }); service maps it back to photo_thumb.
    expect(Q.GET_TEAMS_MEMBERS).toContain('users { id name photo_url { thumb } }');
    // The probe carried complexity{}; the app version must NOT (contract).
    expect(Q.GET_TEAMS_MEMBERS).not.toContain('complexity');
  });

  it('GET_USERS_DETAILS fetches id/name/photo_url { thumb } for a user id list', () => {
    expect(Q.GET_USERS_DETAILS).toContain('query GetUsersDetails');
    expect(Q.GET_USERS_DETAILS).toContain('users(ids:$userIds)');
    expect(Q.GET_USERS_DETAILS).toContain('id name photo_url { thumb }');
  });

  it('GET_BOARD_COLUMNS reads column schema with the typed settings field only', () => {
    expect(Q.GET_BOARD_COLUMNS).toContain('query GetBoardColumns');
    expect(Q.GET_BOARD_COLUMNS).toContain('columns { id title type settings }');
  });

  it('UPDATE_COLUMN_VALUE writes via change_column_value with a JSON value', () => {
    expect(Q.UPDATE_COLUMN_VALUE).toContain('mutation UpdateColumnValue');
    expect(Q.UPDATE_COLUMN_VALUE).toContain('change_column_value');
    expect(Q.UPDATE_COLUMN_VALUE).toContain('$value:JSON!');
  });
});
