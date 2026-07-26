// Locks the Axiom logging v2 primitives ported into the deadline-confirm SERVER
// (usage/health telemetry + privacy scrubbing + domain-kind wire schema).
// Mirrors apps/team-people-column/src/utils/telemetry-v2.test.js and the app-core
// suite. The legacy line writers (logAttempt/logError/logInfo) stay byte-locked by
// tests/core-output.test.js — this file covers ONLY the new v2 surface.

import { describe, it, expect, vi, afterEach } from 'vitest';
import logger, {
  encodeDims,
  track,
  health,
  emit,
  addSink,
  setBeforeSend,
  logAttempt,
} from '../src/helpers/logger.js';
import { scrubMessage, shouldShip, mapRecordToEvent } from '../src/helpers/axiomServerSink.js';

afterEach(() => {
  vi.restoreAllMocks();
  setBeforeSend(); // reset to identity
});

/** Capture every record fanned out to sinks while fn() runs (console muted). */
function capture(fn) {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const records = [];
  const unsub = addSink((r) => records.push(r));
  try {
    fn();
  } finally {
    unsub();
  }
  return records;
}

describe('encodeDims', () => {
  it('returns the base unchanged when there are no dims', () => {
    expect(encodeDims('view_open')).toBe('view_open');
  });
  it('folds dims into a sorted key=value suffix', () => {
    expect(encodeDims('e', { b: 2, a: 1 })).toBe('e a=1 b=2');
  });
  it('keeps only string/bool/finite-number values (drops objects/fns/NaN/Infinity)', () => {
    expect(encodeDims('e', { s: 'x', ok: true, n: 3, bad: {}, f: () => {}, nan: NaN, inf: Infinity }))
      .toBe('e n=3 ok=true s=x');
  });
});

describe('logger.track / logger.health', () => {
  it('track() emits an INFO record with domainKind usage + alwaysShip + encoded message', () => {
    const recs = capture(() => track('confirm', { outcome: 'ok', method: 'POST' }));
    const rec = recs.find((r) => r.tag === 'usage');
    expect(rec).toBeTruthy();
    expect(rec.level).toBe('INFO');
    expect(rec.domainKind).toBe('usage');
    expect(rec.alwaysShip).toBe(true);
    expect(rec.message).toBe('confirm method=POST outcome=ok');
  });

  it('health() emits an INFO record with domainKind health + alwaysShip', () => {
    const recs = capture(() => health('boot', { version: '0.4.0', port: 8080 }));
    const rec = recs.find((r) => r.tag === 'health');
    expect(rec.domainKind).toBe('health');
    expect(rec.alwaysShip).toBe(true);
    expect(rec.message).toBe('boot port=8080 version=0.4.0');
  });

  it('exposes the same primitives on the default export', () => {
    expect(typeof logger.track).toBe('function');
    expect(typeof logger.health).toBe('function');
    expect(typeof logger.addSink).toBe('function');
    expect(typeof logger.emit).toBe('function');
  });
});

describe('emit + beforeSend (attempt ip scrub)', () => {
  it('logAttempt feeds a sink record and beforeSend can strip the ip', () => {
    setBeforeSend((record) => {
      if (record.tag === 'attempt' && record.context && 'ip' in record.context) {
        record.context = { ...record.context, ip: undefined };
      }
      return record;
    });
    const recs = capture(() => logAttempt({ ip: '1.2.3.4', itemId: '42', outcome: 'ok' }));
    const rec = recs.find((r) => r.tag === 'attempt');
    expect(rec).toBeTruthy();
    expect(rec.context.ip).toBeUndefined();      // scrubbed
    expect(rec.context.itemId).toBe('42');       // kept
    expect(rec.context.outcome).toBe('ok');
  });

  it('a null beforeSend return suppresses the record entirely', () => {
    setBeforeSend(() => null);
    const recs = capture(() => emit({ level: 'ERROR', tag: 'x', message: 'boom' }));
    expect(recs).toHaveLength(0);
  });
});

describe('scrubMessage (privacy D2)', () => {
  it('redacts emails, long tokens, and digit runs; caps length; non-strings -> empty', () => {
    expect(scrubMessage('mail admin@corp.co bounced')).toBe('mail [email] bounced');
    expect(scrubMessage('token ABCDEF0123456789ghij')).toBe('token [redacted]');
    expect(scrubMessage('id 12345678 failed')).toBe('id [num] failed');
    expect(scrubMessage('reach me at a.b@sub.example.com now')).not.toContain('@');
    expect(scrubMessage('ab '.repeat(100)).length).toBe(200);
    expect(scrubMessage(null)).toBe('');
  });
});

describe('mapRecordToEvent (wire schema)', () => {
  it('sets ev.kind = domainKind ?? "error" and never the rendering kind', () => {
    expect(mapRecordToEvent({ level: 'INFO', tag: 'usage', message: 'confirm', domainKind: 'usage' }).kind)
      .toBe('usage');
    expect(mapRecordToEvent({ level: 'ERROR', tag: 'x', message: 'boom' }).kind).toBe('error');
  });
  it('ships error.message ONLY scrubbed as err_msg', () => {
    const ev = mapRecordToEvent({
      level: 'ERROR', tag: 'x', message: 'boom',
      error: { name: 'Error', message: 'mail a@b.co failed' },
    });
    expect(ev.err_msg).toBe('mail [email] failed');
    expect(ev.err_name).toBe('Error');
  });
  it('stamps ver/sess from cfg (Fable #6) and omits them when cfg lacks them', () => {
    const withCfg = mapRecordToEvent(
      { level: 'ERROR', tag: 'x', message: 'boom' },
      { app: 'deadline-confirm', env: 'production', ver: '0.4.0', sess: 'abc123' },
    );
    expect(withCfg.ver).toBe('0.4.0');
    expect(withCfg.sess).toBe('abc123');
    const noCfg = mapRecordToEvent({ level: 'ERROR', tag: 'x', message: 'boom' });
    expect('ver' in noCfg).toBe(false);
    expect('sess' in noCfg).toBe(false);
  });

  it('ships allow-listed context (itemId/outcome/op/ms/ok) but never ip', () => {
    const ev = mapRecordToEvent({
      level: 'INFO', tag: 'attempt', message: 'confirm_attempt',
      context: { ip: '1.2.3.4', itemId: '42', outcome: 'ok', op: 'GetItem', ms: 12, ok: true },
    });
    expect(ev.ip).toBeUndefined();
    expect(ev.itemId).toBe('42');
    expect(ev.outcome).toBe('ok');
    expect(ev.op).toBe('GetItem');
    expect(ev.ms).toBe(12);
    expect(ev.ok).toBe(true);
  });
});

describe('shouldShip (level policy + alwaysShip bypass)', () => {
  it('duplicate first, then alwaysShip, then WARN/ERROR-only default', () => {
    expect(shouldShip({ level: 'ERROR' })).toBe(true);
    expect(shouldShip({ level: 'WARN' })).toBe(true);
    expect(shouldShip({ level: 'INFO' })).toBe(false);
    expect(shouldShip({ level: 'INFO', alwaysShip: true })).toBe(true);
    expect(shouldShip({ level: 'ERROR', duplicate: true })).toBe(false);
    expect(shouldShip({ level: 'INFO', alwaysShip: true, duplicate: true })).toBe(false);
  });
});
