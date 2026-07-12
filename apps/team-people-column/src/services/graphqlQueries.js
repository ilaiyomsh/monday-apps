// GraphQL operations for team-people-column.
//
// Transcribed VERBATIM from the probed, working operations captured in the
// sandbox — see src/test-utils/probes/MANIFEST.md for each operation's query,
// variables and the captured response it produced. The only deliberate
// deviation from the probes: GetTeamsMembers drops the `complexity { ... }`
// field the probe carried (the app never reads it), per the module contract.
//
// Export names follow the module contract; GET_COLUMN_VALUE / UPDATE_COLUMN_VALUE
// keep the template-contract names.

// q1 — source item's board_relation link + its own people-column selection.
// PeopleValue.persons_and_teams for the (rare) team selection; `value` is the raw
// JSON string parseCellValue consumes for the own-column selection.
export const GET_COLUMN_VALUE = `query GetColumnValue($itemIds:[ID!],$columnIds:[String!]){ items(ids:$itemIds){ id name column_values(ids:$columnIds){ id type text value ... on BoardRelationValue { linked_item_ids } ... on PeopleValue { persons_and_teams { id kind } } } } }`;

// q2 — the linked (target) items' people column (the team/person holder).
export const GET_LINKED_ITEMS_PEOPLE = `query GetLinkedItemsPeople($itemIds:[ID!],$columnIds:[String!]){ items(ids:$itemIds){ id name column_values(ids:$columnIds){ id type ... on PeopleValue { persons_and_teams { id kind } text } } } }`;

// q3 — team members. Probe carried `complexity { query before after }`; the app
// version omits it (contract). The User photo is selected via `photo_url { thumb }`
// (validated 2026-07 SDL: `User.photo_url: PhotoUrl { thumb ... }`); the flat
// `photo_thumb` field is deprecated (removed 2026-10). The service maps it back to
// the internal `photo_thumb` key at the boundary.
export const GET_TEAMS_MEMBERS = `query GetTeamsMembers($teamIds:[ID!]){ teams(ids:$teamIds){ id name users { id name photo_url { thumb } } } }`;

// q4 — user details for listed persons / stale-selection ids not covered by a team.
export const GET_USERS_DETAILS = `query GetUsersDetails($userIds:[ID!]){ users(ids:$userIds){ id name photo_url { thumb } } }`;

// Board schema for settings validation. Selects the typed `settings` object only
// (the deprecated stringified form is dead since 2025-10; `settings` is
// probe-verified populated for board_relation — see test-utils/probes/MANIFEST.md).
export const GET_BOARD_COLUMNS = `query GetBoardColumns($boardIds:[ID!]){ boards(ids:$boardIds){ id name columns { id title type settings } } }`;

// Write the chosen persons into the own people column (native people format).
export const UPDATE_COLUMN_VALUE = `mutation UpdateColumnValue($boardId:ID!,$itemId:ID!,$columnId:String!,$value:JSON!){ change_column_value(board_id:$boardId,item_id:$itemId,column_id:$columnId,value:$value){ id } }`;
