export const meta = {
  name: 'mutation-audit',
  description: 'Mutation audit of existing test suites: inject deliberate semantic bugs, check whether tests catch them',
  whenToUse: 'test-guard audit mode — measure whether a project\'s tests can actually fail. Args: [{name, dir, scope?, mutationsPerModule?}]',
  phases: [
    { title: 'Audit', detail: 'one agent per project, sequential mutations with full restore' },
  ],
}

// args: array of { name: string, dir: absolute path, scope?: string, mutationsPerModule?: number }
// scope: free-text instructions on which test files/modules to cover (default: all test files,
// capped at 10 modules prioritizing business logic over UI).

const RESULTS_SCHEMA = {
  type: 'object',
  required: ['project', 'baseline', 'modules', 'treeClean'],
  properties: {
    project: { type: 'string' },
    baseline: {
      type: 'object',
      required: ['ran', 'passed'],
      properties: {
        ran: { type: 'boolean' },
        passed: { type: 'boolean' },
        failingTests: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
    },
    modules: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sourceFile', 'testFile', 'mutations'],
        properties: {
          sourceFile: { type: 'string' },
          testFile: { type: 'string' },
          skippedReason: { type: 'string' },
          mutations: {
            type: 'array',
            items: {
              type: 'object',
              required: ['description', 'killed'],
              properties: {
                description: { type: 'string' },
                killed: { type: 'boolean' },
                failingTests: { type: 'array', items: { type: 'string' } },
                survivalAnalysis: { type: 'string' },
              },
            },
          },
        },
      },
    },
    treeClean: { type: 'boolean' },
    notes: { type: 'string' },
  },
}

const PROTOCOL = `
You are running a MUTATION AUDIT on an existing test suite. The goal: measure whether the existing tests actually catch real bugs, or only confirm the code against itself. You do NOT fix anything, you do NOT improve tests, you only measure and report. The full protocol lives at .claude/skills/test-guard/references/mutation-protocol.md (relative to the repo root) — read it first; the essentials:

1. Baseline first: run the full suite once (the project's test script, or npx vitest run / npx jest). Record pass/fail. If specific test files fail at baseline, note them and SKIP the modules they cover.
2. For each target module: design SEMANTIC mutations — realistic bugs an engineer could ship. Good kinds: flip a boundary (< vs <=), negate/weaken a condition (&& vs ||), wrong object key in a produced payload, drop a filter/guard clause, swap ternary/if branches or spread order, change a default/fallback value, off-by-one in date/index arithmetic. BAD kinds (do not use): syntax errors, removing exports, breaking imports, type-only changes. Selection discipline: mutations on a module must hit DISTINCT targets, and at least one must target a line/branch/produced key NOT literally quoted in any assertion of the test file.
3. Per mutation, exactly this sequence:
   a. cp SOURCE_FILE SOURCE_FILE.mutbak
   b. apply the single mutation with Edit
   c. run ONLY the relevant test file
   d. record: killed=true if any test failed — killed=true REQUIRES failingTests to name at least one failing test copied from the runner output (an evidence-free kill claim is invalid); killed=false if all passed
   e. restore: mv SOURCE_FILE.mutbak SOURCE_FILE (ALWAYS, even on errors)
4. If a mutation survived its own test file: (a) verify the mutated line is actually reachable (not dead code — if dead, note it and pick another mutation); (b) re-apply the mutation once and run the FULL project suite — if any other test kills it, record killed=true with those failingTests (a kill by a consumer/integration test is a kill, not a survivor); restore again. For genuine survivors write one sentence in survivalAnalysis explaining WHY the suite missed it.
5. NEVER modify any test file. NEVER run git commit/checkout/stash. NEVER leave a mutation in place.
6. At the end: re-run the baseline (must be green again), check 'find . -name "*.mutbak" -not -path "*/node_modules/*"' is empty, and if a git repo compare git status --porcelain with the state you found at start. Report treeClean honestly.

Report via structured output. File paths relative to the project dir. Be honest — a survived mutation is the interesting finding here, not a failure of yours.`

if (!Array.isArray(args) || args.length === 0) {
  return { error: 'mutation-audit requires args: [{name, dir, scope?, mutationsPerModule?}] — one entry per project to audit.' }
}

phase('Audit')
log(`Auditing ${args.length} project(s) in parallel`)

const results = await parallel(args.map(p => () =>
  agent(
    `Project directory: ${p.dir}\nProject name for the report: ${p.name}\n\n` +
    `Coverage scope: ${p.scope || 'ALL test files in the project (search for *.test.* / *.spec.* outside node_modules). If there are more than 10, sample 10 modules prioritizing business logic (services, domain, hooks, utils) over UI components, and list your selection rationale in notes.'}\n` +
    `Mutations per module: ${p.mutationsPerModule || 3}.\n\n${PROTOCOL}`,
    { label: `audit:${p.name}`, phase: 'Audit', schema: RESULTS_SCHEMA }
  )
))

const clean = results.filter(Boolean)
const totals = clean.map(r => {
  const ms = (r.modules || []).filter(m => !m.skippedReason)
  const muts = ms.flatMap(m => m.mutations || [])
  return { project: r.project, modules: ms.length, mutations: muts.length, killed: muts.filter(x => x.killed).length, treeClean: r.treeClean }
})
log('Done: ' + totals.map(t => `${t.project}: ${t.killed}/${t.mutations} killed (tree clean: ${t.treeClean})`).join(' | '))

return { results: clean, totals }
