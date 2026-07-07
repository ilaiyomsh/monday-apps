function gql(token, query, variables = {}) {
  return fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  }).then(async (res) => {
    const data = await res.json();
    if (!res.ok || data.errors) {
      throw new Error(`monday graphql failed: ${res.status} ${JSON.stringify(data.errors || data)}`);
    }
    return data.data;
  });
}

export async function exchangeMondayCodeForToken({ code, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch('https://auth.monday.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    throw new Error(`monday token exchange failed: ${res.status}`);
  }
  return res.json();
}

export async function findItemByLink({ token, boardId, linkColumnId, linkValue }) {
  const query = `
    query ($boardId: ID!, $columnId: String!, $value: String!) {
      items_page_by_column_values(board_id: $boardId, columns: [{ column_id: $columnId, column_values: [$value] }], limit: 1) {
        items { id name }
      }
    }
  `;

  const data = await gql(token, query, {
    boardId: String(boardId),
    columnId: linkColumnId,
    value: linkValue,
  });

  return data.items_page_by_column_values?.items?.[0] || null;
}

export async function createItem({ token, boardId, itemName, columnValues }) {
  const query = `
    mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) { id }
    }
  `;
  const data = await gql(token, query, {
    boardId: String(boardId),
    itemName,
    columnValues: JSON.stringify(columnValues),
  });
  return data.create_item;
}

export async function updateItem({ token, boardId, itemId, columnValues }) {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id }
    }
  `;
  return gql(token, query, {
    boardId: String(boardId),
    itemId: String(itemId),
    columnValues: JSON.stringify(columnValues),
  });
}

export async function renameItem({ token, boardId, itemId, itemName }) {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $value) { id }
    }
  `;
  return gql(token, query, {
    boardId: String(boardId),
    itemId: String(itemId),
    value: itemName,
  });
}

export async function deleteItem({ token, itemId }) {
  const query = `
    mutation ($itemId: ID!) {
      delete_item(item_id: $itemId) { id }
    }
  `;
  return gql(token, query, { itemId: String(itemId) });
}
