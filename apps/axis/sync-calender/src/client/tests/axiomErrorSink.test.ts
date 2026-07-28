import { describe, it, expect } from 'vitest';
import { shouldShip, mapRecordToEvent, scrubMessage } from '../admin/utils/axiomErrorSink';
import type { LogRecord } from '../admin/lib/logger';

function rec(over: Partial<LogRecord> = {}): LogRecord {
  return { level: 'ERROR', module: 'admin', message: 'ev', timestamp: 0, domainKind: 'error', ...over };
}

describe('shouldShip', () => {
  it('ships ERROR and WARN by default', () => {
    expect(shouldShip(rec({ level: 'ERROR' }))).toBe(true);
    expect(shouldShip(rec({ level: 'WARN' }))).toBe(true);
  });

  it('drops INFO/DEBUG by default', () => {
    expect(shouldShip(rec({ level: 'INFO' }))).toBe(false);
    expect(shouldShip(rec({ level: 'DEBUG' }))).toBe(false);
  });

  it('ships INFO records flagged alwaysShip (usage/health)', () => {
    expect(shouldShip(rec({ level: 'INFO', alwaysShip: true, domainKind: 'usage' }))).toBe(true);
  });

  it('never ships a record marked duplicate, even ERROR', () => {
    expect(shouldShip(rec({ level: 'ERROR', duplicate: true }))).toBe(false);
  });

  it('incident remoteLevel DEBUG lets an INFO record through', () => {
    expect(shouldShip(rec({ level: 'INFO' }), 'DEBUG')).toBe(true);
  });
});

describe('mapRecordToEvent', () => {
  it('maps level/tag lowercased, message as-is, and kind from domainKind', () => {
    const ev = mapRecordToEvent(rec({ level: 'ERROR', module: 'Admin', message: 'render_error', domainKind: 'error' }));
    expect(ev.level).toBe('error');
    expect(ev.tag).toBe('admin');
    expect(ev.message).toBe('render_error');
    expect(ev.kind).toBe('error');
  });

  it('derives kind from record.domainKind (usage), not a hardcoded default', () => {
    const ev = mapRecordToEvent(rec({ level: 'INFO', domainKind: 'usage', alwaysShip: true }));
    expect(ev.kind).toBe('usage');
  });

  it('ships err_name + scrubbed err_msg from a carried Error', () => {
    const ev = mapRecordToEvent(rec({ error: new Error('boom happened') }));
    expect(ev.err_name).toBe('Error');
    expect(ev.err_msg).toBe('boom happened');
  });

  it('ships a React componentStack from context as component_stack', () => {
    const ev = mapRecordToEvent(rec({ context: { componentStack: '\n    in App\n    in Root' } }));
    expect(typeof ev.component_stack).toBe('string');
    expect(String(ev.component_stack)).toContain('in App');
  });

  it('omits component_stack when the record carries no componentStack', () => {
    const ev = mapRecordToEvent(rec());
    expect('component_stack' in ev).toBe(false);
  });
});

describe('scrubMessage', () => {
  it('redacts an email address', () => {
    expect(scrubMessage('failed for user alice@example.com now')).toBe('failed for user [email] now');
  });

  it('returns empty string for a non-string input', () => {
    expect(scrubMessage(undefined)).toBe('');
  });
});
