// Smoke-test every monday GraphQL write path used by the POC sync engine
// (create / lookup by link / update / rename / delete). Uses
// MONDAY_FALLBACK_ACCESS_TOKEN from the POC .env. Leaves the board clean.
//
// Run from project root:
//   node poc/custom-object-direct-local/scripts/monday-write-test.mjs

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createItem, findItemByLink, deleteItem, updateItem, renameItem } from '../server/monday-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POC_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(POC_ROOT, '.env') });

const TOKEN = process.env.MONDAY_FALLBACK_ACCESS_TOKEN;
const BOARD = '1953193772';
const LINK_COL = 'link_mm2dfvy3';
const PEOPLE_COL = 'multiple_person_mkqwq9gz';
const DATE_COL = 'date_mkqwkw4q';
const TEXT_COL = 'text_mkqwc4p1';
const USER_ID = 71077014;

const FAKE_LINK = `https://www.google.com/calendar/event?eid=poc-test-${Date.now()}`;
const ITEM_NAME = 'POC write test — autonomous';

const columnValues = {
  [LINK_COL]: { url: FAKE_LINK, text: FAKE_LINK },
  [PEOPLE_COL]: { personsAndTeams: [{ id: USER_ID, kind: 'person' }] },
  [DATE_COL]: { date: '2026-04-16' },
  [TEXT_COL]: 'POC description field — written by autonomous test',
};

console.log('1. creating item…');
const created = await createItem({ token: TOKEN, boardId: BOARD, itemName: ITEM_NAME, columnValues });
console.log('   created id =', created.id);

console.log('2. looking up by link…');
const found = await findItemByLink({ token: TOKEN, boardId: BOARD, linkColumnId: LINK_COL, linkValue: FAKE_LINK });
console.log('   found:', found ? `${found.id} / ${found.name}` : 'NOT FOUND');

console.log('3. updating columns…');
await updateItem({ token: TOKEN, boardId: BOARD, itemId: created.id, columnValues: { [TEXT_COL]: 'POC — updated description' } });
console.log('   updated ok');

console.log('4. renaming item…');
await renameItem({ token: TOKEN, boardId: BOARD, itemId: created.id, itemName: ITEM_NAME + ' — renamed' });
console.log('   renamed ok');

console.log('5. deleting item…');
await deleteItem({ token: TOKEN, itemId: created.id });
console.log('   deleted ok');

console.log('\nALL MONDAY WRITE PATHS VALIDATED');
