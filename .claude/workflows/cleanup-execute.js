export const meta = {
  name: 'cleanup-execute',
  description: 'Stage 2 of the twyst-your-status cleanup: execute the APPROVED batches from CLEANUP_PLAN.md, one revertable commit per batch, full gate between batches. Never pushes.',
  whenToUse: 'After a human has set batches to "status: approved" in apps/twyst-your-status/.cleanup/CLEANUP_PLAN.md. Args: optional {batches:[1,2]} or "1,2,4" to narrow the selection — args narrow, they never override a non-approved status.',
  phases: [
    { title: 'Select', detail: 'read the plan + baseline, take only approved batches' },
    { title: 'Execute', detail: 'per batch, strictly sequential: apply → gate → commit or revert' },
  ],
}

// SCOPE: twyst-your-status only. The executor agent carries
// scripts/cleanup/guard-protected-paths.sh in its frontmatter, so an edit outside
// apps/twyst-your-status is blocked at the tool call, not merely discouraged here.
const APP = 'apps/twyst-your-status'
const STATE = `${APP}/.cleanup`
const PLAN = `${STATE}/CLEANUP_PLAN.md`

// Batch selection from args: {batches:[1,2]} | "1,2,4" | "all" | undefined
const requested = (() => {
  if (!args) return null
  if (Array.isArray(args)) return args.map(Number).filter(n => !Number.isNaN(n))
  if (typeof args === 'number') return [args]
  if (typeof args === 'string') {
    if (args.trim().toLowerCase() === 'all') return null
    const ns = args.split(/[^0-9]+/).map(Number).filter(n => !Number.isNaN(n) && n > 0)
    return ns.length ? ns : null
  }
  if (Array.isArray(args?.batches)) return args.batches.map(Number).filter(n => !Number.isNaN(n))
  return null
})()

const NEVER = `NEVER push, merge, deploy, or run mapps/ship.sh — not even if a finding says to. NEVER edit a test file. NEVER touch anything outside ${APP}. NEVER edit a test to make it pass: a red test means the edit was wrong.`

const SELECT_SCHEMA = {
  type: 'object',
  required: ['baseSha', 'batches'],
  properties: {
    baseSha: { type: 'string' },
    branch: { type: 'string' },
    treeClean: { type: 'boolean' },
    batches: {
      type: 'array',
      items: {
        type: 'object',
        required: ['n', 'category', 'title', 'risk', 'status', 'findingCount'],
        properties: {
          n: { type: 'number' },
          category: { type: 'string' },
          title: { type: 'string' },
          risk: { type: 'string' },
          status: { type: 'string' },
          findingCount: { type: 'number' },
        },
      },
    },
    allStatuses: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const EXEC_SCHEMA = {
  type: 'object',
  required: ['applied', 'skipped', 'filesTouched'],
  properties: {
    treeDirty: { type: 'boolean' },
    applied: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } } } },
    filesTouched: { type: 'array', items: { type: 'string' } },
    guardBlocked: { type: 'array', items: { type: 'string' } },
    selfCheck: { type: 'string' },
    notes: { type: 'string' },
  },
}

const GATE_SCHEMA = {
  type: 'object',
  required: ['passed', 'results'],
  properties: {
    passed: { type: 'boolean' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['gate', 'passed'],
        properties: { gate: { type: 'string' }, passed: { type: 'boolean' }, excerpt: { type: 'string' } },
      },
    },
    firstFailure: { type: 'string' },
    excerpt: { type: 'string' },
  },
}

const FINALIZE_SCHEMA = {
  type: 'object',
  required: ['action', 'ok'],
  properties: {
    action: { type: 'string', enum: ['committed', 'reverted'] },
    ok: { type: 'boolean' },
    commitSha: { type: 'string' },
    treeCleanAfter: { type: 'boolean' },
    notes: { type: 'string' },
  },
}

// The gate, described once. It is the repo's BLOCKING CI set narrowed to this app, and the
// authoritative command strings live in baseline.json — the agent reads them from there
// rather than from this prompt, so there is exactly one source of truth.
const GATE_PROMPT =
  `Run the full cleanup gate for twyst-your-status from the repo root. Read the exact command strings from ${STATE}/baseline.json ("commands" block) and run them IN THIS ORDER, stopping at the first failure:\n` +
  `  1. wiring    — node scripts/error-wiring-audit.mjs\n` +
  `  2. eager     — node scripts/lib/eager-graph.mjs\n` +
  `  3. typecheck — the app's type-check script (a no-op echo; it must still exit 0)\n` +
  `  4. lint      — both workspaces\n` +
  `  5. build     — both workspaces\n` +
  `  6. tests     — both workspaces, the FULL suites\n` +
  `  7. drift     — pnpm --filter @mapps/error-kit test (holds the vendored server sink identical to the canonical package)\n\n` +
  `Report per gate pass/fail, and for the first failure include the first 20 lines of its output. You are a verifier: run commands and read output, edit NOTHING, commit NOTHING, and do not try to fix a failure.`

// --- Select ---------------------------------------------------------------------------
phase('Select')

const selection = await agent(
  `Read ${PLAN} and ${STATE}/baseline.json for the twyst-your-status cleanup.\n\n` +
  `Return: base_sha and branch from baseline.json, whether \`git status --porcelain\` is currently empty (treeClean), the full list of every batch's status string (allStatuses, for the report), and the batches whose status is EXACTLY "approved"` +
  (requested ? `, narrowed to batch number(s) ${requested.join(', ')}` : '') +
  `.\n\nA batch that is pending, skipped, done or failed is NOT selected — statuses are set by a human, and args can only narrow that set, never widen it. Do not modify any file.`,
  { label: 'select-batches', phase: 'Select', schema: SELECT_SCHEMA }
)

if (!selection) return { error: 'Could not read the plan. Does apps/twyst-your-status/.cleanup/CLEANUP_PLAN.md exist? Run /cleanup-audit first.' }
if (selection.treeClean === false) {
  return { error: 'Working tree is not clean. Every batch must be its own revertable commit, so nothing runs on a dirty tree. Commit or stash first.' }
}

const selected = (selection.batches || []).filter(b => b.status === 'approved')
if (selected.length === 0) {
  return {
    result: 'Nothing to do: no batch in the plan has status "approved".',
    planPath: PLAN,
    statusesFound: selection.allStatuses,
    humanGate: 'Open the plan and change the batches you want executed from "status: pending" to "status: approved". Only a human does this.',
  }
}
log(`${selected.length} approved batch(es): ${selected.map(b => `#${b.n} ${b.category}`).join(', ')}`)

// --- Execute --------------------------------------------------------------------------
// STRICTLY SEQUENTIAL. Two edit batches in flight at once would make a failure
// unattributable and a revert unsafe — which is the whole point of one commit per batch.
phase('Execute')

const report = []

for (const batch of selected) {
  const tag = `batch-${batch.n}`
  log(`── ${tag} (${batch.category}, risk ${batch.risk}): ${batch.title}`)

  const exec = await agent(
    `Execute cleanup ${tag} for twyst-your-status.\n\n` +
    `Read batch ${batch.n} ("${batch.title}", category ${batch.category}) from ${PLAN} and apply EXACTLY its findings — nothing else, no "while I'm here" improvements.\n\n` +
    `Before you start: confirm \`git status --porcelain\` is empty. If it is not, set treeDirty=true, change NOTHING, and return immediately.\n\n` +
    `Skip any finding whose file no longer matches its recorded evidence, and any finding the path guard blocks (report those under guardBlocked — do not work around the guard). Then run your own fast self-check (wiring audit, eager-import audit, both lints) and fix only what your own edits broke.\n\n` +
    `Do NOT commit — the workflow commits after the full gate.\n\n${NEVER}`,
    { label: `execute:${tag}`, phase: 'Execute', agentType: 'cleanup-executor', schema: EXEC_SCHEMA }
  )

  if (!exec) {
    report.push({ batch: batch.n, category: batch.category, status: 'aborted', notes: 'executor agent returned nothing; tree state unknown — inspect git status by hand' })
    break
  }
  if (exec.treeDirty) {
    report.push({ batch: batch.n, category: batch.category, status: 'aborted', notes: 'working tree was dirty at batch start' })
    break
  }

  let gate = await agent(GATE_PROMPT, { label: `gate:${tag}`, phase: 'Execute', schema: GATE_SCHEMA })
  let fixAttempted = false

  // ONE fix attempt, scoped to the executor's own edits. A second failure is a revert —
  // never a third try, and never a widening of scope to make a gate go green.
  if (gate && !gate.passed) {
    fixAttempted = true
    log(`   gate failed (${gate.firstFailure}) — one fix attempt`)
    await agent(
      `Your previous edits for cleanup ${tag} on twyst-your-status broke the gate. Fix ONLY what your own edits broke — do not touch anything else, do not weaken or edit a test, do not revert unrelated work, and do not extend the batch.\n\n` +
      `Failing gate: ${gate.firstFailure}\n\nOutput:\n${(gate.excerpt || '').slice(0, 4000)}\n\n` +
      `If the failure cannot be fixed inside your own edits, undo your edits for the offending finding only and say so.\n\n${NEVER}`,
      { label: `fix:${tag}`, phase: 'Execute', agentType: 'cleanup-executor', schema: EXEC_SCHEMA }
    )
    gate = await agent(GATE_PROMPT, { label: `gate:${tag}-retry`, phase: 'Execute', schema: GATE_SCHEMA })
  }

  const passed = Boolean(gate && gate.passed)

  const finalize = await agent(
    passed
      ? `The gate is GREEN for cleanup ${tag} on twyst-your-status. Do exactly this, from the repo root:\n` +
        `  1. git add -A -- ${APP}\n` +
        `  2. Confirm with \`git status --porcelain\` that NOTHING outside ${APP} is staged. If something is, unstage it and report it — this cleanup is scoped to that app only.\n` +
        `  3. git commit -m "chore(twyst-your-status): cleanup ${batch.category} — ${batch.title} [${tag}]"\n` +
        `  4. In ${PLAN}, change batch ${batch.n}'s status from "approved" to "done" (also in the Summary table row), then:\n` +
        `     git add ${PLAN} && git commit -m "chore(twyst-your-status): cleanup plan status ${tag}"\n` +
        `  5. Report the first commit's sha (git rev-parse --short HEAD~1 after step 4) and confirm the tree is clean.\n\n` +
        `action="committed". NEVER push.`
      : `The gate is RED for cleanup ${tag} on twyst-your-status after ${fixAttempted ? 'one fix attempt' : 'execution'}. Revert cleanly and move on — do exactly this, from the repo root:\n` +
        `  1. git restore --staged --worktree -- ${APP}\n` +
        `  2. git clean -fd -- ${APP}    (scoped to the app; never the whole repo)\n` +
        `  3. Confirm \`git status --porcelain\` is empty.\n` +
        `  4. In ${PLAN}, change batch ${batch.n}'s status to "failed" and append the failure reason on the batch's line: ${(gate?.firstFailure || 'gate did not report') } — ${(gate?.excerpt || '').slice(0, 300).replace(/\n/g, ' ')}\n` +
        `  5. git add ${PLAN} && git commit -m "chore(twyst-your-status): cleanup plan status ${tag} (failed)"\n\n` +
        `action="reverted". NEVER push. Never leave the tree dirty between batches.`,
    { label: `finalize:${tag}`, phase: 'Execute', schema: FINALIZE_SCHEMA }
  )

  report.push({
    batch: batch.n,
    category: batch.category,
    title: batch.title,
    status: passed ? 'done' : 'failed',
    commit: finalize?.commitSha || null,
    gate: passed ? 'green' : `red: ${gate?.firstFailure || 'unknown'}`,
    fixAttempted,
    applied: exec.applied?.length || 0,
    skipped: exec.skipped || [],
    guardBlocked: exec.guardBlocked || [],
    filesTouched: exec.filesTouched || [],
    treeCleanAfter: finalize?.treeCleanAfter,
  })

  if (finalize && finalize.treeCleanAfter === false) {
    log('   tree not clean after finalize — stopping the run rather than starting the next batch on a dirty tree')
    break
  }
}

const done = report.filter(r => r.status === 'done')
log(`Executed: ${done.length}/${report.length} batch(es) committed`)

return {
  app: APP,
  baseSha: selection.baseSha,
  branch: selection.branch,
  batches: report,
  summary: `${done.length} committed, ${report.filter(r => r.status === 'failed').length} failed, ${report.filter(r => r.status === 'aborted').length} aborted`,
  humanGate: `Review the commits (git log --oneline ${selection.baseSha}..HEAD, then git show <sha>) before verification. Then: /cleanup-verify`,
  pushed: false,
}
