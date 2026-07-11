/**
 * axiomSink.ts — the SINGLE shared bridge from an app-core `logger` to the
 * hardened Axiom browser transport (`../axiomTransport.ts`). This replaces the
 * naive per-record `shipAxiom` fetch that used to live inside `createLogger`.
 *
 * Standard: this is the app-core implementation of the error-guard remote-monitoring
 * contract (`.claude/skills/error-guard/references/remote-monitoring.md`) — direct
 * browser→Axiom ingest into the SHARED `app-errors` dataset, discriminated by the
 * `app` field. Generalized from tracker's `src/utils/axiomSink.js` (the reference
 * implementation), adapted to app-core's `LogRecord` shape.
 *
 * Activation gate (truth table): the transport ships ONLY when `active` resolves
 * true — by default `import.meta.env.PROD === true` AND both `dataset` and `token`
 * are present (the consumer reads `VITE_AXIOM_DATASET` / `VITE_AXIOM_TOKEN` and
 * passes them in). Dev server, tunnel, and vitest are structurally inert: the
 * transport is an inert handle and `attachAxiomSink()` degrades to a no-op.
 *
 * PRIVACY (defense in depth): the sink NEVER copies `record.data`,
 * `record.context.query/variables/response/rawResponse`, or `error.message` — only
 * the allowlisted envelope fields below. The transport's own exact-key allowlist
 * would drop them anyway, but the sink refuses to hand them over in the first place.
 */
import { createAxiomBrowserTransport, type AxiomTransport, type AxiomEventInput } from '../axiomTransport';
import type { Logger, LogRecord } from '../logger';

// Rank table — DEBUG < INFO < WARN < ERROR.
const RANK: Record<string, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const REMOTE_LEVEL_KEY = 'axis:remoteLogLevel';

// Guarded prod probe — app-core is consumed as TS source, so the consuming app's
// Vite build inlines `import.meta.env.PROD`. Matches the cast pattern in logger.ts.
function isProd(): boolean {
  return typeof import.meta !== 'undefined' && (import.meta as { env?: { PROD?: boolean } }).env?.PROD === true;
}

export interface AxiomSinkOptions {
  /** Dataset discriminator — the app slug (e.g. 'day-off'). Stamped as the `app` field. */
  app: string;
  /** Axiom dataset — the consumer passes import.meta.env.VITE_AXIOM_DATASET (default 'app-errors'). */
  dataset?: string;
  /** Ingest token — the consumer passes import.meta.env.VITE_AXIOM_TOKEN. NEVER hard-coded. */
  token?: string;
  appVersion?: string;
  environment?: string;
  /** Override the gate (tests pass `true`; production omits it). */
  active?: boolean;
  /** Test seam — inject a transport instead of constructing one. */
  transport?: AxiomTransport;
}

// ============================================
// shouldShip — level policy (pure; unit-test seam)
// ============================================

/**
 * Default policy: ERROR/WARN ship, everything else is dropped. `remoteLevel` is the
 * incident override — when set, ship iff rank(level) >= rank(remoteLevel). Duplicate
 * records never ship (logger.ts already withholds them from sinks; kept as one cheap line).
 */
export function shouldShip(record: LogRecord, remoteLevel?: string | null): boolean {
  if (!record) return false;
  const rank = RANK[String(record.level ?? '').toUpperCase()];
  const remoteRank = remoteLevel != null ? RANK[String(remoteLevel).toUpperCase()] : undefined;
  if (remoteRank !== undefined) {
    if (rank === undefined || rank < remoteRank) return false;
  } else if (rank !== RANK.ERROR && rank !== RANK.WARN) {
    return false; // default policy: WARN/ERROR only
  }
  if (record.duplicate === true) return false;
  return true;
}

// ============================================
// mapRecordToEvent — record → flat envelope (pure; unit-test seam)
// ============================================

/**
 * First stack-frame line. V8 frames (`/^\s*at /`) are preferred over any earlier
 * '@'-containing line so a message line like "Error: mail a@b.co bounced" (which
 * contains '@' but is NOT a frame) can never leak error.message content.
 */
function firstStackFrame(stack: unknown): string | undefined {
  if (typeof stack !== 'string' || stack === '') return undefined;
  let sigilLine: string | undefined;
  for (const line of stack.split('\n')) {
    if (/^\s*at /.test(line)) return line.trim();
    if (sigilLine === undefined && line.includes('@')) sigilLine = line;
  }
  return sigilLine === undefined ? undefined : sigilLine.trim();
}

/**
 * Maps EXACTLY the allowlisted fields — never `record.data`, `record.context`
 * query/response, or `error.message`. The transport stamps `_time` at enqueue and
 * enriches app/env/ver/sess + acc/usr/obj/board at flush.
 */
export function mapRecordToEvent(record: LogRecord): AxiomEventInput {
  const r = record || ({} as LogRecord);
  const ev: AxiomEventInput = {
    level: String(r.level ?? '').toLowerCase(),
    tag: String(r.module || 'app').toLowerCase(),
    message: r.message, // stable English event id; transport truncates at 300
  };
  if (r.correlationId != null) ev.corr = String(r.correlationId);
  const err = r.error as { name?: unknown; errorCode?: unknown; status?: unknown; code?: unknown; stack?: unknown } | undefined;
  if (err != null && typeof err === 'object') {
    if (err.name != null) ev.err_name = String(err.name);
    const code = err.errorCode ?? err.status ?? err.code; // MondayApiError.errorCode / HTTP status
    if (code != null) ev.err_code = String(code);
    const stack1 = firstStackFrame(err.stack);
    if (stack1 !== undefined) ev.stack1 = stack1; // transport truncates at 400
  }
  const ctx = r.context;
  if (ctx != null && typeof ctx === 'object') {
    const c = ctx as { duration?: unknown; totalMs?: unknown; step?: unknown };
    if (typeof c.duration === 'number' && Number.isFinite(c.duration)) ev.ms = c.duration;
    if (typeof c.totalMs === 'number' && Number.isFinite(c.totalMs)) ev.total_ms = c.totalMs;
    if (typeof c.step === 'number' && Number.isFinite(c.step)) ev.step = c.step;
  }
  return ev;
}

// ============================================
// attachAxiomSink — construction + registration + ring-buffer replay
// ============================================

// Incident-mode remote level, read ONCE at module load so it survives a reload.
let remoteLevel: string | null = null;
try {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(REMOTE_LEVEL_KEY);
    if (saved !== null && RANK[saved] !== undefined) remoteLevel = saved;
  }
} catch {
  /* localStorage unavailable (privacy mode / sandboxed iframe) — default policy */
}

// The single active transport, exposed for setAxiomContext + the window debug surface.
let activeTransport: AxiomTransport | null = null;

/**
 * Bridge `logger` records into the Axiom transport. MUST run synchronously during
 * initial module evaluation in the app entry, BEFORE render, so the ring-buffer
 * replay and the live sink don't overlap (no double-ship).
 *
 * Returns an unsubscribe fn (no-op when gated off / already attached).
 */
export function attachAxiomSink(logger: Logger, options: AxiomSinkOptions): () => void {
  const dataset = options.dataset;
  const token = options.token;
  const active = options.active ?? (isProd() && Boolean(dataset) && Boolean(token));
  if (!active) return () => {};

  let transport: AxiomTransport | null = options.transport ?? null;
  if (!transport) {
    try {
      transport = createAxiomBrowserTransport({
        dataset: dataset as string,
        token: token as string,
        app: options.app,
        appVersion: options.appVersion,
        environment: options.environment,
      });
    } catch (e) {
      // one breadcrumb, then the sink degrades to a permanent no-op — the app never pays
      // eslint-disable-next-line no-console
      console.error('[axiom-sink] init failed — remote logging disabled for this session:', e);
      return () => {};
    }
  }

  const g: { __AXIS_AXIOM_SINK_ATTACHED__?: boolean } =
    typeof globalThis !== 'undefined' ? (globalThis as typeof g) : {};
  if (g.__AXIS_AXIOM_SINK_ATTACHED__) return () => {}; // survives HMR module re-eval
  g.__AXIS_AXIOM_SINK_ATTACHED__ = true; // set BEFORE replay

  activeTransport = transport;

  const sink = (record: LogRecord): void => {
    try {
      if (!shouldShip(record, remoteLevel)) return;
      transport!.enqueue(mapRecordToEvent(record));
    } catch (e) {
      // never re-enter the logger (recursion hazard)
      // eslint-disable-next-line no-console
      console.error('[axiom-sink] failed to ship a record (suppressed):', e);
    }
  };

  // replay import-time buffer (respects shouldShip + duplicate), then attach live
  for (const rec of logger.getBuffer()) sink(rec);
  const unsubscribe = logger.addSink(sink);

  // operator surface — remote level control + stats (browser only)
  if (typeof window !== 'undefined') {
    (window as unknown as { setRemoteLevel?: unknown; getAxiomStats?: unknown }).setRemoteLevel = setRemoteLevel;
    (window as unknown as { getAxiomStats?: unknown }).getAxiomStats = () =>
      activeTransport?.stats() ?? { enabled: false };
  }

  return () => {
    unsubscribe();
    g.__AXIS_AXIOM_SINK_ATTACHED__ = false;
    if (activeTransport === transport) activeTransport = null;
  };
}

/**
 * Merge monday iframe identity into every future envelope (merge semantics —
 * undefined never clobbers). Safe to call repeatedly as ids resolve.
 */
export function setAxiomContext(
  ids: { accountId?: string | number; userId?: string | number; boardId?: string | number; instanceId?: string | number } = {},
  seams: { transport?: AxiomTransport | null } = {},
): void {
  const t = seams.transport ?? activeTransport;
  t?.setContext({ acc: ids.accountId, usr: ids.userId, obj: ids.instanceId ?? ids.boardId, board: ids.boardId });
}

/**
 * Incident mode: override the default WARN/ERROR ship policy at runtime.
 * setRemoteLevel('DEBUG') ships everything; persists across reload via localStorage;
 * setRemoteLevel(null) restores the default policy.
 */
export function setRemoteLevel(level: string | null): string | null {
  if (level === null || level === undefined) {
    remoteLevel = null;
    try {
      localStorage.removeItem(REMOTE_LEVEL_KEY);
    } catch {
      /* localStorage unavailable — live var still cleared */
    }
    return null;
  }
  const up = String(level).toUpperCase();
  if (RANK[up] === undefined) {
    // eslint-disable-next-line no-console
    console.error(`[axiom-sink] invalid remote level '${level}' — use DEBUG | INFO | WARN | ERROR or null`);
    return remoteLevel;
  }
  remoteLevel = up;
  try {
    localStorage.setItem(REMOTE_LEVEL_KEY, up);
  } catch {
    /* localStorage unavailable — incident mode won't survive reload, still live now */
  }
  return remoteLevel;
}
