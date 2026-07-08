import { promises as fs } from 'fs';
import path from 'path';
import { mondayQuery } from './monday-query.js';

// Remove a local-storage file between tests. Missing file is a no-op.
export async function clearLocalStorage(file = '.dev/storage.json') {
  const abs = path.resolve(file);
  try {
    await fs.unlink(abs);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

// Manual helper — delete all items on the test board whose name starts with
// the given prefix (default "test-"). Intentionally NOT wired into any
// scenario teardown: per project policy items stay on the board for manual
// inspection. Invoke explicitly when you're ready to clean up:
//
//   node -e "import('./tests/lib/cleanup.js').then(m=>m.deleteItemsByPrefix().then(console.log))"
//
// Uses env defaults (MONDAY_API_TOKEN, TEST_BOARD_ID) unless overridden.
export async function deleteItemsByPrefix(opts = {}) {
  const { loadTestConfig } = await import('./config.js');
  const cfg = loadTestConfig();
  const token = opts.token || cfg.mondayApiToken;
  const boardId = opts.boardId || cfg.boardId;
  const prefix = opts.prefix ?? 'test-';

  const data = await mondayQuery({
    token,
    query: `
      query BoardItems($id: ID!) {
        boards(ids: [$id]) {
          items_page(limit: 500) {
            items { id name }
          }
        }
      }
    `,
    variables: { id: boardId },
  });
  const items = data.boards?.[0]?.items_page?.items ?? [];
  const toDelete = items.filter((i) => i.name?.startsWith(prefix));

  const deleted = [];
  for (const it of toDelete) {
    await mondayQuery({
      token,
      query: `mutation DeleteItem($id: ID!) { delete_item(item_id: $id) { id } }`,
      variables: { id: it.id },
    });
    deleted.push({ id: it.id, name: it.name });
  }

  return { deletedCount: deleted.length, deleted };
}
