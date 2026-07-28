#!/usr/bin/env node
// Generate scripts/lifecycle-apps.config.json from the live account state:
// for every producer app it runs `mapps app-version:list` + `mapps
// app-features:list` (draft + live versions) and writes the full registration
// matrix — apps × {draft, live} × lifecycle features. This removes the
// stale-feature-id problem for good: after any promote / new draft, re-run
// this script and re-register (feature ids differ per version — verified:
// tracker draft 23902080/23902079 vs live 19856477/19856476).
//
// Usage:
//   node scripts/resolve-lifecycle-features.mjs [--app <name>] [--webhook-base-url <url>] [--dry-run]
//
//   --webhook-base-url  Overrides the webhookBaseUrl written to the config.
//                       Without it the existing config value is preserved.
//                       Interim target (owner decision 2026-07-22): the
//                       telemetry-dashboard DRAFT URL; re-point to live1
//                       after the dashboard release.
//   --app               Only refresh the named app (the rest of the config
//                       is preserved as-is).
//   --dry-run           Print the resulting config to stdout without writing.
//
// Requires the mapps CLI authenticated locally (`mapps init -t <token>`).
// Read-only against the account: only list commands are executed.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { lifecycleKindFor } from './lifecycle-kinds.mjs';

const CONFIG_URL = new URL('./lifecycle-apps.config.json', import.meta.url);

// Producer apps wired to the ALE board — ids match the table in the root
// CLAUDE.md (ground truth). telemetry-dashboard itself is the consumer, not
// a producer, so it is deliberately absent.
export const PRODUCER_APPS = [
  { name: 'axis-day-off', appId: '11459177' },
  { name: 'axis-sync-calender', appId: '11666315' },
  { name: 'axis-tracker', appId: '10684862' },
  { name: 'axis-planner', appId: '10787117' },
  { name: 'discussions', appId: '11457413' },
  { name: 'team-people-column', appId: '11689948' },
  { name: 'deadline-confirm', appId: '11704868' },
];

// Parse the console.table box-drawing output mapps prints. Rows are `│`-
// separated; the first data row is the header. The `(index)` column is
// dropped, quoted strings are unquoted, everything else stays a raw string.
export function parseMappsTable(text) {
  const lines = String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('│'));
  if (lines.length < 2) return [];
  const splitRow = (line) =>
    line
      .split('│')
      .slice(1, -1)
      .map((cell) => cell.trim());
  const unquote = (v) =>
    v.startsWith("'") && v.endsWith("'") && v.length >= 2 ? v.slice(1, -1) : v;
  const headers = splitRow(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitRow(line);
    const row = {};
    headers.forEach((h, i) => {
      if (h === '(index)') return;
      row[h] = unquote(cells[i] ?? '');
    });
    return row;
  });
}

// From `app-version:list` rows, pick the registration targets: the highest-
// numbered draft and the highest-numbered live version. Deprecated versions
// are never targets. Either can be null (sync-calender has no live yet).
export function pickTargetVersions(rows) {
  const num = (r) => parseInt(String(r.versionNumber ?? '').replace(/^v/, ''), 10) || 0;
  const latest = (status) =>
    rows
      .filter((r) => r.status === status)
      .sort((a, b) => num(b) - num(a))[0] ?? null;
  return { draft: latest('draft'), live: latest('live') };
}

// Turn one version + its `app-features:list` rows into a config entry.
// Features without lifecycle events are kept under skippedFeatures so the
// generated matrix stays reviewable (nothing silently disappears).
export function buildVersionEntry(versionRow, featureRows) {
  const features = [];
  const skippedFeatures = [];
  for (const f of featureRows) {
    const kind = lifecycleKindFor(f.type);
    const base = { featureId: Number(f.id), name: f.name, type: f.type };
    if (kind) features.push({ ...base, kind });
    else skippedFeatures.push(base);
  }
  return {
    versionId: versionRow.id,
    versionNumber: versionRow.versionNumber,
    versionStatus: versionRow.status,
    features,
    skippedFeatures,
  };
}

function runMapps(args) {
  // mapps prints a punycode DeprecationWarning on stderr; stdout is the table.
  return execFileSync('mapps', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function resolveApp(app) {
  const versionRows = parseMappsTable(runMapps(['app-version:list', '-i', app.appId]));
  if (versionRows.length === 0) {
    throw new Error(`app-version:list returned no versions for ${app.name} (${app.appId})`);
  }
  const { draft, live } = pickTargetVersions(versionRows);
  const versions = [];
  for (const versionRow of [draft, live]) {
    if (!versionRow) continue;
    const featureRows = parseMappsTable(
      runMapps(['app-features:list', '-a', app.appId, '-i', versionRow.id])
    );
    versions.push(buildVersionEntry(versionRow, featureRows));
  }
  return { name: app.name, appId: app.appId, versions };
}

function loadExistingConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_URL, 'utf8'));
  } catch {
    return {};
  }
}

function printMatrix(apps) {
  console.log('\nRegistration matrix:');
  for (const app of apps) {
    for (const v of app.versions) {
      const feats = v.features.map((f) => `${f.featureId} ${f.kind}`).join(', ') || '—';
      const skipped = v.skippedFeatures.length
        ? `  (skipped: ${v.skippedFeatures.map((f) => `${f.featureId} ${f.type}`).join(', ')})`
        : '';
      console.log(`  ${app.name} ${v.versionNumber} [${v.versionStatus}] → ${feats}${skipped}`);
    }
    if (app.versions.length === 0) console.log(`  ${app.name} → no draft/live versions found`);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      app: { type: 'string' },
      'webhook-base-url': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('usage: node scripts/resolve-lifecycle-features.mjs [--app <name>] [--webhook-base-url <url>] [--dry-run]');
    return;
  }

  let targets = PRODUCER_APPS;
  if (values.app) {
    targets = PRODUCER_APPS.filter((a) => a.name === values.app || a.appId === values.app);
    if (targets.length === 0) {
      console.error(`--app ${values.app} matched nothing; known apps: ${PRODUCER_APPS.map((a) => a.name).join(', ')}`);
      process.exit(1);
    }
  }

  const existing = loadExistingConfig();
  const webhookBaseUrl = (values['webhook-base-url'] ?? existing.webhookBaseUrl ?? '').replace(/\/+$/, '');
  if (!webhookBaseUrl) {
    console.error('no webhookBaseUrl: pass --webhook-base-url or keep one in the existing config');
    process.exit(1);
  }

  const failures = [];
  const resolved = [];
  for (const app of targets) {
    try {
      console.log(`resolving ${app.name} (${app.appId})…`);
      resolved.push(resolveApp(app));
    } catch (err) {
      console.error(`  ${app.name} failed: ${err.message}`);
      failures.push(app.name);
    }
  }
  if (failures.length > 0) {
    console.error(`\naborting without writing — resolution failed for: ${failures.join(', ')}`);
    process.exit(1);
  }

  // --app refresh keeps every other app's entry from the existing config.
  let apps = resolved;
  if (values.app && Array.isArray(existing.apps)) {
    apps = PRODUCER_APPS.map(
      (p) => resolved.find((r) => r.name === p.name) ?? existing.apps.find((e) => e.name === p.name)
    ).filter(Boolean);
  }

  const config = {
    _comment:
      'GENERATED by scripts/resolve-lifecycle-features.mjs — do not hand-edit ids. Re-run it (then re-register) after every promote or new draft version: feature ids differ per version. webhookBaseUrl interim target is the telemetry-dashboard DRAFT url (owner decision 2026-07-22); re-point to live1 after the dashboard release.',
    generatedAt: new Date().toISOString(),
    webhookBaseUrl,
    apps,
  };

  printMatrix(apps);
  if (values['dry-run']) {
    console.log(`\n(dry run) config not written; would write to ${fileURLToPath(CONFIG_URL)}`);
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  writeFileSync(CONFIG_URL, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`\nwrote ${fileURLToPath(CONFIG_URL)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`resolve-lifecycle-features failed: ${err.message}`);
    process.exit(1);
  });
}
