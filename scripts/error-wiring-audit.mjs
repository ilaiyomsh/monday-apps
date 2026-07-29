#!/usr/bin/env node
/**
 * error-wiring-audit.mjs — repo-level STRUCTURAL checker for the error-kit / error-guard
 * wiring across every monday-app surface. node:fs only (zero deps). Exit 1 on any hard
 * violation, 0 otherwise; known/pending gaps print as ⚠ warnings without failing.
 *
 * It is DECLARATIVE: the SURFACES array below is the single source of truth. Onboarding a new
 * app = add ONE entry (see docs/ERROR-AXIOM-STANDARD.md → onboarding checklist). Everything
 * else is generic.
 *
 * What it enforces, per surface kind:
 *   CLIENT:
 *     - entry wires the global handlers AND the Axiom sink, the sink BEFORE render (ring-buffer
 *       replay must not overlap the live sink)
 *     - a root ErrorBoundary exists (in the entry, the app tree, or via app-core's bootstrapApp)
 *     - the deploy workflow bakes VITE_AXIOM_DATASET / VITE_AXIOM_TOKEN (+ VITE_AXIOM_APP)
 *   SERVER:
 *     - process guards install BOTH uncaughtException AND unhandledRejection
 *     - a terminal 4-arg Express error middleware exists
 *     - the sink is opts-injected — no process.env.AXIOM_* reads in the sink file itself
 *   REPO-WIDE (heuristic):
 *     - no raw fetch to axiom.co outside the sanctioned transport/query files
 *     - no console.* inside a catch block outside sanctioned files (logger/sink/transport/…)
 *
 * Heuristic limits are DOCUMENTED inline where they apply (comment stripping is regex-based;
 * the catch-block scan is a brace matcher, not a parser — it can miss exotic nesting). A real
 * violation that the checker cannot cleanly classify is surfaced, never silently dropped.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { auditWorkflowEnv } from './lib/workflow-env.mjs';

// Root defaults to this script's parent (the repo). AUDIT_REPO_ROOT overrides it — used by
// the test suite to point the audit at a fixture tree (and prove it fails on a broken one).
const REPO = process.env.AUDIT_REPO_ROOT
  ? resolve(process.env.AUDIT_REPO_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

// A file is SANCTIONED (exempt from the console-in-catch + raw-axiom-fetch scans) when its
// basename or path matches one of these — the transport/sink/logger/handler infra whose
// breadcrumbs and endpoint constants are the point, plus tests and the dashboard's read path.
const SANCTIONED = [
  /(^|\/)logger\.[jt]sx?$/i,
  /[Ss]ink/,
  /[Tt]ransport/,
  /globalErrorHandler/,
  /process-?guards/i,
  /\/__tests__\//,
  /\.(test|spec)\.[jt]sx?$/,
  /telemetry-dashboard\/src\/server\/axiom\.js$/, // the dashboard's Axiom QUERY client (read path)
];
const isSanctioned = (rel) => SANCTIONED.some((re) => re.test(rel));

// ============================================================================
// SURFACES — the declarative registry. One entry per shipping surface.
// ============================================================================
const SURFACES = [
  // ---- pure clients (import @mapps/error-kit directly, or via @axis/app-core) ----
  {
    name: 'axis-tracker', kind: 'client',
    entry: 'apps/axis/tracker/src/index.jsx',
    wiring: [{ anyOf: ['setupGlobalErrorHandlers'], beforeRender: true }, { anyOf: ['attachAxiomSink'], beforeRender: true }],
    renderMarkers: ['createRoot(', '.render('],
    boundaryDirs: ['apps/axis/tracker/src'],
    workflow: '.github/workflows/deploy-draft-axis-tracker.yml',
    deployEnv: { keys: ['VITE_AXIOM_DATASET', 'VITE_AXIOM_TOKEN', 'VITE_AXIOM_APP'] },
  },
  {
    name: 'axis-day-off', kind: 'client',
    entry: 'apps/axis/day-off/src/main.tsx',
    // app-core consumer: bootstrapApp installs the global handlers + ErrorBoundary + renders.
    wiring: [{ anyOf: ['attachAxiomSink'], beforeRender: true }, { anyOf: ['bootstrapApp', 'setupGlobalErrorHandlers'], beforeRender: false }],
    renderMarkers: ['bootstrapApp('],
    boundaryDirs: ['apps/axis/services/app-core/src'], // ErrorBoundary lives in app-core
    workflow: '.github/workflows/deploy-draft-axis-day-off.yml',
    deployEnv: { keys: ['VITE_AXIOM_DATASET', 'VITE_AXIOM_TOKEN', 'VITE_AXIOM_APP'] },
  },
  {
    name: 'axis-planner', kind: 'client',
    entry: 'apps/axis/planner/src/main.tsx',
    // initErrorReporting() wraps setupGlobalErrorHandlers + attachAxiomSink.
    wiring: [{ anyOf: ['initErrorReporting', 'attachAxiomSink'], beforeRender: true }],
    renderMarkers: ['createRoot('],
    boundaryDirs: ['apps/axis/planner/src'],
    workflow: '.github/workflows/deploy-draft-axis-planner.yml',
    deployEnv: { keys: ['VITE_AXIOM_DATASET', 'VITE_AXIOM_TOKEN', 'VITE_AXIOM_APP'] },
  },
  {
    name: 'discussions', kind: 'client',
    entry: 'apps/discussions/src/index.jsx',
    wiring: [{ anyOf: ['setupGlobalErrorHandlers'], beforeRender: true }, { anyOf: ['attachAxiomSink'], beforeRender: true }],
    renderMarkers: ['createRoot('],
    boundaryDirs: ['apps/discussions/src'],
    workflow: '.github/workflows/deploy-draft-discussions.yml',
    deployEnv: { keys: ['VITE_AXIOM_DATASET', 'VITE_AXIOM_TOKEN', 'VITE_AXIOM_APP'] },
  },
  {
    name: 'twyst-your-status', kind: 'client',
    entry: 'apps/twyst-your-status/src/index.jsx',
    wiring: [{ anyOf: ['setupGlobalErrorHandlers'], beforeRender: true }, { anyOf: ['attachAxiomSink'], beforeRender: true }],
    renderMarkers: ['createRoot('],
    boundaryDirs: ['apps/twyst-your-status/src'],
    workflow: '.github/workflows/deploy-draft-twyst-your-status.yml',
    deployEnv: { keys: ['VITE_AXIOM_DATASET', 'VITE_AXIOM_TOKEN', 'VITE_AXIOM_APP'] },
  },
  {
    name: 'team-people-column', kind: 'client',
    entry: 'apps/team-people-column/src/index.jsx',
    wiring: [{ anyOf: ['setupGlobalErrorHandlers'], beforeRender: true }, { anyOf: ['attachAxiomSink'], beforeRender: true }],
    renderMarkers: ['createRoot('],
    boundaryDirs: ['apps/team-people-column/src'],
    workflow: '.github/workflows/deploy-draft-team-people-column.yml',
    deployEnv: { keys: ['VITE_AXIOM_DATASET', 'VITE_AXIOM_TOKEN', 'VITE_AXIOM_APP'] },
  },
  // ---- embedded admin SPAs (vendored copies) ----
  {
    name: 'sync-calender-admin', kind: 'client',
    entry: 'apps/axis/sync-calender/src/client/admin/main.tsx',
    wiring: [{ anyOf: ['setupGlobalErrorHandlers'], beforeRender: true }, { anyOf: ['attachAxiomSink'], beforeRender: true }],
    renderMarkers: ['createRoot('],
    boundaryDirs: ['apps/axis/sync-calender/src/client/admin'],
    workflow: '.github/workflows/deploy-draft-axis-sync-calender.yml',
    deployEnv: { keys: ['VITE_AXIOM_DATASET', 'VITE_AXIOM_TOKEN', 'VITE_AXIOM_APP'] },
  },
  {
    name: 'deadline-confirm-admin', kind: 'client',
    entry: 'apps/deadline-confirm/src/client/admin/main.tsx',
    wiring: [{ anyOf: ['attachAxiomSink'], beforeRender: true }, { anyOf: ['setupGlobalErrorHandlers'], beforeRender: true }],
    renderMarkers: ['createRoot('],
    boundaryDirs: ['apps/deadline-confirm/src/client/admin'],
    workflow: '.github/workflows/deploy-draft-deadline-confirm.yml',
    // The admin build now bakes VITE_AXIOM_* (draft + live workflows) — the former known gap is
    // closed, so this surface is enforced like the rest: a missing key FAILS, never warns.
    deployEnv: { keys: ['VITE_AXIOM_DATASET', 'VITE_AXIOM_TOKEN', 'VITE_AXIOM_APP'] },
  },
  {
    name: 'telemetry-dashboard-client', kind: 'client',
    entry: 'apps/telemetry-dashboard/src/client/main.tsx',
    wiring: [{ anyOf: ['setupGlobalErrorHandlers'], beforeRender: true }, { anyOf: ['attachAxiomSink'], beforeRender: true }],
    renderMarkers: ['createRoot('],
    boundaryDirs: ['apps/telemetry-dashboard/src/client'],
    workflow: '.github/workflows/deploy-draft-telemetry-dashboard.yml',
    deployEnv: { keys: ['VITE_AXIOM_DATASET', 'VITE_AXIOM_TOKEN', 'VITE_AXIOM_APP'] },
  },
  // ---- servers (monday-code) ----
  {
    name: 'sync-calender-server', kind: 'server',
    entry: 'apps/axis/sync-calender/src/index.js',
    processGuardsFile: 'apps/axis/sync-calender/src/process-guards.js',
    middlewareFiles: ['apps/axis/sync-calender/src/middlewares/error-middleware.js'],
    sinkFile: 'apps/axis/sync-calender/src/services/axiomServerSink.js',
  },
  {
    name: 'deadline-confirm-server', kind: 'server',
    entry: 'apps/deadline-confirm/src/index.js',
    processGuardsFile: 'apps/deadline-confirm/src/helpers/process-guards.js',
    middlewareFiles: ['apps/deadline-confirm/src/app.js'],
    sinkFile: 'apps/deadline-confirm/src/helpers/axiomServerSink.js',
  },
  {
    name: 'telemetry-dashboard-server', kind: 'server',
    entry: 'apps/telemetry-dashboard/src/index.js',
    processGuardsFile: 'apps/telemetry-dashboard/src/helpers/processGuards.js',
    middlewareFiles: ['apps/telemetry-dashboard/src/app.js'],
    sinkFile: 'apps/telemetry-dashboard/src/helpers/axiomServerSink.js',
  },
];

// ============================================================================
// helpers
// ============================================================================
const read = (rel) => {
  const abs = resolve(REPO, rel);
  return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, 'utf8') : null;
};

/** Strip /* *​/ block comments and // line comments (regex heuristic — good enough for the
 *  config/code we scan; string literals containing "//" are rare here and noted where relied on). */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripBlockComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ''); // keeps line comments

const firstIndexOfAny = (src, tokens) => {
  let min = -1;
  for (const t of tokens) {
    const i = src.indexOf(t);
    if (i >= 0 && (min === -1 || i < min)) min = i;
  }
  return min;
};

/** Walk a source dir collecting .js/.jsx/.ts/.tsx files (skips node_modules/dist/build/coverage). */
function walk(relDir, out = []) {
  const abs = resolve(REPO, relDir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (['node_modules', 'dist', 'build', 'coverage', '.git', 'public', 'legacy'].includes(name)) continue;
    const childAbs = join(abs, name);
    const childRel = join(relDir, name);
    const st = statSync(childAbs);
    if (st.isDirectory()) walk(childRel, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(childRel);
  }
  return out;
}

/** Does `dir` contain any file that imports/uses an ErrorBoundary? */
function hasErrorBoundary(dirs) {
  for (const d of dirs) {
    for (const f of walk(d)) {
      const src = read(f);
      if (src && /ErrorBoundary/.test(src)) return true;
    }
  }
  return false;
}

/**
 * Heuristic: a console.* call inside a catch block. Brace-matcher, NOT a parser — it finds each
 * `catch (…) {`, walks to the matching `}`, and flags a `console.\w+(` inside.
 *
 * It honors the two escape hatches the real ESLint no-console rule honors:
 *   - a `// eslint-disable-next-line no-console` / `eslint-disable-line no-console` on the console
 *     line or the line above it (a reviewed, deliberate breadcrumb — e.g. a catch that ALSO
 *     displays via setError but keeps a dev console breadcrumb).
 *   - a console that is itself commented out (`// console.error(...)`).
 *
 * LIMITS (documented, accepted): braces inside strings / regex / template literals are counted
 * naively, so on files with heavy brace-in-string content the matched body can over-reach. This
 * is why logger/sink/transport/handler files are sanctioned OUT of this scan entirely (their
 * console breadcrumbs are the point). Operates on block-comment-stripped source so `catch {`
 * inside a /* *​/ block is ignored while line comments (where eslint-disable lives) survive.
 */
function consoleInCatch(src) {
  const hits = [];
  const lines = src.split('\n');
  const re = /catch\s*(\([^)]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    const body = src.slice(start, i - 1);
    const cRe = /\bconsole\.\w+\s*\(/g;
    let cm;
    while ((cm = cRe.exec(body)) !== null) {
      const absPos = start + cm.index;
      const lineNo = src.slice(0, absPos).split('\n').length; // 1-based
      const thisLine = lines[lineNo - 1] ?? '';
      const prevLine = lines[lineNo - 2] ?? '';
      // commented-out console (line comment before the match on the same line)
      const beforeOnLine = thisLine.slice(0, thisLine.indexOf('console.'));
      if (beforeOnLine.includes('//')) continue;
      // reviewed breadcrumb: eslint-disable no-console on this or the previous line
      const disabled = (t) => /eslint-disable(-next-line|-line)?\b.*no-console/.test(t);
      if (disabled(thisLine) || disabled(prevLine)) continue;
      hits.push(lineNo);
    }
  }
  return hits;
}

// ============================================================================
// per-surface checks
// ============================================================================
const results = []; // { surface, checks: [{ label, status: 'pass'|'fail'|'warn', detail }] }

function checkClient(s) {
  const checks = [];
  const raw = read(s.entry);
  if (raw === null) {
    checks.push({ label: 'entry file exists', status: 'fail', detail: s.entry });
    return checks;
  }
  // Analyse the CODE, not the comments — entries routinely say "…BEFORE createRoot().render"
  // in a comment, which must not be mistaken for the actual render call.
  const src = stripComments(raw);
  const renderIdx = firstIndexOfAny(src, s.renderMarkers);
  for (const req of s.wiring) {
    // match the CALL form (token + '(') so an `import { attachAxiomSink }` line is not mistaken
    // for the wiring call, and a token that is imported-but-never-called still fails.
    const idx = firstIndexOfAny(src, req.anyOf.map((t) => `${t}(`));
    if (idx < 0) {
      checks.push({ label: `entry wires ${req.anyOf.join(' | ')}`, status: 'fail', detail: `none of [${req.anyOf.join(', ')}] found in ${s.entry}` });
      continue;
    }
    if (req.beforeRender) {
      if (renderIdx < 0) {
        checks.push({ label: `entry wires ${req.anyOf.join(' | ')} before render`, status: 'fail', detail: `no render marker (${s.renderMarkers.join(', ')}) found` });
      } else if (idx > renderIdx) {
        checks.push({ label: `entry wires ${req.anyOf.join(' | ')} before render`, status: 'fail', detail: `wiring appears AFTER render` });
      } else {
        checks.push({ label: `entry wires ${req.anyOf.join(' | ')} before render`, status: 'pass' });
      }
    } else {
      checks.push({ label: `entry wires ${req.anyOf.join(' | ')}`, status: 'pass' });
    }
  }
  checks.push(hasErrorBoundary(s.boundaryDirs)
    ? { label: 'root ErrorBoundary present', status: 'pass' }
    : { label: 'root ErrorBoundary present', status: 'fail', detail: `no ErrorBoundary under ${s.boundaryDirs.join(', ')}` });

  // Deploy workflow env — BOTH the draft workflow and its live twin. Auditing draft only
  // left the customer-facing build unchecked: the exact regression this gate exists to
  // catch could ship to production while CI stayed green. And the check is structural
  // (see scripts/lib/workflow-env.mjs), not a substring scan — a key in a comment, in a
  // `run:` body, or in a duplicate `env:` block is no longer mistaken for real wiring.
  for (const wfPath of workflowPair(s.workflow)) {
    const label = `${wfPath.includes('deploy-live-') ? 'live' : 'draft'} workflow bakes VITE_AXIOM_* (structural)`;
    const wf = read(wfPath);
    if (wf === null) {
      checks.push({ label: 'deploy workflow exists', status: 'fail', detail: wfPath });
      continue;
    }
    const { errors } = auditWorkflowEnv(wf, { requiredKeys: s.deployEnv.keys });
    if (errors.length === 0) {
      checks.push({ label, status: 'pass' });
    } else if (s.deployEnv.knownGap) {
      checks.push({ label, status: 'warn', detail: `${s.deployEnv.knownGap} [${errors.join('; ')}]` });
    } else {
      checks.push({ label, status: 'fail', detail: `${wfPath}: ${errors.join('; ')}` });
    }
  }
  return checks;
}

/**
 * A surface declares its draft workflow; the live twin is the same file with the
 * `deploy-draft-` prefix swapped. Returns both so neither side can drift unaudited.
 */
function workflowPair(draftPath) {
  const live = draftPath.replace('/deploy-draft-', '/deploy-live-');
  return live === draftPath ? [draftPath] : [draftPath, live];
}

function checkServer(s) {
  const checks = [];
  // process guards: BOTH uncaughtException + unhandledRejection, and the entry installs them.
  const pg = read(s.processGuardsFile);
  const entry = read(s.entry);
  if (pg === null) {
    checks.push({ label: 'process guards file exists', status: 'fail', detail: s.processGuardsFile });
  } else {
    const both = pg.includes('uncaughtException') && pg.includes('unhandledRejection');
    checks.push(both
      ? { label: 'process guards (uncaughtException + unhandledRejection)', status: 'pass' }
      : { label: 'process guards (uncaughtException + unhandledRejection)', status: 'fail', detail: `missing one of the two in ${s.processGuardsFile}` });
  }
  // A MISSING entry file must fail, not vanish. The previous shape (`if (entry && …) / else
  // if (entry)`) pushed no check at all when the file could not be read, so renaming a
  // server entry without updating SURFACES silently deleted the process-guards requirement
  // from a passing report — a fail-open in a blocking gate.
  if (entry === null) {
    checks.push({ label: 'server entry exists', status: 'fail', detail: `cannot read ${s.entry} (stale SURFACES entry?)` });
  } else if (!/installProcessGuards\s*\(/.test(entry)) {
    checks.push({ label: 'entry installs process guards', status: 'fail', detail: `installProcessGuards(...) not called in ${s.entry}` });
  } else {
    checks.push({ label: 'entry installs process guards', status: 'pass' });
  }

  // terminal 4-arg error middleware
  const mwRe = /\(\s*err\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+\s*\)\s*=>/; // (err, req, res, next) =>
  const mwReFn = /function[^(]*\(\s*err\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+\s*\)/;
  const found = s.middlewareFiles.some((f) => {
    const c = read(f);
    return c && (mwRe.test(c) || mwReFn.test(c));
  });
  checks.push(found
    ? { label: 'terminal 4-arg error middleware', status: 'pass' }
    : { label: 'terminal 4-arg error middleware', status: 'fail', detail: `no (err, req, res, next) middleware in ${s.middlewareFiles.join(', ')}` });

  // sink opts-injected: no process.env in the sink CODE (comments may mention it)
  const sink = read(s.sinkFile);
  if (sink === null) {
    checks.push({ label: 'sink opts-injected (no process.env)', status: 'fail', detail: s.sinkFile });
  } else {
    const code = stripComments(sink);
    checks.push(!/process\.env/.test(code)
      ? { label: 'sink opts-injected (no process.env)', status: 'pass' }
      : { label: 'sink opts-injected (no process.env)', status: 'fail', detail: `${s.sinkFile} reads process.env in code — inject config via opts/envManager from index.js` });
  }
  return checks;
}

for (const s of SURFACES) {
  results.push({ surface: s, checks: s.kind === 'client' ? checkClient(s) : checkServer(s) });
}

// ============================================================================
// repo-wide heuristic scans
// ============================================================================
// NOTE: this list drives ONLY the repo-wide heuristics below (raw-axiom-fetch and
// console-in-catch). It is SEPARATE from SURFACES above, and an app missing from here is
// silently unscanned while the audit still reports PASS. Adding an app to SURFACES without
// adding it here (or vice versa) is the recurring mistake — both lists need the entry.
const APP_SRC_DIRS = ['apps/axis/tracker/src', 'apps/axis/day-off/src', 'apps/axis/planner/src',
  'apps/axis/services/app-core/src', 'apps/axis/sync-calender/src', 'apps/discussions/src',
  'apps/team-people-column/src', 'apps/deadline-confirm/src', 'apps/telemetry-dashboard/src',
  // docs-export is scanned here from day one. Its full SURFACES entry is deliberately
  // deferred until its deploy workflows exist — a surface declares `workflow`, and a
  // missing workflow file is a hard `fail`, so registering the surface before the
  // pipeline onboarding would break this blocking gate.
  'apps/docs-export/src'];

const rawFetchHits = [];
const consoleCatchHits = [];
for (const dir of APP_SRC_DIRS) {
  for (const f of walk(dir)) {
    if (isSanctioned(f)) continue;
    const src = read(f);
    if (!src) continue;
    const code = stripComments(src);
    if (/axiom\.co|api\.axiom/.test(code)) rawFetchHits.push(f);
    // console scan keeps line comments so eslint-disable directives survive.
    for (const line of consoleInCatch(stripBlockComments(src))) consoleCatchHits.push(`${f}:${line}`);
  }
}

// ============================================================================
// report
// ============================================================================
let fails = 0;
let warns = 0;
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', X = '\x1b[0m';
const glyph = (st) => (st === 'pass' ? `${G}✓${X}` : st === 'warn' ? `${Y}⚠${X}` : `${R}✗${X}`);

console.log('\nerror-wiring-audit — per-surface report\n' + '='.repeat(48));
for (const { surface, checks } of results) {
  console.log(`\n${surface.name} ${DIM}(${surface.kind})${X}`);
  for (const c of checks) {
    if (c.status === 'fail') fails++;
    if (c.status === 'warn') warns++;
    console.log(`  ${glyph(c.status)} ${c.label}${c.detail ? `  ${DIM}— ${c.detail}${X}` : ''}`);
  }
}

console.log(`\nrepo-wide heuristics\n${'-'.repeat(48)}`);
if (rawFetchHits.length === 0) {
  console.log(`  ${glyph('pass')} no raw axiom.co fetch outside sanctioned transport/query files`);
} else {
  fails += rawFetchHits.length;
  console.log(`  ${glyph('fail')} raw axiom.co reference outside sanctioned files:`);
  for (const h of rawFetchHits) console.log(`      ${h}`);
}
if (consoleCatchHits.length === 0) {
  console.log(`  ${glyph('pass')} no console.* inside catch blocks outside sanctioned files ${DIM}(brace-matcher heuristic)${X}`);
} else {
  fails += consoleCatchHits.length;
  console.log(`  ${glyph('fail')} console.* inside a catch block (use the app logger):`);
  for (const h of consoleCatchHits) console.log(`      ${h}`);
}

console.log(`\n${'='.repeat(48)}`);
console.log(`${fails === 0 ? G + 'PASS' + X : R + 'FAIL' + X}  ${results.length} surfaces · ${fails} violation(s) · ${warns} known gap(s)`);
if (warns > 0) console.log(`${DIM}known gaps are reported (not failed) — see docs/ERROR-AXIOM-STANDARD.md openIssues${X}`);
console.log('');

process.exit(fails === 0 ? 0 : 1);
