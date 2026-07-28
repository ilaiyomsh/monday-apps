// test-guard gate for src/client/utils/axiomErrorSink.ts — the vendored record→envelope +
// privacy layer for the dashboard client. Plain JS (not TS) because this app's vitest config
// collects test/**/*.test.js only; vitest still transforms the imported .ts module.
//
// Until now this copy had NO local suite — only packages/error-kit/test/drift.test.ts covered
// it, from another package. That is what let audit finding 6 sit here: err_name was assigned
// without String(), and drift's own check asserted String(mapped.err_name), so coercing in
// the test hid the missing coercion in the source.

import { describe, it, expect } from 'vitest';
import { shouldShip, scrubMessage, mapRecordToEvent } from '../src/client/utils/axiomErrorSink.ts';

const record = (over = {}) => ({ level: 'ERROR', module: 'svc', message: 'op_failed', ...over });

describe('mapRecordToEvent — err_name is the discriminator and must survive', () => {
  it('keeps a real Error name', () => {
    expect(mapRecordToEvent(record({ error: new TypeError('x') })).err_name).toBe('TypeError');
  });

  // Audit finding 6. The generic-name fallback below the assignment guards with
  // `typeof ev.err_name === 'string'`, so a NON-STRING name fails that check and the stable
  // logger message overwrites the real discriminator. The transport's dedup key reads
  // err_name the same guarded way, so distinct errors collapse under one key and after
  // dedupMaxPerWindow (5) in 60s the rest are silently dropped.
  it('coerces a non-string err.name instead of losing it to the generic message', () => {
    const mapped = mapRecordToEvent(record({ error: { name: 500, message: 'upstream exploded' } }));
    expect(typeof mapped.err_name).toBe('string');
    expect(mapped.err_name).toBe('500');
    expect(mapped.err_name).not.toBe('op_failed');
  });

  it('keeps two distinct non-string names distinct (one dedup key per error)', () => {
    const a = mapRecordToEvent(record({ error: { name: 500, message: 'a' } }));
    const b = mapRecordToEvent(record({ error: { name: 503, message: 'b' } }));
    expect(a.err_name).not.toBe(b.err_name);
  });

  it('falls back message → tag → unknown when there is no Error at all', () => {
    expect(mapRecordToEvent(record({ message: 'Uncaught error' })).err_name).toBe('Uncaught error');
    expect(mapRecordToEvent(record({ module: 'boot', message: '' })).err_name).toBe('boot');
    expect(mapRecordToEvent(record({ module: '   ', message: '  ' })).err_name).toBe('unknown');
  });
});

describe('mapRecordToEvent — privacy: the raw error.message never ships', () => {
  it('ships err_msg SCRUBBED, with no raw PII anywhere in the envelope', () => {
    const err = new Error('user admin@corp.com id 12345678 failed');
    const mapped = mapRecordToEvent(record({ error: err }));
    expect(mapped.err_msg).toContain('[email]');
    expect(mapped.err_msg).toContain('[num]');
    const serialized = JSON.stringify(mapped);
    expect(serialized).not.toContain('admin@corp.com');
    expect(serialized).not.toContain('12345678');
  });

  it('never copies record.data', () => {
    const mapped = mapRecordToEvent(record({ data: { secretish: 'do-not-ship-me' } }));
    expect(JSON.stringify(mapped)).not.toContain('do-not-ship-me');
  });

  it('ships the stable message event-id as-is', () => {
    expect(mapRecordToEvent(record()).message).toBe('op_failed');
  });
});

describe('scrubMessage — redaction spec (emails / tokens>=16 / digit-runs>=7), cap 200', () => {
  it('redacts emails, long token runs and long digit runs', () => {
    expect(scrubMessage('ping a@b.co')).toContain('[email]');
    expect(scrubMessage('tok abcdef0123456789abcdef')).toContain('[redacted]');
    expect(scrubMessage('id 1234567')).toContain('[num]');
  });

  it('leaves a short digit run alone (boundary: 6 digits)', () => {
    expect(scrubMessage('id 123456')).toBe('id 123456');
  });

  it('caps at 200 characters', () => {
    // Short whitespace-separated tokens on purpose: one long unbroken run would be eaten by
    // the >=16-char token rule and collapse to '[redacted]' before the cap ever applied.
    expect(scrubMessage('ab '.repeat(200))).toHaveLength(200);
  });

  it('returns empty string for non-strings', () => {
    expect(scrubMessage(undefined)).toBe('');
    expect(scrubMessage(42)).toBe('');
  });
});

describe('shouldShip — WARN/ERROR policy, duplicate drop, alwaysShip bypass', () => {
  it('ships ERROR and WARN, drops INFO and DEBUG', () => {
    expect(shouldShip({ level: 'ERROR' })).toBe(true);
    expect(shouldShip({ level: 'WARN' })).toBe(true);
    expect(shouldShip({ level: 'INFO' })).toBe(false);
    expect(shouldShip({ level: 'DEBUG' })).toBe(false);
  });

  it('never ships a duplicate, even at ERROR (log-once)', () => {
    expect(shouldShip({ level: 'ERROR', duplicate: true })).toBe(false);
  });

  it('lets alwaysShip bypass the level policy', () => {
    expect(shouldShip({ level: 'INFO', alwaysShip: true })).toBe(true);
  });

  it('drops a nullish record rather than throwing', () => {
    expect(shouldShip(null)).toBe(false);
    expect(shouldShip(undefined)).toBe(false);
  });
});
