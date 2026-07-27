// SYNCED COPY ג€” canonical source: .claude/skills/error-guard/templates/. Fix defects THERE first (error-guard SKILL.md ֲ§Self-correction rule 4), then re-sync consumers.
/**
 * axiomErrorSink.js ג€” bridges logger.js records into the Axiom browser transport
 * (direct ingest into the SHARED errors dataset ג€” see error-guard
 * references/remote-monitoring.md for the one-time Axiom setup and wiring runbook).
 *
 * Generalized from the Tracker sink (Axis/tracker/src/utils/axiomSink.js, 25/25
 * tests green there). Differences from Tracker: activation reads generic env vars
 * (VITE_AXIOM_APP for the app slug ג€” the shared-dataset discriminator), and the
 * Tracker-specific init-lifecycle INFO branch is dropped (default policy here is
 * WARN/ERROR only).
 *
 * Activation gate truth table: ships ONLY when import.meta.env.PROD === true AND
 * VITE_AXIOM_DATASET / VITE_AXIOM_TOKEN / VITE_AXIOM_APP are all baked into the
 * bundle (.env.production.local ג€” never committed). Dev server, tunnel, and vitest
 * are structurally inert ג€” the module transport is null and attachAxiomSink()
 * degrades to a no-op.
 *
 * PRIVACY: the sink NEVER copies record.data, context.query/variables/response/
 * rawResponse, or any Hebrew userMessage. error.message ships ONLY scrubbed, as
 * err_msg (scrubMessage: emails / tokens&hex>=16 / digit-runs>=7 redacted, capped
 * 200) ג€” the raw message is never handed over; the transport's exact-key allowlist
 * backstops it. What ships per error: level, tag (module), message (stable English
 * event id), kind (domain discriminator), corr, err_name, err_code, err_msg
 * (scrubbed), first stack frame, and numeric timings.
 *
 * ESLint: no-console must be OFF for this file (standard sink-file exemption) ג€”
 * the console.error breadcrumbs are the operator surface and must never re-enter
 * the logger (recursion hazard).
 */
/* global globalThis */
import { createAxiomBrowserTransport } from './axiomBrowserTransport';
import logger from './logger';

// Rank table ג€” DEBUG < INFO < WARN < ERROR
const RANK = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

// ============================================
// Gate + transport construction (module scope)
// ============================================

const DATASET = import.meta.env.VITE_AXIOM_DATASET;
const TOKEN = import.meta.env.VITE_AXIOM_TOKEN;
const APP = import.meta.env.VITE_AXIOM_APP;
const ACTIVE = import.meta.env.PROD === true && Boolean(DATASET) && Boolean(TOKEN) && Boolean(APP);

const REMOTE_LEVEL_KEY = `${APP ?? 'app'}:remoteLogLevel`;

let transport = null;
if (ACTIVE) {
    try {
        transport = createAxiomBrowserTransport({
            dataset: DATASET,
            token: TOKEN,
            app: APP,
            appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0',
            environment: import.meta.env.VITE_AXIOM_ENV ?? 'production',
        });
    } catch (e) {
        // one breadcrumb, then the sink degrades to a permanent no-op ג€” the app never pays
        console.error('[axiom-sink] init failed ג€” remote logging disabled for this session:', e);
        transport = null;
    }
}

// Incident mode: remote level read ONCE at module load so it survives reload.
let remoteLevel = null;
try {
    if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(REMOTE_LEVEL_KEY);
        if (saved !== null && RANK[saved] !== undefined) {
            remoteLevel = saved;
        }
    }
} catch {
    // localStorage unavailable (privacy mode / sandboxed iframe) ג€” default policy
}

// ============================================
// shouldShip(record, remoteLevel) ג€” pure function (unit-test seam)
// ============================================

/**
 * Duplicate FIRST (logger.js already withholds duplicates from sinks ג€” kept as one
 * cheap line), then alwaysShip (usage/health INFO records bypass the level policy,
 * D3/D5), then the level policy: ERROR/WARN ship, everything else stays local.
 * Incident mode (setRemoteLevel) overrides with a pure rank comparison.
 *
 * @param {Object} record - logger.js record ({level, module, message, kind, alwaysShip, ...})
 * @param {string|null} [remoteLevel] - incident override; ship iff rank(level) >= rank(remoteLevel)
 * @returns {boolean}
 */
export function shouldShip(record, remoteLevel) {
    if (!record) return false;
    if (record.duplicate === true) return false;   // duplicates never ship (checked first)
    if (record.alwaysShip === true) return true;    // usage/health (INFO) bypass the level policy (D3/D5)
    const rank = RANK[String(record.level ?? '').toUpperCase()];
    const remoteRank = remoteLevel != null ? RANK[String(remoteLevel).toUpperCase()] : undefined;
    if (remoteRank !== undefined) {
        // incident mode: pure rank comparison
        if (rank === undefined || rank < remoteRank) return false;
    } else if (rank !== RANK.ERROR && rank !== RANK.WARN) {
        return false; // default policy: only ERROR/WARN ship
    }
    return true;
}

// ============================================
// mapRecordToEvent(record) ג€” pure function (unit-test seam)
// ============================================

/**
 * First stack-frame line. Prefers V8 frames (`/^\s*at /`); falls back to a real
 * Firefox/Safari `name@url:line[:col]` frame ג€” anchored, with NO space before '@'
 * and a trailing `:line[:col]`. A prose message that merely contains '@' (an email)
 * has whitespace before the '@', so even one that happens to end in ':<digits>'
 * (a status code / port / timestamp) can never be mistaken for a frame and leak
 * error.message content into stack1 (the app-core 0.1 privacy fix).
 */
function firstStackFrame(stack) {
    if (typeof stack !== 'string' || stack === '') return undefined;
    let sigilLine;
    for (const line of stack.split('\n')) {
        if (/^\s*at /.test(line)) return line.trim();
        // Anchored frame shape: `name@url:line[:col]`, no whitespace before '@' or in the url.
        if (sigilLine === undefined && /^\s*\S*@\S+:\d+(?::\d+)?\s*$/.test(line)) sigilLine = line;
    }
    return sigilLine === undefined ? undefined : sigilLine.trim();
}

// ============================================
// scrubMessage ג€” privacy-scrub error.message before it ships as err_msg (D2)
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
 * slice 200. Accepted trade-off: redacts a rare 16+ char all-letter word. Identical spec across
 * app-core, this template, and tracker (which imports it from app-core to avoid drift).
 *
 * @param {*} raw - error.message (any type; non-strings return '')
 * @returns {string}
 */
export function scrubMessage(raw) {
    if (typeof raw !== 'string' || raw === '') return '';
    let s = raw.slice(0, MSG_PRECAP);
    s = s.replace(EMAIL_RE, '[email]');
    s = s.replace(TOKEN_RE, '[redacted]');
    s = s.replace(DIGITS_RE, '[num]');
    return s.slice(0, MSG_MAXLEN);
}

/**
 * Mapping table ג€” EXACTLY these fields, nothing else. The transport stamps `_time`
 * at enqueue and enriches app/env/ver/sess + acc/usr/obj/board at flush.
 *
 * @param {Object} record - logger.js record
 * @returns {Object} flat envelope for transport.enqueue
 */
export function mapRecordToEvent(record) {
    const r = record || {};
    const ev = {
        level: String(r.level ?? '').toLowerCase(),
        tag: String(r.module || 'app').toLowerCase(),
        message: r.message, // as-is (stable English event id); transport truncates
    };
    // DOMAIN discriminator (matches the transport allowlist + app-core): error (default) |
    // usage | health. track()/health() set record.domainKind; NEVER ship the rendering `kind`.
    ev.kind = r.domainKind ?? 'error';
    if (r.correlationId != null) ev.corr = String(r.correlationId);  // key OMITTED when absent
    const err = r.error;
    if (err != null) {
        if (err.name != null) ev.err_name = err.name;
        const code = err.errorCode ?? err.status ?? err.code;        // MondayApiError.errorCode / HTTP status
        if (code != null) ev.err_code = String(code);
        const stack1 = firstStackFrame(err.stack);
        if (stack1 !== undefined) ev.stack1 = stack1;                // transport truncates
        // error.message ships ONLY scrubbed, as err_msg (D2) ג€” the raw message is never handed over
        if (typeof err.message === 'string' && err.message !== '') ev.err_msg = scrubMessage(err.message);
    }
    const ctx = r.context;
    if (ctx != null && typeof ctx === 'object') {
        // `ms` matches the status-hub vocabulary; total_ms stays separate
        // (one field must not carry two meanings)
        if (typeof ctx.duration === 'number' && Number.isFinite(ctx.duration)) ev.ms = ctx.duration;
        if (typeof ctx.totalMs === 'number' && Number.isFinite(ctx.totalMs)) ev.total_ms = ctx.totalMs;
        if (typeof ctx.step === 'number' && Number.isFinite(ctx.step)) ev.step = ctx.step;
    }
    return ev;
}

// ============================================
// attachAxiomSink ג€” registration + ring-buffer replay
// ============================================

/**
 * The sink fn: shouldShip (live remoteLevel) ג†’ mapRecordToEvent ג†’ t.enqueue, all
 * try/catched ג€” one console.error breadcrumb on internal failure, NEVER re-enters
 * the logger (recursion hazard).
 */
function makeSink(t) {
    return (record) => {
        try {
            if (!shouldShip(record, remoteLevel)) return;
            t.enqueue(mapRecordToEvent(record));
        } catch (e) {
            console.error('[axiom-sink] failed to ship a record (suppressed):', e);
        }
    };
}

/**
 * Register the Axiom sink on the logger. MUST run synchronously during initial
 * module evaluation in the app entry, BEFORE createRoot(...).render ג€” the ring
 * buffer at that instant holds only import-time records, and there is no async gap
 * in which a record could be emitted between replay and addSink (no double-ship).
 *
 * @param {Object} [seams] - test seams; production callers pass nothing
 * @param {Object} [seams.log] - logger (default: the real module logger)
 * @param {Object} [seams.t] - transport (default: the module transport, null when gated off)
 * @returns {function():void} unsubscribe (no-op when gated off / already attached)
 */
export function attachAxiomSink({ log = logger, t = transport } = {}) {
    if (!t) return () => {};
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    if (g.__ERROR_GUARD_AXIOM_SINK_ATTACHED__) return () => {};   // survives HMR module re-eval
    g.__ERROR_GUARD_AXIOM_SINK_ATTACHED__ = true;                  // set BEFORE replay
    const sink = makeSink(t);
    // replay ג€” ships import-time ERROR/WARN records, respecting shouldShip
    // (pre-attach DEBUG never ships) and duplicate:true (buffer keeps them)
    for (const rec of log.getBuffer()) sink(rec);
    return log.addSink(sink);
}

// ============================================
// Context capture + window debug surface
// ============================================

/**
 * Merge monday iframe identity into every future envelope. Raw values pass
 * through ג€” the transport String-coerces, drops undefined (merge semantics allow
 * a late accountId), and caps field length. Call once the monday SDK context loads:
 *   setAxiomContext({ accountId, userId, boardId, instanceId })
 *
 * @param {Object} [ids]
 * @param {string|number} [ids.accountId]
 * @param {string|number} [ids.userId]
 * @param {string|number} [ids.boardId]
 * @param {string|number} [ids.instanceId]
 * @param {Object} [seams] - test seam; production callers pass nothing
 */
export function setAxiomContext({ accountId, userId, boardId, instanceId } = {}, { t = transport } = {}) {
    t?.setContext({ acc: accountId, usr: userId, obj: instanceId ?? boardId, board: boardId });
}

/** True only when the activation gate passed AND the transport constructed. */
export function isAxiomSinkActive() {
    return ACTIVE && Boolean(transport);
}

/**
 * Incident mode: override the default ship policy at runtime.
 * setRemoteLevel('DEBUG') ships everything; persists across reload via
 * localStorage; setRemoteLevel(null) clears and restores the default policy.
 */
function setRemoteLevel(level) {
    if (level === null || level === undefined) {
        remoteLevel = null;
        try {
            localStorage.removeItem(REMOTE_LEVEL_KEY);
        } catch {
            // localStorage unavailable ג€” live var still cleared
        }
        return null;
    }
    const up = String(level).toUpperCase();
    if (RANK[up] === undefined) {
        console.error(`[axiom-sink] invalid remote level '${level}' ג€” use DEBUG | INFO | WARN | ERROR or null`);
        return remoteLevel;
    }
    remoteLevel = up;
    try {
        localStorage.setItem(REMOTE_LEVEL_KEY, up);
    } catch {
        // localStorage unavailable ג€” incident mode won't survive reload, still live now
    }
    return remoteLevel;
}

// Operator surface ג€” siblings of logger.js's flat window fns (those gate console
// only; these gate the remote sink). Registered only in a browser-like environment.
if (typeof window !== 'undefined') {
    window.setRemoteLevel = setRemoteLevel;
    window.getAxiomStats = () => transport?.stats() ?? { enabled: false };
}

