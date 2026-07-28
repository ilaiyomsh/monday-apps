// Structure-aware reader for a deploy workflow's `mapps code:push` step — node stdlib only,
// matching error-wiring-audit.mjs's "no dependencies" constraint.
//
// Why this exists: the lockfile gate has to know which apps monday-code actually runs
// `npm ci` for. That is decided by ONE thing in the workflow — the `-c` flag (client/CDN vs
// server/monday-code) — and by `-d`, the pushed directory. The root CLAUDE.md is explicit
// that build output dirs vary per app and must be READ from the workflow, never assumed, so
// the gate derives both from the file instead of carrying a hardcoded app list that would
// silently miss the next server app.
//
// Comments are excluded deliberately: the shipped workflows explain the `-c` convention in
// prose right above the step ("-c is for client-side (CDN) apps, empty for server-side"), so
// a substring match would read every server app as a client app and skip exactly the
// lockfiles this gate exists to check.

/** @typedef {{ found: boolean, isClient: boolean, dir: string|null, line: number }} PushTarget */

const indentOf = (line) => line.length - line.trimStart().length;
const isComment = (line) => line.trimStart().startsWith('#');
const isBlank = (line) => line.trim() === '';
/** A mapping key like `env:` — where the command's continuation lines end. */
const KEY_RE = /^([A-Za-z_][\w.-]*)\s*:(?:\s|$)/;
const ITEM_RE = /^-\s+/;

/**
 * The push invocation, in either shipped form: the bare CLI, or the retry wrapper that runs
 * it (scripts/mapps-push-retry.sh). Both carry the SAME -c/-d flags, which is all this
 * reader needs. Recognising both matters because the lockfile audit derives its scope from
 * this parse — if the wrapper were unrecognised the audit would report every workflow
 * unreadable, which it treats as a failure rather than a silent pass.
 */
const PUSH_INVOCATION_RE = /mapps\s+code:push|mapps-push-retry\.sh/;

/**
 * Find the `mapps code:push` invocation and read its client flag + pushed directory.
 *
 * The command lives in a `run:` scalar (folded `>` or literal `|`), so its flags may sit on
 * following lines. Continuation stops at the first line that dedents to or past the
 * command's own indentation — which is where the next step key (`env:`) or list item sits.
 *
 * @param {string} text raw workflow YAML
 * @returns {PushTarget}
 */
export function parsePushTarget(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => !isComment(l) && PUSH_INVOCATION_RE.test(l));
  if (start === -1) return { found: false, isClient: false, dir: null, line: -1 };

  const commandIndent = indentOf(lines[start]);
  const parts = [lines[start].trim()];

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line)) break;
    if (isComment(line)) continue;
    if (indentOf(line) < commandIndent) break; // dedented out of the run: scalar
    const trimmed = line.trimStart();
    if (ITEM_RE.test(trimmed)) break; // next step
    if (KEY_RE.test(trimmed) && indentOf(line) <= commandIndent) break; // e.g. `env:`
    parts.push(trimmed);
  }

  // Token-level flag reading: a `-c` SUBSTRING inside a path (apps/axis/sync-calender)
  // must never register as the client flag.
  const tokens = parts.join(' ').split(/\s+/).filter(Boolean);
  const isClient = tokens.includes('-c') || tokens.includes('--client');

  let dir = null;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === '-d' || tokens[i] === '--directory') {
      dir = tokens[i + 1];
      break;
    }
  }
  if (dir !== null) {
    dir = dir.replace(/\/\.$/, '').replace(/\/$/, ''); // `apps/x/.` and `apps/x/` → `apps/x`
    if (dir === '') dir = '.';
  }

  return { found: true, isClient, dir, line: start + 1 };
}

/**
 * Decide what the lockfile gate should do with one app. Pure, so every branch is testable
 * without a filesystem or a network — the runner does the I/O and calls this.
 *
 * `fail` outcomes come FIRST and deliberately outrank the client check: when the workflow
 * could not be read, the `-c` reading is precisely the thing that cannot be trusted, so
 * treating an unparsed workflow as "probably a client app, skip it" would let a server app
 * slip through unchecked while the gate still reported green.
 *
 * @param {PushTarget} target
 * @param {{ dirExists: boolean, hasLockfile: boolean }} fsFacts
 * @returns {{ action: 'check'|'skip'|'fail', reason: string, dir: string|null }}
 */
export function classifyPushTarget(target, fsFacts) {
  const { dirExists, hasLockfile } = fsFacts;
  if (!target || target.found !== true) {
    return { action: 'fail', reason: "no 'mapps code:push' step found in the workflow", dir: null };
  }
  if (target.dir === null || target.dir === undefined) {
    return { action: 'fail', reason: 'push step has no -d/--directory flag', dir: null };
  }
  if (target.isClient) {
    return {
      action: 'skip',
      reason: 'client (CDN) app — monday-code never runs npm on it',
      dir: target.dir,
    };
  }
  if (!dirExists) {
    return { action: 'fail', reason: `pushed directory '${target.dir}' does not exist`, dir: target.dir };
  }
  if (!hasLockfile) {
    // No lockfile means monday-code resolves with `npm install` instead — a different
    // (unpinned) risk, but there is no lockfile/manifest agreement to verify here.
    return {
      action: 'skip',
      reason: 'server app with no package-lock.json — monday-code resolves via npm install',
      dir: target.dir,
    };
  }
  return { action: 'check', reason: 'server app with a lockfile', dir: target.dir };
}
