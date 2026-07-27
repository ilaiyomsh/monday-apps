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

export const GET_WORKFLOW_BOARD_METADATA = `
  query WorkflowBoardMetadata($boardIds: [ID!]) {
    boards(ids: $boardIds) {
      id
      columns { id title type settings }
    }
    users(limit: 500) { id name teams { id } }
    teams { id name }
  }
`;

export const GET_WORKFLOW_ITEM_DATA = `
  query WorkflowItemData($boardIds: [ID!], $itemIds: [ID!], $columnIds: [String!], $statusColumnIds: [String!], $userIds: [ID!]) {
    boards(ids: $boardIds) { columns(ids: $statusColumnIds) { id title type settings } }
    items(ids: $itemIds) {
      id
      name
      column_values(ids: $columnIds) {
        id
        text
        value
        column { id title type }
        ... on StatusValue { index label label_style { color border } }
      }
    }
    users(ids: $userIds) { id name teams { id } }
  }
`;

export const GET_USERS_BY_IDS = `
  query WorkflowAuditUsers($userIds: [ID!]) {
    users(ids: $userIds) { id name }
  }
`;
