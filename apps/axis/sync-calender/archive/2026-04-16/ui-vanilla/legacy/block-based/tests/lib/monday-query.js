// Lightweight monday GraphQL helper for tests (verification queries).
export async function mondayQuery({ token, query, variables = {} }) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': '2026-04',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`monday API error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// Finds items by exact name match using items_page_by_column_values on the
// built-in "name" column, which monday indexes immediately on create — much
// faster/more reliable than scanning a paginated items_page and filtering
// client-side (that has ~10s indexing lag under load).
export async function findItemsByName({ token, boardId, name, limit = 5 }) {
  const data = await mondayQuery({
    token,
    query: `
      query FindItemsByName($boardId: ID!, $name: String!) {
        items_page_by_column_values(
          board_id: $boardId,
          columns: [{ column_id: "name", column_values: [$name] }],
          limit: 25
        ) {
          items {
            id
            name
            column_values {
              id
              text
              value
              type
            }
          }
        }
      }
    `,
    variables: { boardId, name },
  });
  const items = data.items_page_by_column_values?.items || [];
  return items.slice(0, limit);
}
