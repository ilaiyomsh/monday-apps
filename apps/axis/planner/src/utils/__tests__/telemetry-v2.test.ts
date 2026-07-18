import { describe, it, expect, vi } from 'vitest';
import logger, { encodeDims } from '../Logger';
import { scrubMessage, shouldShip, mapRecordToEvent } from '../axiomErrorSink';
import { createAxiomBrowserTransport } from '../axiomBrowserTransport';

// Locks the Axiom logging v2 primitives ported into planner (usage/health telemetry + privacy
// scrubbing + domain-kind wire schema + transport allowlist). Mirrors the app-core/tracker/
// template/tpc suites — the wire schema is load-bearing (identical across every app).

describe('encodeDims', () => {
  it('returns the base unchanged when there are no dims', () => {
    expect(encodeDims('view_open')).toBe('view_open');
  });
  it('folds dims into a sorted key=value suffix', () => {
    expect(encodeDims('e', { b: 2, a: 1 })).toBe('e a=1 b=2');
  });
  it('keeps only string/bool/finite-number values (drops objects/fns/NaN/Infinity)', () => {
    expect(
      encodeDims('e', { s: 'x', ok: true, n: 3, bad: {}, f: () => {}, nan: NaN, inf: Infinity })
    ).toBe('e n=3 ok=true s=x');
  });
});

describe('logger.track / logger.health', () => {
  const capture = (fn: () => void) => {
    const records: Array<Record<string, unknown>> = [];
    const unsub = logger.addSink((r) => records.push(r as unknown as Record<string, unknown>));
    fn();
    unsub();
    return records;
  };

  it('track() emits an INFO record with domainKind usage + alwaysShip + encoded message', () => {
    const recs = capture(() => logger.track('view_open', { view: 'x', a: 1 }));
    const rec = recs.find((r) => r.module === 'usage');
    expect(rec).toBeTruthy();
    expect(rec!.level).toBe('INFO');
    expect(rec!.domainKind).toBe('usage');
    expect(rec!.alwaysShip).toBe(true);
    expect(rec!.message).toBe('view_open a=1 view=x');
    expect(rec!.kind).toBe('simple'); // rendering kind stays 'simple', not a domain value
  });

  it('health() emits an INFO record with domainKind health + alwaysShip', () => {
    const recs = capture(() => logger.health('boot', { ms: 42 }));
    const rec = recs.find((r) => r.module === 'health');
    expect(rec!.domainKind).toBe('health');
    expect(rec!.alwaysShip).toBe(true);
    expect(rec!.message).toBe('boot ms=42');
  });

  it('error() emits an ERROR record carrying the Error instance (ships as domain error)', () => {
    const boom = new Error('kaboom');
    const recs = capture(() => logger.error('[apiQueue] failed', boom));
    const rec = recs.find((r) => r.level === 'ERROR');
    expect(rec).toBeTruthy();
    expect(rec!.error).toBe(boom);
    expect(rec!.module).toBe('apiQueue'); // parsed from the leading [tag]
    expect(rec!.domainKind).toBeUndefined(); // sink defaults ev.kind to 'error'
  });

  it('scrubs an Error-DERIVED record.message so a raw error.message can never reach ev.message (D2)', () => {
    // No current call site passes an Error as the FIRST arg, but nothing enforces it. When one
    // does, record.message is derived from error.message and MUST be scrubbed (same spec as the
    // sink's err_msg) before it lands in ev.message via mapRecordToEvent.
    const boom = new Error('leak admin@corp.co token ABCDEF0123456789ghij id 12345678');
    const recs = capture(() => logger.error(boom));
    const rec = recs.find((r) => r.level === 'ERROR');
    expect(rec).toBeTruthy();
    expect(rec!.error).toBe(boom); // the Error instance still travels for err_name/err_code/stack
    expect(rec!.message).toBe('leak [email] token [redacted] id [num]');
    // end-to-end: the scrubbed message survives into the wire envelope with no raw PII
    const ev = mapRecordToEvent(rec as unknown as Parameters<typeof mapRecordToEvent>[0]);
    expect(ev.message).toBe('leak [email] token [redacted] id [num]');
    expect(String(ev.message)).not.toContain('@');
    expect(String(ev.message)).not.toContain('12345678');
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
    expect(
      mapRecordToEvent({
        level: 'INFO',
        module: 'usage',
        message: 'view_open',
        kind: 'simple',
        domainKind: 'usage',
      }).kind
    ).toBe('usage');
    expect(mapRecordToEvent({ level: 'ERROR', module: 'x', message: 'boom', kind: 'error' }).kind).toBe(
      'error'
    );
  });
  it('ships error.message ONLY scrubbed as err_msg', () => {
    const ev = mapRecordToEvent({
      level: 'ERROR',
      module: 'x',
      message: 'boom',
      error: { name: 'Error', message: 'mail a@b.co failed' },
    });
    expect(ev.err_msg).toBe('mail [email] failed');
    expect(ev.err_name).toBe('Error');
  });
  it('maps err_code from errorCode/status/code and numeric timings from context', () => {
    const ev = mapRecordToEvent({
      level: 'ERROR',
      module: 'api',
      message: 'boom',
      error: { name: 'MondayApiError', status: 429 },
      context: { duration: 1234, step: 5 },
    });
    expect(ev.err_code).toBe('429');
    expect(ev.ms).toBe(1234);
    expect(ev.step).toBe(5);
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

describe('transport sanitizer + allowlist (wire safety)', () => {
  // A fully-injected transport (fetch/win/doc seams) so it's live in jsdom without real network.
  const makeTransport = () => {
    const bodies: string[] = [];
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return { ok: true, status: 200 };
    });
    const listeners: Record<string, () => void> = {};
    const win = {
      addEventListener: (e: string, h: () => void) => {
        listeners[e] = h;
      },
      removeEventListener: () => {},
    } as unknown as Window;
    const doc = {
      addEventListener: () => {},
      removeEventListener: () => {},
      visibilityState: 'visible',
    } as unknown as Document;
    const t = createAxiomBrowserTransport({
      dataset: 'ds',
      token: 'tok',
      app: 'planner-test',
      fetchFn,
      win,
      doc,
    });
    return { t, bodies, fetchFn };
  };

  it('drops non-allowlisted / denied keys, caps err_msg at 200, keeps numeric extras', async () => {
    const { t, bodies } = makeTransport();
    t.enqueue({
      level: 'error',
      tag: 'x',
      message: 'boom',
      kind: 'error',
      err_msg: 'z'.repeat(500),
      ms: 1200,
      secretToken: 'leak-me', // denied by substring rule (token)
      title: 'nope', // denied
      payload: { a: 1 }, // object dropped
    });
    t.flush('manual');
    await Promise.resolve();
    await Promise.resolve();
    expect(bodies.length).toBe(1);
    const [ev] = JSON.parse(bodies[0]);
    expect(ev.message).toBe('boom');
    expect(ev.kind).toBe('error');
    expect(ev.err_msg.length).toBe(200);
    expect(ev.ms).toBe(1200);
    expect(ev.secretToken).toBeUndefined();
    expect(ev.title).toBeUndefined();
    expect(ev.payload).toBeUndefined();
    expect(ev.app).toBe('planner-test'); // transport-owned stamp
    t.dispose();
  });

  it('inert transport (missing dataset/token) never ships and reports enabled:false', () => {
    const t = createAxiomBrowserTransport({ dataset: '', token: '', app: 'inert' });
    t.enqueue({ level: 'error', message: 'x' });
    expect(t.stats().enabled).toBe(false);
  });
});
