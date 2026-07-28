// Unit tests for push-target.mjs — node:test + stdlib only, matching the audit libs'
// "no dependencies" constraint. CI runs these via `node --test scripts/lib/*.test.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePushTarget } from './push-target.mjs';

/** A server-app push step as actually shipped (folded scalar, flags on their own lines). */
const SERVER_WORKFLOW = `
jobs:
  deploy:
    steps:
      - name: Push to latest DRAFT version
        run: >
          mapps code:push
          -d apps/axis/sync-calender/.
          -a "$APP_ID"
        env:
          MONDAY_TOKEN: \${{ secrets.MONDAY_TOKEN }}
          APP_ID: \${{ secrets.APP_AXIS_SYNC_CALENDER_ID }}
`;

const CLIENT_WORKFLOW = `
jobs:
  deploy:
    steps:
      - name: Push to latest DRAFT version
        run: >
          mapps code:push -c
          -d apps/discussions/build
          -a "$APP_ID"
        env:
          MONDAY_TOKEN: \${{ secrets.MONDAY_TOKEN }}
`;

test('reads a server push: no -c, and the pushed directory', () => {
  const t = parsePushTarget(SERVER_WORKFLOW);
  assert.equal(t.found, true);
  assert.equal(t.isClient, false);
  assert.equal(t.dir, 'apps/axis/sync-calender');
});

test('reads a client push: -c present', () => {
  const t = parsePushTarget(CLIENT_WORKFLOW);
  assert.equal(t.found, true);
  assert.equal(t.isClient, true);
  assert.equal(t.dir, 'apps/discussions/build');
});

test('normalises a trailing /. on the pushed directory', () => {
  const t = parsePushTarget(SERVER_WORKFLOW);
  assert.equal(t.dir, 'apps/axis/sync-calender'); // not '.../sync-calender/.'
});

test('tolerates extra flags around the command', () => {
  const t = parsePushTarget(`
      - name: Push
        run: >
          mapps code:push --verbose
          -d apps/deadline-confirm
          -a "$APP_ID"
`);
  assert.equal(t.isClient, false);
  assert.equal(t.dir, 'apps/deadline-confirm');
});

test('accepts a block scalar (run: |) as well as a folded one', () => {
  const t = parsePushTarget(`
      - name: Push
        run: |
          mapps code:push -c -d apps/team-people-column/dist -a "$APP_ID"
`);
  assert.equal(t.isClient, true);
  assert.equal(t.dir, 'apps/team-people-column/dist');
});

test('supports the long form --directory and --client', () => {
  const t = parsePushTarget(`
      - name: Push
        run: >
          mapps code:push --client
          --directory apps/x/dist
`);
  assert.equal(t.isClient, true);
  assert.equal(t.dir, 'apps/x/dist');
});

test('reports not-found when the workflow has no push step', () => {
  const t = parsePushTarget(`
jobs:
  ci:
    steps:
      - run: pnpm install
`);
  assert.equal(t.found, false);
  assert.equal(t.dir, null);
});

// A commented-out command must NOT be read as the real one: the shipped workflows carry
// explanatory comments that mention `code:push` and the -c flag verbatim, so a naive
// substring match would classify a server app as a client app and skip its lockfile.
test('ignores comment lines that mention code:push and -c', () => {
  const t = parsePushTarget(`
      # "-c" is for client-side (CDN) apps, empty for server-side apps.
      # strip them from public/admin before code:push. (Server runs from source)
      - name: Push
        run: >
          mapps code:push
          -d apps/axis/sync-calender/.
`);
  assert.equal(t.found, true);
  assert.equal(t.isClient, false, 'a -c inside a comment must not mark this a client app');
  assert.equal(t.dir, 'apps/axis/sync-calender');
});

test('does not mistake a -c substring inside a path for the client flag', () => {
  const t = parsePushTarget(`
      - name: Push
        run: >
          mapps code:push
          -d apps/axis/sync-calender
`);
  assert.equal(t.isClient, false);
});

test('stops at the step key that follows the command (env: is not a flag)', () => {
  const t = parsePushTarget(SERVER_WORKFLOW);
  // A parser that ran past `env:` would swallow the secret mapping into the flag list.
  assert.equal(t.dir, 'apps/axis/sync-calender');
  assert.equal(t.isClient, false);
});

// ---------------------------------------------------------------------------
// classifyPushTarget — the gate's per-app decision, kept pure so every branch is
// testable without a filesystem or a network. The runner stays thin I/O around it.
// ---------------------------------------------------------------------------
import { classifyPushTarget } from './push-target.mjs';

const server = { found: true, isClient: false, dir: 'apps/x', line: 10 };

test('checks a server app that has a lockfile', () => {
  const d = classifyPushTarget(server, { dirExists: true, hasLockfile: true });
  assert.equal(d.action, 'check');
  assert.equal(d.dir, 'apps/x');
});

test('skips a client app — monday-code never runs npm on a CDN push', () => {
  const d = classifyPushTarget({ ...server, isClient: true }, { dirExists: true, hasLockfile: true });
  assert.equal(d.action, 'skip');
  assert.match(d.reason, /client/i);
});

test('skips a server app with no lockfile — there is no agreement to verify', () => {
  const d = classifyPushTarget(server, { dirExists: true, hasLockfile: false });
  assert.equal(d.action, 'skip');
  assert.match(d.reason, /npm install/);
});

// An unreadable workflow must FAIL, never skip: a gate that cannot tell client from server
// cannot know whether a lockfile matters, and a silent skip would read as a pass.
test('fails when the workflow has no push step', () => {
  const d = classifyPushTarget({ found: false, isClient: false, dir: null, line: -1 }, { dirExists: true, hasLockfile: true });
  assert.equal(d.action, 'fail');
  assert.match(d.reason, /push/i);
});

test('fails when the push step has no -d directory', () => {
  const d = classifyPushTarget({ ...server, dir: null }, { dirExists: true, hasLockfile: true });
  assert.equal(d.action, 'fail');
  assert.match(d.reason, /director/i);
});

test('fails when the pushed directory does not exist', () => {
  const d = classifyPushTarget(server, { dirExists: false, hasLockfile: false });
  assert.equal(d.action, 'fail');
  assert.match(d.reason, /exist/i);
});

// Order matters: an unreadable workflow is a failure even for what looks like a client app,
// because the -c reading is exactly what cannot be trusted when parsing failed.
test('an unparsed workflow fails even when isClient happens to be false', () => {
  const d = classifyPushTarget({ found: false, isClient: true, dir: 'apps/x', line: -1 }, { dirExists: true, hasLockfile: true });
  assert.equal(d.action, 'fail');
});

// The push command is wrapped by scripts/mapps-push-retry.sh in the shipped workflows. The
// lockfile audit derives its scope from this parse, so the wrapper MUST be recognised — an
// unrecognised invocation makes every workflow read as unreadable, which the audit treats as
// a failure. Both forms stay supported so the two can coexist during any transition.
test('reads a push made through the retry wrapper (server)', () => {
  const t = parsePushTarget(`
      - name: Push to latest DRAFT version
        run: >
          bash scripts/mapps-push-retry.sh
          -d apps/axis/sync-calender/.
          -a "$APP_ID"
`);
  assert.equal(t.found, true);
  assert.equal(t.isClient, false);
  assert.equal(t.dir, 'apps/axis/sync-calender');
});

test('reads a client push made through the retry wrapper, with --force', () => {
  const t = parsePushTarget(`
      - name: FORCE push to LIVE
        run: >
          bash scripts/mapps-push-retry.sh -c --force
          -d apps/discussions/build
          -i "live-9"
`);
  assert.equal(t.found, true);
  assert.equal(t.isClient, true);
  assert.equal(t.dir, 'apps/discussions/build');
});
