/**
 * axiomSink.js — Tracker's Axiom sink: bridges logger.js records into the shared
 * @axis/app-core browser transport (direct Axiom ingest into `axis-prod`).
 *
 * Normative spec: Axis/TRACKER-AXIOM-EXECUTION-PLAN.md §4 —
 *   §4.1 activation gate + transport construction (module scope)
 *   §4.2 shouldShip — level policy FIRST, duplicate second (order is contractual)
 *   §4.3 mapRecordToEvent — the full record→envelope mapping table; the sink NEVER
 *        copies record.data, context.query/variables/response/rawResponse,
 *        error.message, or any Hebrew userMessage (the transport allowlist would
 *        drop them anyway — defense in depth)
 *   §4.4 attachAxiomSink — globalThis HMR guard + ring-buffer replay (ships the
 *        import-time initDone step 1 'Bundle loaded', logger.js:647)
 *   §4.5 setAxiomContext + window debug surface (setRemoteLevel / getAxiomStats)
 *
 * Activation gate (§3.4 truth table): ships ONLY when import.meta.env.PROD === true
 * AND both VITE_AXIOM_DATASET / VITE_AXIOM_TOKEN are baked into the bundle
 * (.env.production.local). Dev server, tunnel, and vitest are structurally inert —
 * the module transport is null and attachAxiomSink() degrades to a no-op.
 *
 * logger.js is NOT edited (713 lines, test-locked). Its legacy flush(url) unload
 * path stays a documented no-op: sendBeacon cannot carry an Authorization header,
 * so it can never target Axiom directly — the transport's own pagehide/
 * visibilitychange keepalive flush replaces it.
 *
 * ESLint: no-console is intentionally OFF for this file (package.json overrides) —
 * the console.error breadcrumbs below are the operator surface and must never
 * re-enter the logger (recursion hazard).
 */
/* global globalThis */
import { createAxiomBrowserTransport, scrubMessage } from '@axis/app-core';
import logger from './logger';

// §4.2 rank table — DEBUG < INFO < WARN < ERROR
const RANK = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const REMOTE_LEVEL_KEY = 'axis:remoteLogLevel';

// Tracker's rendering `kind` → the unified DOMAIN discriminator shipped as ev.kind
// (matches @axis/app-core: error | usage | health). Boot-lifecycle renders are health;
// everything else defaults to 'error'. track()/health() set record.domainKind directly.
const RENDER_TO_DOMAIN = { init: 'health', initSummary: 'health' };

// ============================================
// §4.1 — gate + transport construction (module scope)
// ============================================

const DATASET = import.meta.env.VITE_AXIOM_DATASET;
const TOKEN = import.meta.env.VITE_AXIOM_TOKEN;
const ACTIVE = import.meta.env.PROD === true && Boolean(DATASET) && Boolean(TOKEN);

let transport = null;
if (ACTIVE) {
    try {
        transport = createAxiomBrowserTransport({
            dataset: DATASET,
            token: TOKEN,
            app: 'tracker',
            // Version layer: semver + build SHA (e.g. "2.1.0+a1b2c3f") — the SHA
            // keeps the exact-commit traceability the old hash-only stamp had.
            appVersion:
                (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0') +
                (typeof __BUILD_SHA__ !== 'undefined' ? `+${__BUILD_SHA__.slice(0, 7)}` : ''),
            environment: import.meta.env.VITE_AXIOM_ENV ?? 'production',
        });
    } catch (e) {
        // one breadcrumb, then the sink degrades to a permanent no-op — the app never pays
        console.error('[axiom-sink] init failed — remote logging disabled for this session:', e);
        transport = null;
    }
}

// Incident mode (§4.5): remote level read ONCE at module load so it survives reload.
let remoteLevel = null;
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
// §4.2 — shouldShip(record, remoteLevel) — pure function (unit-test seam)
// ============================================

/**
 * Level policy FIRST (cheapest check — logger.js has NO pre-emit gate; sinks receive
 * ALL levels including the prod DEBUG firehose from api/apiResponse/functionStart/
 * functionEnd), then duplicate:true → false (redundant defense: logger.js:346-348
 * already withholds duplicates from all sinks — kept as one cheap line).
 *
 * @param {Object} record - logger.js record ({level, module, message, kind, ...})
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
        // incident mode: pure rank comparison, kind whitelist bypassed
        if (rank === undefined || rank < remoteRank) return false;
    } else if (rank === RANK.ERROR || rank === RANK.WARN) {
        // default policy: ERROR/WARN always ship
    } else if (rank === RANK.INFO) {
        // INFO ships only for the init lifecycle — keyed off `kind`, the stable
        // discriminator, never off message text
        if (record.kind !== 'init' && record.kind !== 'initSummary') return false;
    } else {
        return false; // DEBUG (and unknown levels) never ship by default
    }
    return true;
}

// ============================================
// §4.3 — mapRecordToEvent(record) — pure function (unit-test seam)
// ============================================

/**
 * First stack-frame line. Frame lines are `/^\s*at /` (V8) or '@'-containing
 * (Safari/Firefox). V8 frames are preferred over any earlier '@'-containing line:
 * a V8 message line like "Error: mail admin@x.co bounced" contains '@' but is NOT
 * a frame — returning it would leak error.message content (on the §4.3 NEVER list).
 */
function firstStackFrame(stack) {
    if (typeof stack !== 'string' || stack === '') return undefined;
    let sigilLine;
    for (const line of stack.split('\n')) {
        if (/^\s*at /.test(line)) return line.trim();
        // Anchored Firefox/Safari frame `name@url:line[:col]` — REQUIRE no whitespace before
        // '@'. A prose message that merely contains '@' (an email), even one ending in
        // ':<digits>', is never mistaken for a frame and can never leak error.message.
        if (sigilLine === undefined && /^\s*\S*@\S+:\d+(?::\d+)?\s*$/.test(line)) sigilLine = line;
    }
    return sigilLine === undefined ? undefined : sigilLine.trim();
}

/**
 * §4.3 mapping table — EXACTLY these fields, nothing else. The transport stamps
 * `_time` at enqueue and enriches app/env/ver/sess + acc/usr/obj/board at flush.
 *
 * @param {Object} record - logger.js record
 * @returns {Object} flat envelope for transport.enqueue
 */
export function mapRecordToEvent(record) {
    const r = record || {};
    const ev = {
        level: String(r.level ?? '').toLowerCase(),
        tag: String(r.module || 'app').toLowerCase(),
        message: r.message, // as-is (stable English event id); transport truncates at 300
    };
    // DOMAIN discriminator (matches @axis/app-core): NEVER ship tracker's rendering `kind`.
    ev.kind = r.domainKind ?? RENDER_TO_DOMAIN[r.kind] ?? 'error';
    if (r.correlationId != null) ev.corr = String(r.correlationId);  // key OMITTED when absent
    const err = r.error;
    if (err != null) {
        if (err.name != null) ev.err_name = err.name;
        const code = err.errorCode ?? err.status ?? err.code;        // MondayApiError.errorCode / HTTP status
        if (code != null) ev.err_code = String(code);
        const stack1 = firstStackFrame(err.stack);
        if (stack1 !== undefined) ev.stack1 = stack1;                // transport truncates at 400
        // error.message ships ONLY scrubbed, as err_msg (D2) — single source scrubMessage from @axis/app-core
        if (typeof err.message === 'string' && err.message !== '') ev.err_msg = scrubMessage(err.message);
    }
    const ctx = r.context;
    if (ctx != null && typeof ctx === 'object') {
        // `ms` matches the unified-dataset vocabulary; total_ms stays separate
        // (one field must not carry two meanings)
        if (typeof ctx.duration === 'number' && Number.isFinite(ctx.duration)) ev.ms = ctx.duration;
        if (typeof ctx.totalMs === 'number' && Number.isFinite(ctx.totalMs)) ev.total_ms = ctx.totalMs;
        if (typeof ctx.step === 'number' && Number.isFinite(ctx.step)) ev.step = ctx.step;
    }
    return ev;
}

// ============================================
// §4.4 — attachAxiomSink — registration + ring-buffer replay
// ============================================

/**
 * The sink fn: shouldShip (live remoteLevel) → mapRecordToEvent → t.enqueue, all
 * try/catched — one console.error breadcrumb on internal failure, NEVER re-enters
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
 * module evaluation in index.jsx, BEFORE createRoot(...).render — the ring buffer
 * at that instant holds only import-time records, and there is no async gap in
 * which a record could be emitted between replay and addSink (no double-ship).
 *
 * @param {Object} [seams] - test seams; production callers pass nothing
 * @param {Object} [seams.log] - logger (default: the real module logger)
 * @param {Object} [seams.t] - transport (default: the module transport, null when gated off)
 * @returns {function():void} unsubscribe (no-op when gated off / already attached)
 */
export function attachAxiomSink({ log = logger, t = transport } = {}) {
    if (!t) return () => {};
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    if (g.__AXIS_AXIOM_SINK_ATTACHED__) return () => {};      // survives HMR module re-eval
    g.__AXIS_AXIOM_SINK_ATTACHED__ = true;                     // set BEFORE replay
    const sink = makeSink(t);
    // replay — ships initDone step 1 ('Bundle loaded', logger.js:647), respecting
    // shouldShip (pre-attach DEBUG never ships) and duplicate:true (buffer keeps them)
    for (const rec of log.getBuffer()) sink(rec);
    return log.addSink(sink);
}

// ============================================
// §4.5 — context capture + window debug surface
// ============================================

/**
 * Merge monday iframe identity into every future envelope. Raw values pass
 * through — the transport String-coerces, drops undefined (merge semantics allow
 * a late accountId), and caps field length.
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

/** True only when the §4.1 gate passed AND the transport constructed. */
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

// Operator surface — siblings of logger.js's flat window fns (those gate console
// only; these gate the remote sink). Registered only in a browser-like environment.
if (typeof window !== 'undefined') {
    window.setRemoteLevel = setRemoteLevel;
    window.getAxiomStats = () => transport?.stats() ?? { enabled: false };
}
