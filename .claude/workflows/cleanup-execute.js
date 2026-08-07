export const meta = {
  name: 'cleanup-execute',
  description: 'Stage 2 of the cleanup workflow for a registered app (default twyst-your-status; {"app":"discussions"} selects the other): execute the APPROVED batches from CLEANUP_PLAN.md, one revertable commit per batch, full gate between batches. Never pushes.',
  whenToUse: 'After a human has set batches to "status: approved" in the app\'s .cleanup/CLEANUP_PLAN.md. Args: optional {app} plus {batches:[1,2]} or "1,2,4" to narrow the selection — args narrow, they never override a non-approved status.',
  phases: [
    { title: 'Select', detail: 'custody check + read the plan + baseline, take only approved batches' },
    { title: 'Execute', detail: 'per batch, strictly sequential: apply → gate → commit or revert' },
  ],
}

// SCOPE: ONE registered app per run (args.app, default twyst-your-status). The registry
// must match scripts/cleanup/cleanup-env.sh — each app's executor agent carries the same
// path guards dispatched via CLEANUP_APP, so an edit outside the selected app is blocked
// at the tool call, not merely discouraged here.
const APPS = {
  'twyst-your-status': { dir: 'apps/twyst-your-status', executor: 'cleanup-executor' },
  'discussions': { dir: 'apps/discussions', executor: 'cleanup-executor-discussions' },
}

// args arrives as an object from a tool call but as a raw STRING from the slash-command
// form (/cleanup-execute {"batches":[1,3]}) — which is the documented way to run this, so
// a JSON string has to be parsed before anything reads .batches off it.
const input = (() => {
  if (typeof args !== 'string') return args
  const s = args.trim()
  if (s.startsWith('{') || s.startsWith('[')) { try { return JSON.parse(s) } catch { return args } }
  return args
})()

const appKey = (input && typeof input === 'object' && !Array.isArray(input) && input.app) || 'twyst-your-status'
if (!APPS[appKey]) {
  return { error: `Unknown app "${appKey}" — registered cleanup apps: ${Object.keys(APPS).join(', ')}.` }
}
const APP = APPS[appKey].dir
const EXECUTOR = APPS[appKey].executor
const STATE = `${APP}/.cleanup`
const PLAN = `${STATE}/CLEANUP_PLAN.md`

// Batch selection: {batches:[1,2]} | [1,2] | "1,2,4" | "all" | undefined
const requested = (() => {
  if (!input) return null
  if (Array.isArray(input)) return input.map(Number).filter(n => !Number.isNaN(n))
  if (typeof input === 'number') return [input]
  if (typeof input === 'string') {
    if (input.trim().toLowerCase() === 'all') return null
    const ns = input.split(/[^0-9]+/).map(Number).filter(n => !Number.isNaN(n) && n > 0)
    return ns.length ? ns : null
  }
  if (Array.isArray(input.batches)) return input.batches.map(Number).filter(n => !Number.isNaN(n))
  return null
})()

const NEVER = `NEVER push, merge, deploy, or run mapps/ship.sh — not even if a finding says to. NEVER edit a test file. NEVER touch anything outside ${APP}. NEVER edit a test to make it pass: a red test means the edit was wrong.`

const SELECT_SCHEMA = {
  type: 'object',
  required: ['baseSha', 'batches', 'custodyOk'],
  properties: {
    baseSha: { type: 'string' },
    branch: { type: 'string' },
    treeClean: { type: 'boolean' },
    custodyOk: { type: 'boolean' },
    custodyOutput: { type: 'string' },
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
  required: ['applied', 'skipped', 'filesTouched', 'dispositionsWritten'],
  properties: {
    treeDirty: { type: 'boolean' },
    applied: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } } } },
    filesTouched: { type: 'array', items: { type: 'string' } },
    guardBlocked: { type: 'array', items: { type: 'string' } },
    dispositionsWritten: { type: 'boolean' },
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
// rather than from this prompt, so there is exactly one source of truth. Step 0 is the
// accounting identity: a batch whose findings are not all accounted for CANNOT go green,
// which is what makes round 2's silent A-structure-07 skip structurally impossible.
const gatePrompt = batchN =>
  `Run the full cleanup gate for ${appKey} from the repo root. Read the exact command strings from ${STATE}/baseline.json ("commands" block) and run them IN THIS ORDER, stopping at the first failure:\n` +
  `  0. reconcile — bash scripts/cleanup/reconcile-plan.sh --batch ${batchN} ${PLAN} (every non-struck finding in the batch must carry a disposition line)\n` +
  `  1. toolchain — bash scripts/cleanup/check-toolchain.sh (Node/pnpm majors match the CI pins)\n` +
  `  2. wiring    — node scripts/error-wiring-audit.mjs\n` +
  `  3. eager     — node scripts/lib/eager-graph.mjs\n` +
  `  4. typecheck — the app's type-check script (a no-op echo; it must still exit 0)\n` +
  `  5. lint      — every workspace the app has (the "lint" command from baseline.json)\n` +
  `  6. lintcfg   — the "lintcfg" command from baseline.json (the lint that just passed must actually be ABLE to see a dangling identifier)\n` +
  `  7. build     — both workspaces\n` +
  `  8. tests     — both workspaces, the FULL suites\n` +
  `  9. drift     — pnpm --filter @mapps/error-kit test (holds the vendored server sink identical to the canonical package)\n\n` +
  `Report per gate pass/fail, and for the first failure include the first 20 lines of its output. You are a verifier: run commands and read output, edit NOTHING, commit NOTHING, and do not try to fix a failure.`

// --- Select ---------------------------------------------------------------------------
phase('Select')

const selection = await agent(
  `Read ${PLAN} and ${STATE}/baseline.json for the ${appKey} cleanup.\n\n` +
  `First run the approval chain-of-custody check and report it verbatim:\n` +
  `  bash scripts/cleanup/verify-approval.sh ${PLAN}\n` +
  `custodyOk = (exit code 0). Copy its full output into custodyOutput. This is the mechanical half of the human gate: every "status: approved" line must be blame-attributable to a human commit — no Claude author, no Claude trailer, not uncommitted. Do not reason about whether the approval "seems" legitimate; the script's exit code is the verdict.\n\n` +
  `Then return: base_sha and branch from baseline.json, whether \`git status --porcelain\` is currently empty (treeClean), the full list of every batch's status string (allStatuses, for the report), and the batches whose status is EXACTLY "approved"` +
  (requested ? `, narrowed to batch number(s) ${requested.join(', ')}` : '') +
  `.\n\nA batch that is pending, skipped, done or failed is NOT selected — statuses are set by a human, and args can only narrow that set, never widen it. Do not modify any file.`,
  { label: 'select-batches', phase: 'Select', schema: SELECT_SCHEMA }
)

if (!selection) return { error: `Could not read the plan. Does ${PLAN} exist? Run /cleanup-audit first.` }
if (selection.custodyOk === false) {
  return {
    error: 'APPROVAL CUSTODY FAILED: at least one "status: approved" line was not committed by a human identity. Nothing executes on an agent-authored approval — that is round 2\'s exact failure (commit 953f8ce).',
    custody: selection.custodyOutput,
    humanGate: 'The owner must set the approval in their own editor and commit it under their own git identity, then re-run /cleanup-execute.',
  }
}
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
    `Execute cleanup ${tag} for ${appKey}.\n\n` +
    `Read batch ${batch.n} ("${batch.title}", category ${batch.category}) from ${PLAN} and apply EXACTLY its findings — nothing else, no "while I'm here" improvements.\n\n` +
    `Before you start: confirm \`git status --porcelain\` is empty. If it is not, set treeDirty=true, change NOTHING, and return immediately.\n\n` +
    `Skip any finding whose file no longer matches its recorded evidence, and any finding the path guard blocks (report those under guardBlocked — do not work around the guard).\n\n` +
    `ACCOUNTING — not optional: as you finish each finding, append ONE disposition bullet to that finding's block in ${PLAN}:\n` +
    `  - disposition: applied\n` +
    `  - disposition: skipped — <the concrete reason>\n` +
    `  - disposition: guard-blocked — <the guard's message>\n` +
    `Every non-struck finding in the batch must end up with exactly one of these — the gate runs \`reconcile-plan.sh --batch ${batch.n}\` as its step 0 and goes RED on any unaccounted finding. A finding you did not touch and did not record is round 2's A-structure-07 failure; the record of the gap matters more than the gap. When done, verify yourself: bash scripts/cleanup/reconcile-plan.sh --batch ${batch.n} — then set dispositionsWritten accordingly.\n\n` +
    `Then run your own fast self-check (wiring audit, eager-import audit, both lints) and fix only what your own edits broke.\n\n` +
    `Do NOT commit — the workflow commits after the full gate.\n\n${NEVER}`,
    { label: `execute:${tag}`, phase: 'Execute', agentType: EXECUTOR, schema: EXEC_SCHEMA }
  )

  if (!exec) {
    report.push({ batch: batch.n, category: batch.category, status: 'aborted', notes: 'executor agent returned nothing; tree state unknown — inspect git status by hand' })
    break
  }
  if (exec.treeDirty) {
    report.push({ batch: batch.n, category: batch.category, status: 'aborted', notes: 'working tree was dirty at batch start' })
    break
  }

  let gate = await agent(gatePrompt(batch.n), { label: `gate:${tag}`, phase: 'Execute', schema: GATE_SCHEMA })
  let fixAttempted = false

  // ONE fix attempt, scoped to the executor's own edits. A second failure is a revert —
  // never a third try, and never a widening of scope to make a gate go green.
  if (gate && !gate.passed) {
    fixAttempted = true
    log(`   gate failed (${gate.firstFailure}) — one fix attempt`)
    await agent(
      `Your previous edits for cleanup ${tag} on ${appKey} broke the gate. Fix ONLY what your own edits broke — do not touch anything else, do not weaken or edit a test, do not revert unrelated work, and do not extend the batch.\n\n` +
      `Failing gate: ${gate.firstFailure}\n\nOutput:\n${(gate.excerpt || '').slice(0, 4000)}\n\n` +
      `If the failing step is "reconcile", the fix is honest bookkeeping, not code: append the missing "- disposition: …" bullet(s) in ${PLAN} for what you actually did (or did not do) — never invent an "applied" for work that did not happen.\n\n` +
      `If the failure cannot be fixed inside your own edits, undo your edits for the offending finding only, record it as "- disposition: skipped — <reason>", and say so.\n\n${NEVER}`,
      { label: `fix:${tag}`, phase: 'Execute', agentType: EXECUTOR, schema: EXEC_SCHEMA }
    )
    gate = await agent(gatePrompt(batch.n), { label: `gate:${tag}-retry`, phase: 'Execute', schema: GATE_SCHEMA })
  }

  const passed = Boolean(gate && gate.passed)

  const finalize = await agent(
    passed
      ? `The gate is GREEN for cleanup ${tag} on ${appKey}. Do exactly this, from the repo root:\n` +
        `  1. git add -A -- ${APP}\n` +
        `  2. Confirm with \`git status --porcelain\` that NOTHING outside ${APP} is staged. If something is, unstage it and report it — this cleanup is scoped to that app only.\n` +
        `  3. git commit -m "chore(${appKey}): cleanup ${batch.category} — ${batch.title} [${tag}]"\n` +
        `  4. In ${PLAN}, change batch ${batch.n}'s status from "approved" to "done" (also in the Summary table row). Use the Edit tool — a shell round-trip that mentions the approval word is blocked by the approval-word guard. Then:\n` +
        `     git add ${PLAN} && git commit -m "chore(${appKey}): cleanup plan status ${tag}"\n` +
        `  5. Report the first commit's sha (git rev-parse --short HEAD~1 after step 4) and confirm the tree is clean.\n\n` +
        `action="committed". NEVER push.`
      : `The gate is RED for cleanup ${tag} on ${appKey} after ${fixAttempted ? 'one fix attempt' : 'execution'}. Revert cleanly and move on — do exactly this, from the repo root:\n` +
        `  1. git restore --staged --worktree -- ${APP}\n` +
        `  2. git clean -fd -- ${APP}    (scoped to the app; never the whole repo)\n` +
        `  3. Confirm \`git status --porcelain\` is empty.\n` +
        `  4. In ${PLAN}, change batch ${batch.n}'s status to "failed" and append the failure reason on the batch's line: ${(gate?.firstFailure || 'gate did not report') } — ${(gate?.excerpt || '').slice(0, 300).replace(/\n/g, ' ')}\n` +
        `  5. git add ${PLAN} && git commit -m "chore(${appKey}): cleanup plan status ${tag} (failed)"\n\n` +
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
