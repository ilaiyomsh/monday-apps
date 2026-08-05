import { describe, it, expect } from 'vitest';
import logger, { encodeDims } from './logger';
import { remapKind } from './axiomLogger';
import { scrubMessage, shouldShip, mapRecordToEvent } from '@mapps/error-kit/browser';

// Locks the Axiom logging v2 primitives this app ships through @mapps/error-kit/browser
// (usage/health telemetry + privacy scrubbing + domain-kind wire schema), post error-kit
// migration. This app's logger keeps its OWN domainKind convention (see utils/logger.js
// track()/health()) rather than app-core's kind-is-the-domain convention the package
// expects, so production feeds records through this app's remapKind adapter
// (utils/axiomLogger.js) before they ever reach the package's mapRecordToEvent — the
// mapRecordToEvent tests below exercise that exact two-step pipeline, not the package
// function in isolation.

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
  const capture = (fn) => {
    const records = [];
    const unsub = logger.addSink((r) => records.push(r));
    fn();
    unsub();
    return records;
  };

  it('track() emits an INFO record with domainKind usage + alwaysShip + encoded message', () => {
    const recs = capture(() => logger.track('view_open', { view: 'x', a: 1 }));
    const rec = recs.find((r) => r.module === 'usage');
    expect(rec).toBeTruthy();
    expect(rec.level).toBe('INFO');
    expect(rec.domainKind).toBe('usage');
    expect(rec.alwaysShip).toBe(true);
    expect(rec.message).toBe('view_open a=1 view=x');
    expect(rec.kind).toBe('simple'); // rendering kind stays 'simple', not a domain value
  });

  it('health() emits an INFO record with domainKind health + alwaysShip', () => {
    const recs = capture(() => logger.health('boot', { ms: 42 }));
    const rec = recs.find((r) => r.module === 'health');
    expect(rec.domainKind).toBe('health');
    expect(rec.alwaysShip).toBe(true);
    expect(rec.message).toBe('boot ms=42');
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

describe('mapRecordToEvent (wire schema, through this app\'s remapKind adapter)', () => {
  it('sets ev.kind = domainKind ?? "error" and never the rendering kind', () => {
    expect(mapRecordToEvent(remapKind({ level: 'INFO', module: 'usage', message: 'view_open', kind: 'simple', domainKind: 'usage' })).kind).toBe('usage');
    expect(mapRecordToEvent(remapKind({ level: 'ERROR', module: 'x', message: 'boom', kind: 'error' })).kind).toBe('error');
  });
  it('ships error.message ONLY scrubbed as err_msg', () => {
    const ev = mapRecordToEvent(remapKind({ level: 'ERROR', module: 'x', message: 'boom', error: { name: 'Error', message: 'mail a@b.co failed' } }));
    expect(ev.err_msg).toBe('mail [email] failed');
    expect(ev.err_name).toBe('Error');
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
