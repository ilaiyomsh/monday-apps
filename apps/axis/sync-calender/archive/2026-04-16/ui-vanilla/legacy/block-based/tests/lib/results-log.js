// Append-only log of scenario runs. Two formats, both in /tests:
//   results.log   — human-readable blocks, each scenario occupying ~10 lines.
//   results.jsonl — one JSON object per line, for future tooling / diffing.
//
// Usage inside a scenario:
//
//   import { startRun, createRecorder, finishRun } from '../lib/results-log.js';
//   const run = startRun('create-event', 'action');
//   const r = createRecorder(run);
//   r.assert(res.status === 200, 'response 200');
//   r.record('itemId', itemId);
//   const { failed } = await finishRun(run, failed === 0 ? 'pass' : 'fail');
//
// createRecorder wraps the existing assert helpers so each assertion is
// captured both on stdout (live feedback) and into the run record.

import { promises as fs } from 'fs';
import path from 'path';
import { assert as rawAssert, assertEq as rawAssertEq } from './assert.js';

const LOG_FILE = path.resolve('tests/results.log');
const JSONL_FILE = path.resolve('tests/results.jsonl');

export function startRun(scenarioName, tier = 'action') {
  return {
    scenarioName,
    tier,
    startMs: Date.now(),
    timestamp: new Date().toISOString(),
    assertions: [],
    observations: {},
  };
}

export function recordAssertion(run, { name, passed, details }) {
  run.assertions.push({ name, passed: !!passed, details: details ?? null });
}

export function recordObservation(run, key, value) {
  run.observations[key] = value;
}

export function createRecorder(run) {
  return {
    assert(cond, name, details) {
      rawAssert(cond, name);
      recordAssertion(run, { name, passed: !!cond, details });
    },
    assertEq(actual, expected, name) {
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      rawAssertEq(actual, expected, name);
      recordAssertion(run, {
        name,
        passed: ok,
        details: ok ? null : `expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}`,
      });
    },
    record(key, value) {
      recordObservation(run, key, value);
    },
    run,
  };
}

function formatTimestamp(iso) {
  // "2026-04-14T15:42:10.123Z" → "2026-04-14 15:42:10"
  return iso.replace('T', ' ').slice(0, 19);
}

function stringify(v) {
  if (v == null) return String(v);
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

export async function finishRun(run, status = 'pass') {
  const durationMs = Date.now() - run.startMs;
  const total = run.assertions.length;
  const passed = run.assertions.filter((a) => a.passed).length;
  const failed = total - passed;
  const finalStatus = status === 'pass' && failed > 0 ? 'fail' : status;

  const lines = [
    `=== ${formatTimestamp(run.timestamp)} — ${run.scenarioName} (${run.tier}) ===`,
    `Status: ${finalStatus.toUpperCase()}   Duration: ${(durationMs / 1000).toFixed(1)}s`,
    `Assertions: ${passed}/${total} passed${failed > 0 ? `  [${failed} failed]` : ''}`,
  ];
  if (failed > 0) {
    lines.push('Failed:');
    for (const a of run.assertions) {
      if (!a.passed) lines.push(`  ✗ ${a.name}${a.details ? `  — ${a.details}` : ''}`);
    }
  }
  if (Object.keys(run.observations).length > 0) {
    lines.push('Observations:');
    for (const [k, v] of Object.entries(run.observations)) {
      lines.push(`  ${k}: ${stringify(v)}`);
    }
  }
  lines.push('---', '');

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true }).catch(() => {});
  await fs.appendFile(LOG_FILE, lines.join('\n'));

  const record = {
    timestamp: run.timestamp,
    scenario: run.scenarioName,
    tier: run.tier,
    status: finalStatus,
    durationMs,
    assertions: run.assertions,
    observations: run.observations,
  };
  await fs.appendFile(JSONL_FILE, JSON.stringify(record) + '\n');

  return { durationMs, passed, failed, total, status: finalStatus };
}
