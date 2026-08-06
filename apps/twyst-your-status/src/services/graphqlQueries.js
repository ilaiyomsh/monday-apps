import { ALL_COLUMN_VALUE_FIELDS } from '../domain/columnFields.js';

export const GET_STATUS_COLUMN_CONTEXT = `
  query GetStatusColumnContext(
    $boardIds: [ID!]
    $itemIds: [ID!]
    $columnIds: [String!]
  ) {
    boards(ids: $boardIds) {
      id
      columns(ids: $columnIds) {
        id
        title
        type
        revision
        settings
      }
    }
    items(ids: $itemIds) {
      id
      name
      column_values(ids: $columnIds) {
        id
        type
        text
        value
        column { id title type }
        ... on StatusValue {
          index
          label
          is_done
          label_style {
            color
            border
          }
        }
        ... on PeopleValue {
          persons_and_teams {
            id
            kind
          }
        }
      }
    }
  }
`;

/** Requires teams:read. Loaded separately so missing scope does not break the picker. */
export const GET_USER_TEAM_IDS = `
  query GetUserTeamIds($userIds: [ID!]) {
    users(ids: $userIds) {
      id
      teams { id }
    }
  }
`;

export const GET_STATUS_COLUMN_SETTINGS = `
  query GetStatusColumnSettings(
    $boardIds: [ID!]
    $columnIds: [String!]
  ) {
    boards(ids: $boardIds) {
      id
      columns(ids: $columnIds) {
        id
        title
        type
        revision
        settings
      }
    }
  }
`;

/** Boards + account users — does not require teams:read. */
export const GET_BOARD_SETTINGS_METADATA = `
  query GetBoardSettingsMetadata($boardIds: [ID!]) {
    boards(ids: $boardIds) {
      id
      columns {
        id
        title
        type
        revision
        settings
      }
    }
    users(limit: 500) {
      id
      name
      photo_thumb
    }
  }
`;

/**
 * Board user owners — who may open the settings overlay.
 *
 * `owners` needs boards:read + users:read only, so it is asked ALONE: monday rejects a
 * whole query when one field is out of scope, and folding `team_owners` (teams:read) in
 * here would mean a missing scope locks every owner out instead of just the team-owned
 * ones. `owner` is deprecated (it returned the creator) — `owners` is the real list.
 */
export const GET_BOARD_OWNER_IDS = `
  query GetBoardOwnerIds($boardIds: [ID!]) {
    boards(ids: $boardIds) {
      id
      owners { id }
    }
  }
`;

/**
 * Board TEAM owners. Requires teams:read, so it is a separate round trip that may be
 * refused (see teamsAccess.loadBoardTeamOwnerIds) — and it is only sent when the actor
 * turned out not to be a direct user owner.
 *
 * `team_owners` is paginated and defaults to 25. One page is taken: a board owned by
 * more teams than this is not a shape that occurs.
 */
export const GET_BOARD_TEAM_OWNER_IDS = `
  query GetBoardTeamOwnerIds($boardIds: [ID!], $limit: Int!) {
    boards(ids: $boardIds) {
      id
      team_owners(limit: $limit) { id }
    }
  }
`;

/** Requires teams:read. Loaded separately so missing scope does not break settings. */
export const GET_ACCOUNT_TEAMS = `
  query GetAccountTeams {
    teams {
      id
      name
    }
  }
`;

/*
 * Avatar URLs use monday's photo_thumb (API 2026-04 pin — photo_url { thumb } only
 * exists from 2026-07).
 */
export const GET_ACCOUNT_USERS = 'query AccountUsers($limit: Int) { users(limit: $limit) { id name photo_thumb } }';

/**
 * Everything the required-fields modal needs, in one round trip: the gated status
 * column's labels (to name the label being written) plus the item's current values
 * for the required columns. The modal is a separate iframe with no state from the
 * picker, so it re-reads rather than inherits.
 */
export const GET_REQUIRED_FIELDS_CONTEXT = `
  query GetRequiredFieldsContext(
    $boardIds: [ID!]
    $statusColumnIds: [String!]
    $itemIds: [ID!]
    $columnIds: [String!]
  ) {
    boards(ids: $boardIds) {
      id
      columns(ids: $statusColumnIds) {
        id
        title
        type
        settings
      }
    }
    items(ids: $itemIds) {
      id
      name
      column_values(ids: $columnIds) {
        ${ALL_COLUMN_VALUE_FIELDS}
      }
    }
  }
`;

/**
 * Candidate items of the board(s) a connected-boards column points at.
 *
 * ONE page, no cursor follow-up: this feeds a picker inside a required-fields form, and
 * a form that blocks a status transition must not sit through an unbounded crawl. The
 * `cursor` is still selected so the control can TELL the user the list was truncated
 * rather than quietly showing a prefix (see BoardRelationFieldControl).
 *
 * Search is client-side. monday cannot server-filter a relation's candidates by
 * anything but item NAME, and `items_page(query_params:)` on a large board costs
 * complexity we do not need for a list this size.
 */
export const GET_LINKED_BOARD_ITEMS = `
  query GetLinkedBoardItems(
    $boardIds: [ID!]
    $limit: Int!
  ) {
    boards(ids: $boardIds) {
      id
      name
      items_page(limit: $limit) {
        cursor
        items {
          id
          name
        }
      }
    }
  }
`;

/**
 * Write one status value — and echo the column back.
 *
 * The echo is not diagnostics: the picker CLOSES on this response and the closing is
 * the user's only confirmation, so it must be able to tell "the status is now what
 * was picked" from "a request came back". `change_column_value` returns `Item`, and
 * `StatusValue.index` carries the label **id** (probe-verified round trip —
 * monday-api references/column-formats.md). Checked by domain/statusWriteResult.js.
 */
export const UPDATE_STATUS_COLUMN_VALUE = `
  mutation UpdateStatusColumnValue(
    $boardId: ID!
    $itemId: ID!
    $columnId: String!
    $value: JSON!
  ) {
    change_column_value(
      board_id: $boardId
      item_id: $itemId
      column_id: $columnId
      value: $value
    ) {
      id
      column_values(ids: [$columnId]) {
        id
        text
        value
        ... on StatusValue {
          index
          label
        }
      }
    }
  }
`;

/**
 * Write the form columns and the status together, and echo the STATUS column back —
 * same reason as above: the fill form closes on this response.
 *
 * `$statusColumnId` is the gated column, which is also one of the keys inside
 * `$columnValues`; it is passed separately because a GraphQL selection cannot reach
 * into a JSON argument.
 */
export const UPDATE_MULTIPLE_COLUMN_VALUES = `
  mutation UpdateMultipleColumnValues(
    $boardId: ID!
    $itemId: ID!
    $columnValues: JSON!
    $statusColumnId: String!
  ) {
    change_multiple_column_values(
      board_id: $boardId
      item_id: $itemId
      column_values: $columnValues
    ) {
      id
      column_values(ids: [$statusColumnId]) {
        id
        text
        value
        ... on StatusValue {
          index
          label
        }
      }
    }
  }
`;

/** Fresh revision for optimistic concurrency on update_status_column. */
export const GET_STATUS_COLUMN_REVISION = `
  query GetStatusColumnRevision(
    $boardIds: [ID!]
    $columnIds: [String!]
  ) {
    boards(ids: $boardIds) {
      id
      columns(ids: $columnIds) {
        id
        type
        revision
        settings
      }
    }
  }
`;
