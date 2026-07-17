// SYNCED COPY — canonical source: .claude/skills/error-guard/templates/. Fix defects THERE first (error-guard SKILL.md §Self-correction rule 4), then re-sync consumers.
/**
 * axiomBrowserTransport.js — browser log transport for direct Axiom ingest.
 *
 * Plain-JS generalization of the Axis transport (`Axis/Services/axis-app-core/src/
 * axiomTransport.ts`, 44/44 tests green there). Logic is a faithful port; only the
 * TypeScript types were stripped. If a defect is found here, check whether the TS
 * original shares it and fix both (error-guard SKILL.md §Self-correction, rule 4).
 *
 * Structural constraints (load-bearing):
 * - NO React imports, NO `import.meta` anywhere — env is injected by the consumer
 *   (the activation gate lives in the consumer's sink, see axiomErrorSink.js).
 * - Real globals (fetch/window/document) are referenced ONLY as guarded defaults
 *   for the injectable seams (`fetchFn`/`win`/`doc`) — so the transport is fully
 *   testable in plain Node.
 * - `enqueue`/`flush` never throw to the caller. Every ship failure emits exactly
 *   one console.error starting '[axiom-transport] '.
 *
 * Event input contract: FLAT objects — strings + finite numbers only (the sanitizer
 * enforces an exact-key allowlist; everything else is dropped, never shipped).
 */

const DEFAULT_CAPS = {
  batchMaxEvents: 20,
  batchMaxBytes: 60_000,     // keepalive 64KB budget headroom
  flushIntervalMs: 5_000,
  queueMax: 100,             // drop-oldest
  dedupWindowMs: 60_000,     // FIXED window
  dedupMaxPerWindow: 5,
  sessionShipMax: 300,
  breakerFailureThreshold: 3,
  breakerOpenMs: 60_000,
  messageMaxLen: 300,
  stackMaxLen: 400,
  fieldMaxLen: 128,
  numericExtrasMax: 12,
};

const DEFAULT_ENDPOINT = 'https://api.axiom.co/v1/datasets';
const DEDUP_MAP_MAX = 500;
const KIND_MAX_LEN = 32;
const ERR_MSG_MAX_LEN = 200; // scrubbed error.message (see axiomErrorSink.js scrubMessage)

// Deny substring on every non-allowlisted key, regardless of value type.
const DENY_RE = /(name|title|summary|text|label|email|token|secret|password)/i;
// Numeric-extra key shape.
const NUM_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
// Transport-owned envelope fields: caller-supplied values for these are dropped.
const TRANSPORT_OWNED = new Set(['app', 'env', 'ver', 'sess', '_time']);

// UTF-8 byte length when TextEncoder exists (guarded default), else string length.
const ENC = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
function byteLen(s) {
  return ENC ? ENC.encode(s).length : s.length;
}

function crumb(msg) {
  try {
    // eslint-disable-next-line no-console
    console.error('[axiom-transport] ' + msg);
  } catch {
    /* never re-enters any logger, never throws */
  }
}

/** Exact-key allowlist with per-key caps derived from the active caps. */
function buildAllowlist(caps) {
  const allow = Object.create(null);
  const f = caps.fieldMaxLen;
  allow.level = f;
  allow.tag = f;
  allow.message = caps.messageMaxLen;
  allow.acc = f;
  allow.usr = f;
  allow.obj = f;
  allow.board = f;
  allow.corr = f;
  allow.kind = KIND_MAX_LEN;
  allow.err_name = f;
  allow.err_code = f;
  allow.err_msg = ERR_MSG_MAX_LEN;
  allow.stack1 = caps.stackMaxLen;
  return allow;
}

/**
 * Sanitizer — ONE precedence rule, applied per key of the flat input:
 * 1. exact-key allowlist wins (String(v).slice(0, cap)); transport-owned keys dropped;
 * 2. deny substring drops everything else regardless of value type;
 * 3. remaining finite-number keys pass (key regex, max N numeric extras, NaN/±Infinity drop);
 * 4. all else drops. Output on a null-prototype object (__proto__/constructor inert).
 */
function sanitize(input, caps, allow) {
  const out = Object.create(null);
  let numericExtras = 0;
  for (const key of Object.keys(Object(input))) {
    if (TRANSPORT_OWNED.has(key)) continue;                 // transport-owned — caller-supplied dropped
    const cap = allow[key];                                  // null-proto map: no prototype leakage
    if (cap !== undefined) {
      const v = input[key];
      if (v === undefined || v === null) continue;
      out[key] = String(v).slice(0, cap);
      continue;
    }
    if (DENY_RE.test(key)) continue;                         // deny beats value type (numeric emailCount drops)
    const v = input[key];
    if (
      typeof v === 'number' &&
      Number.isFinite(v) &&
      NUM_KEY_RE.test(key) &&
      numericExtras < caps.numericExtrasMax
    ) {
      out[key] = v;
      numericExtras++;
      continue;
    }
    // rule 4: objects, arrays, Errors, functions, symbols, booleans, null/undefined — dropped
  }
  return out;
}

// HMR/StrictMode idempotency — dispose-and-replace registry keyed by options.app.
const REG = new Map();

/**
 * @param {Object} options
 * @param {string} options.dataset - Axiom dataset (the shared errors dataset)
 * @param {string} options.token - ingest-only Axiom token
 * @param {string} options.app - app slug, stamped on every event (the shared-dataset discriminator)
 * @param {string} [options.appVersion] - e.g. __APP_VERSION__ injected by the consumer
 * @param {string} [options.environment] - consumer passes VITE_AXIOM_ENV ?? 'production'
 * @param {string} [options.endpoint] - default api.axiom.co — the proxy-pivot knob
 * @param {Object} [options.caps] - partial cap overrides
 * @param {Function} [options.fetchFn] - test seam (defaults to global fetch)
 * @param {Object} [options.win] - test seam (defaults to window)
 * @param {Object} [options.doc] - test seam (defaults to document)
 * @returns {{enqueue: Function, setContext: Function, flush: Function, stats: Function, dispose: Function}}
 */
export function createAxiomBrowserTransport(options) {
  const caps = { ...DEFAULT_CAPS, ...(options.caps ?? {}) };
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;

  // Seams: injected first, real globals only as guarded defaults.
  const fetchFn =
    options.fetchFn ??
    (typeof fetch === 'function' ? (url, init) => fetch(url, init) : undefined);
  const win = options.win ?? (typeof window !== 'undefined' ? window : undefined);
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : undefined);

  // Defensive inert gate: empty dataset/token, or no usable fetch/window in a
  // non-injected environment → inert handle. No registry interaction, zero listeners.
  if (!options.dataset || !options.token || !fetchFn || !win || !doc) {
    return {
      enqueue() {},
      setContext() {},
      flush() {},
      stats() {
        return {
          enabled: false,
          queued: 0,
          shipped: 0,
          droppedQueue: 0,
          droppedDedup: 0,
          droppedSessionCap: 0,
          breakerState: 'closed',
          consecutiveFailures: 0,
        };
      },
      dispose() {},
    };
  }

  // Dispose-and-replace: a Vite HMR re-eval never leaves stale listeners/timers,
  // and fresh options always win.
  REG.get(options.app)?.dispose();

  const app = options.app;
  const env = options.environment ?? 'production';
  const ver = options.appVersion ?? '0.0.0';
  const token = options.token;
  const url = `${endpoint}/${options.dataset}/ingest`;
  const sess = Math.random().toString(36).slice(2, 10);      // per instance (per page load)
  const allow = buildAllowlist(caps);

  const queue = [];
  const dedup = new Map();
  const context = Object.create(null);

  let disposed = false;
  let timerId = null;
  let shipped = 0;
  let droppedQueue = 0;
  let droppedDedup = 0;
  let droppedSessionCap = 0;
  let breakerState = 'closed';
  let consecutiveFailures = 0;
  let openedAt = 0;
  let capMetaSent = false;
  let inFlight = false;
  let probeInFlight = false;

  function clearTimer() {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  /** Batch-assembly enrichment: context applied FIRST, event fields win on
   *  collision, transport statics last (spread order is load-bearing). */
  function envelope(ev) {
    return { ...context, ...ev, app, env, ver, sess };
  }

  /** Cut the oldest events from the queue into one batch (≤batchMaxEvents, ≤batchMaxBytes). */
  function cutBatchFront() {
    const parts = [];
    let size = 2; // '[' + ']'
    while (queue.length > 0 && parts.length < caps.batchMaxEvents) {
      const piece = JSON.stringify(envelope(queue[0]));
      const extra = byteLen(piece) + (parts.length > 0 ? 1 : 0);
      if (parts.length > 0 && size + extra > caps.batchMaxBytes) break;
      queue.shift();
      parts.push(piece);
      size += extra;
    }
    return { body: '[' + parts.join(',') + ']', count: parts.length };
  }

  /** Hidden path: single POST ≤batchMaxBytes carrying the NEWEST events,
   *  chronological order preserved; overflow dropped + counted; no chaining. */
  function cutBatchHidden() {
    const parts = [];
    let size = 2;
    let taken = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
      const piece = JSON.stringify(envelope(queue[i]));
      const extra = byteLen(piece) + (taken > 0 ? 1 : 0);
      if (taken > 0 && size + extra > caps.batchMaxBytes) break;
      parts.unshift(piece);
      size += extra;
      taken++;
    }
    droppedQueue += queue.length - taken;
    queue.length = 0;
    return { body: '[' + parts.join(',') + ']', count: taken };
  }

  /** One POST. At-most-once: the batch was already cut from the queue and is never
   *  re-queued. Returns success. Every failure → exactly one console.error breadcrumb. */
  async function ship(body, count, keepalive) {
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body,
    };
    if (keepalive) init.keepalive = true;   // keepalive ONLY on 'hidden' flushes
    let failMsg;
    try {
      const res = await fetchFn(url, init);
      if (res && res.ok) {
        shipped += count;
        consecutiveFailures = 0;
        return true;
      }
      failMsg = `ship failed: HTTP ${res ? res.status : 'unknown'}`;
    } catch (e) {
      failMsg = `ship failed: ${String(e)}`;
    }
    consecutiveFailures++;
    if (breakerState !== 'open' && consecutiveFailures >= caps.breakerFailureThreshold) {
      breakerState = 'open';
      openedAt = Date.now();
      failMsg += `; circuit open ${Math.round(caps.breakerOpenMs / 1000)}s after ${consecutiveFailures} consecutive failures`;
    }
    crumb(failMsg);
    return false;
  }

  async function doFlush(reason) {
    if (disposed || queue.length === 0) return;

    // Circuit breaker: open → no-op until the 60s window elapses, then half-open.
    if (breakerState === 'open') {
      if (Date.now() - openedAt < caps.breakerOpenMs) return;   // zero fetch while open
      breakerState = 'half-open';
    }

    if (breakerState === 'half-open') {
      if (probeInFlight) return;                                // concurrent triggers don't double-send
      probeInFlight = true;
      try {
        const openMs = Date.now() - openedAt;
        const { body, count } = cutBatchFront();                // exactly ONE probe batch
        if (count === 0) return;
        const ok = await ship(body, count, reason === 'hidden');
        if (ok) {
          breakerState = 'closed';
          consecutiveFailures = 0;
          // once per open→closed transition
          enqueueEvent({ level: 'warn', tag: 'transport', message: 'transport_recovered', open_ms: openMs }, true);
        } else {
          breakerState = 'open';                                // fresh 60s window
          openedAt = Date.now();
        }
      } finally {
        probeInFlight = false;
      }
      return;
    }

    // closed — the terminal hidden flush must NOT be starved by an in-flight routine
    // drain: cutBatchHidden() empties the queue synchronously, so running alongside
    // the drain is safe — the drain loop re-checks queue.length after its await.
    if (reason === 'hidden') {
      const { body, count } = cutBatchHidden();                 // at most ONE keepalive POST
      if (count > 0) await ship(body, count, true);
      return;
    }
    if (inFlight) return;                                       // the running drain re-checks the queue
    inFlight = true;
    try {
      // routine path: leftovers chain follow-up POSTs
      while (queue.length > 0 && breakerState === 'closed' && !disposed) {
        const { body, count } = cutBatchFront();
        if (count === 0) break;
        await ship(body, count, false);                         // failed batches discarded (at-most-once)
      }
    } finally {
      inFlight = false;
    }
  }

  function flushNow(reason) {
    if (disposed) return;
    void doFlush(reason).catch((e) => crumb(`flush error: ${String(e)}`));
  }

  /**
   * Enqueue pipeline (order is contractual): disposed→drop · sanitize + stamp `_time`
   * at enqueue · dedup (fixed window, transport-tag bypass, bounded map) · session cap
   * (exactly-once events_dropped meta, meta bypasses the cap) · queue cap drop-oldest ·
   * schedule.
   */
  function enqueueEvent(input, meta) {
    if (disposed) return;
    const ev = sanitize(input, caps, allow);
    ev._time = new Date().toISOString();                        // stamped at enqueue time

    const tag = typeof ev.tag === 'string' ? ev.tag : '';
    if (tag !== 'transport') {                                  // transport meta events bypass dedup
      const key = `${String(ev.level ?? '')}|${tag}|${String(ev.message ?? '')}`;
      const now = Date.now();
      let entry = dedup.get(key);
      if (!entry || now - entry.windowStart >= caps.dedupWindowMs) {
        if (!dedup.has(key) && dedup.size >= DEDUP_MAP_MAX) dedup.clear();  // bounded map
        entry = { count: 0, windowStart: now };
        dedup.set(key, entry);
      }
      if (entry.count >= caps.dedupMaxPerWindow) {
        droppedDedup++;
        return;
      }
      entry.count++;
    }

    if (!meta && shipped >= caps.sessionShipMax) {              // session cap — meta bypasses it
      droppedSessionCap++;
      if (!capMetaSent) {                                       // exactly once per session
        capMetaSent = true;
        enqueueEvent(
          { level: 'warn', tag: 'transport', message: 'events_dropped', dropped: droppedSessionCap },
          true
        );
      }
      return;
    }

    queue.push(ev);
    while (queue.length > caps.queueMax) {                      // drop-oldest
      queue.shift();
      droppedQueue++;
    }

    if (queue.length >= caps.batchMaxEvents) {                  // full batch → immediate flush
      clearTimer();
      flushNow('size');
    } else if (timerId === null) {                              // timer armed on first enqueue
      timerId = setTimeout(() => {
        timerId = null;
        flushNow('timer');
      }, caps.flushIntervalMs);
    }
  }

  // Lifecycle listeners: visibilitychange(hidden) + pagehide → flush('hidden').
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') flushNow('hidden');
  };
  const onPageHide = () => {
    flushNow('hidden');
  };
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', onPageHide);

  const handle = {
    enqueue(event) {
      try {
        enqueueEvent(event, false);
      } catch {
        /* never throws to the caller */
      }
    },

    /** Merge iframe identity (acc/usr/obj/board) into every future envelope. */
    setContext(ctx) {
      if (disposed || !ctx) return;
      try {
        for (const k of ['acc', 'usr', 'obj', 'board']) {
          const v = ctx[k];
          if (v === undefined || v === null) continue;          // merge semantics: undefined never clobbers
          context[k] = String(v).slice(0, caps.fieldMaxLen);
        }
      } catch {
        /* never throws */
      }
    },

    flush(reason) {
      flushNow(reason ?? 'manual');
    },

    stats() {
      return {
        enabled: true,
        queued: queue.length,
        shipped,
        droppedQueue,
        droppedDedup,
        droppedSessionCap,
        breakerState,
        consecutiveFailures,
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      try {
        doc.removeEventListener('visibilitychange', onVisibility);
      } catch {
        /* ignore */
      }
      try {
        win.removeEventListener('pagehide', onPageHide);
      } catch {
        /* ignore */
      }
      queue.length = 0;
      if (REG.get(app) === handle) REG.delete(app);
    },
  };

  REG.set(app, handle);
  return handle;
}
