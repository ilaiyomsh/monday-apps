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

  it('holds every PURE client surface to the before-render ordering (no surface may opt out)', () => {
    const { out } = runAudit();
    // The ordering requirement is the whole point of the client checks: handlers + sink must
    // be installed before the first render can throw. A registry entry that quietly sets
    // beforeRender:false drops the " before render" suffix from its report line — so assert
    // the suffix per surface, not just that the surface is listed.
    //
    // axis-day-off is the ONE sanctioned exception: app-core's bootstrapApp installs the
    // handlers AND renders, so its handler check cannot be ordered against a render marker
    // (its attachAxiomSink check is still before-render, and is asserted below).
    const BEFORE_RENDER_BOTH = [
      'axis-tracker', 'axis-planner', 'discussions', 'team-people-column',
      'twyst-your-status', 'sync-calender-admin', 'deadline-confirm-admin',
      'telemetry-dashboard-client',
    ];
    const section = (name: string) => {
      const i = out.indexOf(`\n${name} `);
      expect(i, `surface ${name} missing from the report`).toBeGreaterThan(-1);
      return out.slice(i, out.indexOf('\n\n', i) === -1 ? undefined : out.indexOf('\n\n', i));
    };
    for (const name of BEFORE_RENDER_BOTH) {
      const body = section(name);
      const ordered = body.split('\n').filter((l) => l.includes('entry wires'));
      // planner declares both names in ONE requirement, the rest declare two — either way
      // EVERY entry-wiring check on a pure client must carry the ordering.
      expect(ordered.length, `${name}: expected at least one entry-wiring check`).toBeGreaterThan(0);
      for (const line of ordered) {
        expect(line, `${name}: wiring check is not ordered before render — ${line.trim()}`)
          .toContain('before render');
      }
    }
    // day-off: the sink check is still ordered; only the bootstrapApp handler check is exempt.
    expect(section('axis-day-off')).toContain('attachAxiomSink before render');
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
