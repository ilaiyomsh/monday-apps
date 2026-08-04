// test-guard gate for src/helpers/axiomServerSink.js — the vendored server sink
// (privacy scrub + ship policy + record→event mapping + attach gating). The
// cross-app contract is ALSO enforced by packages/error-kit/test/drift.test.ts;
// this suite pins the same behavior locally.

import { describe, it, expect, vi } from 'vitest';
import {
  scrubMessage,
  shouldShip,
  mapRecordToEvent,
  attachAxiomServerSink,
} from '../src/helpers/axiomServerSink.js';

describe('scrubMessage (privacy D2)', () => {
  it('redacts emails, long token/hex runs (>=16), and digit-runs (>=7), capped 200', () => {
    expect(scrubMessage('contact admin@corp.com now')).toBe('contact [email] now');
    expect(scrubMessage('key abcdef0123456789XYZ done')).toBe('key [redacted] done');
    expect(scrubMessage('id 1234567 ok')).toBe('id [num] ok');
    expect(scrubMessage('word '.repeat(100)).length).toBe(200);
    expect(scrubMessage(undefined)).toBe('');
  });
});

describe('shouldShip (level policy + alwaysShip bypass)', () => {
  it('WARN/ERROR only by default; duplicate drops; alwaysShip bypasses the level gate', () => {
    expect(shouldShip({ level: 'ERROR' })).toBe(true);
    expect(shouldShip({ level: 'WARN' })).toBe(true);
    expect(shouldShip({ level: 'INFO' })).toBe(false);
    expect(shouldShip({ level: 'DEBUG' })).toBe(false);
    expect(shouldShip({ level: 'ERROR', duplicate: true })).toBe(false);
    expect(shouldShip(null)).toBe(false);
    expect(shouldShip({ level: 'INFO', alwaysShip: true })).toBe(true);
  });
});

describe('mapRecordToEvent (wire schema)', () => {
  it('kind defaults to error; domainKind wins; err.message ships ONLY scrubbed', () => {
    expect(mapRecordToEvent({ level: 'ERROR', message: 'boom' }).kind).toBe('error');
    expect(mapRecordToEvent({ level: 'INFO', message: 'x', domainKind: 'usage' }).kind).toBe('usage');

    const err = Object.assign(new Error('user admin@corp.com id 12345678 failed'), { code: 'ComplexityException' });
    err.stack = 'Error: ...\n    at run (svc.js:10:5)';
    const mapped = mapRecordToEvent({ level: 'ERROR', message: 'op_failed', error: err });
    expect(mapped.err_name).toBe('Error');
    expect(mapped.err_code).toBe('ComplexityException');
    expect(mapped.stack1).toBe('at run (svc.js:10:5)');
    expect(mapped.err_msg).toContain('[email]');
    expect(mapped.err_msg).toContain('[num]');
    expect(JSON.stringify(mapped)).not.toContain('admin@corp.com');
  });

  it('ships allow-listed short context (board/ms) but drops free-form (title/nested) and tokens', () => {
    const mapped = mapRecordToEvent({
      level: 'ERROR', message: 'm',
      context: { ms: 42, board: 'b1', title: 'secret title', token: 'sekret-value', nested: { x: 1 } },
    });
    expect(mapped.ms).toBe(42);
    expect(mapped.board).toBe('b1');
    for (const k of ['title', 'token', 'nested']) expect(k in mapped).toBe(false);
  });

  it('stamps ver/sess from cfg and omits them when cfg lacks them', () => {
    const withCfg = mapRecordToEvent({ level: 'ERROR', message: 'b' }, { app: 'twyst-guard', ver: '1.0.0', sess: 'abc' });
    expect(withCfg.ver).toBe('1.0.0');
    expect(withCfg.sess).toBe('abc');
    const noCfg = mapRecordToEvent({ level: 'ERROR', message: 'b' });
    expect('ver' in noCfg).toBe(false);
    expect('sess' in noCfg).toBe(false);
  });
});

describe('attachAxiomServerSink (activation gate)', () => {
  it('is INERT (no sink registered) when the token/dataset/app are not all present', () => {
    const addSink = vi.fn();
    const unsub = attachAxiomServerSink({ addSink }, { dataset: 'd', app: 'a' }); // token missing
    expect(addSink).not.toHaveBeenCalled();
    expect(typeof unsub).toBe('function');
  });

  it('registers a sink when token+dataset+app are all present', () => {
    const addSink = vi.fn(() => () => {});
    attachAxiomServerSink({ addSink }, { token: 't', dataset: 'd', app: 'a' });
    expect(addSink).toHaveBeenCalledTimes(1);
  });
});
