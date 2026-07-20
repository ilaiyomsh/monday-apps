/**
 * fix-sink.test.ts — TDD gate for fix 3's sink half: mapRecordToEvent must ship a scrubbed
 * multi-frame `stack` (top 5) IN ADDITION to the existing `stack1`, and a scrubbed
 * `component_stack` when the record context carries one. RED against the app-core baseline
 * (which shipped only stack1 and never read componentStack). See RED-GATE-LOG.md.
 */
import { describe, it, expect } from 'vitest';
import { mapRecordToEvent } from '../src/browser/axiomSink';
import type { LogRecord } from '../src/types';

function rec(over: Partial<LogRecord> = {}): LogRecord {
  return {
    level: 'ERROR',
    module: 'app',
    message: 'event_id',
    timestamp: 0,
    timestampISO: '2026-07-19T00:00:00.000Z',
    ...over,
  };
}

const sixFrameStack = [
  'Error: boom',
  '    at a (f.js:1:1)',
  '    at b (f.js:2:2)',
  '    at c (f.js:3:3)',
  '    at d (f.js:4:4)',
  '    at e (f.js:5:5)',
  '    at f (f.js:6:6)',
].join('\n');

describe('fix3 (sink): extended stack', () => {
  it('F3s-a: ships `stack` = top 5 frames joined by newline, alongside the compat `stack1`', () => {
    const err = Object.assign(new Error('boom'), { stack: sixFrameStack });
    const ev = mapRecordToEvent(rec({ error: err }));
    expect(ev.stack1).toBe('at a (f.js:1:1)'); // compat: first frame, unchanged
    const frames = (ev.stack as string).split('\n');
    expect(frames).toHaveLength(5); // top 5 only, the 6th dropped
    expect(frames[0]).toBe('at a (f.js:1:1)');
    expect(frames[4]).toBe('at e (f.js:5:5)');
  });

  it('F3s-b: each frame is scrubbed (a token in a frame URL is redacted)', () => {
    const err = Object.assign(new Error('x'), {
      stack: 'Error: x\n    at h (https://app/main.js?t=abcdef0123456789ABCD:1:1)',
    });
    const ev = mapRecordToEvent(rec({ error: err }));
    expect(ev.stack as string).toContain('[redacted]');
    expect(ev.stack as string).not.toContain('abcdef0123456789ABCD');
  });

  it('F3s-c: a frame-less @-message never leaks into stack (privacy preserved)', () => {
    const err = Object.assign(new Error('contact admin@corp.com'), {
      stack: 'Error: contact admin@corp.com',
    });
    const ev = mapRecordToEvent(rec({ error: err }));
    expect('stack' in ev).toBe(false); // no frame lines → no stack key
    expect(JSON.stringify(ev)).not.toContain('admin@corp.com');
  });
});

describe('fix3 (sink): component_stack from context', () => {
  it('F3s-d: ships component_stack when the record context carries componentStack', () => {
    const ev = mapRecordToEvent(
      rec({ error: new Error('x'), context: { componentStack: '\n    in App\n    in Provider' } }),
    );
    expect(ev.component_stack as string).toContain('in App');
    expect(ev.component_stack as string).toContain('in Provider');
  });

  it('F3s-e: no component_stack key when the context lacks componentStack', () => {
    const ev = mapRecordToEvent(rec({ error: new Error('x') }));
    expect('component_stack' in ev).toBe(false);
  });

  it('F3s-f: component_stack is scrubbed (email/digits redacted) and capped at 1000', () => {
    const cs = 'in Row prop=admin@corp.com id=12345678\n'.repeat(60); // ~2340 chars
    const ev = mapRecordToEvent(rec({ error: new Error('x'), context: { componentStack: cs } }));
    expect(ev.component_stack as string).not.toContain('admin@corp.com');
    expect(ev.component_stack as string).not.toContain('12345678');
    expect((ev.component_stack as string).length).toBeLessThanOrEqual(1000);
    expect((ev.component_stack as string).length).toBeGreaterThan(200); // NOT clipped to the 200 err_msg cap
  });
});
