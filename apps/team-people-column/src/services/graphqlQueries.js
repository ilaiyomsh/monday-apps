// GraphQL operations for team-people-column.
//
// Transcribed VERBATIM from the probed, working operations captured in the
// sandbox — see src/test-utils/probes/MANIFEST.md for each operation's query,
// variables and the captured response it produced. The only deliberate
// deviation from the probes: the app versions drop the `complexity { ... }`
// field the probes carried (the app never reads it), per the module contract.
//
// Round-trip budget: the monday-sdk-js iframe bridge SERIALIZES api() calls and
// each carries proxy overhead, so the resolve chain is consolidated into TWO
// operations (was four): q1 nests the linked items' people column via
// BoardRelationValue.linked_items, and q2 merges the teams + users root fields
// into one document gated by @include directives.

// q1 — source item's board_relation link + the linked (target) items' people
// column (nested via linked_items) + the item's own people-column selection.
// PeopleValue.persons_and_teams for the (rare) team selection; `value` is the
// raw JSON string parseCellValue consumes for the own-column selection.
// Probed complexity: 34 (single item, single linked item).
export const GET_COLUMN_VALUE = `query GetColumnValue($itemIds:[ID!],$columnIds:[String!],$peopleColumnIds:[String!]){ items(ids:$itemIds){ id name column_values(ids:$columnIds){ id type text value ... on BoardRelationValue { linked_item_ids linked_items { id name column_values(ids:$peopleColumnIds){ id type ... on PeopleValue { persons_and_teams { id kind } text } } } } ... on PeopleValue { persons_and_teams { id kind } } } } }`;

// q2 — team members + user details in ONE document. @include lets either root
// field be skipped when its id list is empty (probe-verified: the skipped field
// is absent from the response). The User photo is selected via
// `photo_url { thumb }` (validated 2026-07 SDL; flat `photo_thumb` is removed
// in 2026-10). QUIRK (probed 2026-07): on the ROOT `users(ids:)` field,
// photo_url resolves null for users other than `me`; the nested
// `teams { users { photo_url } }` selection returns real URLs — so the service
// prefers team-resolved details when a user appears in both.
// Team.picture_url feeds the dialog-title avatar (validated 2026-10 SDL;
// live-probed 2026-07-14 — real thumb URL for team 1348990).
// Probed complexity: 46 (one team of 3 + one user).
export const GET_TEAMS_AND_USERS = `query GetTeamsAndUsers($teamIds:[ID!],$userIds:[ID!],$includeTeams:Boolean!,$includeUsers:Boolean!){ teams(ids:$teamIds) @include(if:$includeTeams) { id name picture_url users { id name photo_url { thumb } } } users(ids:$userIds) @include(if:$includeUsers) { id name photo_url { thumb } } }`;

// Board schema for settings validation. Selects the typed `settings` object only
// (the deprecated stringified form is dead since 2025-10; `settings` is
// probe-verified populated for board_relation — see test-utils/probes/MANIFEST.md).
export const GET_BOARD_COLUMNS = `query GetBoardColumns($boardIds:[ID!]){ boards(ids:$boardIds){ id name columns { id title type settings } } }`;

// Write the chosen persons into the own people column (native people format).
export const UPDATE_COLUMN_VALUE = `mutation UpdateColumnValue($boardId:ID!,$itemId:ID!,$columnId:String!,$value:JSON!){ change_column_value(board_id:$boardId,item_id:$itemId,column_id:$columnId,value:$value){ id } }`;
