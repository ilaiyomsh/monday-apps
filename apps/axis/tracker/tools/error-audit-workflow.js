export const meta = {
  name: 'error-audit',
  description: 'Maximal-rigor audit of all src/ for error-handling coverage, clarity, and silent failures vs docs/error-handling-standard.md. Deterministic grep census + reconciliation, two independent readers per batch, semantic critic, verify gaps AND passes on catch/mutate paths, single sorted report.',
  phases: [
    { title: 'Discover', detail: 'find all source files' },
    { title: 'Infra', detail: 'check global safety net + ErrorBoundary quality' },
    { title: 'Gather', detail: 'per batch: grep census + 2 independent readers + semantic critic' },
    { title: 'Reconcile', detail: 'merge readers, reconcile vs census, gap-fill uncovered sites' },
    { title: 'Verify', detail: 'adversarially confirm critical/high gaps AND passes on catch/mutate' },
    { title: 'Synthesize', detail: 'merge into one report, write docs/error-handling-audit.md' },
  ],
}

// ============ shared rubric, injected into every grading agent ============
const STANDARD = `
Grade against the standard in docs/error-handling-standard.md. Key rules:
- An "error source" = any await / SDK call / JSON.parse / field access on an API response / async useEffect / async event handler / render-time code that may throw / date-number parsing / a promise without await ("fire and forget") / a .then without .catch.
- PASS requires ALL of: (1) Coverage - caught by a mechanism appropriate to its category; (2) Zero silent swallow - there is a logger call on the catch path; (3) Clarity - the error is mapped (parseMondayError/MondayApiError); (4) Surfaced to the user when relevant.
- Silent swallow = a catch with no logger call whatsoever => AUTOMATIC FAIL. The only exception: if (e.name === 'AbortError') return;
- Direct console.log / console.error instead of logger = a "low" gap (logged='console-only').
- Surfacing to the user is mandatory ONLY when the failure affects a user-initiated action (save/delete/blocking load) or blanks the screen. Background/prefetch may be log-only.
- Mutate path = create/update/delete (createBoardItem/updateItemColumnValues/deleteItem, etc.).
- Severity: critical = silent swallow on a mutate path, or an uncaught failure that can blank the screen; high = caught but not logged on a read path, or a generic message on a user action; medium = logged but unclear/unmapped, or missing surfacing on a non-critical user action; low = cosmetic / dev-only / bare console / could be tightened.
- Project tools: logger (debug/info/warn/error/api/apiError), parseMondayError + createFullErrorObject (utils/errorHandler.js), MondayApiError + wrapMondayApiCall + safeApi (utils/mondayApi), showErrorWithDetails (useToast). An error logged via a wrapper counts as logged.
- All free-text fields you return (operation, gapType, proposedFix) must be in ENGLISH.
`

const FINDING_PROPS = {
  file: { type: 'string' },
  lineRange: { type: 'string', description: 'e.g. "142" or "142-150"' },
  operation: { type: 'string', description: 'short English description of what the code does' },
  category: { type: 'string', enum: ['api', 'render', 'network', 'race', 'uncaught', 'validation', 'sdk'] },
  caught: { type: 'string', enum: ['none', 'try-catch', 'dot-catch', 'wrapper', 'error-boundary'] },
  logged: { type: 'string', enum: ['swallowed', 'console-only', 'logger-error', 'logger-apiError', 'logger-warn'] },
  surfacedToUser: { type: 'string', enum: ['none', 'toast', 'inline', 'fallback-ui', 'not-applicable'] },
  clarity: { type: 'string', enum: ['mapped', 'generic', 'opaque', 'not-applicable'] },
  severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
  verdict: { type: 'string', enum: ['pass', 'gap'] },
  gapType: { type: 'string', description: 'if gap: short English gap type. if pass: empty' },
  proposedFix: { type: 'string', description: 'short concrete English fix (not applied). if pass: empty' },
}
const FINDING_REQUIRED = ['file', 'lineRange', 'operation', 'category', 'caught', 'logged', 'surfacedToUser', 'clarity', 'severity', 'verdict', 'proposedFix']
const FINDINGS_SCHEMA = { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: { type: 'object', required: FINDING_REQUIRED, properties: FINDING_PROPS } } } }
const VERIFIED_SCHEMA = { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: { type: 'object', required: [...FINDING_REQUIRED, 'verified'], properties: { ...FINDING_PROPS, verified: { type: 'boolean' }, verifyNote: { type: 'string' } } } } } }
const CENSUS_SCHEMA = { type: 'object', required: ['sites'], properties: { sites: { type: 'array', items: { type: 'object', required: ['file', 'line', 'signal'], properties: { file: { type: 'string' }, line: { type: 'number' }, signal: { type: 'string', enum: ['catch', 'dotcatch', 'sdk', 'jsonparse', 'await', 'console'] } } } } } }
const INFRA_SCHEMA = {
  type: 'object', required: ['globalHandler', 'errorBoundary', 'summary'],
  properties: {
    globalHandler: { type: 'object', required: ['exists', 'quality', 'gaps'], properties: { exists: { type: 'boolean' }, files: { type: 'array', items: { type: 'string' } }, quality: { type: 'string', enum: ['absent', 'partial', 'good'] }, gaps: { type: 'array', items: { type: 'string' } } } },
    errorBoundary: { type: 'object', required: ['exists', 'coverage', 'gaps'], properties: { exists: { type: 'boolean' }, files: { type: 'array', items: { type: 'string' } }, coverage: { type: 'string', enum: ['none', 'partial', 'full'] }, gaps: { type: 'array', items: { type: 'string' } } } },
    summary: { type: 'string' },
  },
}

// ============ Phase 1: discover ============
phase('Discover')
const disc = await agent(
  `Run: find src \\( -name '*.js' -o -name '*.jsx' \\) -not -path '*/__tests__/*' -not -name '*.test.*' -not -name 'setupTests.js' | sort
Return every path. Do not read the files.`,
  { label: 'discover-files', phase: 'Discover', schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } } }
)
const files = (disc?.files || []).filter(Boolean)
const SIZE = 7
const batches = []
for (let i = 0; i < files.length; i += SIZE) batches.push(files.slice(i, i + SIZE))
log(`${files.length} files in ${batches.length} batches`)

// ============ Phase 2 (concurrent): infra ============
const infraPromise = agent(
  `Check the global safety-net and ErrorBoundary infrastructure (React, Monday board view).
Read: src/utils/globalErrorHandler.js, src/utils/logger.js, src/index.jsx, src/init.js, src/App.jsx, src/components/ErrorBoundary/ErrorBoundary.jsx, src/components/NetworkErrorScreen.jsx, src/MondayCalendar.jsx.
- globalHandler: are window.onerror + unhandledrejection installed? Installed before React mount? Do they log via logger? Do they filter AbortError? Report quality + gaps.
- errorBoundary: does it exist? Does it wrap the root AND individual components? Does componentDidCatch log via logger? Report coverage + gaps.
${STANDARD}`,
  { label: 'infra-safety-net', phase: 'Infra', schema: INFRA_SCHEMA }
)

// ============ helpers ============
const lineSet = (findings) => {
  const m = {}
  for (const f of findings) {
    const nums = String(f.lineRange).match(/\d+/g) || []
    const a = +nums[0], b = nums[1] ? +nums[1] : a
    if (!Number.isFinite(a)) continue
    if (!m[f.file]) m[f.file] = new Set()
    for (let n = a; n <= b; n++) m[f.file].add(n)
  }
  return m
}
const HARD = new Set(['catch', 'dotcatch', 'sdk', 'jsonparse']) // every such site must be accounted for

// ============ Phase 3+4+5: per-batch gather -> reconcile -> verify ============
phase('Gather')
const perBatch = await pipeline(
  batches,

  // -- stage 1: gather (census + 2 readers + semantic critic, concurrently) --
  (batch, _o, i) => parallel([
    () => agent(
      `Run exactly this command and return every match as {file,line,signal} (do not add or omit any):
grep -nE '\\}[[:space:]]*catch[[:space:]]*\\(|[[:space:]]catch[[:space:]]*\\{|\\.catch\\(|monday\\.(api|execute|listen|get|storage)|JSON\\.parse|\\bawait\\b|console\\.(log|error|warn|info)' ${batch.join(' ')}
signal mapping: "} catch(" or " catch {" => catch ; ".catch(" => dotcatch ; "monday.api/execute/listen/get/storage" => sdk ; "JSON.parse" => jsonparse ; "await" => await ; "console.*" => console.`,
      { label: `census:${i}`, phase: 'Gather', schema: CENSUS_SCHEMA }
    ),
    () => agent(
      `Reader A — focus on COVERAGE and SILENT SWALLOW. Read these files in full:
${batch.map(f => '- ' + f).join('\n')}
Find every error source. For each catch/.catch check whether a logger call exists on the path. Return one row per source (including PASS rows).
${STANDARD}`,
      { label: `readA:${i}`, phase: 'Gather', schema: FINDINGS_SCHEMA }
    ),
    () => agent(
      `Reader B — focus on CLARITY, USER SURFACING, and SEVERITY. Read these files in full:
${batch.map(f => '- ' + f).join('\n')}
Find every error source. For each, assess: is the message mapped (parseMondayError) or generic, is it a user-initiated action that must surface, and what severity. Return one row per source (including PASS rows).
${STANDARD}`,
      { label: `readB:${i}`, phase: 'Gather', schema: FINDINGS_SCHEMA }
    ),
    () => agent(
      `Semantic critic — find ONLY what grep cannot catch: race conditions (setState after unmount, out-of-order responses), render-crash risks (null deref on props/state, .map on a possibly-undefined value), promises without await ("fire and forget"), .then without .catch, async useEffect without abort/cleanup. Read these files in full:
${batch.map(f => '- ' + f).join('\n')}
Return one row per semantic finding only.
${STANDARD}`,
      { label: `semantic:${i}`, phase: 'Gather', schema: FINDINGS_SCHEMA }
    ),
  ]).then(([census, rA, rB, sem]) => ({ census, rA, rB, sem, batch, i })),

  // -- stage 2: merge readers + reconcile vs census + gap-fill uncovered hard sites --
  async (g) => {
    const merged = await agent(
      `Merge three lists of findings into one unified list, de-duplicated (identity by file + overlapping lineRange + operation). On a grading conflict between readers, pick the STRICTER grade (verdict=gap beats pass; higher severity wins). Keep all semantic findings.
Reader A:
${JSON.stringify(g.rA?.findings || [], null, 2)}
Reader B:
${JSON.stringify(g.rB?.findings || [], null, 2)}
Semantic critic:
${JSON.stringify(g.sem?.findings || [], null, 2)}
${STANDARD}`,
      { label: `merge:${g.i}`, phase: 'Reconcile', schema: FINDINGS_SCHEMA }
    )
    const findings = (merged?.findings) || []

    // reconcile (JS, deterministic): every HARD census site must be covered by some finding line
    const covered = lineSet(findings)
    const sites = (g.census?.sites) || []
    const uncovered = sites.filter(s => HARD.has(s.signal) && !(covered[s.file] && covered[s.file].has(s.line)))
    if (uncovered.length === 0) return { findings, batch: g.batch, i: g.i }

    log(`batch ${g.i}: ${uncovered.length} uncovered grep sites — targeted re-read`)
    const fill = await agent(
      `The following code sites (catch/SDK/JSON.parse) exist but were not graded. Read each one precisely and grade it as an error source. Return one row per site.
Sites:
${uncovered.map(s => `- ${s.file}:${s.line} (${s.signal})`).join('\n')}
${STANDARD}`,
      { label: `gapfill:${g.i}`, phase: 'Reconcile', schema: FINDINGS_SCHEMA }
    )
    return { findings: [...findings, ...((fill?.findings) || [])], batch: g.batch, i: g.i }
  },

  // -- stage 3: verify critical/high gaps AND passes on catch/mutate (close false negatives) --
  (m, _b, idx) => {
    const rows = (m?.findings) || []
    const i = (m && m.i != null) ? m.i : idx
    const needsVerify = rows.filter(r =>
      (r.verdict === 'gap' && (r.severity === 'critical' || r.severity === 'high')) ||
      (r.verdict === 'pass' && (r.caught === 'try-catch' || r.caught === 'dot-catch' || r.caught === 'wrapper'))
    )
    if (needsVerify.length === 0) return { findings: rows.map(r => ({ ...r, verified: true })) }
    return agent(
      `Adversarially verify by re-reading the code. Two kinds of rows to verify:
1) critical/high gaps — try to REFUTE: maybe there IS a logger via a wrapper, maybe the catch logs on another line, maybe it is an intentional AbortError, maybe surfacing happens further up the stack.
2) PASS rows with catch/wrapper — confirm it is truly PASS and not a silent swallow mislabeled as pass (false negative). If there is no real logger on the path — change to verdict=gap with appropriate severity.
Set verified=false + verifyNote if the row is wrong, otherwise verified=true. Return ALL rows of the batch (also the ones not verified, with verified=true).
Rows to verify:
${JSON.stringify(needsVerify, null, 2)}
All batch rows:
${JSON.stringify(rows, null, 2)}
${STANDARD}`,
      { label: `verify:${i}`, phase: 'Verify', schema: VERIFIED_SCHEMA }
    )
  }
)

const infra = await infraPromise
const allRows = perBatch.filter(Boolean).flatMap(b => (b?.findings) || [])
const rows = allRows.filter(r => r.verified !== false) // drop confirmed false positives
log(`${rows.length} final rows (out of ${allRows.length} before false-positive filtering)`)

// ============ Phase 6: synthesize ============
phase('Synthesize')
const summary = await agent(
  `Write an error-handling audit report in ENGLISH and write it to the file docs/error-handling-audit.md.
Structure:
1. Executive summary: total error sources, how many PASS vs gaps, breakdown by severity and by category.
2. Infrastructure findings: global safety net + ErrorBoundary.
3. One central table sorted by severity (critical->low) with columns: Location | Operation | Category | Caught? | Logged? | Surfaced? | Clear? | Severity | Verdict | Proposed fix.
4. A detailed checklist of the critical and high gaps only, for one-by-one fix approval.
Do not invent data; use only what is provided.

Infrastructure findings:
${JSON.stringify(infra, null, 2)}

All rows:
${JSON.stringify(rows, null, 2)}

Return a summary object.`,
  {
    label: 'synthesize-report', phase: 'Synthesize',
    schema: { type: 'object', required: ['totalSources', 'gaps', 'reportPath'], properties: { totalSources: { type: 'number' }, passCount: { type: 'number' }, gaps: { type: 'number' }, bySeverity: { type: 'object' }, byCategory: { type: 'object' }, reportPath: { type: 'string' }, headline: { type: 'string' } } },
  }
)

return { infra, totalRows: rows.length, summary }
