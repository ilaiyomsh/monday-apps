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
