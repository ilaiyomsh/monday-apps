/**
 * axiomErrorSink.ts — bridges logger.ts records into the Axiom browser transport
 * (direct ingest into the SHARED errors dataset). TypeScript port of the error-guard
 * client template (.claude/skills/error-guard/templates/axiomErrorSink.js).
 *
 * Activation gate: ships ONLY when import.meta.env.PROD === true AND VITE_AXIOM_DATASET /
 * VITE_AXIOM_TOKEN / VITE_AXIOM_APP are all baked into the bundle. Dev server, tunnel, and
 * tests are structurally inert — the module transport is null and attachAxiomSink() is a no-op.
 *
 * PRIVACY: the sink NEVER copies record.data, context.query/variables/response/rawResponse, or
 * any Hebrew userMessage. error.message ships ONLY scrubbed, as err_msg (scrubMessage: emails /
 * tokens&hex>=16 / digit-runs>=7 redacted, capped 200); the transport's exact-key allowlist
 * backstops it. What ships per error: level, tag (module), message (stable English event id),
 * kind (domain discriminator), corr, err_name, err_code, err_msg (scrubbed), first stack frame,
 * and numeric timings.
 */
import { createAxiomBrowserTransport, type AxiomTransport, type AxiomEventInput } from './axiomBrowserTransport';
import logger, { type LogRecord, type LogContext } from './logger';

// Rank table — DEBUG < INFO < WARN < ERROR. Values are number|undefined so the
// `=== undefined` guards below stay type-legal under strict TS.
const RANK: Record<string, number | undefined> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

declare global {
  interface Window {
    setRemoteLevel?: (level: string | null) => string | null;
    getAxiomStats?: () => unknown;
  }
}

// ============================================
// Gate + transport construction (module scope)
// ============================================

const DATASET = import.meta.env.VITE_AXIOM_DATASET;
const TOKEN = import.meta.env.VITE_AXIOM_TOKEN;
const APP = import.meta.env.VITE_AXIOM_APP;
const ACTIVE = import.meta.env.PROD === true && Boolean(DATASET) && Boolean(TOKEN) && Boolean(APP);

const REMOTE_LEVEL_KEY = `${APP ?? 'app'}:remoteLogLevel`;

let transport: AxiomTransport | null = null;
if (ACTIVE) {
  try {
    transport = createAxiomBrowserTransport({
      dataset: DATASET as string,
      token: TOKEN as string,
      app: APP as string,
      appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0',
      environment: import.meta.env.VITE_AXIOM_ENV ?? 'production',
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
 * Duplicate FIRST (logger already withholds duplicates — kept as one cheap line), then
 * alwaysShip (usage/health INFO bypass the level policy, D3/D5), then the level policy:
 * ERROR/WARN ship, everything else stays local. Incident mode overrides with a rank compare.
 */
export function shouldShip(record: LogRecord | null | undefined, remoteLvl?: string | null): boolean {
  if (!record) return false;
  if (record.duplicate === true) return false; // duplicates never ship (checked first)
  if (record.alwaysShip === true) return true; // usage/health (INFO) bypass the level policy (D3/D5)
  const rank = RANK[String(record.level ?? '').toUpperCase()];
  const remoteRank = remoteLvl != null ? RANK[String(remoteLvl).toUpperCase()] : undefined;
  if (remoteRank !== undefined) {
    // incident mode: pure rank comparison
    if (rank === undefined || rank < remoteRank) return false;
  } else if (rank !== RANK.ERROR && rank !== RANK.WARN) {
    return false; // default policy: only ERROR/WARN ship
  }
  return true;
}

// ============================================
// mapRecordToEvent(record) — pure function (unit-test seam)
// ============================================

/** An error may carry extended discriminators the base Error type does not expose. */
interface ExtendedError extends Error {
  errorCode?: unknown;
  status?: unknown;
  code?: unknown;
}

/**
 * First stack-frame line. Prefers V8 frames (`/^\s*at /`); falls back to a real
 * Firefox/Safari `name@url:line[:col]` frame — anchored, NO space before '@', trailing
 * `:line[:col]`. A prose message that merely contains '@' (an email) has whitespace before
 * the '@', so it can never be mistaken for a frame and leak error.message content.
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

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN_RE = /[A-Za-z0-9_-]{16,}/g;
const DIGITS_RE = /\d{7,}/g;
const MSG_PRECAP = 1000;
const MSG_MAXLEN = 200;
const STACK_MAXLEN = 1500;         // fix 3: joined top-5 frames
const COMPONENT_STACK_MAXLEN = 1000; // fix 3: React componentStack

/**
 * Redaction core (order matters: emails FIRST — their local part would otherwise be eaten by
 * the token rule — then long token/hex runs (>=16), then digit-runs (>=7)). Shared by
 * scrubMessage and scrubCapped so every scrubbed field obeys one redaction spec.
 */
function redact(s: string): string {
  return s.replace(EMAIL_RE, '[email]').replace(TOKEN_RE, '[redacted]').replace(DIGITS_RE, '[num]');
}

/**
 * Redact PII/secrets from an error message so it can ship as `err_msg` (D2). Pre-capped at
 * 1000 to bound regex work, final slice 200. Identical spec across app-core, the templates,
 * and every vendored copy.
 */
export function scrubMessage(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '';
  return redact(raw.slice(0, MSG_PRECAP)).slice(0, MSG_MAXLEN);
}

/**
 * Same redaction as scrubMessage but with a caller-chosen final cap — for fields that are
 * legitimately longer than an error message (the componentStack, cap 1000). Pre-caps at 3×cap.
 */
function scrubCapped(raw: unknown, cap: number): string {
  if (typeof raw !== 'string' || raw === '') return '';
  return redact(raw.slice(0, cap * 3)).slice(0, cap);
}

/**
 * The top `max` stack frames — V8 (`/^\s*at /`) or a real Firefox/Safari `name@url:line[:col]`
 * frame. Uses the SAME anchored frame detection as firstStackFrame, so a prose header line or
 * an @-containing message can never masquerade as a frame and leak error.message content.
 */
function topFrames(stack: unknown, max: number): string[] {
  if (typeof stack !== 'string' || stack === '') return [];
  const out: string[] = [];
  for (const line of stack.split('\n')) {
    if (/^\s*at /.test(line) || /^\s*\S*@\S+:\d+(?::\d+)?\s*$/.test(line)) {
      out.push(line.trim());
      if (out.length >= max) break;
    }
  }
  return out;
}

/**
 * Mapping table — EXACTLY these fields, nothing else. The transport stamps `_time` at
 * enqueue and enriches app/env/ver/sess + acc/usr/obj/board at flush.
 */
export function mapRecordToEvent(record: LogRecord | null | undefined): AxiomEventInput {
  const r = record ?? ({} as LogRecord);
  const ev: AxiomEventInput = {
    level: String(r.level ?? '').toLowerCase(),
    tag: String(r.module || 'app').toLowerCase(),
    message: r.message, // as-is (stable English event id); transport truncates
  };
  // DOMAIN discriminator: error (default) | usage | health. NEVER ship the rendering `kind`.
  ev.kind = r.domainKind ?? 'error';
  if (r.correlationId != null) ev.corr = String(r.correlationId); // key OMITTED when absent
  const err = r.error as ExtendedError | undefined;
  if (err != null) {
    if (err.name != null) ev.err_name = err.name;
    const code = err.errorCode ?? err.status ?? err.code; // MondayApiError.errorCode / HTTP status
    if (code != null) ev.err_code = String(code);
    const stack1 = firstStackFrame(err.stack);
    if (stack1 !== undefined) ev.stack1 = stack1; // transport truncates
    // Extended stack (fix 3): top-5 frames, each scrubbed, joined by newline, total cap 1500.
    // Shipped IN ADDITION to stack1 (which stays the single-frame query field).
    const frames = topFrames(err.stack, 5);
    if (frames.length > 0) ev.stack = frames.map((f) => scrubMessage(f)).join('\n').slice(0, STACK_MAXLEN);
    // error.message ships ONLY scrubbed, as err_msg (D2) — the raw message is never handed over
    if (typeof err.message === 'string' && err.message !== '') ev.err_msg = scrubMessage(err.message);
  }
  const ctx = r.context as (LogContext & { componentStack?: unknown }) | undefined;
  if (ctx != null && typeof ctx === 'object') {
    // `ms` matches the status-hub vocabulary; total_ms stays separate.
    if (typeof ctx.duration === 'number' && Number.isFinite(ctx.duration)) ev.ms = ctx.duration;
    if (typeof ctx.totalMs === 'number' && Number.isFinite(ctx.totalMs)) ev.total_ms = ctx.totalMs;
    if (typeof ctx.step === 'number' && Number.isFinite(ctx.step)) ev.step = ctx.step;
    // React componentStack (fix 3): scrubbed, cap 1000. Only when the record carries it — so
    // ordinary error records never gain the key.
    if (typeof ctx.componentStack === 'string' && ctx.componentStack !== '') {
      ev.component_stack = scrubCapped(ctx.componentStack, COMPONENT_STACK_MAXLEN);
    }
  }
  return ev;
}

// ============================================
// attachAxiomSink — registration + ring-buffer replay
// ============================================

interface AttachSeams {
  log?: typeof logger;
  t?: AxiomTransport | null;
}

/** The sink fn: shouldShip (live remoteLevel) → mapRecordToEvent → t.enqueue, all try/catched. */
function makeSink(t: AxiomTransport): LogSinkFn {
  return (record: LogRecord) => {
    try {
      if (!shouldShip(record, remoteLevel)) return;
      t.enqueue(mapRecordToEvent(record));
    } catch (e) {
      console.error('[axiom-sink] failed to ship a record (suppressed):', e);
    }
  };
}

type LogSinkFn = (record: LogRecord) => void;

interface GlobalWithFlag {
  __ERROR_GUARD_AXIOM_SINK_ATTACHED__?: boolean;
}

/**
 * Register the Axiom sink on the logger. MUST run synchronously during initial module
 * evaluation in the app entry, BEFORE createRoot(...).render — the ring buffer at that
 * instant holds only import-time records, so there is no double-ship.
 */
export function attachAxiomSink({ log = logger, t = transport }: AttachSeams = {}): () => void {
  if (!t) return () => {};
  const g = (typeof globalThis !== 'undefined' ? globalThis : {}) as GlobalWithFlag;
  if (g.__ERROR_GUARD_AXIOM_SINK_ATTACHED__) return () => {}; // survives HMR module re-eval
  g.__ERROR_GUARD_AXIOM_SINK_ATTACHED__ = true; // set BEFORE replay
  const sink = makeSink(t);
  // replay — ships import-time ERROR/WARN records, respecting shouldShip + duplicate:true
  for (const rec of log.getBuffer()) sink(rec);
  return log.addSink(sink);
}

// ============================================
// Context capture + window debug surface
// ============================================

export interface AxiomContextIds {
  accountId?: string | number;
  userId?: string | number;
  boardId?: string | number;
  instanceId?: string | number;
}

/**
 * Merge monday iframe identity into every future envelope. Call once the SDK context loads:
 *   setAxiomContext({ accountId, userId, boardId, instanceId })
 */
export function setAxiomContext(
  { accountId, userId, boardId, instanceId }: AxiomContextIds = {},
  { t = transport }: { t?: AxiomTransport | null } = {}
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
function setRemoteLevel(level: string | null): string | null {
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

// Operator surface — siblings of logger.ts's window fns (those gate console only; these
// gate the remote sink). Registered only in a browser-like environment.
if (typeof window !== 'undefined') {
  window.setRemoteLevel = setRemoteLevel;
  window.getAxiomStats = () => transport?.stats() ?? { enabled: false };
}
