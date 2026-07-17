/**
 * axiomErrorSink.ts — bridges Logger.ts records into the Axiom browser transport
 * (direct ingest into the SHARED errors dataset). TypeScript port of
 * .claude/skills/error-guard/templates/axiomErrorSink.js, adapted to planner's
 * Logger.ts record shape (LogRecord: {level, module, message, domainKind, alwaysShip,
 * error, context, correlationId, duplicate}).
 *
 * Activation gate: ships ONLY when import.meta.env.PROD === true AND
 * VITE_AXIOM_DATASET / VITE_AXIOM_TOKEN / VITE_AXIOM_APP are all baked into the bundle
 * (.env.production.local — never committed). Dev server, tunnel, and vitest are structurally
 * inert — the module transport is null and attachAxiomSink() degrades to a no-op.
 *
 * PRIVACY: the sink NEVER copies record payloads, query/variables/response, or any Hebrew
 * userMessage. error.message ships ONLY scrubbed, as err_msg (scrubMessage: emails /
 * tokens&hex>=16 / digit-runs>=7 redacted, precap 1000 / cap 200). The record.message ships
 * as a stable English event id (the transport truncates it). What ships per error: level, tag
 * (module), message, kind (domain discriminator), corr, err_name, err_code, err_msg (scrubbed),
 * first stack frame, and numeric timings.
 */
/* eslint-disable no-console */
import { createAxiomBrowserTransport } from './axiomBrowserTransport';
import type { AxiomBrowserTransport } from './axiomBrowserTransport';
import logger from './Logger';
import type { LogRecord } from './Logger';

// Build-time version constant injected by vite.config.ts `define` (mirrored to a literal in
// vitest.config.ts). Declared module-locally so this file typechecks under BOTH tsconfig.app
// (which also has the global from vite-env.d.ts — a module-scoped declare shadows it) and
// tsconfig.test.json (which does not reference vite-env.d.ts).
declare const __APP_VERSION__: string;

// Rank table — DEBUG < INFO < WARN < ERROR
const RANK: Record<string, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

/** Loose view of a record for the pure mapping/policy functions (test seams pass plain objects). */
interface SinkRecord {
  level?: string;
  module?: string;
  message?: string;
  kind?: string;
  domainKind?: string;
  alwaysShip?: boolean;
  duplicate?: boolean;
  correlationId?: string | number | null;
  error?: {
    name?: string;
    message?: unknown;
    errorCode?: unknown;
    status?: unknown;
    code?: unknown;
    stack?: unknown;
  } | null;
  context?: { duration?: unknown; totalMs?: unknown; step?: unknown } | null;
}

/** Flat wire envelope handed to transport.enqueue. */
type WireEvent = Record<string, string | number>;

// ============================================
// Gate + transport construction (module scope)
// ============================================

const DATASET = import.meta.env.VITE_AXIOM_DATASET as string | undefined;
const TOKEN = import.meta.env.VITE_AXIOM_TOKEN as string | undefined;
const APP = import.meta.env.VITE_AXIOM_APP as string | undefined;
const ACTIVE =
  import.meta.env.PROD === true && Boolean(DATASET) && Boolean(TOKEN) && Boolean(APP);

const REMOTE_LEVEL_KEY = `${APP ?? 'app'}:remoteLogLevel`;

let transport: AxiomBrowserTransport | null = null;
if (ACTIVE) {
  try {
    transport = createAxiomBrowserTransport({
      dataset: DATASET!,
      token: TOKEN!,
      app: APP!,
      appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0',
      environment: (import.meta.env.VITE_AXIOM_ENV as string | undefined) ?? 'production',
    });
  } catch (e) {
    // one breadcrumb, then the sink degrades to a permanent no-op — the app never pays
    console.error('[axiom-sink] init failed — remote logging disabled for this session:', e);
    transport = null;
  }
}

// Incident mode: remote level read ONCE at module load so it survives reload.
let remoteLevel: string | null = null;
try {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(REMOTE_LEVEL_KEY);
    if (saved !== null && RANK[saved] !== undefined) {
      remoteLevel = saved;
    }
  }
} catch {
  // localStorage unavailable (privacy mode / sandboxed iframe) — default policy
}

// ============================================
// shouldShip(record, remoteLevel) — pure function (unit-test seam)
// ============================================

/**
 * Order: duplicate FIRST → false, then alwaysShip → true (usage/health INFO bypass the level
 * policy, D3/D5), then the level policy (ERROR/WARN ship, everything else stays local). Incident
 * mode (setRemoteLevel) overrides with a pure rank comparison.
 */
export function shouldShip(record: SinkRecord | null | undefined, level?: string | null): boolean {
  if (!record) return false;
  if (record.duplicate === true) return false; // duplicates never ship (checked first)
  if (record.alwaysShip === true) return true; // usage/health (INFO) bypass the level policy
  const rank = RANK[String(record.level ?? '').toUpperCase()];
  const remoteRank = level != null ? RANK[String(level).toUpperCase()] : undefined;
  if (remoteRank !== undefined) {
    // incident mode: pure rank comparison
    if (rank === undefined || rank < remoteRank) return false;
  } else if (rank !== RANK.ERROR && rank !== RANK.WARN) {
    return false; // default policy: only ERROR/WARN ship
  }
  return true;
}

// ============================================
// firstStackFrame — anchored frame extraction
// ============================================

/**
 * First stack-frame line. Prefers V8 frames (`/^\s*at /`); falls back to a real Firefox/Safari
 * `name@url:line[:col]` frame — anchored, NO space before '@', trailing `:line[:col]`. A prose
 * message that merely contains '@' (an email) has whitespace before the '@', so it can never be
 * mistaken for a frame and leak error.message content into stack1.
 */
function firstStackFrame(stack: unknown): string | undefined {
  if (typeof stack !== 'string' || stack === '') return undefined;
  let sigilLine: string | undefined;
  for (const line of stack.split('\n')) {
    if (/^\s*at /.test(line)) return line.trim();
    if (sigilLine === undefined && /^\s*\S*@\S+:\d+(?::\d+)?\s*$/.test(line)) sigilLine = line;
  }
  return sigilLine === undefined ? undefined : sigilLine.trim();
}

// ============================================
// scrubMessage — privacy-scrub error.message before it ships as err_msg (D2)
// ============================================

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN_RE = /[A-Za-z0-9_-]{16,}/g;
const DIGITS_RE = /\d{7,}/g;
const MSG_PRECAP = 1000;
const MSG_MAXLEN = 200;

/**
 * Redact PII/secrets from an error message so it can ship as `err_msg` (D2). Order matters:
 * emails FIRST (their local part would otherwise be eaten by the token rule), then long
 * token/hex runs (>=16), then digit-runs (>=7). Pre-capped at 1000 to bound regex work, final
 * slice 200. Identical spec across app-core, the template, and every app.
 */
export function scrubMessage(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '';
  let s = raw.slice(0, MSG_PRECAP);
  s = s.replace(EMAIL_RE, '[email]');
  s = s.replace(TOKEN_RE, '[redacted]');
  s = s.replace(DIGITS_RE, '[num]');
  return s.slice(0, MSG_MAXLEN);
}

// ============================================
// mapRecordToEvent(record) — pure function (unit-test seam)
// ============================================

/**
 * Mapping table — EXACTLY these fields, nothing else. The transport stamps `_time` at enqueue
 * and enriches app/env/ver/sess + acc/usr/obj/board at flush. ev.kind = record.domainKind ??
 * 'error' (NEVER the rendering kind). error.message ships ONLY scrubbed, as err_msg.
 */
export function mapRecordToEvent(record: SinkRecord | null | undefined): WireEvent {
  const r = record || {};
  const ev: WireEvent = {
    level: String(r.level ?? '').toLowerCase(),
    tag: String(r.module || 'app').toLowerCase(),
    message: String(r.message ?? ''), // stable English event id; transport truncates
  };
  // DOMAIN discriminator: error (default) | usage | health. NEVER the rendering `kind`.
  ev.kind = r.domainKind ?? 'error';
  if (r.correlationId != null) ev.corr = String(r.correlationId); // key OMITTED when absent
  const err = r.error;
  if (err != null) {
    if (err.name != null) ev.err_name = String(err.name);
    const code = err.errorCode ?? err.status ?? err.code; // MondayApiError.errorCode / HTTP status
    if (code != null) ev.err_code = String(code);
    const stack1 = firstStackFrame(err.stack);
    if (stack1 !== undefined) ev.stack1 = stack1; // transport truncates
    // error.message ships ONLY scrubbed, as err_msg (D2)
    if (typeof err.message === 'string' && err.message !== '') ev.err_msg = scrubMessage(err.message);
  }
  const ctx = r.context;
  if (ctx != null && typeof ctx === 'object') {
    if (typeof ctx.duration === 'number' && Number.isFinite(ctx.duration)) ev.ms = ctx.duration;
    if (typeof ctx.totalMs === 'number' && Number.isFinite(ctx.totalMs)) ev.total_ms = ctx.totalMs;
    if (typeof ctx.step === 'number' && Number.isFinite(ctx.step)) ev.step = ctx.step;
  }
  return ev;
}

// ============================================
// attachAxiomSink — registration + ring-buffer replay
// ============================================

/** The sink fn: shouldShip (live remoteLevel) → mapRecordToEvent → t.enqueue, all try/catched. */
function makeSink(t: AxiomBrowserTransport): (record: LogRecord) => void {
  return (record: LogRecord) => {
    try {
      if (!shouldShip(record as SinkRecord, remoteLevel)) return;
      t.enqueue(mapRecordToEvent(record as SinkRecord));
    } catch (e) {
      console.error('[axiom-sink] failed to ship a record (suppressed):', e);
    }
  };
}

interface AttachSeams {
  log?: { getBuffer(): LogRecord[]; addSink(fn: (r: LogRecord) => void): () => void };
  t?: AxiomBrowserTransport | null;
}

/**
 * Register the Axiom sink on the logger. MUST run synchronously during initial module
 * evaluation in the app entry, BEFORE createRoot(...).render — the ring buffer at that instant
 * holds only import-time records, and there is no async gap between replay and addSink.
 */
export function attachAxiomSink({ log = logger, t = transport }: AttachSeams = {}): () => void {
  if (!t) return () => {};
  const g = (typeof globalThis !== 'undefined' ? globalThis : {}) as Record<string, unknown>;
  if (g.__ERROR_GUARD_AXIOM_SINK_ATTACHED__) return () => {}; // survives HMR module re-eval
  g.__ERROR_GUARD_AXIOM_SINK_ATTACHED__ = true; // set BEFORE replay
  const sink = makeSink(t);
  // replay — ships import-time ERROR/WARN records, respecting shouldShip
  for (const rec of log.getBuffer()) sink(rec);
  return log.addSink(sink);
}

// ============================================
// Context capture + window debug surface
// ============================================

/**
 * Merge monday iframe identity into every future envelope. Call once the monday SDK context
 * loads: setAxiomContext({ accountId, userId, boardId, instanceId }).
 */
export function setAxiomContext(
  {
    accountId,
    userId,
    boardId,
    instanceId,
  }: {
    accountId?: string | number;
    userId?: string | number;
    boardId?: string | number;
    instanceId?: string | number;
  } = {},
  { t = transport }: { t?: AxiomBrowserTransport | null } = {}
): void {
  t?.setContext({ acc: accountId, usr: userId, obj: instanceId ?? boardId, board: boardId });
}

/** True only when the activation gate passed AND the transport constructed. */
export function isAxiomSinkActive(): boolean {
  return ACTIVE && Boolean(transport);
}

/**
 * Incident mode: override the default ship policy at runtime. setRemoteLevel('DEBUG') ships
 * everything; persists across reload via localStorage; setRemoteLevel(null) restores default.
 */
function setRemoteLevel(level: string | null | undefined): string | null {
  if (level === null || level === undefined) {
    remoteLevel = null;
    try {
      localStorage.removeItem(REMOTE_LEVEL_KEY);
    } catch {
      // localStorage unavailable — live var still cleared
    }
    return null;
  }
  const up = String(level).toUpperCase();
  if (RANK[up] === undefined) {
    console.error(`[axiom-sink] invalid remote level '${level}' — use DEBUG | INFO | WARN | ERROR or null`);
    return remoteLevel;
  }
  remoteLevel = up;
  try {
    localStorage.setItem(REMOTE_LEVEL_KEY, up);
  } catch {
    // localStorage unavailable — incident mode won't survive reload, still live now
  }
  return remoteLevel;
}

// Operator surface — siblings of Logger.ts's window.AppLogger (that gates console only; these
// gate the remote sink). Registered only in a browser-like environment.
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).setRemoteLevel = setRemoteLevel;
  (window as unknown as Record<string, unknown>).getAxiomStats = () =>
    transport?.stats() ?? { enabled: false };
}
