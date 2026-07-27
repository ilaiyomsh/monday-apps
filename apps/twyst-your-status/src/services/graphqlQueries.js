export const GET_STATUS_COLUMN_CONTEXT = `
  query GetStatusColumnContext(
    $boardIds: [ID!]
    $itemIds: [ID!]
    $columnIds: [String!]
    $userIds: [ID!]
  ) {
    boards(ids: $boardIds) {
      id
      columns(ids: $columnIds) {
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
      }
    }
    users(ids: $userIds) {
      id
      name
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
        settings
      }
    }
  }
`;

export const GET_BOARD_SETTINGS_METADATA = `
  query GetBoardSettingsMetadata($boardIds: [ID!]) {
    boards(ids: $boardIds) {
      id
      columns {
        id
        title
        type
        settings
      }
    }
    users(limit: 500) {
      id
      name
      teams { id }
    }
    teams {
      id
      name
    }
  }
`;

export const GET_ITEM_FORM_VALUES = `
  query GetItemFormValues(
    $itemIds: [ID!]
    $columnIds: [String!]
  ) {
    items(ids: $itemIds) {
      id
      column_values(ids: $columnIds) {
        id
        type
        text
        value
        column { id title type }
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
