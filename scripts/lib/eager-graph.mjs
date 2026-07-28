#!/usr/bin/env node
/**
 * eager-graph.mjs — forbidden-import guard for the EAGER (non-lazy) module graph of a
 * surface. node:fs only (zero deps). Runnable as a script (exit 1 on any violation) and
 * importable as a lib (scripts/lib/eager-graph.test.mjs).
 *
 * WHY THIS AND NOT A SIZE BUDGET. A byte threshold measures a symptom, needs a build to
 * evaluate, and ratchets — always upward, because the only way to make a red budget green
 * on a deadline is to raise it. The invariant is the actual rule: nothing on the picker's
 * eager path may import a heavy UI kit. That is binary, needs no build, and runs in
 * milliseconds before the build step. twyst-your-status shipped 47 KB gzip of @vibe/core in
 * the picker's critical chunk for three components the happy path never rendered — one of
 * them unreachable dead code. Nothing would have told us.
 *
 * It is DECLARATIVE: the TARGETS array below is the single source of truth. Guarding a new
 * surface = add ONE entry.
 *
 * TWO HONEST LIMITS, both by design:
 *
 *  1. STATIC IMPORTS ONLY. The walker follows `import … from '…'`, bare `import '…'` and
 *     `export … from '…'`, and stops dead at `import(…)` — which is the point, since
 *     `React.lazy(() => import(…))` is exactly how a heavy dependency is SUPPOSED to be
 *     reached. The flip side is that anything pulled in by a runtime require, a re-export
 *     generated at build time, or a bundler alias is invisible here. A green guard means
 *     "no static path to the forbidden module", not "not in the bundle".
 *  2. IT REPORTS, IT DOES NOT BLOCK. Per .github/workflows/ci.yml (GitHub Free + private
 *     repo = no required checks), a red run is visible on the PR but cannot physically stop
 *     a merge. Discipline and the agent are the enforcement layer.
 *
 * Unresolvable relative imports are WARNINGS, never silent: a file the walker cannot find
 * is coverage it did not have, and pretending otherwise is how a guard reports green on a
 * graph it can no longer read.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = resolve(SELF_DIR, '../..');

// ============================================================================
// TARGETS — the declarative registry. One entry per guarded surface.
// ============================================================================
export const TARGETS = [
  {
    name: 'twyst-your-status — picker eager path',
    entry: 'apps/twyst-your-status/src/index.jsx',
    forbid: ['@vibe/core'],
    why: 'The /picker iframe is created on the cell click and destroyed on close, so this '
      + 'chunk is re-fetched and re-parsed on EVERY open. Vibe belongs behind React.lazy '
      + '(ColumnSettings, SettingsLauncher, RequiredFieldsForm, PersonPicker). Shared '
      + 'components on the eager path (ErrorState, LoadingState) use plain elements styled '
      + 'with Vibe CSS custom properties instead — see MANIFEST.md.',
  },
];

/** Extensions tried for an extensionless specifier, in resolution order. */
const EXTENSIONS = ['.js', '.jsx', '.mjs', '.ts', '.tsx'];

/** Only these are parsed for further imports; a .css/.json leaf has no JS graph. */
const PARSEABLE = /\.(js|jsx|mjs|cjs|ts|tsx)$/;

/**
 * Strip comments so a commented-out or documented import never counts as one.
 * Regex-based, like the error-wiring audit's stripper: it does not understand a `//`
 * inside a string literal. The failure mode is conservative here — over-stripping can
 * only DROP an import, which surfaces as an unresolved-coverage warning, not as a
 * false pass on a forbidden one.
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/**
 * Every STATIC import/re-export specifier in a module, in source order.
 * `import(…)` is deliberately not matched — see limit 1 in the header.
 */
export function staticSpecifiers(source) {
  const src = stripComments(source);
  const found = [];
  // `import … from 'x'` / `export … from 'x'`. The [^;'"] class cannot cross a statement
  // boundary or a string literal, so a dynamic import earlier in the file cannot be
  // stitched onto a later `from`.
  const withFrom = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
  // Side-effect only: `import 'x'`. The \s after `import` excludes `import('x')`.
  const bare = /\bimport\s+['"]([^'"]+)['"]/g;
  for (const re of [withFrom, bare]) {
    let match = re.exec(src);
    while (match !== null) {
      found.push(match[1]);
      match = re.exec(src);
    }
  }
  return found;
}

/** True for a package specifier (bare or scoped) rather than a path. */
const isBare = (spec) => !spec.startsWith('.') && !spec.startsWith('/');

/** The package a bare specifier belongs to: '@vibe/core/tokens' -> '@vibe/core'. */
export function packageOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const isFile = (p) => existsSync(p) && statSync(p).isFile();

/** Resolve a relative specifier to a real file, mirroring bundler resolution order. */
export function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  if (isFile(base)) return base;
  for (const ext of EXTENSIONS) {
    if (isFile(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONS) {
    const indexFile = join(base, `index${ext}`);
    if (isFile(indexFile)) return indexFile;
  }
  return null;
}

/**
 * Walk the eager graph from an entry file.
 *
 * @param {string} entryFile absolute path to the entry module
 * @returns {{ files: string[], packages: Map<string, string[]>, unresolved: string[] }}
 *   `packages` maps a package name to the files that statically import it.
 */
export function walkEagerGraph(entryFile) {
  const files = [];
  const packages = new Map();
  const unresolved = [];
  const seen = new Set();
  const queue = [entryFile];

  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    files.push(current);
    if (!PARSEABLE.test(current)) continue;

    for (const spec of staticSpecifiers(readFileSync(current, 'utf8'))) {
      if (isBare(spec)) {
        const pkg = packageOf(spec);
        if (!packages.has(pkg)) packages.set(pkg, []);
        packages.get(pkg).push(current);
        continue; // never walk INTO node_modules
      }
      const resolved = resolveRelative(current, spec);
      if (resolved === null) {
        unresolved.push(`${current} -> ${spec}`);
        continue;
      }
      queue.push(resolved);
    }
  }

  return { files, packages, unresolved };
}

/**
 * Audit every target. Pure — no printing, no exiting.
 *
 * @param {{ repoRoot?: string, targets?: Array<object> }} [opts]
 * @returns {{ results: Array<object>, fails: number, warns: number }}
 */
export function auditEagerImports({ repoRoot = DEFAULT_REPO, targets = TARGETS } = {}) {
  const results = [];
  let fails = 0;
  let warns = 0;

  for (const target of targets) {
    const entryFile = resolve(repoRoot, target.entry);
    const checks = [];

    if (!isFile(entryFile)) {
      // A moved or renamed entry must be loud: the guard silently passing on a graph it
      // never walked is strictly worse than no guard.
      checks.push({
        status: 'fail',
        label: `entry exists: ${target.entry}`,
        detail: 'not found — update the TARGETS entry',
      });
      fails += 1;
      results.push({ target, checks, graph: null });
      continue;
    }

    const graph = walkEagerGraph(entryFile);
    const rel = (p) => relative(repoRoot, p);

    for (const forbidden of target.forbid) {
      const importers = graph.packages.get(forbidden);
      if (importers === undefined) {
        checks.push({
          status: 'pass',
          label: `no static path to ${forbidden}`,
          detail: `${graph.files.length} eager modules walked`,
        });
      } else {
        fails += 1;
        checks.push({
          status: 'fail',
          label: `${forbidden} is on the eager path`,
          detail: `imported by ${[...new Set(importers)].map(rel).join(', ')}`,
        });
      }
    }

    if (graph.unresolved.length > 0) {
      warns += 1;
      checks.push({
        status: 'warn',
        label: `${graph.unresolved.length} unresolved import(s) — coverage gap`,
        detail: graph.unresolved.map((u) => u.replace(`${repoRoot}/`, '')).join('; '),
      });
    }

    results.push({ target, checks, graph });
  }

  return { results, fails, warns };
}

// ============================================================================
// CLI — only when executed directly, so importing this from the tests is inert.
// ============================================================================
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const repoRoot = process.env.AUDIT_REPO_ROOT
    ? resolve(process.env.AUDIT_REPO_ROOT)
    : DEFAULT_REPO;
  const { results, fails, warns } = auditEagerImports({ repoRoot });

  const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', X = '\x1b[0m';
  const glyph = (st) => (st === 'pass' ? `${G}✓${X}` : st === 'warn' ? `${Y}⚠${X}` : `${R}✗${X}`);

  console.log(`\neager-import audit — forbidden imports on non-lazy paths\n${'='.repeat(56)}`);
  for (const { target, checks } of results) {
    console.log(`\n${target.name}`);
    for (const c of checks) {
      console.log(`  ${glyph(c.status)} ${c.label}${c.detail ? `  ${DIM}— ${c.detail}${X}` : ''}`);
    }
    if (checks.some((c) => c.status === 'fail')) console.log(`  ${DIM}${target.why}${X}`);
  }

  console.log(`\n${'='.repeat(56)}`);
  console.log(`${fails === 0 ? `${G}PASS${X}` : `${R}FAIL${X}`}  ${results.length} target(s) · ${fails} violation(s) · ${warns} coverage warning(s)`);
  console.log(`${DIM}static imports only; reports but does not block (ci.yml: GitHub Free, no required checks)${X}\n`);

  process.exit(fails === 0 ? 0 : 1);
}
