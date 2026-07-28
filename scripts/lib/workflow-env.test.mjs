// Unit tests for the workflow structure reader behind the error-wiring audit's deploy-env
// check. Runner is node:test (stdlib) — the audit script and its lib carry no dependencies.
//   node --test scripts/lib/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseWorkflowSteps, auditWorkflowEnv } from './workflow-env.mjs';

const KEYS = ['VITE_AXIOM_DATASET', 'VITE_AXIOM_TOKEN', 'VITE_AXIOM_APP'];
const audit = (text, requiredKeys = KEYS) => auditWorkflowEnv(text, { requiredKeys });

/** A correctly wired build step, used as the baseline every fixture below deviates from. */
const GOOD = `name: deploy
on:
  push:
    branches: [develop]
jobs:
  deploy-draft:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Build app
        # a comment mentioning VITE_AXIOM_TOKEN must not count as wiring
        env:
          VITE_AXIOM_DATASET: app-errors
          VITE_AXIOM_TOKEN: \${{ secrets.AXIOM_INGEST_TOKEN }}
          VITE_AXIOM_APP: my-app
        run: pnpm build

      - name: Push
        run: npx mapps code:push
`;

test('a correctly wired workflow reports no errors', () => {
  assert.deepEqual(audit(GOOD).errors, []);
});

test('the second env: block in one step is reported as a duplicate key', () => {
  // The exact defect shipped in deploy-{draft,live}-deadline-confirm.yml: an env: block was
  // appended AFTER run: instead of the existing one being edited in place.
  const broken = GOOD.replace(
    '        run: pnpm build\n',
    '        run: pnpm build\n        env:\n          VITE_AXIOM_APP: my-app-admin\n',
  );
  const { errors } = audit(broken);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicate 'env:' key in step "Build app"/);
});

test('a duplicated run: key is reported even though it is not an env key', () => {
  const broken = GOOD.replace('        run: pnpm build\n', '        run: pnpm build\n        run: pnpm build:admin\n');
  assert.equal(audit(broken).errors.length, 1);
  assert.match(audit(broken).errors[0], /duplicate 'run:' key/);
});

test('the same env var declared twice inside one env: block is reported', () => {
  const broken = GOOD.replace(
    '          VITE_AXIOM_APP: my-app\n',
    '          VITE_AXIOM_APP: my-app\n          VITE_AXIOM_APP: my-app-admin\n',
  );
  const { errors } = audit(broken);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicate env var 'VITE_AXIOM_APP'/);
});

test('a required key present only in a comment is reported missing', () => {
  const broken = GOOD.replace('          VITE_AXIOM_TOKEN: ${{ secrets.AXIOM_INGEST_TOKEN }}\n', '');
  const { errors } = audit(broken);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing everywhere: VITE_AXIOM_TOKEN/);
});

test('a required key present only inside a run: block scalar is reported missing', () => {
  const broken = GOOD
    .replace('          VITE_AXIOM_APP: my-app\n', '')
    .replace('        run: pnpm build\n', '        run: |\n          echo VITE_AXIOM_APP: smuggled\n          pnpm build\n');
  const { errors } = audit(broken);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing everywhere: VITE_AXIOM_APP/);
});

test('required keys spread across two steps do not satisfy the check', () => {
  const split = GOOD.replace(
    '          VITE_AXIOM_APP: my-app\n',
    '',
  ).replace(
    '      - name: Push\n        run: npx mapps code:push\n',
    '      - name: Push\n        env:\n          VITE_AXIOM_APP: my-app\n        run: npx mapps code:push\n',
  );
  const { errors } = audit(split);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /spread across different steps/);
});

test('a step with no env: block at all does not mask a wired sibling step', () => {
  assert.deepEqual(audit(GOOD).errors, []);
  const steps = parseWorkflowSteps(GOOD);
  assert.deepEqual(steps.map((s) => s.name), ['Checkout', 'Build app', 'Push']);
  assert.equal(steps[0].env, null);
  assert.deepEqual(steps[1].env.keys, KEYS);
});

test('a workflow with no steps at all reports the requirement as unmet', () => {
  const { errors } = audit('name: nothing\non: push\n');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing everywhere/);
});

test('steps of a second job are parsed too, and its non-step lists are not', () => {
  // `needs:` is a list that sits DEEPER than the first job's `steps:` key. It is only
  // excluded because leaving the steps block resets the tracker — without that reset,
  // `- deploy-draft` reads as a phantom fourth step.
  const twoJobs = GOOD + `  notify:
    runs-on: ubuntu-latest
    needs:
      - deploy-draft
    steps:
      - name: Ping
        run: echo hi
`;
  assert.deepEqual(parseWorkflowSteps(twoJobs).map((s) => s.name), ['Checkout', 'Build app', 'Push', 'Ping']);
});

test('an unnamed step is labelled by its line number, not dropped', () => {
  const unnamed = GOOD.replace('      - name: Checkout\n        uses: actions/checkout@v4\n', '      - uses: actions/checkout@v4\n');
  const steps = parseWorkflowSteps(unnamed);
  assert.equal(steps.length, 3);
  assert.equal(steps[0].name, null);
});

test('every deploy workflow that bakes VITE_AXIOM_* in the repo is structurally valid', () => {
  // Regression guard on the live files themselves: catches the shipped duplicate-env defect
  // in BOTH the draft and the live deadline-confirm workflow.
  const dir = new URL('../../.github/workflows/', import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('deploy-') && f.endsWith('.yml'))
    .map((f) => new URL(f, dir));
  assert.ok(files.length > 0, 'expected deploy workflows to exist');
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    if (!text.includes('VITE_AXIOM_')) continue;
    assert.deepEqual(audit(text).errors, [], `${f} is not structurally wired`);
  }
});
