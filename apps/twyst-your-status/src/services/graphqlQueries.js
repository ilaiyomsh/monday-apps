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

/** Requires teams:read. Loaded separately so missing scope does not break settings. */
export const GET_ACCOUNT_TEAMS = `
  query GetAccountTeams {
    teams {
      id
      name
    }
  }
`;

/**
 * Required-field values for one item. The selection comes from the columnFields
 * registry: `text`/`value` alone are NULL for people/dropdown/relation columns on
 * API 2025-04+, so every supported type contributes its typed fragment, and
 * `column.settings` rides along for the option-based controls.
 */
export const GET_ITEM_FORM_VALUES = `
  query GetItemFormValues(
    $itemIds: [ID!]
    $columnIds: [String!]
  ) {
    items(ids: $itemIds) {
      id
      column_values(ids: $columnIds) {
        ${ALL_COLUMN_VALUE_FIELDS}
      }
    }
  }
`;

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
    }
  }
`;

export const UPDATE_MULTIPLE_COLUMN_VALUES = `
  mutation UpdateMultipleColumnValues(
    $boardId: ID!
    $itemId: ID!
    $columnValues: JSON!
  ) {
    change_multiple_column_values(
      board_id: $boardId
      item_id: $itemId
      column_values: $columnValues
    ) {
      id
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
