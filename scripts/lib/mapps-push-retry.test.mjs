// Unit tests for scripts/mapps-push-retry.sh — node:test + stdlib only. CI runs these via
// the existing `node --test scripts/lib/*.test.mjs` step.
//
// The retry logic is exercised against a STUB mapps binary (MAPPS_BIN), so nothing here can
// reach the platform. Backoff is set to 0s so the suite stays fast.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'mapps-push-retry.sh');

/**
 * Build a stub `mapps` that appends each invocation to a log and exits with the code taken
 * from a scripted list (one per attempt, last value reused).
 */
function stubMapps(exitCodes) {
  const dir = mkdtempSync(join(tmpdir(), 'push-retry-'));
  const log = join(dir, 'calls.log');
  const codes = join(dir, 'codes');
  writeFileSync(codes, exitCodes.join('\n') + '\n');
  const bin = join(dir, 'mapps');
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
echo "$@" >> ${JSON.stringify(log)}
n=$(wc -l < ${JSON.stringify(log)} | tr -d ' ')
code=$(sed -n "\${n}p" ${JSON.stringify(codes)})
[ -z "$code" ] && code=$(tail -n 1 ${JSON.stringify(codes)})
exit "$code"
`
  );
  chmodSync(bin, 0o755);
  return { bin, log, dir };
}

function run(stub, args, env = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MAPPS_BIN: stub.bin, PUSH_BACKOFF: '0,0,0', ...env },
  });
  const calls = existsSync(stub.log)
    ? readFileSync(stub.log, 'utf8').split('\n').filter(Boolean)
    : [];
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls };
}

test('a first-attempt success runs the push exactly once and exits 0', () => {
  const stub = stubMapps([0]);
  const r = run(stub, ['-d', 'apps/x/.', '-a', '123']);
  assert.equal(r.status, 0);
  assert.equal(r.calls.length, 1);
});

test('passes every flag through to code:push verbatim, in order', () => {
  const stub = stubMapps([0]);
  const r = run(stub, ['-c', '--force', '-d', 'apps/x/dist', '-i', 'live-9']);
  assert.equal(r.calls[0], 'code:push -c --force -d apps/x/dist -i live-9');
});

test('retries a transient failure and succeeds on the second attempt', () => {
  const stub = stubMapps([1, 0]);
  const r = run(stub, ['-d', 'apps/x/.']);
  assert.equal(r.status, 0);
  assert.equal(r.calls.length, 2);
});

// A push that needed more than one try is a signal about platform health; recovering
// silently would hide it.
test('announces a recovery so repeated flakiness stays visible', () => {
  const stub = stubMapps([1, 0]);
  const r = run(stub, ['-d', 'apps/x/.']);
  assert.match(r.stdout, /succeeded on attempt 2\/3/);
});

test('gives up after PUSH_ATTEMPTS and fails the job with the last exit code', () => {
  const stub = stubMapps([7, 7, 7]);
  const r = run(stub, ['-d', 'apps/x/.']);
  assert.equal(r.calls.length, 3);
  assert.equal(r.status, 7, 'the real exit code must survive so the job fails');
  assert.match(r.stderr, /failed after 3 attempt/);
});

test('honours PUSH_ATTEMPTS=1 (no retry at all)', () => {
  const stub = stubMapps([1]);
  const r = run(stub, ['-d', 'apps/x/.'], { PUSH_ATTEMPTS: '1' });
  assert.equal(r.calls.length, 1);
  assert.notEqual(r.status, 0);
});

test('retries up to a raised PUSH_ATTEMPTS, reusing the last backoff value', () => {
  const stub = stubMapps([1, 1, 1, 0]);
  const r = run(stub, ['-d', 'apps/x/.'], { PUSH_ATTEMPTS: '4', PUSH_BACKOFF: '0' });
  assert.equal(r.status, 0);
  assert.equal(r.calls.length, 4);
});

test('rejects a non-numeric PUSH_ATTEMPTS instead of silently pushing once', () => {
  const stub = stubMapps([0]);
  const r = run(stub, ['-d', 'apps/x/.'], { PUSH_ATTEMPTS: 'lots' });
  assert.equal(r.status, 2);
  assert.equal(r.calls.length, 0);
  assert.match(r.stderr, /PUSH_ATTEMPTS/);
});

test('refuses to run with no flags — an argument-less push is a wiring mistake', () => {
  const stub = stubMapps([0]);
  const r = run(stub, []);
  assert.equal(r.status, 2);
  assert.equal(r.calls.length, 0);
});
