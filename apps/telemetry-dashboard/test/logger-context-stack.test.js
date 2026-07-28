// test-guard gate for M5: the CLIENT logger.error must forward a 4th `context` argument
// onto the emitted record so the ErrorBoundary's { componentStack } rides
// record.context.componentStack — the ONLY path the vendored sink reads it from
// (axiomErrorSink component_stack, fix 3). The previous boundary shipped it as a DEBUG
// record that shouldShip drops, so the component tree was lost from every render crash.
//
// Lives under test/ (the app's vitest include) but exercises the client TS modules by
// relative import — both are pure w.r.t. the DOM (window usage is typeof-guarded).

import { describe, it, expect } from 'vitest';
import logger from '../src/client/utils/logger';
import { mapRecordToEvent } from '../src/client/utils/axiomErrorSink';

function capture(fn) {
  const records = [];
  const unsub = logger.addSink((r) => records.push(r));
  try {
    fn();
  } finally {
    unsub();
  }
  return records;
}

describe('client logger.error — context forwarding (M5)', () => {
  it('carries a { componentStack } context onto the emitted ERROR record', () => {
    const err = new Error('render blew up');
    const recs = capture(() =>
      logger.error('dashboard', 'render_error', err, { componentStack: '\n    in Broken\n    in App' })
    );
    const rec = recs.find((r) => r.level === 'ERROR');
    expect(rec).toBeTruthy();
    expect(rec.error).toBe(err);
    expect(rec.context?.componentStack).toBe('\n    in Broken\n    in App');
  });

  it('end-to-end: the forwarded componentStack ships as ev.component_stack', () => {
    const recs = capture(() =>
      logger.error('dashboard', 'render_error', new Error('x'), { componentStack: 'in <Comp>\n in <App>' })
    );
    const rec = recs.find((r) => r.level === 'ERROR');
    const ev = mapRecordToEvent(rec);
    expect(ev.component_stack).toBe('in <Comp>\n in <App>');
  });

  it('a plain error with no context still emits (no componentStack key)', () => {
    const recs = capture(() => logger.error('dashboard', 'render_error', new Error('y')));
    const rec = recs.find((r) => r.level === 'ERROR');
    expect(rec.context?.componentStack).toBeUndefined();
  });
});
