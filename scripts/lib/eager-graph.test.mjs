// Unit tests for the eager-import guard. Runner is node:test (stdlib) — the audit and its
// lib stay dependency-free.
//   node --test scripts/lib/*.test.mjs
//
// Every assertion runs against a FIXTURE TREE in a temp dir, so the guard is proven in both
// directions: it must go red on a graph that statically imports the forbidden package, and
// green on one that reaches it only through import(). A guard only ever tested on the real
// repo is a guard that passes because the repo happens to be clean.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  auditEagerImports,
  walkEagerGraph,
  staticSpecifiers,
  stripComments,
  packageOf,
  resolveRelative,
  TARGETS,
} from './eager-graph.mjs';

/** Build a fixture tree from a {relativePath: contents} map; returns its root. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'eager-graph-'));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }
  return root;
}

const TARGET = [{
  name: 'fixture app',
  entry: 'src/index.jsx',
  forbid: ['@vibe/core'],
  why: 'fixture',
}];

const audit = (root) => auditEagerImports({ repoRoot: root, targets: TARGET });
const statuses = (result) => result.results[0].checks.map((c) => c.status);

// ---------------------------------------------------------------------------
// the guard in both directions
// ---------------------------------------------------------------------------

test('a clean eager graph passes', () => {
  const root = fixture({
    'src/index.jsx': "import App from './App.jsx';\n",
    'src/App.jsx': "import ErrorState from './ErrorState.jsx';\n",
    'src/ErrorState.jsx': 'export default function ErrorState() { return null; }\n',
  });
  try {
    const result = audit(root);
    assert.equal(result.fails, 0);
    assert.deepEqual(statuses(result), ['pass']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a forbidden import ANYWHERE on the eager path fails, and names the importer', () => {
  // Two hops from the entry: the real defect was never in the entry file itself.
  const root = fixture({
    'src/index.jsx': "import App from './App.jsx';\n",
    'src/App.jsx': "import ErrorState from './shared/ErrorState.jsx';\n",
    'src/shared/ErrorState.jsx': "import { Button } from '@vibe/core';\nexport default Button;\n",
  });
  try {
    const result = audit(root);
    assert.equal(result.fails, 1);
    const fail = result.results[0].checks.find((c) => c.status === 'fail');
    assert.match(fail.label, /@vibe\/core is on the eager path/);
    assert.match(fail.detail, /src\/shared\/ErrorState\.jsx/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the SAME package reached only through import() passes — that is the whole point', () => {
  const root = fixture({
    'src/index.jsx': "import App from './App.jsx';\n",
    'src/App.jsx': "const Settings = lazy(() => import('./Settings.jsx'));\nexport default Settings;\n",
    'src/Settings.jsx': "import { Button } from '@vibe/core';\nexport default Button;\n",
  });
  try {
    const result = audit(root);
    assert.equal(result.fails, 0);
    // Proof it is the dynamic boundary doing the work, not a failure to read the file:
    // Settings.jsx must not be in the walked set at all.
    assert.ok(!result.results[0].graph.files.some((f) => f.endsWith('Settings.jsx')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a subpath import counts as its package', () => {
  const root = fixture({
    'src/index.jsx': "import '@vibe/core/tokens';\n",
  });
  try {
    assert.equal(audit(root).fails, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing entry FAILS rather than quietly passing on an unwalked graph', () => {
  const root = fixture({ 'src/other.jsx': 'export default 1;\n' });
  try {
    const result = audit(root);
    assert.equal(result.fails, 1);
    assert.match(result.results[0].checks[0].detail, /not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unresolvable relative import warns without failing', () => {
  const root = fixture({
    'src/index.jsx': "import gone from './does-not-exist.js';\n",
  });
  try {
    const result = audit(root);
    assert.equal(result.fails, 0);
    assert.equal(result.warns, 1);
    assert.ok(statuses(result).includes('warn'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a cyclic graph terminates', () => {
  const root = fixture({
    'src/index.jsx': "import './a.js';\n",
    'src/a.js': "import './b.js';\n",
    'src/b.js': "import './a.js';\n",
  });
  try {
    assert.equal(audit(root).fails, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// the specifier reader
// ---------------------------------------------------------------------------

test('reads every static form, and no dynamic one', () => {
  const found = staticSpecifiers(`
    import a from './a.js';
    import { b, c } from "./b.js";
    import {
      d,
      e,
    } from './multi.js';
    import './side-effect.css';
    import * as ns from './ns.js';
    export { f } from './re-export.js';
    export * from './star.js';
    const lazy = () => import('./dynamic.js');
    await import("./also-dynamic.js");
  `);
  assert.deepEqual(new Set(found), new Set([
    './a.js', './b.js', './multi.js', './side-effect.css', './ns.js',
    './re-export.js', './star.js',
  ]));
});

test('a commented-out import does not count', () => {
  const found = staticSpecifiers(`
    // import { Button } from '@vibe/core';
    /* import { Loader } from '@vibe/core'; */
    import App from './App.jsx';
  `);
  assert.deepEqual(found, ['./App.jsx']);
});

test('stripComments leaves a protocol slash alone', () => {
  // The guard against a stripper that eats https:// and swallows the rest of the line.
  assert.match(stripComments("const url = 'https://example.com/x';"), /https:\/\/example\.com\/x/);
});

test('packageOf handles scoped and unscoped names', () => {
  assert.equal(packageOf('@vibe/core'), '@vibe/core');
  assert.equal(packageOf('@vibe/core/tokens'), '@vibe/core');
  assert.equal(packageOf('react'), 'react');
  assert.equal(packageOf('react-dom/client'), 'react-dom');
});

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

test('resolves extensionless specifiers and directory indexes', () => {
  const root = fixture({
    'src/entry.js': '',
    'src/Thing.jsx': '',
    'src/folder/index.js': '',
  });
  try {
    const entry = join(root, 'src/entry.js');
    assert.equal(resolveRelative(entry, './Thing'), join(root, 'src/Thing.jsx'));
    assert.equal(resolveRelative(entry, './Thing.jsx'), join(root, 'src/Thing.jsx'));
    assert.equal(resolveRelative(entry, './folder'), join(root, 'src/folder/index.js'));
    assert.equal(resolveRelative(entry, './nope'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bare specifiers are recorded but never walked into', () => {
  const root = fixture({
    'src/index.jsx': "import React from 'react';\nimport './a.js';\n",
    'src/a.js': '',
  });
  try {
    const graph = walkEagerGraph(join(root, 'src/index.jsx'));
    assert.deepEqual([...graph.packages.keys()], ['react']);
    assert.equal(graph.files.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// the real registry
// ---------------------------------------------------------------------------

test('every TARGETS entry is complete', () => {
  assert.ok(TARGETS.length > 0);
  for (const t of TARGETS) {
    assert.equal(typeof t.name, 'string');
    assert.match(t.entry, /\.(js|jsx|ts|tsx)$/);
    assert.ok(Array.isArray(t.forbid) && t.forbid.length > 0);
    // `why` is printed on failure — an entry without one leaves the next reader guessing.
    assert.ok(typeof t.why === 'string' && t.why.length > 20);
  }
});

test('the real repo passes its own guard', () => {
  assert.equal(auditEagerImports().fails, 0);
});
