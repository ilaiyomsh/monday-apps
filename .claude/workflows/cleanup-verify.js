export const meta = {
  name: 'cleanup-verify',
  description: 'Stage 3 of the cleanup workflow for a registered app (default twyst-your-status; {"app":"discussions"} selects the other): full gate from a clean install, re-scan, before/after metrics, and an independent adversarial review of the whole branch diff. Writes CLEANUP_REPORT.md.',
  whenToUse: 'After /cleanup-execute, once a human has glanced at the commits. Produces <app>/.cleanup/CLEANUP_REPORT.md and a READY_FOR_PR / ISSUES_FOUND verdict. Args: optional {app}. Opens no PR and pushes nothing.',
  phases: [
    { title: 'Gate', detail: 'clean install, then the full blocking gate for both workspaces' },
    { title: 'Measure', detail: 're-scan with -after suffix, then compute before/after metrics' },
    { title: 'Review', detail: 'independent adversarial review of base..HEAD, fresh context' },
    { title: 'Report', detail: 'assemble CLEANUP_REPORT.md and commit it' },
  ],
}

// SCOPE: ONE registered app per run (args.app, default twyst-your-status). The registry
// must match scripts/cleanup/cleanup-env.sh; CLEANUP_APP is what points the shared env
// (and cleanup_bundle_kb) at the right app.
const APPS = {
  'twyst-your-status': 'apps/twyst-your-status',
  'discussions': 'apps/discussions',
}
const input = (() => {
  if (typeof args !== 'string') return args
  const s = args.trim()
  if (s.startsWith('{') || s.startsWith('[')) { try { return JSON.parse(s) } catch { return args } }
  return args
})()
const appKey = (input && typeof input === 'object' && input.app) || 'twyst-your-status'
if (!APPS[appKey]) {
  return { error: `Unknown app "${appKey}" — registered cleanup apps: ${Object.keys(APPS).join(', ')}.` }
}
const APP = APPS[appKey]
const STATE = `${APP}/.cleanup`
const RAW = `${STATE}/raw`
const PLAN = `${STATE}/CLEANUP_PLAN.md`
const REPORT = `${STATE}/CLEANUP_REPORT.md`

const READ_ONLY = `You verify; you do not fix. Edit no source file, revert nothing, commit nothing (the final agent commits the report), and never push or deploy. If something is broken, that is the finding.`

const GATE_SCHEMA = {
  type: 'object',
  required: ['passed', 'baseSha', 'results'],
  properties: {
    passed: { type: 'boolean' },
    baseSha: { type: 'string' },
    branch: { type: 'string' },
    bundleKb: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['gate', 'passed'],
        properties: { gate: { type: 'string' }, passed: { type: 'boolean' }, excerpt: { type: 'string' } },
      },
    },
    firstFailure: { type: 'string' },
  },
}

const SCAN_SCHEMA = {
  type: 'object',
  required: ['knipTrustworthy', 'outputs'],
  properties: {
    knipTrustworthy: { type: 'boolean' },
    outputs: { type: 'array', items: { type: 'string' } },
    counts: { type: 'object' },
    notes: { type: 'string' },
  },
}

const COMPARE_SCHEMA = {
  type: 'object',
  required: ['reportPath', 'metrics'],
  properties: {
    reportPath: { type: 'string' },
    metrics: {
      type: 'array',
      items: {
        type: 'object',
        required: ['metric', 'before', 'after'],
        properties: { metric: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, delta: { type: 'string' } },
      },
    },
    batchResults: { type: 'array', items: { type: 'object' } },
    notes: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['verdict', 'commits'],
  properties: {
    verdict: { type: 'string', enum: ['READY_FOR_PR', 'ISSUES_FOUND'] },
    commits: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sha', 'subject', 'verdict'],
        properties: { sha: { type: 'string' }, subject: { type: 'string' }, verdict: { type: 'string' }, reason: { type: 'string' } },
      },
    },
    blockingIssues: { type: 'array', items: { type: 'string' } },
    rawOutput: { type: 'string' },
  },
}

const FINAL_SCHEMA = {
  type: 'object',
  required: ['ok', 'reportPath'],
  properties: {
    ok: { type: 'boolean' },
    reportPath: { type: 'string' },
    commitSha: { type: 'string' },
    prTitle: { type: 'string' },
    prBody: { type: 'string' },
    notes: { type: 'string' },
  },
}

// --- Phase A — the gate, from a clean install ------------------------------------------
phase('Gate')

const gate = await agent(
  `Verify the ${appKey} cleanup branch end to end, from the repo root. Read the command strings from ${STATE}/baseline.json ("commands") and also return its base_sha and branch.\n\n` +
  `Run, in order, stopping at the first failure:\n` +
  `  1. toolchain — bash scripts/cleanup/check-toolchain.sh (Node/pnpm majors match the CI pins — metrics on a different runtime are not comparable to the baseline)\n` +
  `  2. install   — pnpm install --frozen-lockfile (a clean install: a dependency batch that broke resolution shows up here and nowhere else)\n` +
  `  3. reconcile — bash scripts/cleanup/reconcile-plan.sh --all-done ${PLAN} (every done batch fully accounted: applied/skipped/guard-blocked per finding — a done batch with an unaccounted finding is round 2's A-structure-07 failure and an automatic ISSUES_FOUND)\n` +
  `  4. wiring    — node scripts/error-wiring-audit.mjs\n` +
  `  5. eager     — node scripts/lib/eager-graph.mjs\n` +
  `  6. typecheck — the app's type-check script\n` +
  `  7. lint      — both workspaces\n` +
  `  8. lintcfg   — the "lintcfg" command from baseline.json (the lint that just passed must be ABLE to see a dangling identifier)\n` +
  `  9. build     — both workspaces\n` +
  ` 10. tests     — both workspaces, FULL suites\n` +
  ` 11. drift     — pnpm --filter @mapps/error-kit test\n\n` +
  `After the build, measure the SPA bundle the same way the baseline did — run exactly:\n` +
  `  bash -c 'export CLEANUP_APP=${appKey}; . scripts/cleanup/cleanup-env.sh && cleanup_bundle_kb'\n` +
  `(report as bundleKb). Do NOT substitute a plain \`du -sk dist\`: that counts the hidden sourcemaps the deploy strips, which is ~3.7x the served bytes and would drown any real delta.\n\n` +
  `Any failure means the report's verdict is ISSUES_FOUND regardless of anything else. Include the first 20 lines of the first failure.\n\n${READ_ONLY}`,
  { label: 'full-gate', phase: 'Gate', schema: GATE_SCHEMA }
)

if (!gate) return { error: 'The gate agent returned nothing — re-run /cleanup-verify.' }
log(gate.passed ? 'Gate green' : `Gate RED at ${gate.firstFailure}`)

// --- Phases B/C and D — measure and review, concurrently ------------------------------
// The reviewer only needs the base SHA, so it must not wait behind the re-scan.
const measureChain = async () => {
  phase('Measure')
  const rescan = await agent(
    `Re-run the deterministic cleanup scanners for ${appKey} with the output suffix "-after" (knip-spa-after.json, knip-srv-after.json, jscpd-after/, eslint-spa-after.json, eslint-srv-after.json, todos-after.txt, commented-code-after.txt), all under ${RAW}/. Target: exactly the dirs the baseline scan covered (baseline.json "scanners" block) — a metric compared against a different scope is not a metric.\n\n${READ_ONLY}`,
    { label: 'rescan', phase: 'Measure', agentType: 'cleanup-scanner', schema: SCAN_SCHEMA }
  )

  return agent(
    `Write the before/after section of the ${appKey} cleanup report to ${REPORT}.\n\n` +
    `Read the baseline metrics from ${STATE}/baseline.json ("metrics") and its raw files (${RAW}/knip-spa-baseline.json, knip-srv-baseline.json, jscpd-baseline/jscpd-report.json), and the -after files listed here: ${JSON.stringify(rescan?.outputs || [])}.\n\n` +
    `Compute before → after → delta for: source LOC (git-tracked non-test lines under the src dirs the baseline measured — same definition, via cleanup_loc), source file count, knip unused files, knip unused exports, knip unused dependencies, jscpd clone count, duplication %, eslint problem count, and SPA bundle KB (baseline metrics.bundle_kb vs "${gate.bundleKb || 'unknown'}").\n\n` +
    `Then read ${PLAN} and add the per-batch results table (batch | category | status | risk) covering done/failed/skipped/pending.\n\n` +
    `Report skeleton:\n` +
    '```markdown\n' +
    `# CLEANUP_REPORT — ${appKey}\n` +
    `generated: <run \`date -Iseconds\` yourself> | base: ${gate.baseSha} | branch: ${gate.branch || '(current)'}\n\n` +
    `## Gate\n<one row per gate step: name | pass/fail>\n\n` +
    `## Metrics\n| metric | before | after | delta |\n|---|---|---|---|\n\n` +
    `## Batches\n| batch | category | status | risk |\n|---|---|---|---|\n\n` +
    `## Adversarial review\n<left empty — the review is appended by the next step>\n` +
    '```\n\n' +
    `Gate results to write into the Gate section: ${JSON.stringify(gate.results)}${gate.passed ? '' : ` (FAILED at ${gate.firstFailure})`}\n\n` +
    `Be honest about a metric you cannot compute — write "unknown", never a guess.\n\n${READ_ONLY} (writing ${REPORT} is the one exception)`,
    { label: 'compare', phase: 'Measure', schema: COMPARE_SCHEMA }
  )
}

const reviewTask = () => agent(
  `Independently review the ${appKey} cleanup branch. Base SHA: ${gate.baseSha}.\n\n` +
  `Walk every commit in ${gate.baseSha}..HEAD (git log --oneline, then git show per commit) and hunt for what the cleanup team missed: behaviour changes disguised as cleanup, deleted-but-still-referenced code (including string routes and the paths named in scripts/error-wiring-audit.mjs and scripts/lib/eager-graph.mjs), lost WHY-comments, touched or weakened tests, error/observability regressions, platform-contract changes (settings_str keys, storage keys, webhook config, OAuth scopes, routes), and any file outside ${APP}.\n\n` +
  `Two custody checks are already mechanical — run them and fold any failure into your verdict as a blocking issue, then spend your judgement where a grep cannot go (semantics, contracts, lost knowledge):\n` +
  `  bash scripts/cleanup/verify-approval.sh ${PLAN}   (agent-authored approvals; exit 0 also when statuses have moved on to done)\n` +
  `  bash scripts/cleanup/reconcile-plan.sh --all-done ${PLAN}   (unaccounted findings in done batches)\n\n` +
  `Return per-commit verdicts plus an overall READY_FOR_PR / ISSUES_FOUND, and put your full formatted output in rawOutput so it can be appended verbatim to the report.\n\n${READ_ONLY}`,
  { label: 'adversarial-review', phase: 'Review', agentType: 'cleanup-reviewer', schema: REVIEW_SCHEMA }
)

phase('Review')
const [compare, review] = await parallel([measureChain, reviewTask])

const reviewVerdict = review?.verdict || 'ISSUES_FOUND'
const verdict = gate.passed && reviewVerdict === 'READY_FOR_PR' ? 'READY_FOR_PR' : 'ISSUES_FOUND'
log(`Verdict: ${verdict} (gate ${gate.passed ? 'green' : 'RED'}, review ${reviewVerdict})`)

// --- Phase E — assemble and commit the report -----------------------------------------
phase('Report')

const final = await agent(
  `Finish the ${appKey} cleanup report at ${REPORT}.\n\n` +
  `1. Replace the "## Adversarial review" section with this reviewer output verbatim:\n\n${(review?.rawOutput || '(the reviewer returned no output — record that fact)').slice(0, 8000)}\n\n` +
  `2. Add a final line: \`VERDICT: ${verdict}\`${verdict === 'ISSUES_FOUND' ? ` and list the blocking issues: ${JSON.stringify(review?.blockingIssues || [])}${gate.passed ? '' : ` plus the red gate: ${gate.firstFailure}`}` : ''}.\n` +
  `3. git add ${REPORT} ${PLAN} && git commit -m "chore(${appKey}): cleanup verification report"\n` +
  `4. ${verdict === 'READY_FOR_PR'
      ? `Propose a PR title and a 5-line body summarising what was removed/consolidated, with the metric deltas. Do NOT open the PR and do NOT push — this repo takes exactly one confirming question from the human before a push, the PR targets develop (never main), and a release freeze may be in effect (check: gh pr list --base main).`
      : `Do NOT propose a PR. Summarise instead what has to be fixed first, and on which branch.`}\n\n` +
  `Commit only those two files. Never push.`,
  { label: 'finalize-report', phase: 'Report', schema: FINAL_SCHEMA }
)

return {
  app: APP,
  verdict,
  gate: { passed: gate.passed, firstFailure: gate.firstFailure || null, steps: gate.results },
  metrics: compare?.metrics || [],
  batches: compare?.batchResults || [],
  review: { verdict: reviewVerdict, commits: review?.commits || [], blockingIssues: review?.blockingIssues || [] },
  reportPath: final?.reportPath || REPORT,
  reportCommit: final?.commitSha || null,
  pr: verdict === 'READY_FOR_PR' ? { title: final?.prTitle, body: final?.prBody, base: 'develop', opened: false } : null,
  nextStep: verdict === 'READY_FOR_PR'
    ? 'Human decision: push the branch (one confirming question) and open the PR into develop. Check the release freeze first — nothing merges into develop while a develop→main PR is open.'
    : 'Fix the blocking issues on this branch (or revert the offending commit) and re-run /cleanup-verify. Nothing merges on ISSUES_FOUND.',
  pushed: false,
}
