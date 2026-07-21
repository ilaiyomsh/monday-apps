/**
 * audit-script.test.ts — gate for scripts/error-wiring-audit.mjs (the repo-level structural
 * error-wiring checker). Runs the script as a subprocess and asserts its verdict + report on
 * (a) the real tree (must PASS, exit 0) and (b) an empty fixture root via AUDIT_REPO_ROOT
 * (must FAIL, exit 1) — proving the checker can both pass a clean tree and detect a broken one.
 *
 * test-guard: closed via spotcheck mutations (retrofit path — see test/RED-GATE-LOG.md).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = resolve(REPO, 'scripts/error-wiring-audit.mjs');

function runAudit(env: Record<string, string> = {}) {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('error-wiring-audit.mjs', () => {
  it('PASSES on the real repo tree (exit 0) with zero violations', () => {
    const { status, out } = runAudit();
    expect(status).toBe(0);
    expect(out).toContain('PASS');
    expect(out).toContain('0 violation(s)');
  });

  it('reports every server sink as opts-injected and every surface present', () => {
    const { out } = runAudit();
    // a mutation that breaks the sink process.env check flips these to ✗ and fails exit 0.
    expect(out).toContain('sink opts-injected (no process.env)');
    expect(out).toContain('telemetry-dashboard-server');
    expect(out).toContain('no console.* inside catch blocks');
    // the deadline-confirm client env gap is surfaced as a known gap, not a violation.
    expect(out).toContain('known gap');
  });

  it('FAILS (exit 1) when pointed at a tree with none of the surfaces present', () => {
    const empty = mkdtempSync(resolve(tmpdir(), 'audit-fixture-'));
    const { status, out } = runAudit({ AUDIT_REPO_ROOT: empty });
    expect(status).toBe(1);
    expect(out).toContain('FAIL');
    // missing entries are reported per surface, never silently skipped.
    expect(out).toMatch(/entry file exists|entry wires/);
  });
});
