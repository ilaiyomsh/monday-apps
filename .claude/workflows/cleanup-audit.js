export const meta = {
  name: 'cleanup-audit',
  description: 'Stage 1 of the twyst-your-status cleanup: scan, adversarially verify, judge, and write CLEANUP_PLAN.md. Read-only for source.',
  whenToUse: 'After scripts/cleanup/baseline.sh has passed. Produces apps/twyst-your-status/.cleanup/CLEANUP_PLAN.md with every batch pending — a human sets batches to approved. Args: optional {target} subdirectory INSIDE apps/twyst-your-status (first run: pilot one subdirectory), or a bare path string.',
  phases: [
    { title: 'Scan', detail: 'knip x2 + jscpd + eslint + comment/TODO inventories into .cleanup/raw/' },
    { title: 'Verify', detail: 'parse knip findings, then one adversarial verifier per chunk of ~12' },
    { title: 'Judge', detail: '4 auditors in parallel: patterns, comments, structure, dependencies' },
    { title: 'Consolidate', detail: 'one agent merges everything into CLEANUP_PLAN.md, all batches pending' },
  ],
}

// ---------------------------------------------------------------------------
// SCOPE. This workflow serves exactly one app. Every path below is inside it, and the
// target is validated against it before a single agent starts — a cleanup that quietly
// widens to a sibling app is the failure mode this whole package is built to prevent.
// The same fact is enforced physically by scripts/cleanup/guard-protected-paths.sh, which
// the cleanup-executor agent carries in its frontmatter.
const APP = 'apps/twyst-your-status'
const STATE = `${APP}/.cleanup`
const RAW = `${STATE}/raw`

const target = (typeof args === 'string' ? args : args?.target) || `${APP}/src`
if (!target.startsWith(APP)) {
  return { error: `Refusing to run: target "${target}" is outside ${APP}. This cleanup workflow is scoped to twyst-your-status only.` }
}

// Read-only stages, spelled out once and pasted into every agent prompt: the only writes
// this entire workflow may perform anywhere are under STATE.
const READ_ONLY = `HARD CONSTRAINT: this audit is strictly READ-ONLY for source files. The only paths you may write are under ${STATE}/. Do not edit, delete, format, build, commit or push anything. Do not look at or report on any app other than ${APP}.`

const SCAN_SCHEMA = {
  type: 'object',
  required: ['knipTrustworthy', 'scanners', 'outputs'],
  properties: {
    knipTrustworthy: { type: 'boolean' },
    knipProblem: { type: 'string' },
    scanners: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'ok'],
        properties: { name: { type: 'string' }, ok: { type: 'boolean' }, error: { type: 'string' } },
      },
    },
    counts: {
      type: 'object',
      properties: {
        knipUnusedFiles: { type: 'number' },
        knipUnusedExports: { type: 'number' },
        knipUnusedDependencies: { type: 'number' },
        jscpdClones: { type: 'number' },
        jscpdPercentage: { type: 'number' },
        eslintProblems: { type: 'number' },
        todos: { type: 'number' },
        commentedCodeBlocks: { type: 'number' },
      },
    },
    outputs: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

const PARSE_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'kind', 'workspace', 'path'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['file', 'export', 'dependency', 'duplicate-export'] },
          workspace: { type: 'string', enum: ['spa', 'server'] },
          path: { type: 'string' },
          symbol: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'verdict', 'evidence'],
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['CONFIRMED_DEAD', 'FALSE_POSITIVE', 'TEST_ONLY', 'UNCERTAIN'] },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

const AUDIT_SCHEMA = {
  type: 'object',
  required: ['area', 'findingCount', 'path'],
  properties: {
    area: { type: 'string' },
    findingCount: { type: 'number' },
    path: { type: 'string' },
    top: { type: 'array', items: { type: 'string' } },
  },
}

const PLAN_SCHEMA = {
  type: 'object',
  required: ['planPath', 'batches'],
  properties: {
    planPath: { type: 'string' },
    batches: {
      type: 'array',
      items: {
        type: 'object',
        required: ['n', 'category', 'title', 'risk', 'findingCount', 'status'],
        properties: {
          n: { type: 'number' },
          category: { type: 'string' },
          title: { type: 'string' },
          risk: { type: 'string', enum: ['S', 'M', 'L'] },
          findingCount: { type: 'number' },
          status: { type: 'string' },
        },
      },
    },
    nonActionableCount: { type: 'number' },
    notes: { type: 'string' },
  },
}

// --- Phase A — Scan -------------------------------------------------------------------
phase('Scan')
log(`Scanning ${target} (scope: ${APP} only)`)

const scan = await agent(
  `Run the deterministic cleanup scanners for twyst-your-status. Target for the file-level scans: ${target}. Output suffix: none (this is an audit run, not a verify re-scan). Save everything under ${RAW}/.\n\n` +
  `Read ${STATE}/baseline.json first and use the commands recorded in its "scanners" block. Remember: knip exits 1 when it HAS findings — that is a report, not a failure. Report knipTrustworthy=false only if a knip JSON file is invalid, empty, or scanned zero files.\n\n${READ_ONLY}`,
  { label: 'scan', phase: 'Scan', agentType: 'cleanup-scanner', schema: SCAN_SCHEMA }
)

if (!scan) return { error: 'The scanner agent returned nothing — nothing downstream can be trusted. Re-run.' }
if (!scan.knipTrustworthy) {
  return {
    error: 'ABORTED: knip output is not trustworthy, so every dead-code finding downstream would be guesswork.',
    knipProblem: scan.knipProblem || scan.notes,
    fix: `Check apps/twyst-your-status/knip.jsonc and server/knip.jsonc entry points, run "pnpm dlx knip@5.88.1 --directory ${APP}" by hand, then re-run this workflow.`,
    scanners: scan.scanners,
  }
}
log(`Scan OK — ${JSON.stringify(scan.counts || {})}`)

// --- Phases B and C — Verify and Judge, concurrently ----------------------------------
// Phase B is a chain (parse, then fan out over its chunks), Phase C is four independent
// auditors. They share no data, so the auditors must not wait behind the parse step.
const AREAS = ['patterns', 'comments', 'structure', 'dependencies']

const verifyChain = async () => {
  phase('Verify')
  const parsed = await agent(
    `Parse the knip JSON reports into individual, id'd findings for verification. Read BOTH ${RAW}/knip-spa.json (workspace "spa") and ${RAW}/knip-srv.json (workspace "server").\n\n` +
    `Assign stable ids: K-001, K-002, ... in file order, spa first. One finding per unused file, per unused export, per unused dependency, per duplicate export. For an export, "path" is the file and "symbol" is the exported name. Do not judge anything, do not drop anything — this is a mechanical transcription, and the count must match the reports.\n\n${READ_ONLY}`,
    { label: 'parse-knip', phase: 'Verify', schema: PARSE_SCHEMA }
  )

  const findings = parsed?.findings || []
  if (findings.length === 0) {
    log('knip reported no dead-code findings — nothing to verify')
    return []
  }

  const CHUNK = 12
  const chunks = []
  for (let i = 0; i < findings.length; i += CHUNK) chunks.push(findings.slice(i, i + CHUNK))
  log(`Verifying ${findings.length} knip finding(s) in ${chunks.length} chunk(s)`)

  const results = await parallel(chunks.map((chunk, i) => () =>
    agent(
      `Adversarially verify this chunk of dead-code findings for twyst-your-status. For EACH one, try to prove it is still used — dynamic import, string-based route, platform caller, cross-package test import, subpath export, global. Work through every check in your instructions, including this app's specific false-positive sources.\n\n` +
      `Findings (JSON):\n${JSON.stringify(chunk, null, 2)}\n\n` +
      `Return one verdict per finding id, with evidence. UNCERTAIN when in doubt — nothing marked UNCERTAIN is deleted downstream.\n\n${READ_ONLY}`,
      { label: `verify:chunk-${i + 1}`, phase: 'Verify', agentType: 'cleanup-verifier', schema: VERDICT_SCHEMA }
    )
  ))

  return results.filter(Boolean).flatMap(r => r.verdicts || [])
}

const judgeArea = area => async () => {
  return agent(
    `Audit the "${area}" focus area of twyst-your-status. Target directory: ${target}.\n\n` +
    `Inputs already on disk you should use: ${RAW}/todos.txt, ${RAW}/commented-code.txt, ${RAW}/jscpd/jscpd-report.json, ${RAW}/eslint-spa.json, ${RAW}/eslint-srv.json.\n\n` +
    `Write your findings to ${STATE}/audit/${area}.md in the exact format your instructions specify, cap at 25, and return the 3-line summary.\n\n${READ_ONLY}`,
    { label: `judge:${area}`, phase: 'Judge', agentType: 'cleanup-auditor', schema: AUDIT_SCHEMA }
  )
}

phase('Judge')
const [verdicts, ...audits] = await parallel([verifyChain, ...AREAS.map(judgeArea)])

const allVerdicts = verdicts || []
const tally = allVerdicts.reduce((acc, v) => { acc[v.verdict] = (acc[v.verdict] || 0) + 1; return acc }, {})
const confirmedDead = allVerdicts.filter(v => v.verdict === 'CONFIRMED_DEAD')
const auditSummaries = audits.filter(Boolean)
log(`Verified: ${JSON.stringify(tally)} | auditors: ${auditSummaries.map(a => `${a.area}=${a.findingCount}`).join(' ')}`)

// --- Phase D — Consolidate ------------------------------------------------------------
phase('Consolidate')

const plan = await agent(
  `Write the cleanup plan for twyst-your-status to ${STATE}/CLEANUP_PLAN.md.\n\n` +
  `INPUTS\n` +
  `1. Verified knip verdicts (JSON below). Include ONLY verdict=CONFIRMED_DEAD as actionable findings.\n` +
  `2. Auditor findings on disk: ${AREAS.map(a => `${STATE}/audit/${a}.md`).join(', ')} — read all four files.\n` +
  `3. Baseline: ${STATE}/baseline.json (take base_sha and the commands from it).\n` +
  `4. jscpd clones: ${RAW}/jscpd/jscpd-report.json.\n\n` +
  `Verified verdicts:\n${JSON.stringify(allVerdicts, null, 2)}\n\n` +
  `RULES\n` +
  `- FALSE_POSITIVE, UNCERTAIN and TEST_ONLY verdicts go into a short non-actionable appendix, clearly marked, with their evidence. They are never batched for execution. TEST_ONLY specifically: test files are locked in this repo, so removing a test-only symbol needs a separate human-owned change.\n` +
  `- Deduplicate overlaps: a jscpd clone also reported by the patterns auditor appears ONCE.\n` +
  `- Drop any finding whose file is protected by scripts/cleanup/guard-protected-paths.sh (the error/observability boot layer, tests, config, docs, build output) into the appendix instead of a batch — an executor physically cannot apply it. Say which guard rule applies.\n` +
  `- Order batches by category, safest first: 1 comments (S) → 2 dead files (M) → 3 unused exports (M) → 4 unused deps (M) → 5 duplication consolidation (L) → 6 pattern alignment (L) → 7 structure (L). Skip a number if it has no findings; do not renumber to hide a gap.\n` +
  `- One category per batch. Every batch starts as "status: pending". Do NOT set any batch to approved — only the human operator does that.\n\n` +
  `FORMAT\n` +
  '```markdown\n' +
  `# CLEANUP_PLAN — twyst-your-status\n` +
  `generated: <run \`date -Iseconds\` yourself> | target: ${target} | base: <base_sha> | app: ${APP}\n\n` +
  `## Summary\n| batch | category | findings | risk | status |\n|---|---|---|---|---|\n\n` +
  `## Batch <N> — <category>: <title>\nrisk: S|M|L | status: pending\n\n` +
  `### <finding-id>\n- files: <path:line, ...>\n- action: <mechanical instruction>\n- evidence: <verification or auditor evidence>\n- source: knip | jscpd | auditor:<area>\n\n` +
  `## Appendix — non-actionable (not for execution)\n| id | verdict/reason | evidence |\n|---|---|---|\n` +
  '```\n\n' +
  `${READ_ONLY}`,
  { label: 'consolidate', phase: 'Consolidate', schema: PLAN_SCHEMA }
)

if (!plan) return { error: 'The consolidation agent returned nothing. The verdicts and auditor files are on disk — re-run this stage.' }

log(`Plan written: ${plan.batches.length} batch(es), all pending`)

return {
  app: APP,
  target,
  planPath: plan.planPath,
  scan: scan.counts,
  verification: { total: allVerdicts.length, ...tally, falsePositiveRate: allVerdicts.length ? `${Math.round((100 * ((tally.FALSE_POSITIVE || 0) + (tally.UNCERTAIN || 0))) / allVerdicts.length)}%` : 'n/a' },
  confirmedDead: confirmedDead.length,
  auditors: auditSummaries.map(a => ({ area: a.area, findings: a.findingCount, top: a.top })),
  batches: plan.batches,
  nonActionable: plan.nonActionableCount,
  humanGate: `Review ${plan.planPath} and change the batches you want executed from "status: pending" to "status: approved" (or "skipped"). Nothing runs until you do. Then: /cleanup-execute`,
}
