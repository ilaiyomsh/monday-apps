// M1 contract test — validates LocalStorage matches the SecureStorage interface
// consumed by channel-storage.js. Runs in-process, no HTTP, no server.
//
//   node tests/run.js m1-localstorage-contract
//
// Verifies:
//   1) get(<missing>) returns null
//   2) set(key, value) persists; get returns { value } (not the raw value)
//   3) delete(key) removes the entry
//   4) Re-opening a fresh instance over the same file sees the same data
//      (proving persistence, not just in-memory)
//   5) Concurrent writes to different keys don't corrupt the file

import { promises as fs } from 'fs';
import path from 'path';
import LocalStorage from '../../src/storage/local-storage.js';
import { assert, assertEq, assertionSummary } from '../lib/assert.js';

const TEST_FILE = path.resolve('.dev/m1-contract.json');

async function cleanFile() {
  try { await fs.unlink(TEST_FILE); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

export async function run() {
  console.log('▶ Scenario: m1-localstorage-contract');
  await cleanFile();

  const ls = new LocalStorage(TEST_FILE);

  // 1) missing key → null
  const missing = await ls.get('does-not-exist');
  assertEq(missing, null, 'get(missing) returns null');

  // 2) set + get round-trip (value is already JSON-stringified by caller)
  const jsonStr = JSON.stringify({ hello: 'world', n: 42 });
  await ls.set('k1', jsonStr);
  const got = await ls.get('k1');
  assertEq(got, { value: jsonStr }, 'get(k1) returns { value: <string> } matching SecureStorage contract');

  // 3) delete
  await ls.delete('k1');
  const gone = await ls.get('k1');
  assertEq(gone, null, 'get after delete returns null');

  // 4) persistence — new instance over same file sees writes
  await ls.set('k2', 'persisted');
  const ls2 = new LocalStorage(TEST_FILE);
  const persisted = await ls2.get('k2');
  assertEq(persisted, { value: 'persisted' }, 'second instance reads what first wrote');

  // 5) concurrent writes — kick off many sets in parallel; expect all to land.
  const writes = [];
  for (let i = 0; i < 20; i++) writes.push(ls.set(`concurrent-${i}`, String(i)));
  await Promise.all(writes);
  let allThere = true;
  for (let i = 0; i < 20; i++) {
    const v = await ls.get(`concurrent-${i}`);
    if (!v || v.value !== String(i)) { allThere = false; break; }
  }
  assert(allThere, '20 concurrent writes all persisted correctly');

  // 6) file is human-readable JSON (sanity)
  const raw = await fs.readFile(TEST_FILE, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  assert(parsed && typeof parsed === 'object', 'file content is valid JSON');
  assert(typeof parsed.k2 === 'object' && parsed.k2.value === 'persisted',
    'on-disk shape matches { <key>: { value: <string> } }');

  const { failures } = assertionSummary();
  // Cleanup test file on success so it doesn't leave droppings.
  if (failures === 0) await cleanFile();

  if (failures > 0) {
    console.error('\n✗ m1-localstorage-contract FAILED');
    process.exitCode = 1;
    return;
  }
  console.log('\n✓ m1-localstorage-contract PASSED');
}
