// Shape gate for the probed GraphQL operations. These are opaque strings at
// runtime, so the test pins the LOAD-BEARING tokens each operation must carry —
// the exact fields the service/domain layer reads out of the response and the
// exact operation names probeFixtures.js matches on. Transcribed against the
// probed, working operations in src/test-utils/probes/MANIFEST.md.
//
// The resolve chain is TWO operations (round-trip consolidation, 2026-07):
// GetColumnValue nests the linked items' people column via linked_items, and
// GetTeamsAndUsers merges the former teams + users lookups behind @include.

import { describe, it, expect } from 'vitest';
import * as Q from './graphqlQueries.js';

describe('graphqlQueries — load-bearing tokens per probed operation', () => {
  it('GET_COLUMN_VALUE reads the relation linked_item_ids, the NESTED linked_items people column, and the own selection', () => {
    expect(Q.GET_COLUMN_VALUE).toContain('query GetColumnValue');
    expect(Q.GET_COLUMN_VALUE).toContain('linked_item_ids');
    // The linked items' people column is nested INSIDE the relation value —
    // this is what collapsed the former separate GetLinkedItemsPeople call.
    expect(Q.GET_COLUMN_VALUE).toContain('linked_items');
    expect(Q.GET_COLUMN_VALUE).toContain('column_values(ids:$peopleColumnIds)');
    expect(Q.GET_COLUMN_VALUE).toContain('persons_and_teams { id kind }');
    // `value` is the raw JSON string parseCellValue consumes for the own column.
    expect(Q.GET_COLUMN_VALUE).toContain('value');
  });

  it('GET_TEAMS_AND_USERS merges team members + user details behind @include gates', () => {
    expect(Q.GET_TEAMS_AND_USERS).toContain('query GetTeamsAndUsers');
    expect(Q.GET_TEAMS_AND_USERS).toContain('teams(ids:$teamIds) @include(if:$includeTeams)');
    expect(Q.GET_TEAMS_AND_USERS).toContain('users(ids:$userIds) @include(if:$includeUsers)');
    // User photo migrated off the deprecated flat field to the typed sub-selection
    // (validated: User.photo_url: PhotoUrl { thumb ... }); service maps it back to photo_thumb.
    expect(Q.GET_TEAMS_AND_USERS).toContain('users { id name photo_url { thumb } }');
    // Team avatar for the dialog title (validated: Team.picture_url: String;
    // live-probed 2026-07-14 — returns a real thumb URL for team 1348990).
    expect(Q.GET_TEAMS_AND_USERS).toContain('{ id name picture_url users');
    // The probe carried complexity{}; the app version must NOT (contract).
    expect(Q.GET_TEAMS_AND_USERS).not.toContain('complexity');
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
