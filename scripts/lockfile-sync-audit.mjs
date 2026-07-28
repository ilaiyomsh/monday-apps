#!/usr/bin/env node
// lockfile-sync-audit.mjs — the gate nobody had: does each SERVER app's npm lockfile still
// agree with its package.json?
//
// Why this exists. monday-code runs `npm ci` inside a server app's pushed directory at
// deploy time. `npm ci` REFUSES to install when package.json and package-lock.json
// disagree. Nothing in CI read those lockfiles, so a desync was invisible until the deploy
// failed — which is exactly how sync-calender broke, and it was caught only AFTER the merge.
// Every other CI gate reported green on something it was not looking at.
//
// The check IS the platform's own command (`npm ci`, --dry-run so nothing is written), not a
// proxy for it. A reimplementation of npm's sync rules would be one more thing that can be
// green while npm is red.
//
// Scope is derived from the workflows, never hardcoded (root CLAUDE.md: read the app's
// workflow file, never assume): `-c` means client/CDN, where monday-code never runs npm at
// all, and `-d` gives the pushed directory. A future server app is covered the day its
// workflow lands.
//
// Every app is accounted for in the output — checked, or skipped WITH THE REASON. A gate
// that silently narrows its own scope reads as "covered everything" when it did not.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePushTarget, classifyPushTarget } from './lib/push-target.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_DIR = join(REPO, '.github/workflows');
const LOCKFILE = 'package-lock.json';

/** @type {{ checked: string[], skipped: Array<{app: string, why: string}>, failed: Array<{app: string, detail: string}> }} */
const report = { checked: [], skipped: [], failed: [] };

/**
 * Pull the actionable lines out of an npm failure. npm prints peer-dependency WARNINGS
 * before the error, and this repo's apps produce plenty of them (@vibe/core pins an old
 * react-dates), so a naive head-of-stderr buries the one line that says what to fix —
 * usually "npm ci can only install packages when your package.json and package-lock.json
 * are in sync" plus the Missing/Invalid list. Warnings are shown only when there is nothing
 * better, so the reader is never left with an empty explanation.
 */
function explain(stderr, stdout) {
  const lines = `${stderr || ''}\n${stdout || ''}`.split('\n').map((l) => l.trimEnd());
  const errors = lines.filter((l) => /^npm error/i.test(l.trim()) || /not in sync|Missing:|Invalid:/i.test(l));
  const chosen = errors.length > 0 ? errors : lines.filter((l) => l.trim() !== '').slice(-12);
  return chosen.slice(0, 20).join('\n') || '(npm produced no output)';
}

const workflows = readdirSync(WORKFLOW_DIR)
  .filter((f) => f.startsWith('deploy-draft-') && f.endsWith('.yml'))
  .sort();

if (workflows.length === 0) {
  console.error('lockfile-sync-audit: no deploy-draft-*.yml workflows found — refusing to report green.');
  process.exit(1);
}

for (const file of workflows) {
  const app = file.replace(/^deploy-draft-/, '').replace(/\.yml$/, '');
  const target = parsePushTarget(readFileSync(join(WORKFLOW_DIR, file), 'utf8'));

  // All the branching lives in the pure classifier (unit-tested in lib/push-target.test.mjs);
  // this loop only supplies filesystem facts and runs npm.
  const absDir = target.dir === null ? null : join(REPO, target.dir);
  const decision = classifyPushTarget(target, {
    dirExists: absDir !== null && existsSync(absDir),
    hasLockfile: absDir !== null && existsSync(join(absDir, LOCKFILE)),
  });

  if (decision.action === 'fail') {
    report.failed.push({ app, detail: `${decision.reason} (${file})` });
    continue;
  }
  if (decision.action === 'skip') {
    report.skipped.push({ app, why: decision.reason });
    continue;
  }

  const dir = /** @type {string} */ (absDir);
  process.stdout.write(`• ${app}: npm ci --dry-run in ${target.dir} … `);
  // --ignore-scripts: a dry run has no business executing arbitrary postinstall hooks in
  // CI. It does not affect the assertion — npm validates package.json/lock agreement
  // before it would run any script, which is the failure mode being gated.
  const run = spawnSync('npm', ['ci', '--dry-run', '--ignore-scripts'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  });

  if (run.error) {
    process.stdout.write('ERROR\n');
    report.failed.push({ app, detail: `could not run npm: ${run.error.message}` });
    continue;
  }
  if (run.status !== 0) {
    process.stdout.write('FAILED\n');
    report.failed.push({ app, detail: explain(run.stderr, run.stdout) });
    continue;
  }
  process.stdout.write('ok\n');
  report.checked.push(app);
}

console.log('\n── lockfile sync audit ──');
console.log(`checked: ${report.checked.length ? report.checked.join(', ') : '(none)'}`);
for (const s of report.skipped) console.log(`skipped: ${s.app} — ${s.why}`);

if (report.failed.length > 0) {
  console.error('\nFAILED:');
  for (const f of report.failed) console.error(`\n  ${f.app}:\n${f.detail.replace(/^/gm, '    ')}`);
  console.error(
    '\nThis is what monday-code runs at deploy time. Fix it by regenerating the lockfile in\n' +
      "that app's directory (npm install), then commit the result — do NOT hand-edit it.\n"
  );
  process.exit(1);
}

console.log('\nAll server-app lockfiles resolve. ✅');
