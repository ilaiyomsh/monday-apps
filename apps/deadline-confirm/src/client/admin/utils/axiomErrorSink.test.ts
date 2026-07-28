// test-guard gate for the sink-side of the error-kit port: mapRecordToEvent now
// ships the extended `stack` (top-5 scrubbed frames, in addition to stack1) and
// a scrubbed `component_stack` from record.context.componentStack — parity with
// packages/error-kit/src/browser/axiomSink.ts (fix 3).

import { describe, it, expect } from 'vitest';
import { mapRecordToEvent } from './axiomErrorSink';
import type { LogRecord } from './logger';

function rec(over: Partial<LogRecord>): LogRecord {
  return { kind: 'error', level: 'ERROR', module: 'x', message: 'm', consoleEnabled: false, ...over };
}

const V8_STACK =
  'Error: boom\n  at a (f.js:1:1)\n  at b (f.js:2:2)\n  at c (f.js:3:3)\n  at d (f.js:4:4)\n  at e (f.js:5:5)\n  at f (f.js:6:6)';

describe('mapRecordToEvent — extended stack (fix 3)', () => {
  it('keeps stack1 as the single first frame AND adds `stack` with the top-5 frames joined by newline', () => {
    const err = Object.assign(new Error('boom'), { stack: V8_STACK });
    const ev = mapRecordToEvent(rec({ error: err }));

    expect(ev.stack1).toBe('at a (f.js:1:1)');
    const frames = String(ev.stack).split('\n');
    expect(frames).toHaveLength(5); // capped at top-5, the 6th frame dropped
    expect(frames[0]).toBe('at a (f.js:1:1)');
    expect(frames[4]).toBe('at e (f.js:5:5)');
  });

  it('omits `stack` entirely when the error has no stack frames', () => {
    const err = Object.assign(new Error('boom'), { stack: 'Error: boom (no frames)' });
    const ev = mapRecordToEvent(rec({ error: err }));
    expect('stack' in ev).toBe(false);
  });
});

describe('mapRecordToEvent — component_stack (fix 3)', () => {
  it('ships a scrubbed component_stack from record.context.componentStack', () => {
    const ev = mapRecordToEvent(rec({ context: { componentStack: 'in <Comp>\n in <App>' } }));
    expect(ev.component_stack).toBe('in <Comp>\n in <App>');
  });

  it('scrubs PII out of the component_stack (emails redacted)', () => {
    const ev = mapRecordToEvent(rec({ context: { componentStack: 'rendered for user a.b@corp.co in <Comp>' } }));
    expect(String(ev.component_stack)).not.toContain('@');
    expect(String(ev.component_stack)).toContain('[email]');
  });

  it('omits component_stack when the record carries none (ordinary error record)', () => {
    const ev = mapRecordToEvent(rec({ error: new Error('boom') }));
    expect('component_stack' in ev).toBe(false);
  });
});

// Audit finding 6: err_name was assigned without String(), so a NON-STRING name failed the
// generic-name fallback's `typeof ev.err_name === 'string'` guard and the stable logger
// message overwrote the real discriminator. The transport's dedup key reads err_name the
// same guarded way, so distinct errors collapsed under one key and after dedupMaxPerWindow
// (5) in 60s the rest were silently dropped. drift.test.ts could not see it because its
// check asserted String(mapped.err_name) — coercing in the test hid the missing coercion.
describe('mapRecordToEvent — err_name is the discriminator and must survive', () => {
  it('coerces a non-string err.name instead of losing it to the generic message', () => {
    const mapped = mapRecordToEvent(
      rec({ message: 'op_failed', error: { name: 500, message: 'upstream exploded' } as unknown as Error })
    );
    expect(typeof mapped.err_name).toBe('string');
    expect(mapped.err_name).toBe('500');
    expect(mapped.err_name).not.toBe('op_failed');
  });

  it('keeps two distinct non-string names distinct (one dedup key per error)', () => {
    const a = mapRecordToEvent(rec({ message: 'op_failed', error: { name: 500, message: 'a' } as unknown as Error }));
    const b = mapRecordToEvent(rec({ message: 'op_failed', error: { name: 503, message: 'b' } as unknown as Error }));
    expect(a.err_name).not.toBe(b.err_name);
  });

  it('still keeps a real Error name untouched', () => {
    expect(mapRecordToEvent(rec({ error: new TypeError('x') })).err_name).toBe('TypeError');
  });

  // The fallback CHAIN, in order — the telemetry dashboard groups and drills down by
  // err_name, so nothing may ship nameless. The stable message event-id comes first
  // because it is the most specific thing left once there is no Error object.
  it('falls back message → tag → unknown when there is no Error at all', () => {
    expect(mapRecordToEvent(rec({ module: 'globalerrorhandler', message: 'Uncaught error' })).err_name)
      .toBe('Uncaught error');
    // empty message → the module tag names it
    expect(mapRecordToEvent(rec({ module: 'boot', message: '' })).err_name).toBe('boot');
    // blank tag AND blank message → 'unknown', never a whitespace-only name
    expect(mapRecordToEvent(rec({ module: '   ', message: '  ' })).err_name).toBe('unknown');
  });
});
