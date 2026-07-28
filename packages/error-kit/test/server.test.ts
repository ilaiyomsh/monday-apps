/**
 * server.test.ts — the reference server sink (src/server/axiomServerSink.ts): opts-injected
 * config (zero process.env reads), the WARN/ERROR ship policy, scrubbed err_msg, the CTX_ALLOW
 * filter, and the inert gate. Node env, injected logger seam — no network.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  scrubMessage,
  shouldShip,
  mapRecordToEvent,
  attachAxiomServerSink,
  type ServerLogRecord,
} from '../src/server/axiomServerSink';

const RANK = { ERROR: 3, WARN: 2, INFO: 1, DEBUG: 0 };

describe('scrubMessage (server)', () => {
  it('redacts emails, long token/hex runs (>=16), and digit-runs (>=7)', () => {
    expect(scrubMessage('contact admin@corp.com now')).toBe('contact [email] now');
    expect(scrubMessage('key abcdef0123456789XYZ done')).toBe('key [redacted] done');
    expect(scrubMessage('id 1234567 ok')).toBe('id [num] ok');
  });
  it('caps at 200 and returns "" for non-strings', () => {
    expect(scrubMessage('word '.repeat(100)).length).toBe(200);
    expect(scrubMessage(undefined)).toBe('');
    expect(scrubMessage(42)).toBe('');
  });
});

describe('shouldShip (server)', () => {
  it('ships ERROR/WARN by default, drops INFO/DEBUG', () => {
    expect(shouldShip({ level: 'ERROR' })).toBe(true);
    expect(shouldShip({ level: 'WARN' })).toBe(true);
    expect(shouldShip({ level: 'INFO' })).toBe(false);
    expect(shouldShip({ level: 'DEBUG' })).toBe(false);
  });
  it('drops duplicates and null; alwaysShip bypasses the level policy', () => {
    expect(shouldShip({ level: 'ERROR', duplicate: true })).toBe(false);
    expect(shouldShip(null as unknown as ServerLogRecord)).toBe(false);
    expect(shouldShip({ level: 'INFO', alwaysShip: true })).toBe(true);
  });
  it('honors a widened shipLevel (incident mode ships INFO)', () => {
    expect(shouldShip({ level: 'INFO' }, RANK.INFO)).toBe(true);
    expect(shouldShip({ level: 'DEBUG' }, RANK.INFO)).toBe(false);
  });
});

describe('mapRecordToEvent (server)', () => {
  it('maps level/tag/message + injected app/env/ver/sess', () => {
    const ev = mapRecordToEvent(
      { level: 'ERROR', tag: 'Sync', message: 'boom', timestampISO: '2026-07-19T00:00:00.000Z' },
      { app: 'deadline-confirm', env: 'production', ver: '1.2.3', sess: 'abc123' },
    );
    expect(ev).toMatchObject({
      level: 'error', tag: 'sync', message: 'boom', app: 'deadline-confirm',
      env: 'production', ver: '1.2.3', sess: 'abc123', _time: '2026-07-19T00:00:00.000Z', kind: 'error',
    });
  });
  it('omits ver/sess when the cfg does not carry them (pure default)', () => {
    const ev = mapRecordToEvent({ level: 'WARN', message: 'x' });
    expect('ver' in ev).toBe(false);
    expect('sess' in ev).toBe(false);
    expect(ev.app).toBeNull();
  });
  it('ships error.message ONLY scrubbed as err_msg and extracts name/code/stack1', () => {
    const err = Object.assign(new Error('user admin@corp.com id 12345678 failed'), { errorCode: 'ComplexityException' });
    err.stack = 'Error: ...\n    at run (svc.js:10:5)';
    const ev = mapRecordToEvent({ level: 'ERROR', message: 'op_failed', error: err });
    expect(ev.err_name).toBe('Error');
    expect(ev.err_code).toBe('ComplexityException');
    expect(ev.stack1).toBe('at run (svc.js:10:5)');
    expect(ev.err_msg).toContain('[email]');
    expect(ev.err_msg).toContain('[num]');
    expect(JSON.stringify(ev)).not.toContain('admin@corp.com');
  });
  it('CTX_ALLOW gate: allow-listed context ships, everything else stays local', () => {
    const ev = mapRecordToEvent({
      level: 'ERROR', message: 'm',
      context: { ms: 42, ok: true, board: 'b1', title: 'secret title', email: 'a@b.co', nested: { x: 1 } },
    });
    expect(ev.ms).toBe(42);
    expect(ev.ok).toBe(true);
    expect(ev.board).toBe('b1');
    for (const k of ['title', 'email', 'nested']) expect(k in ev).toBe(false);
  });
});

describe('attachAxiomServerSink — opts gate', () => {
  it('is inert (no-op) when token/dataset/app are not all present', () => {
    const added: Array<(r: ServerLogRecord) => void> = [];
    const logger = { addSink: (fn: (r: ServerLogRecord) => void) => { added.push(fn); return () => {}; } };
    const off = attachAxiomServerSink(logger, { dataset: 'app-errors', app: 'x' }); // no token
    expect(added).toHaveLength(0);
    expect(typeof off).toBe('function');
    off();
  });
  it('subscribes a sink when token+dataset+app are all present', () => {
    const added: Array<(r: ServerLogRecord) => void> = [];
    const logger = { addSink: vi.fn((fn: (r: ServerLogRecord) => void) => { added.push(fn); return () => {}; }) };
    const off = attachAxiomServerSink(logger, { token: 't', dataset: 'app-errors', app: 'x' });
    expect(logger.addSink).toHaveBeenCalledTimes(1);
    expect(added).toHaveLength(1);
    off();
  });
});
