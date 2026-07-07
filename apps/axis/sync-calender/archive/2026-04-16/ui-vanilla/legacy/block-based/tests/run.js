// tests/run.js — CLI dispatcher. Usage:
//   node tests/run.js <scenario-name>       # single scenario (any tier)
//   node tests/run.js <tier>/<name>         # explicit tier (action, e2e, smoke)
//   node tests/run.js all action            # every scenario in tests/scenarios/action/
//   node tests/run.js all e2e               # every scenario in tests/scenarios/e2e/
//   node tests/run.js all smoke             # every scenario at tests/scenarios/*.js
//   node tests/run.js all                   # all tiers
import fs from 'fs/promises';
import path from 'path';

const TIERS = ['action', 'e2e', 'smoke'];

async function discover(tier) {
  const baseDir = path.resolve('tests/scenarios', tier === 'smoke' ? '' : tier);
  const out = {};
  async function walk(dir, prefix) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (tier === 'smoke') continue; // smoke tier never recurses
        await walk(full, prefix ? `${prefix}/${ent.name}` : ent.name);
      } else if (ent.isFile() && ent.name.endsWith('.js')) {
        const key = (prefix ? `${prefix}/` : '') + ent.name.replace(/\.js$/, '');
        const relPath = './' + path.relative(path.resolve('tests'), full);
        out[key] = { tier, loader: () => import(relPath) };
      }
    }
  }
  await walk(baseDir, '');
  return out;
}

async function buildCatalog() {
  const catalog = {};
  for (const tier of TIERS) {
    const found = await discover(tier);
    for (const [name, entry] of Object.entries(found)) {
      // For name collisions across tiers, tier prefix disambiguates.
      catalog[`${tier}/${name}`] = entry;
      if (!catalog[name]) catalog[name] = entry; // convenience short form
    }
  }
  return catalog;
}

async function runOne(name, entry) {
  console.log(`\n=== [${entry.tier}] ${name} ===`);
  const t0 = Date.now();
  try {
    const mod = await entry.loader();
    await mod.run();
  } catch (err) {
    console.error(`\n✗ ${name} crashed:`, err.message);
    if (process.env.VERBOSE) console.error(err.stack);
    process.exitCode = 1;
  }
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`— ${dur}s`);
}

async function runTier(tier, catalog) {
  const keys = Object.keys(catalog)
    .filter((k) => k.startsWith(`${tier}/`))
    .sort();
  if (keys.length === 0) {
    console.error(`no scenarios found under tier "${tier}"`);
    process.exit(1);
  }
  console.log(`▶ Running tier "${tier}" — ${keys.length} scenarios`);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const shortName = key.slice(tier.length + 1);
    await runOne(`${tier}/${shortName}`, catalog[key]);
    // Cool-down between scenarios: lets OS release ports + gives monday API
    // a breath so we don't trip rate limits on back-to-back runs.
    if (i < keys.length - 1) await new Promise((r) => setTimeout(r, 1500));
  }
}

async function main() {
  const [a, b] = process.argv.slice(2);
  const catalog = await buildCatalog();

  if (!a) {
    console.error('Usage: node tests/run.js <scenario> | <tier>/<scenario> | all <tier> | all');
    console.error('Tiers:', TIERS.join(', '));
    process.exit(1);
  }

  if (a === 'all' && b && TIERS.includes(b)) {
    await runTier(b, catalog);
    return;
  }
  if (a === 'all') {
    for (const tier of TIERS) await runTier(tier, catalog);
    return;
  }

  // Single scenario
  const entry = catalog[a];
  if (!entry) {
    console.error(`unknown scenario: ${a}`);
    console.error('Available:');
    for (const key of Object.keys(catalog).sort()) {
      if (key.includes('/')) console.error('  ', key);
    }
    process.exit(1);
  }
  await runOne(a, entry);
}

main();
