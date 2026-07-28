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
 * PRIVACY (defense in depth): the sink NEVER copies `record.data` or
 * `record.context.query/variables/response/rawResponse`. `error.message` ships ONLY as
 * `err_msg` via `scrubMessage` (emails / tokens&hex>=16 / digit-runs>=7 redacted, capped
 * 200) — the raw message is never handed over. The transport's exact-key allowlist backstops it.
 */
import {
  createAxiomBrowserTransport,
  type AxiomTransport,
  type AxiomEventInput,
  type AxiomTransportStats,
} from './axiomTransport';
import type { Logger, LogRecord } from '../types';

// Rank table — DEBUG < INFO < WARN < ERROR.
const RANK: Record<string, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const REMOTE_LEVEL_KEY = 'axis:remoteLogLevel';

// Guarded prod probe. error-kit ships COMPILED (dist/), so both consumer worlds are
// covered: Vite inlines `import.meta.env.PROD`; CRA/webpack define `process.env.NODE_ENV`.
// Both are read under typeof guards so neither reference throws where the other is absent,
// and a consumer can always override the whole gate with `options.active`.
function isProd(): boolean {
  try {
    const im = import.meta as { env?: { PROD?: boolean } } | undefined;
    if (typeof im !== 'undefined' && im.env?.PROD === true) return true;
  } catch {
    /* import.meta unavailable (CJS/webpack build target) — fall through */
  }
  try {
    const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
    if (proc?.env?.NODE_ENV === 'production') return true;
  } catch {
    /* process undefined (pure browser) — fall through */
  }
  return false;
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
 * Default policy: ERROR/WARN ship, everything else is dropped — EXCEPT records flagged
 * `alwaysShip` (usage/health at INFO), which ship regardless of level. `remoteLevel` is the
 * incident override — when set, ship iff rank(level) >= rank(remoteLevel). Duplicates never ship.
 */
export function shouldShip(record: LogRecord, remoteLevel?: string | null): boolean {
  if (!record) return false;
  if (record.duplicate === true) return false;   // duplicates never ship (checked first)
  if (record.alwaysShip === true) return true;    // usage/health (INFO) bypass the level policy (D3/D5)
  const rank = RANK[String(record.level ?? '').toUpperCase()];
  const remoteRank = remoteLevel != null ? RANK[String(remoteLevel).toUpperCase()] : undefined;
  if (remoteRank !== undefined) {
    if (rank === undefined || rank < remoteRank) return false;
  } else if (rank !== RANK.ERROR && rank !== RANK.WARN) {
    return false; // default policy: WARN/ERROR only
  }
  return true;
}

// ============================================
// mapRecordToEvent — record → flat envelope (pure; unit-test seam)
// ============================================

/**
 * First stack-frame line. Prefers V8 frames (`/^\s*at /`); falls back to a real
 * Firefox/Safari `name@url:line[:col]` frame — anchored, with NO space before '@'
 * and a trailing `:line[:col]`. A prose message that merely contains '@' (an email)
 * has whitespace before the '@', so even one that happens to end in ':<digits>'
 * (a status code / port / timestamp) can never be mistaken for a frame and leak
 * error.message content into stack1.
 */
function firstStackFrame(stack: unknown): string | undefined {
  if (typeof stack !== 'string' || stack === '') return undefined;
  let sigilLine: string | undefined;
  for (const line of stack.split('\n')) {
    if (/^\s*at /.test(line)) return line.trim();
    // Anchored frame shape: `name@url:line[:col]`, no whitespace before '@' or in the url.
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
 * 1000 to bound regex work, final slice 200. Accepted trade-off: redacts a rare 16+ char
 * all-letter word. Identical spec across app-core, the error-guard templates, and tracker.
 */
export function scrubMessage(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '';
  return redact(raw.slice(0, MSG_PRECAP)).slice(0, MSG_MAXLEN);
}

/**
 * Same redaction as scrubMessage but with a caller-chosen final cap — for fields that are
 * legitimately longer than an error message (the componentStack, cap 1000). Pre-caps at 3×cap
 * to bound regex work before the final slice.
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
 * Maps EXACTLY the allowlisted fields — never `record.data` or `record.context`
 * query/response; `error.message` only as scrubbed `err_msg`. The transport stamps `_time`
 * at enqueue and enriches app/env/ver/sess + acc/usr/obj/board at flush.
 */
export function mapRecordToEvent(record: LogRecord): AxiomEventInput {
  const r = record || ({} as LogRecord);
  const ev: AxiomEventInput = {
    level: String(r.level ?? '').toLowerCase(),
    tag: String(r.module || 'app').toLowerCase(),
    message: r.message, // stable English event id; transport truncates at 300
    kind: String(r.kind ?? 'error'), // domain discriminator: error (default) | usage | health
  };
  if (r.correlationId != null) ev.corr = String(r.correlationId);
  const err = r.error as { name?: unknown; errorCode?: unknown; status?: unknown; code?: unknown; stack?: unknown; message?: unknown } | undefined;
  if (err != null && typeof err === 'object') {
    if (err.name != null) ev.err_name = String(err.name);
    const code = err.errorCode ?? err.status ?? err.code; // MondayApiError.errorCode / HTTP status
    if (code != null) ev.err_code = String(code);
    const stack1 = firstStackFrame(err.stack);
    if (stack1 !== undefined) ev.stack1 = stack1; // transport truncates at 400
    // Extended stack (fix 3): top-5 frames, each scrubbed via scrubMessage, joined by newline,
    // total cap 1500. Shipped IN ADDITION to stack1 (which stays the single-frame query field).
    const frames = topFrames(err.stack, 5);
    if (frames.length > 0) ev.stack = frames.map((f) => scrubMessage(f)).join('\n').slice(0, STACK_MAXLEN);
    if (typeof err.message === 'string' && err.message !== '') ev.err_msg = scrubMessage(err.message); // scrubbed (D2)
  }
  const ctx = r.context;
  if (ctx != null && typeof ctx === 'object') {
    const c = ctx as { duration?: unknown; totalMs?: unknown; step?: unknown; componentStack?: unknown };
    if (typeof c.duration === 'number' && Number.isFinite(c.duration)) ev.ms = c.duration;
    if (typeof c.totalMs === 'number' && Number.isFinite(c.totalMs)) ev.total_ms = c.totalMs;
    if (typeof c.step === 'number' && Number.isFinite(c.step)) ev.step = c.step;
    // React componentStack (fix 3): scrubbed, cap 1000. Only when the record carries it — so
    // ordinary error records never gain the key.
    if (typeof c.componentStack === 'string' && c.componentStack !== '') {
      ev.component_stack = scrubCapped(c.componentStack, COMPONENT_STACK_MAXLEN);
    }
  }
  // Guarantee an err_name on every ERROR event (discussions Change #149, generalised here
  // when that app migrated off its vendored sink): real Errors keep err.name; otherwise fall
  // back to the stable message event-id, then the tag, so nothing ships nameless — the
  // telemetry dashboard groups and drills down by err_name, and fix-5's dedup key reads it.
  // Interim safety net; the goal is still a real Error per throw at the call sites.
  // Both candidates are trimmed: a whitespace-only name groups no better than a missing
  // one, so it must fall through to 'unknown' rather than ship as ' '.
  // (err_name comes off the `[key: string]: unknown` index signature — narrow before use.)
  const existingName = typeof ev.err_name === 'string' ? ev.err_name : '';
  if (ev.kind === 'error' && existingName.trim() === '') {
    const msg = typeof ev.message === 'string' ? ev.message.trim() : '';
    const tag = typeof ev.tag === 'string' ? ev.tag.trim() : '';
    ev.err_name = msg || tag || 'unknown';
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

  // Check the attach guard BEFORE building the transport. createAxiomBrowserTransport
  // disposes any transport already registered for this app, so a second attach that
  // reached the constructor would tear down the live transport and then hit the guard and
  // no-op — orphaning the new transport and leaving activeTransport on a dead handle.
  // Bailing out here keeps the first, live transport intact.
  const g: { __AXIS_AXIOM_SINK_ATTACHED__?: boolean } =
    typeof globalThis !== 'undefined' ? (globalThis as typeof g) : {};
  if (g.__AXIS_AXIOM_SINK_ATTACHED__) return () => {}; // survives HMR module re-eval

  let transport: AxiomTransport | null = options.transport ?? null;
  const ownsTransport = transport === null; // true iff WE construct it below (never dispose a borrowed one)
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

  g.__AXIS_AXIOM_SINK_ATTACHED__ = true; // set once we own a transport, before replay

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
    (window as unknown as { getAxiomStats?: unknown }).getAxiomStats = getAxiomStats;
  }

  return () => {
    unsubscribe();
    // Only dispose a transport WE constructed — never a borrowed one injected via options.transport
    // (a shared/test seam whose lifecycle the caller owns).
    if (ownsTransport) transport!.dispose(); // stop flush timer + visibility/pagehide listeners; deregister REG[app]
    g.__AXIS_AXIOM_SINK_ATTACHED__ = false;
    if (activeTransport === transport) activeTransport = null;
  };
}

/**
 * The active transport's live stats, or an inert `{ enabled: false }` when no sink is
 * attached. Exposed as a named export (parity with the `window.getAxiomStats` operator
 * surface) so callers can read droppedShipFailure / droppedQueue / breakerState directly.
 */
export function getAxiomStats(): AxiomTransportStats | { enabled: false } {
  return activeTransport?.stats() ?? { enabled: false };
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
 * True once `attachAxiomSink` has attached an active transport (prod build with a
 * dataset + token present). Gates optional identity-resolution API calls so telemetry
 * never costs an API round-trip when the sink is structurally inert (dev / tunnel / tests).
 */
export function isAxiomSinkActive(): boolean {
  return activeTransport !== null;
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
