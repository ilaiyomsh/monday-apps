// Tests for the opts-injected Axiom server sink. The load-bearing property under
// test is the FIX: activation is driven by injected opts, NEVER by process.env
// (the production-inert bug this refactor closes).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so the mock factory (hoisted above imports) can reference these.
const { ingestSpy, flushSpy, AxiomCtor } = vi.hoisted(() => {
  const ingestSpy = vi.fn();
  const flushSpy = vi.fn(() => Promise.resolve());
  // Regular function (not an arrow) so `new Axiom()` in the source is constructable;
  // returning an object from a constructor replaces `this`.
  const AxiomCtor = vi.fn(function AxiomMock() { return { ingest: ingestSpy, flush: flushSpy }; });
  return { ingestSpy, flushSpy, AxiomCtor };
});

vi.mock('@axiomhq/js', () => ({ Axiom: AxiomCtor }));

const {
  scrubMessage,
  mapRecordToEvent,
  shouldShip,
  attachAxiomServerSink,
  flushAxiom,
} = await import('../src/services/axiomServerSink.js');

// A minimal logger stand-in: addSink captures the sink callback so tests can push
// records through it and observe what reaches client.ingest.
function fakeLogger() {
  const state = { sink: null };
  return {
    state,
    addSink(fn) { state.sink = fn; return () => { state.sink = null; }; },
    emit(record) { if (state.sink) state.sink(record); },
  };
}

beforeEach(() => {
  // mockClear resets call tracking but PRESERVES each spy's implementation
  // (clearAllMocks would drop AxiomCtor's factory, leaving new Axiom() → {}).
  ingestSpy.mockClear();
  flushSpy.mockClear();
  AxiomCtor.mockClear();
});

describe('scrubMessage', () => {
  it('redacts an email, keeping surrounding text', () => {
    expect(scrubMessage('failed for ilai@twyst.co.il now')).toBe('failed for [email] now');
  });

  it('redacts a long token/hex run of 16+ chars', () => {
    expect(scrubMessage('token abcdef0123456789 ok')).toBe('token [redacted] ok');
  });

  it('redacts a digit run of 7+ but leaves a 6-digit run intact', () => {
    expect(scrubMessage('id 1234567 kept 123456')).toBe('id [num] kept 123456');
  });

  it('caps the output at 200 chars', () => {
    // Spaces break token runs so the string survives scrubbing (a bare 500-char
    // run would collapse to the single token '[redacted]').
    const long = 'ab '.repeat(300); // 900 chars, no 16+ run, no 7+ digit run
    expect(scrubMessage(long).length).toBe(200);
  });

  it('returns empty string for non-strings', () => {
    expect(scrubMessage(null)).toBe('');
    expect(scrubMessage(42)).toBe('');
  });
});

describe('mapRecordToEvent', () => {
  it('stamps app/env/ver/sess from cfg and defaults kind to error', () => {
    const ev = mapRecordToEvent(
      { level: 'ERROR', tag: 'Sync', message: 'boom' },
      { app: 'sync-calender', env: 'production', ver: '2.2.0', sess: 'abc123' },
    );
    expect(ev.app).toBe('sync-calender');
    expect(ev.env).toBe('production');
    expect(ev.ver).toBe('2.2.0');
    expect(ev.sess).toBe('abc123');
    expect(ev.kind).toBe('error');
    expect(ev.level).toBe('error');
    expect(ev.tag).toBe('sync');
    expect(ev.message).toBe('boom');
  });

  it('omits ver/sess when cfg does not provide them', () => {
    const ev = mapRecordToEvent({ level: 'WARN', tag: 't', message: 'm' }, { app: 'a' });
    expect(ev).not.toHaveProperty('ver');
    expect(ev).not.toHaveProperty('sess');
    expect(ev.app).toBe('a');
    expect(ev.env).toBe('production');
  });

  it('carries domainKind through as kind', () => {
    const ev = mapRecordToEvent({ level: 'INFO', domainKind: 'health', message: 'boot' }, {});
    expect(ev.kind).toBe('health');
  });

  it('extracts scrubbed err_msg, err_name and err_code from an error', () => {
    const err = { name: 'ApiError', status: 429, message: 'rate limit for ilai@twyst.co.il' };
    const ev = mapRecordToEvent({ level: 'ERROR', message: 'm', error: err }, {});
    expect(ev.err_name).toBe('ApiError');
    expect(ev.err_code).toBe('429');
    expect(ev.err_msg).toBe('rate limit for [email]');
  });

  it('ships context.cause (scrubbed) as err_msg when no Error provided one', () => {
    const ev = mapRecordToEvent(
      { level: 'ERROR', message: 'm', context: { cause: 'token abcdef0123456789 dead' } },
      {},
    );
    expect(ev.err_msg).toBe('token [redacted] dead');
  });

  it('keeps allow-listed context fields (string/number/boolean) and drops everything else', () => {
    const ev = mapRecordToEvent(
      // 'step' is allow-listed; a boolean value exercises the boolean branch.
      { level: 'ERROR', message: 'm', context: { cfg: 'c18e4d79', created: 3, step: true, email: 'x@y.co', title: 'secret' } },
      {},
    );
    expect(ev.cfg).toBe('c18e4d79');
    expect(ev.created).toBe(3);
    expect(ev.step).toBe(true);
    expect(ev).not.toHaveProperty('email');
    expect(ev).not.toHaveProperty('title');
  });
});

describe('shouldShip', () => {
  it('is false for a null record', () => {
    expect(shouldShip(null)).toBe(false);
  });

  it('is false for a duplicate even if ERROR', () => {
    expect(shouldShip({ level: 'ERROR', duplicate: true })).toBe(false);
  });

  it('is true for an alwaysShip INFO (usage/health) despite the WARN default', () => {
    expect(shouldShip({ level: 'INFO', alwaysShip: true })).toBe(true);
  });

  it('ships WARN/ERROR but not INFO at the default WARN threshold', () => {
    expect(shouldShip({ level: 'ERROR' })).toBe(true);
    expect(shouldShip({ level: 'WARN' })).toBe(true);
    expect(shouldShip({ level: 'INFO' })).toBe(false);
    expect(shouldShip({ level: 'DEBUG' })).toBe(false);
  });

  it('widens to INFO when shipLevel is lowered to INFO rank (1)', () => {
    expect(shouldShip({ level: 'INFO' }, 1)).toBe(true);
    expect(shouldShip({ level: 'DEBUG' }, 1)).toBe(false);
  });
});

describe('attachAxiomServerSink — opts injection (the fix)', () => {
  it('is INERT when opts are empty even though process.env has AXIOM_* set', () => {
    process.env.AXIOM_TOKEN = 'env-token-should-be-ignored';
    process.env.AXIOM_DATASET = 'env-dataset';
    process.env.AXIOM_APP_NAME = 'env-app';
    const logger = fakeLogger();
    const unsub = attachAxiomServerSink(logger, {});
    expect(AxiomCtor).not.toHaveBeenCalled();
    expect(logger.state.sink).toBeNull();
    expect(typeof unsub).toBe('function');
    delete process.env.AXIOM_TOKEN;
    delete process.env.AXIOM_DATASET;
    delete process.env.AXIOM_APP_NAME;
  });

  it('is inert when token+dataset present but app missing', () => {
    const logger = fakeLogger();
    attachAxiomServerSink(logger, { token: 't', dataset: 'd' });
    expect(AxiomCtor).not.toHaveBeenCalled();
    expect(logger.state.sink).toBeNull();
  });

  it('activates from injected opts and constructs the client with the injected token', () => {
    const logger = fakeLogger();
    attachAxiomServerSink(logger, { token: 'inj-token', dataset: 'app-errors', app: 'sync-calender' });
    expect(AxiomCtor).toHaveBeenCalledTimes(1);
    expect(AxiomCtor).toHaveBeenCalledWith(expect.objectContaining({ token: 'inj-token' }));
    expect(typeof logger.state.sink).toBe('function');
  });

  it('ingests a WARN record to the injected dataset with the mapped event', () => {
    const logger = fakeLogger();
    attachAxiomServerSink(logger, { token: 't', dataset: 'app-errors', app: 'sync-calender', ver: '2.2.0' });
    logger.emit({ level: 'WARN', tag: 'sync', message: 'renew failed' });
    expect(ingestSpy).toHaveBeenCalledTimes(1);
    const [dataset, events] = ingestSpy.mock.calls[0];
    expect(dataset).toBe('app-errors');
    expect(events[0].app).toBe('sync-calender');
    expect(events[0].ver).toBe('2.2.0');
    expect(events[0].message).toBe('renew failed');
  });

  it('does NOT ingest an INFO record under the default WARN ship policy', () => {
    const logger = fakeLogger();
    attachAxiomServerSink(logger, { token: 't', dataset: 'd', app: 'a' });
    logger.emit({ level: 'INFO', tag: 'sync', message: 'ok' });
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it('ingests an alwaysShip INFO (health) despite the WARN policy', () => {
    const logger = fakeLogger();
    attachAxiomServerSink(logger, { token: 't', dataset: 'd', app: 'a' });
    logger.emit({ level: 'INFO', tag: 'health', message: 'boot', alwaysShip: true });
    expect(ingestSpy).toHaveBeenCalledTimes(1);
  });
});

describe('flushAxiom', () => {
  it('drains the active client buffer', async () => {
    const logger = fakeLogger();
    attachAxiomServerSink(logger, { token: 't', dataset: 'd', app: 'a' });
    await flushAxiom();
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });
});
