export const meta = {
  name: 'sink-readiness',
  description: 'Determine whether every error source would reach a FUTURE centralized logging sink. Two axes: (A) architecture — does logger have a single sink chokepoint + structured payload to attach to; (B) coverage — does every error source actually flow THROUGH logger vs bare console (dark-console) or silent swallow (dark-swallowed). Grep census + 2 classifiers + reconcile + adversarial verify of DARK sites + report.',
  phases: [
    { title: 'Discover', detail: 'find all source files' },
    { title: 'SinkArch', detail: 'is logger sink-ready: chokepoint, method exits, parallel bypass paths, payload, refactor' },
    { title: 'Census', detail: 'per batch: grep every console/logger/catch + 2 reachability classifiers' },
    { title: 'Reconcile', detail: 'merge classifiers (worst wins), reconcile vs census, gap-fill unaccounted catch/console sites' },
    { title: 'Verify', detail: 'adversarially refute DARK (swallowed/console) classifications' },
    { title: 'Synthesize', detail: 'yes/no verdict + reachability counts + full dark-site list + refactor to make logger sink-ready' },
  ],
}

// ============ shared rubric, injected into every reachability agent ============
const SINK_RULES = `
We are answering ONE question per error source: if a future centralized sink (remote logging / telemetry — e.g. Sentry, a backend /logs endpoint, an analytics pipe) were attached to the project's logger (src/utils/logger.js), would THIS error source's failure reach it?

Classify each error source's failure path into exactly one of:
- "reaches" = on failure it calls logger.error / logger.warn / logger.apiError / logger.info / logger.debug — directly, OR via a wrapper that logs (wrapMondayApiCall, safeApi, ErrorBoundary.componentDidCatch). These WOULD be captured once logger forwards to a sink.
- "dark-console" = on failure it calls console.log / console.error / console.warn / console.info DIRECTLY and does NOT also call logger. A sink attached to logger would NOT see it.
- "dark-swallowed" = on failure NOTHING is emitted: empty / comment-only catch, fire-and-forget promise with no .catch, a .then with no .catch, an unguarded throw whose caller does not log, a soft-error early-return on a mutate path with no log, an async effect/handler whose rejection is uncaught. Completely invisible to any sink.

Definitions:
- An "error source" = any await / SDK call (monday.api/execute/listen/get/storage) / JSON.parse / field access on an API response / async useEffect / async event handler / render-time code that may throw / date-number parsing that can NaN / a promise without await ("fire and forget") / a .then without .catch / a soft-error early-return on a mutate path.
- A wrapper "reaches" ONLY if you can confirm it actually calls logger on its failure path. wrapMondayApiCall and ErrorBoundary.componentDidCatch log; safeApi logs GraphQL errors via logger but does NOT throw (so callers that ignore its return still count the safeApi log as "reaches" for the sink question, even if user-surfacing is missing — surfacing is a different concern).
- IMPORTANT framing: "reaches" is CONDITIONAL — logger currently writes only to console and has no sink. "reaches" means "would reach a sink ONCE logger forwards to one." "dark-*" sites stay invisible even after logger is wired to a sink, because they never call logger.
- A direct console.* that is purely an init/debug breadcrumb (not on a failure path) is still "dark-console" if it is the only record of a failure; ignore pure success/debug logs that are not about an error.
- All free-text you return (operation, note) must be in ENGLISH.
`

const SITE_PROPS = {
  file: { type: 'string' },
  lineRange: { type: 'string', description: 'e.g. "142" or "142-150"' },
  operation: { type: 'string', description: 'short English description of what fails here' },
  category: { type: 'string', enum: ['api', 'render', 'race', 'validation', 'sdk', 'uncaught', 'network'] },
  outputSite: { type: 'string', enum: ['logger', 'wrapper', 'console', 'swallowed-catch', 'none'] },
  sinkReachable: { type: 'string', enum: ['reaches', 'dark-console', 'dark-swallowed'] },
  severityIfDark: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'n/a'] },
  note: { type: 'string', description: 'how it is (or is not) routed to logger; name the wrapper if via wrapper' },
}
const SITE_REQUIRED = ['file', 'lineRange', 'operation', 'category', 'outputSite', 'sinkReachable', 'note']
const SITES_SCHEMA = { type: 'object', required: ['sites'], properties: { sites: { type: 'array', items: { type: 'object', required: SITE_REQUIRED, properties: SITE_PROPS } } } }
const VERIFIED_SITES_SCHEMA = { type: 'object', required: ['sites'], properties: { sites: { type: 'array', items: { type: 'object', required: [...SITE_REQUIRED, 'verified'], properties: { ...SITE_PROPS, verified: { type: 'boolean' }, verifyNote: { type: 'string' } } } } } }
const CENSUS_SCHEMA = { type: 'object', required: ['sites'], properties: { sites: { type: 'array', items: { type: 'object', required: ['file', 'line', 'signal'], properties: { file: { type: 'string' }, line: { type: 'number' }, signal: { type: 'string', enum: ['catch', 'dotcatch', 'console', 'logger'] } } } } } }

const ARCH_SCHEMA = {
  type: 'object',
  required: ['hasSinkChokepoint', 'structuredPayload', 'loggerExits', 'parallelPaths', 'wrapperFunnels', 'refactorSteps', 'summary'],
  properties: {
    hasSinkChokepoint: { type: 'boolean', description: 'true ONLY if a single real function inside logger that every log passes through exists today' },
    chokepointNote: { type: 'string' },
    structuredPayload: { type: 'string', enum: ['none', 'partial', 'full'], description: 'at the would-be sink point, is a structured record (level/module/message/error/timestamp/context) available, or only a formatted string + freeform data' },
    loggerExits: { type: 'array', items: { type: 'object', required: ['method', 'exit'], properties: { method: { type: 'string' }, exit: { type: 'string', enum: ['logWithColor->console', 'console-direct', 'console.group', 'mixed', 'other'] }, line: { type: 'string' } } } },
    parallelPaths: { type: 'array', items: { type: 'string' }, description: 'error-handling paths that bypass logger ENTIRELY (e.g. showErrorWithDetails surfaces but never logs; globalErrorHandler bare console fallbacks; any direct console.* on a failure path)' },
    wrapperFunnels: { type: 'array', items: { type: 'string' }, description: 'wrappers CONFIRMED to route through logger (so sources using them are sink-reachable)' },
    refactorSteps: { type: 'array', items: { type: 'string' }, description: 'concrete steps to make logger sink-ready' },
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
const SIZE = 8
const batches = []
for (let i = 0; i < files.length; i += SIZE) batches.push(files.slice(i, i + SIZE))
log(`${files.length} files in ${batches.length} batches`)

// ============ Phase 2 (concurrent): sink architecture, 2 independent lenses ============
phase('SinkArch')
const archPrompt = (lens) => `You are deciding whether the project's logger can be the SINGLE attach point for a FUTURE centralized sink (remote logging / telemetry). ${lens}
Read in full: src/utils/logger.js. Then trace how errors funnel by reading: src/utils/errorHandler.js (parseMondayError, createFullErrorObject), the file that defines wrapMondayApiCall + safeApi (search under src/utils/mondayApi*), src/utils/globalErrorHandler.js, src/components/ErrorBoundary/ErrorBoundary.jsx, src/hooks/useToast.js (showErrorWithDetails).
Answer precisely:
1. hasSinkChokepoint: is there ONE function inside logger that every log call passes through (where a sink could be attached in a single place)? Or does each method write to console independently? Set true ONLY if a single real chokepoint exists today.
2. loggerExits: for each logger method (debug/info/warn/error/api/apiResponse/apiError/functionStart/functionEnd/initDone/initSummary), say HOW it emits output (logWithColor->console.log, direct console.error, console.group, mixed) with line numbers. Note which methods bypass logWithColor.
3. structuredPayload: at the would-be sink point, is a structured object available (level, module, message, error, timestamp, context), or only a formatted string + freeform data? none / partial / full.
4. parallelPaths: list EVERY error-handling path that bypasses logger entirely — showErrorWithDetails (does it ever call logger?), globalErrorHandler bare console.error fallbacks, any direct console.* on a failure path. These would NOT reach a logger-attached sink.
5. wrapperFunnels: confirm which wrappers DO call logger on failure (wrapMondayApiCall, safeApi, ErrorBoundary.componentDidCatch) — quote the logger call.
6. refactorSteps: concrete steps to make logger sink-ready — e.g. a single emit(record) chokepoint that all methods call, a structured record shape, a sink registry (logger.addSink), a ring buffer + flush, AbortError filtering, redaction of PII.
${SINK_RULES}`
const archPromise = parallel([
  () => agent(archPrompt('Lens A: focus on the chokepoint, per-method console exits, and the structured-payload gap.'), { label: 'arch-A', phase: 'SinkArch', schema: ARCH_SCHEMA }),
  () => agent(archPrompt('Lens B: focus on parallel bypass paths (console.*, showErrorWithDetails, globalErrorHandler) and confirming the wrapper funnels, plus a concrete refactor plan.'), { label: 'arch-B', phase: 'SinkArch', schema: ARCH_SCHEMA }),
])

// ============ helpers ============
const lineSet = (sites) => {
  const m = {}
  for (const s of sites) {
    const nums = String(s.lineRange).match(/\d+/g) || []
    const a = +nums[0], b = nums[1] ? +nums[1] : a
    if (!Number.isFinite(a)) continue
    if (!m[s.file]) m[s.file] = new Set()
    for (let n = a; n <= b; n++) m[s.file].add(n)
  }
  return m
}
const HARD = new Set(['catch', 'dotcatch', 'console']) // every catch / .catch / console.* must be accounted for by a classified site

// ============ Phase 3+4+5: per-batch census -> reconcile -> verify ============
phase('Census')
const perBatch = await pipeline(
  batches,

  // -- stage 1: grep census + 2 reachability classifiers, concurrently --
  (batch, _o, i) => parallel([
    () => agent(
      `Run exactly this command and return every match as {file,line,signal} (do not add or omit any):
grep -nE '\\}[[:space:]]*catch[[:space:]]*\\(|[[:space:]]catch[[:space:]]*\\{|\\.catch\\(|console\\.(log|error|warn|info|group)|logger\\.(error|warn|apiError|info|debug|api|apiResponse)' ${batch.join(' ')}
signal mapping: "} catch(" or " catch {" => catch ; ".catch(" => dotcatch ; "console.*" => console ; "logger.*" => logger.`,
      { label: `census:${i}`, phase: 'Census', schema: CENSUS_SCHEMA }
    ),
    () => agent(
      `Classifier A — focus on DARK-SWALLOWED vs REACHES. Read these files in full:
${batch.map(f => '- ' + f).join('\n')}
Find every error source. For each, decide sinkReachable: does its failure path eventually call logger (reaches) — directly OR via wrapMondayApiCall/safeApi/ErrorBoundary — or does it emit nothing at all (dark-swallowed)? Pay special attention to empty/comment-only catches, fire-and-forget promises, .then without .catch, soft-error early-returns on mutate paths, and uncaught async-effect rejections. Return one row per source (including "reaches" rows).
${SINK_RULES}`,
      { label: `classA:${i}`, phase: 'Census', schema: SITES_SCHEMA }
    ),
    () => agent(
      `Classifier B — focus on DARK-CONSOLE vs wrapper-REACHES. Read these files in full:
${batch.map(f => '- ' + f).join('\n')}
Find every place a failure is (or should be) reported. Distinguish bare console.* on a failure path (dark-console — would NOT reach a logger sink) from logger.* / wrapper routing (reaches). Confirm wrapper routing by checking the wrapper actually calls logger. Return one row per site (including "reaches" rows).
${SINK_RULES}`,
      { label: `classB:${i}`, phase: 'Census', schema: SITES_SCHEMA }
    ),
  ]).then(([census, cA, cB]) => ({ census, cA, cB, batch, i })),

  // -- stage 2: merge classifiers (worst reachability wins) + reconcile vs census + gap-fill --
  async (g) => {
    const merged = await agent(
      `Merge two reachability classifications into one unified list, de-duplicated (identity = file + overlapping lineRange + operation). On a conflict, pick the WORST reachability: dark-swallowed (worst) beats dark-console beats reaches. Keep every distinct site.
Classifier A:
${JSON.stringify(g.cA?.sites || [], null, 2)}
Classifier B:
${JSON.stringify(g.cB?.sites || [], null, 2)}
${SINK_RULES}`,
      { label: `merge:${g.i}`, phase: 'Reconcile', schema: SITES_SCHEMA }
    )
    const sites = (merged?.sites) || []

    // reconcile (deterministic): every HARD census site (catch/.catch/console) must be covered by some classified row
    const covered = lineSet(sites)
    const census = (g.census?.sites) || []
    const uncovered = census.filter(s => HARD.has(s.signal) && !(covered[s.file] && covered[s.file].has(s.line)))
    if (uncovered.length === 0) return { sites, batch: g.batch, i: g.i }

    log(`batch ${g.i}: ${uncovered.length} uncovered catch/console sites — targeted re-read`)
    const fill = await agent(
      `The following code sites (catch / .catch / console.*) exist but were not classified for sink-reachability. Read each precisely and classify it. Return one row per site.
Sites:
${uncovered.map(s => `- ${s.file}:${s.line} (${s.signal})`).join('\n')}
${SINK_RULES}`,
      { label: `gapfill:${g.i}`, phase: 'Reconcile', schema: SITES_SCHEMA }
    )
    return { sites: [...sites, ...((fill?.sites) || [])], batch: g.batch, i: g.i }
  },

  // -- stage 3: adversarially verify DARK classifications (refute dark) --
  (m, _b, idx) => {
    const rows = (m?.sites) || []
    const i = (m && m.i != null) ? m.i : idx
    const needsVerify = rows.filter(r => r.sinkReachable === 'dark-swallowed' || r.sinkReachable === 'dark-console')
    if (needsVerify.length === 0) return { sites: rows.map(r => ({ ...r, verified: true })) }
    return agent(
      `Adversarially verify each DARK row by RE-READING the code. Try to REFUTE the dark classification:
- dark-swallowed: maybe there IS a logger call on the path (on another line, or in a wrapper like wrapMondayApiCall/safeApi/ErrorBoundary), maybe it is an intentional AbortError ignore, maybe the rejection is caught upstream and logged. If so it is actually "reaches" (or "dark-console").
- dark-console: maybe a logger call also fires alongside the console.* (then it is "reaches"), or maybe the console.* is a pure success/debug breadcrumb not on a failure path (then it is not an error source at all — set verified=false).
Set verified=false + verifyNote when the row's reachability is wrong; otherwise verified=true. Return ALL rows of the batch (also non-dark rows, with verified=true).
Rows to verify:
${JSON.stringify(needsVerify, null, 2)}
All batch rows:
${JSON.stringify(rows, null, 2)}
${SINK_RULES}`,
      { label: `verify:${i}`, phase: 'Verify', schema: VERIFIED_SITES_SCHEMA }
    )
  }
)

const [arch1, arch2] = (await archPromise).map(x => x || null)
const allRows = perBatch.filter(Boolean).flatMap(b => (b?.sites) || [])
const rows = allRows.filter(r => r.verified !== false) // drop confirmed misclassifications

// deterministic tally
const tally = { reaches: 0, 'dark-console': 0, 'dark-swallowed': 0 }
for (const r of rows) if (tally[r.sinkReachable] != null) tally[r.sinkReachable]++
const darkRows = rows.filter(r => r.sinkReachable !== 'reaches')
log(`${rows.length} error sources: ${tally.reaches} reaches, ${tally['dark-console']} dark-console, ${tally['dark-swallowed']} dark-swallowed`)

// ============ Phase 6: synthesize ============
phase('Synthesize')
const summary = await agent(
  `Write a "logger sink-readiness" report in ENGLISH to the file docs/sink-readiness.md.
Answer one question: "Is every error source mapped so it would reach a future centralized sink?"

Use ONLY the data provided. Structure:
1. Verdict (one paragraph, blunt yes/no). Make the two-axis distinction explicit: (A) ARCHITECTURE — does logger today have a single chokepoint + structured payload a sink can attach to; (B) COVERAGE — do all error sources actually flow through logger.
2. Architecture findings: reconcile the two arch analyses below. Cover: hasSinkChokepoint, the per-method console exits, structuredPayload level, the parallel bypass paths, the confirmed wrapper funnels.
3. Coverage stats: total error sources = ${rows.length}; reaches=${tally.reaches}, dark-console=${tally['dark-console']}, dark-swallowed=${tally['dark-swallowed']}. Give a breakdown by category too.
4. The DARK-SITE TABLE — every source that is NOT mapped (dark-console + dark-swallowed), sorted by severityIfDark (critical->low). Columns: Location | Operation | Category | Output today | Reachable? | Severity | Note.
5. Refactor plan: the concrete steps to make logger sink-ready (single emit() chokepoint, structured record, sink registry, buffer/flush, AbortError filter, PII redaction) AND the work to close the coverage gap (convert console.* -> logger, eliminate silent swallows). Order by impact.

Arch analysis A:
${JSON.stringify(arch1, null, 2)}

Arch analysis B:
${JSON.stringify(arch2, null, 2)}

All classified error sources:
${JSON.stringify(rows, null, 2)}

Return a summary object.`,
  {
    label: 'synthesize-report', phase: 'Synthesize',
    schema: {
      type: 'object',
      required: ['answer', 'totalSources', 'reaches', 'darkConsole', 'darkSwallowed', 'reportPath', 'headline'],
      properties: {
        answer: { type: 'string', enum: ['yes', 'no', 'partial'] },
        hasSinkChokepoint: { type: 'boolean' },
        totalSources: { type: 'number' },
        reaches: { type: 'number' },
        darkConsole: { type: 'number' },
        darkSwallowed: { type: 'number' },
        reportPath: { type: 'string' },
        headline: { type: 'string' },
      },
    },
  }
)

return { arch: { a: arch1, b: arch2 }, tally, totalSources: rows.length, darkCount: darkRows.length, summary }
