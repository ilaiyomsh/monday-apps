#!/usr/bin/env node
// symbolicate.mjs — resolve a minified `stack1` frame from an `app-errors` log
// row back to its original source location, using the build's sourcemap.
//
// Client apps build with `sourcemap: 'hidden'` (§6 LOGGING-ARCHITECTURE.md):
// the `.map` is produced but NEVER shipped to the CDN — CI archives it as a
// GitHub Actions artifact `sourcemaps-<app>-<fullSha>` and strips it from the
// deployed dir. This tool pulls that artifact (keyed by the log's `ver` field,
// `<pkgVersion>+<shortSha>`) and maps `index-<hash>.js:LINE:COL` back to source.
//
// Usage:
//   node symbolicate.mjs '<frame>' --map <path/to.map>              # offline: explicit map
//   node symbolicate.mjs '<frame>' --app <slug> --ver <x.y.z+sha>   # fetch CI artifact via gh
//   node symbolicate.mjs '<frame>' --app <slug> --sha <fullSha>     # fetch by full sha
//
// <frame> accepts any of:
//   "at Sl (https://host/assets/index-Brz8XzEh.js:61:29212)"
//   "https://host/assets/index-Brz8XzEh.js:61:29212"
//   "index-Brz8XzEh.js:61:29212"
//
// Prints the original file:line:col, the mapped symbol name, and a source
// snippet (from the map's sourcesContent) when available.

import { readFileSync, mkdtempSync, readdirSync, existsSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

function die(msg, code = 1) {
  process.stderr.write(`symbolicate: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--map') out.map = argv[++i];
    else if (a === '--app') out.app = argv[++i];
    else if (a === '--ver') out.ver = argv[++i];
    else if (a === '--sha') out.sha = argv[++i];
    else if (a === '--context' || a === '-C') out.context = parseInt(argv[++i], 10);
    else if (a === '-h' || a === '--help') out.help = true;
    else out._.push(a);
  }
  return out;
}

// Extract { bundle, line, column } from a frame string. Grabs the LAST
// `<file>.js:LINE:COL` occurrence (V8 wraps the url in parens).
function parseFrame(frame) {
  const re = /([^\s()/\\]+\.js):(\d+):(\d+)/g;
  let m, last = null;
  while ((m = re.exec(frame)) !== null) last = m;
  if (!last) die(`could not find a "<file>.js:LINE:COL" location in: ${frame}`);
  return { bundle: basename(last[1]), line: Number(last[2]), column: Number(last[3]) };
}

function repoNameWithOwner() {
  try {
    return execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'ilaiyomsh/monday-apps';
  }
}

// Find + download the sourcemap artifact for (app, sha) via gh, unzip to a temp
// dir, and return the path to <bundle>.map inside it.
function fetchMapFromArtifact({ app, sha, shortSha, bundle }) {
  if (!app) die('need --app to locate a CI sourcemap artifact (or pass --map)');
  const repo = repoNameWithOwner();
  const prefix = `sourcemaps-${app}-`;
  let artifacts;
  try {
    const raw = execFileSync(
      'gh',
      ['api', '--paginate', `repos/${repo}/actions/artifacts?per_page=100`, '-q', '.artifacts[] | {id,name,expired}'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    artifacts = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) {
    die(`gh api failed listing artifacts for ${repo}: ${e.message}`);
  }
  const candidates = artifacts.filter((a) => a.name.startsWith(prefix) && !a.expired);
  let hit = null;
  if (sha) hit = candidates.find((a) => a.name === `${prefix}${sha}`);
  else if (shortSha) hit = candidates.find((a) => a.name.slice(prefix.length).startsWith(shortSha));
  if (!hit) {
    const seen = candidates.map((a) => a.name).slice(0, 10).join('\n  ') || '(none)';
    die(
      `no live artifact for ${prefix}${sha || shortSha + '…'} in ${repo}.\n` +
        `Live ${prefix}* artifacts:\n  ${seen}\n` +
        `(artifacts expire — retention is set in the deploy workflow; rebuild the commit to regenerate.)`,
    );
  }
  const dir = mkdtempSync(join(tmpdir(), 'symbolicate-'));
  const zip = join(dir, 'a.zip');
  try {
    execFileSync('gh', ['api', `repos/${repo}/actions/artifacts/${hit.id}/zip`], {
      stdio: ['ignore', openSync(zip, 'w'), 'inherit'],
      maxBuffer: 256 * 1024 * 1024,
    });
    execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  } catch (e) {
    die(`failed downloading/unzipping artifact ${hit.name}: ${e.message}`);
  }
  const want = `${bundle}.map`;
  const found = walkFind(dir, want);
  if (!found) die(`artifact ${hit.name} has no ${want} (bundle hash may not match this build)`);
  process.stderr.write(`symbolicate: using artifact ${hit.name} → ${want}\n`);
  return found;
}

function walkFind(dir, name) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const r = walkFind(p, name);
      if (r) return r;
    } else if (e.name === name) return p;
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) {
    process.stdout.write(
      'Usage: symbolicate "<frame>" (--map <file> | --app <slug> [--ver <x.y.z+sha> | --sha <sha>]) [-C <n>]\n',
    );
    process.exit(args.help ? 0 : 1);
  }
  const { bundle, line, column } = parseFrame(args._.join(' '));

  let mapPath = args.map;
  if (!mapPath) {
    let shortSha = args.sha;
    if (!shortSha && args.ver) {
      const plus = args.ver.indexOf('+');
      if (plus === -1) die(`--ver "${args.ver}" has no "+sha" suffix; pass --sha instead`);
      shortSha = args.ver.slice(plus + 1);
    }
    if (!shortSha) die('need --map, or --app with --ver/--sha, to locate the sourcemap');
    mapPath = fetchMapFromArtifact({ app: args.app, sha: args.sha, shortSha, bundle });
  }
  if (!existsSync(mapPath)) die(`map not found: ${mapPath}`);

  const raw = JSON.parse(readFileSync(mapPath, 'utf8'));
  const tracer = new TraceMap(raw);
  // Stack traces are 1-based line + 1-based column; trace-mapping wants
  // 1-based line + 0-based column.
  const pos = originalPositionFor(tracer, { line, column: Math.max(0, column - 1) });
  if (!pos || pos.source == null) {
    die(`no mapping for ${bundle}:${line}:${column} (offset outside the map, or wrong bundle/build)`);
  }

  const ctx = Number.isFinite(args.context) ? args.context : 3;
  process.stdout.write(`${bundle}:${line}:${column}\n`);
  process.stdout.write(`  → ${pos.source}:${pos.line}:${pos.column}${pos.name ? `  (${pos.name})` : ''}\n`);

  const idx = raw.sources ? raw.sources.indexOf(pos.source) : -1;
  const content = idx >= 0 && raw.sourcesContent ? raw.sourcesContent[idx] : null;
  if (content && Number.isFinite(pos.line)) {
    const lines = content.split('\n');
    const from = Math.max(1, pos.line - ctx);
    const to = Math.min(lines.length, pos.line + ctx);
    process.stdout.write('\n');
    for (let n = from; n <= to; n++) {
      const marker = n === pos.line ? '▶' : ' ';
      process.stdout.write(`  ${marker} ${String(n).padStart(5)} | ${lines[n - 1]}\n`);
    }
  }
}

main();
