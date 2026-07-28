/**
 * axiomServerSink.ts — the CANONICAL REFERENCE server sink: ships server logger records
 * to Axiom (the SHARED `app-errors` dataset). Uses @axiomhq/js; the SDK batches in the
 * background and flushAxiom() drains the buffer on shutdown.
 *
 * Server apps deploy by pushing the app ROOT only, so a workspace dependency does NOT
 * resolve at their runtime — they keep a LOCAL copy of this module. This copy is the
 * single source of truth those copies are drift-tested against.
 *
 * Config is OPTS-INJECTED (deadline-confirm's model): the module reads ZERO process.env.
 * The caller passes { token, dataset, app, env, ver, shipLevel } from wherever it resolves
 * them (monday-code injects platform env via the SDK secrets file, NOT process.env).
 * Without token+dataset+app, attachAxiomServerSink() is inert and console logging is untouched.
 *
 * Ship policy: WARN/ERROR only by default; usage/health (alwaysShip) bypass it. Incident
 * mode: pass shipLevel:'DEBUG'|'INFO' to widen.
 *
 * PRIVACY: ships level/tag/message/kind + err_name/err_code/err_msg (error.message ONLY
 * scrubbed via scrubMessage: emails / tokens&hex>=16 / digit-runs>=7 redacted, capped 200)
 * + first stack frame + allow-listed numeric/short-string context. This is a sink file —
 * console breadcrumbs never re-enter the logger (recursion hazard).
 */
import { Axiom } from '@axiomhq/js';

const RANK: Record<string, number> = { ERROR: 3, WARN: 2, INFO: 1, DEBUG: 0 };

// scrubMessage — privacy-scrub error.message before it ships as err_msg (D2). Order matters:
// emails FIRST, then long token/hex runs (>=16), then digit-runs (>=7). Pre-capped 1000 to
// bound regex work, final slice 200. Identical spec across the browser sink and this reference.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN_RE = /[A-Za-z0-9_-]{16,}/g;
const DIGITS_RE = /\d{7,}/g;
const MSG_PRECAP = 1000;
const MSG_MAXLEN = 200;

// Context fields worth shipping as-is: short identifiers and counters. Everything else in
// record.context stays local. (ip is intentionally absent — PII.)
const CTX_ALLOW = new Set([
  'acc', 'usr', 'obj', 'cfg', 'prv', 'board',
  'created', 'updated', 'deleted', 'skipped', 'ms', 'total', 'total_ms',
  'status', 'method', 'path', 'url', 'step',
  'itemId', 'outcome', 'op', 'ok', 'port',
]);
const FIELD_MAX = 256;

export interface ServerLogRecord {
  level?: string;
  tag?: string;
  message?: string;
  timestampISO?: string;
  domainKind?: string;
  correlationId?: string | number;
  duplicate?: boolean;
  alwaysShip?: boolean;
  error?: { name?: unknown; errorCode?: unknown; status?: unknown; code?: unknown; stack?: unknown; message?: unknown } | null;
  context?: Record<string, unknown> | null;
}

export interface ServerSinkConfig {
  app?: string;
  env?: string;
  ver?: string | null;
  sess?: string | null;
}

export interface ServerSinkOptions {
  token?: string | null;
  dataset?: string | null;
  app?: string | null;
  env?: string;
  ver?: string | null;
  shipLevel?: string;
}

interface AxiomLike {
  ingest(dataset: string, events: Array<Record<string, unknown>>): void;
  flush(): Promise<unknown>;
}

function firstStackFrame(stack: unknown): string | undefined {
  if (typeof stack !== 'string' || stack === '') return undefined;
  // Server stacks are V8-only.
  for (const line of stack.split('\n')) {
    if (/^\s*at /.test(line)) return line.trim().slice(0, 400);
  }
  return undefined;
}

/** Redact PII/secrets from an error message so it can ship as `err_msg` (D2). */
export function scrubMessage(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '';
  let s = raw.slice(0, MSG_PRECAP);
  s = s.replace(EMAIL_RE, '[email]');
  s = s.replace(TOKEN_RE, '[redacted]');
  s = s.replace(DIGITS_RE, '[num]');
  return s.slice(0, MSG_MAXLEN);
}

/**
 * record → flat Axiom event. Pure function (unit-test seam). Reads config from the passed
 * cfg so it stays testable without env.
 */
export function mapRecordToEvent(record: ServerLogRecord, cfg: ServerSinkConfig = {}): Record<string, unknown> {
  const r = record || ({} as ServerLogRecord);
  const ev: Record<string, unknown> = {
    _time: r.timestampISO || new Date().toISOString(),
    level: String(r.level ?? '').toLowerCase(),
    tag: String(r.tag || 'app').toLowerCase(),
    message: String(r.message ?? '').slice(0, 300),
    app: cfg.app ?? null,
    env: cfg.env ?? 'production',
  };
  // ver + sess — parity with the browser transport (correlate a server event to a release
  // and a process instance). Omitted when absent so pure-function tests (no cfg) stay clean.
  if (cfg.ver != null) ev.ver = String(cfg.ver).slice(0, FIELD_MAX);
  if (cfg.sess != null) ev.sess = String(cfg.sess).slice(0, FIELD_MAX);
  // DOMAIN discriminator (matches the client + app-core): error (default) | usage | health.
  ev.kind = r.domainKind ?? 'error';
  if (r.correlationId != null) ev.corr = String(r.correlationId);
  const err = r.error;
  if (err != null) {
    if (err.name != null) ev.err_name = String(err.name).slice(0, FIELD_MAX);
    const code = err.errorCode ?? err.status ?? err.code;
    if (code != null) ev.err_code = String(code).slice(0, FIELD_MAX);
    const stack1 = firstStackFrame(err.stack);
    if (stack1 !== undefined) ev.stack1 = stack1;
    // error.message ships ONLY scrubbed, as err_msg (D2) — the raw message is never handed over
    if (typeof err.message === 'string' && err.message !== '') ev.err_msg = scrubMessage(err.message);
  }
  const ctx = r.context;
  if (ctx && typeof ctx === 'object') {
    for (const [key, val] of Object.entries(ctx)) {
      if (!CTX_ALLOW.has(key)) continue;
      if (typeof val === 'number' && Number.isFinite(val)) ev[key] = val;
      else if (typeof val === 'boolean') ev[key] = val;
      else if (typeof val === 'string') ev[key] = val.slice(0, FIELD_MAX);
    }
  }
  return ev;
}

/**
 * Ship policy — pure function (unit-test seam). Order: !record → false, duplicate → false,
 * alwaysShip → true, THEN level policy.
 */
export function shouldShip(record: ServerLogRecord, shipLevel: number = RANK.WARN): boolean {
  if (!record) return false;
  if (record.duplicate === true) return false; // logger already skips dupes — defense in depth
  if (record.alwaysShip === true) return true;  // usage/health (INFO) bypass WARN/ERROR (D3/D5)
  const rank = RANK[String(record.level ?? '').toUpperCase()];
  if (rank === undefined || rank < shipLevel) return false;
  return true;
}

interface ServerLoggerLike {
  addSink(sink: (record: ServerLogRecord) => void): () => void;
}

let activeClient: AxiomLike | null = null;

/**
 * Register the Axiom sink on the server logger. Call once at startup:
 *   attachAxiomServerSink(logger, { token, dataset, app, env, shipLevel });
 * Inert (returns a no-op) unless token+dataset+app are all present.
 */
export function attachAxiomServerSink(logger: ServerLoggerLike, opts: ServerSinkOptions = {}): () => void {
  const token = opts.token || null;
  const dataset = opts.dataset || null;
  const app = opts.app || null;
  const env = opts.env || 'production';
  const ver = opts.ver || null;
  // Per-process session id — stamped on every event so a burst of errors ties to one
  // process instance across a restart (parity with the browser transport's `sess`).
  const sess = Math.random().toString(36).slice(2, 10);
  const shipLevel = RANK[String(opts.shipLevel ?? '').toUpperCase()] ?? RANK.WARN;

  if (!token || !dataset || !app || !logger?.addSink) return () => {};

  let client: AxiomLike;
  try {
    client = new Axiom({
      token,
      // Never let an Axiom transport error recurse through the logger.
      onError: (err: { message?: string } | unknown) => {
        try {
          const m = (err as { message?: string })?.message ?? err;
          console.error(`[axiom-sink] ${m}`);
        } catch {
          /* breadcrumb best-effort */
        }
      },
    }) as unknown as AxiomLike;
  } catch (e) {
    try {
      console.error('[axiom-sink] init failed — remote logging disabled:', e);
    } catch {
      /* breadcrumb best-effort */
    }
    return () => {};
  }

  // Stash the client for flushAxiom() (shutdown drain).
  activeClient = client;

  return logger.addSink((record: ServerLogRecord) => {
    // logger fan-out already isolates sink throws; keep the hot path lean.
    if (!shouldShip(record, shipLevel)) return;
    client.ingest(dataset, [mapRecordToEvent(record, { app, env, ver, sess })]);
  });
}

/** True only when a client has been constructed (opts gate passed). */
export function isAxiomSinkActive(): boolean {
  return Boolean(activeClient);
}

/**
 * Drain the SDK's background buffer. Process guards call this on shutdown so the last error
 * before a crash is not lost. Never throws.
 */
export async function flushAxiom(): Promise<void> {
  if (!activeClient) return;
  try {
    await activeClient.flush();
  } catch (e) {
    try {
      console.error('[axiom-sink] flush failed:', (e as { message?: string })?.message ?? e);
    } catch {
      /* breadcrumb best-effort */
    }
  }
}
