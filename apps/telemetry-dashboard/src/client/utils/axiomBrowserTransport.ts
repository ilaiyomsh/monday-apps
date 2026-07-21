/**
 * axiomBrowserTransport.ts — browser log transport for direct Axiom ingest.
 *
 * VENDORED verbatim from packages/error-kit/src/browser/axiomTransport.ts (the canonical
 * source, WITH its 5 hardening fixes: fix1 droppedShipFailure stat, fix2 terminal-flush
 * breaker override, fix3 extended stack + component_stack allowlist, fix5 err-aware dedup
 * key). Only the file/header name differs — telemetry-dashboard is a server (monday-code)
 * app whose client bundle cannot resolve workspace deps, so the stack is vendored, not
 * imported. Drift-tested against the canonical source by
 * packages/error-kit/test/drift.test.ts.
 *
 * Structural constraints (load-bearing):
 * - NO React imports, NO `import.meta` anywhere — env is injected by the consumer
 *   (the activation gate lives in the consumer's sink, see axiomErrorSink.ts).
 * - Real globals (fetch/window/document) are referenced ONLY as guarded defaults
 *   for the injectable seams (`fetchFn`/`win`/`doc`).
 * - `enqueue`/`flush` never throw to the caller. Every ship failure emits exactly
 *   one console.error starting '[axiom-transport] '.
 */

export interface AxiomEventInput {           // FLAT: strings + finite numbers only (sanitizer enforces)
  level: string; tag: string; message: string;
  [key: string]: unknown;                    // extras — allowlist or numeric rule, else dropped
}

export interface AxiomTransportCaps {
  batchMaxEvents: number;        // 20
  batchMaxBytes: number;         // 60_000 (keepalive 64KB budget headroom)
  flushIntervalMs: number;       // 5_000
  queueMax: number;              // 100 (drop-oldest)
  dedupWindowMs: number;         // 60_000 (FIXED window)
  dedupMaxPerWindow: number;     // 5
  sessionShipMax: number;        // 300
  breakerFailureThreshold: number; // 3
  breakerOpenMs: number;         // 60_000
  messageMaxLen: number;         // 300
  stackMaxLen: number;           // 400
  fieldMaxLen: number;           // 128
  numericExtrasMax: number;      // 12 per event
}

export interface AxiomTransportOptions {
  dataset: string; token: string; app: string;         // 'tracker'
  appVersion?: string;           // __APP_VERSION__ injected by consumer
  environment?: string;          // consumer passes VITE_AXIOM_ENV ?? 'production'
  endpoint?: string;             // default 'https://api.axiom.co/v1/datasets' — the proxy-pivot knob
  caps?: Partial<AxiomTransportCaps>;
  // test seams (default to real globals, referenced under typeof guards):
  fetchFn?: (url: string, init: { method: string; headers: Record<string, string>; body: string; keepalive?: boolean })
    => Promise<{ ok: boolean; status: number }>;
  win?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  doc?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { visibilityState?: string };
}

export interface AxiomTransportStats {
  enabled: boolean; queued: number; shipped: number;
  droppedQueue: number; droppedDedup: number; droppedSessionCap: number;
  /** Events lost because a POST failed (batch already cut from the queue, at-most-once). */
  droppedShipFailure: number;
  breakerState: 'closed' | 'open' | 'half-open'; consecutiveFailures: number;
}

export interface AxiomTransport {
  enqueue(event: AxiomEventInput): void;                                   // never throws
  setContext(ctx: Partial<Record<'acc' | 'usr' | 'obj' | 'board', string | number | undefined>>): void; // merge
  flush(reason?: 'timer' | 'size' | 'hidden' | 'manual'): void;            // fire-and-forget
  stats(): AxiomTransportStats;
  dispose(): void;                                                          // listeners off, timer cleared; enqueue after = no-op
}

type FlushReason = 'timer' | 'size' | 'hidden' | 'manual';
type FetchLike = NonNullable<AxiomTransportOptions['fetchFn']>;
type WinLike = NonNullable<AxiomTransportOptions['win']>;
type DocLike = NonNullable<AxiomTransportOptions['doc']>;

const DEFAULT_CAPS: AxiomTransportCaps = {
  batchMaxEvents: 20,
  batchMaxBytes: 60_000,
  flushIntervalMs: 5_000,
  queueMax: 100,
  dedupWindowMs: 60_000,
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
const ERR_MSG_MAX_LEN = 200; // scrubbed error.message (see axiomSink.ts scrubMessage)
const STACK_MAX_LEN = 1500;  // fix 3: extended `stack` (top 5 scrubbed frames)
const COMPONENT_STACK_MAX_LEN = 1000; // fix 3: React `component_stack`

// §3.3 rule 2 — deny substring on every non-allowlisted key, regardless of value type.
const DENY_RE = /(name|title|summary|text|label|email|token|secret|password)/i;
// §3.3 rule 3 — numeric-extra key shape.
const NUM_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
// Transport-owned envelope fields: caller-supplied values for these are dropped (§3.3 rule 1).
const TRANSPORT_OWNED = new Set(['app', 'env', 'ver', 'sess', '_time']);

// UTF-8 byte length when TextEncoder exists (guarded default), else string length.
const ENC = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
function byteLen(s: string): number {
  return ENC ? ENC.encode(s).length : s.length;
}

function crumb(msg: string): void {
  try {
    // eslint-disable-next-line no-console
    console.error('[axiom-transport] ' + msg);
  } catch {
    /* never re-enters any logger, never throws */
  }
}

/** Exact-key allowlist (§3.3 rule 1) with per-key caps derived from the active caps. */
function buildAllowlist(caps: AxiomTransportCaps): Record<string, number> {
  const allow: Record<string, number> = Object.create(null);
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
  allow.stack = STACK_MAX_LEN;             // fix 3: top-5 scrubbed frames (query compat kept via stack1)
  allow.component_stack = COMPONENT_STACK_MAX_LEN; // fix 3: React componentStack when present
  return allow;
}

/**
 * §3.3 sanitizer — ONE precedence rule, applied per key of the flat input:
 * 1. exact-key allowlist wins (String(v).slice(0, cap)); transport-owned keys dropped;
 * 2. deny substring drops everything else regardless of value type;
 * 3. remaining finite-number keys pass (key regex, max N numeric extras, NaN/±Infinity drop);
 * 4. all else drops. Output on a null-prototype object (__proto__/constructor inert).
 */
function sanitize(
  input: Record<string, unknown>,
  caps: AxiomTransportCaps,
  allow: Record<string, number>
): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
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

// HMR/StrictMode idempotency — dispose-and-replace registry keyed by options.app (§3.2, pinned by T43).
const REG = new Map<string, AxiomTransport>();

export function createAxiomBrowserTransport(options: AxiomTransportOptions): AxiomTransport {
  const caps: AxiomTransportCaps = { ...DEFAULT_CAPS, ...(options.caps ?? {}) };
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;

  // Seams: injected first, real globals only as guarded defaults.
  const fetchFn: FetchLike | undefined =
    options.fetchFn ??
    (typeof fetch === 'function'
      ? (url, init) => fetch(url, init)
      : undefined);
  const win: WinLike | undefined =
    options.win ?? (typeof window !== 'undefined' ? window : undefined);
  const doc: DocLike | undefined =
    options.doc ?? (typeof document !== 'undefined' ? document : undefined);

  // Defensive inert gate (§3.2): empty dataset/token, or no usable fetch/window in a
  // non-injected environment → inert handle. No registry interaction, zero listeners.
  if (!options.dataset || !options.token || !fetchFn || !win || !doc) {
    return {
      enqueue() {},
      setContext() {},
      flush() {},
      stats(): AxiomTransportStats {
        return {
          enabled: false,
          queued: 0,
          shipped: 0,
          droppedQueue: 0,
          droppedDedup: 0,
          droppedSessionCap: 0,
          droppedShipFailure: 0,
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

  const queue: Array<Record<string, unknown>> = [];
  const dedup = new Map<string, { count: number; windowStart: number }>();
  const context: Record<string, string> = Object.create(null);

  let disposed = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let shipped = 0;
  let droppedQueue = 0;
  let droppedDedup = 0;
  let droppedSessionCap = 0;
  let droppedShipFailure = 0;
  let breakerState: 'closed' | 'open' | 'half-open' = 'closed';
  let consecutiveFailures = 0;
  let openedAt = 0;
  let capMetaSent = false;
  let inFlight = false;
  let probeInFlight = false;

  function clearTimer(): void {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  /** Batch-assembly enrichment (§3.2): context applied FIRST, event fields win on
   *  collision, transport statics last (spread order is load-bearing). */
  function envelope(ev: Record<string, unknown>): Record<string, unknown> {
    return { ...context, ...ev, app, env, ver, sess };
  }

  /** Cut the oldest events from the queue into one batch (≤batchMaxEvents, ≤batchMaxBytes). */
  function cutBatchFront(): { body: string; count: number } {
    const parts: string[] = [];
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

  /** Hidden path (§3.2): single POST ≤batchMaxBytes carrying the NEWEST events,
   *  chronological order preserved; overflow dropped + counted; no chaining. */
  function cutBatchHidden(): { body: string; count: number } {
    const parts: string[] = [];
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
  async function ship(body: string, count: number, keepalive: boolean): Promise<boolean> {
    const init: { method: string; headers: Record<string, string>; body: string; keepalive?: boolean } = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body,
    };
    if (keepalive) init.keepalive = true;   // keepalive ONLY on 'hidden' flushes
    let failMsg: string;
    try {
      const res = await fetchFn!(url, init);
      if (res && res.ok) {
        shipped += count;
        consecutiveFailures = 0;
        return true;
      }
      failMsg = `ship failed: HTTP ${res ? res.status : 'unknown'}`;
    } catch (e) {
      failMsg = `ship failed: ${String(e)}`;
    }
    // The batch was already cut from the queue and is discarded (at-most-once) — those
    // events are now permanently lost. Count them so the loss is visible in stats() instead
    // of vanishing behind only a console breadcrumb (fix 1).
    droppedShipFailure += count;
    consecutiveFailures++;
    if (breakerState !== 'open' && consecutiveFailures >= caps.breakerFailureThreshold) {
      breakerState = 'open';
      openedAt = Date.now();
      failMsg += `; circuit open ${Math.round(caps.breakerOpenMs / 1000)}s after ${consecutiveFailures} consecutive failures`;
    }
    crumb(failMsg);
    return false;
  }

  async function doFlush(reason: FlushReason): Promise<void> {
    if (disposed || queue.length === 0) return;

    // Circuit breaker (§3.2): open → no-op until the 60s window elapses, then half-open.
    if (breakerState === 'open') {
      // Terminal flush override (fix 2): a page-hide/visibility-hidden flush is the LAST
      // chance to ship before the tab is gone. Attempt exactly one keepalive send even while
      // the breaker is open — at-most-once (the batch is cut from the queue and never
      // re-queued) makes this safe, and a failed send is counted by droppedShipFailure.
      if (reason === 'hidden') {
        const { body, count } = cutBatchHidden();
        if (count > 0) await ship(body, count, true);
        return;
      }
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
    // drain (review finding, change #121): cutBatchHidden() empties the queue
    // synchronously, so running alongside the drain is safe — the drain loop
    // re-checks queue.length after its await and exits cleanly.
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

  function flushNow(reason: FlushReason): void {
    if (disposed) return;
    void doFlush(reason).catch((e) => crumb(`flush error: ${String(e)}`));
  }

  /**
   * Enqueue pipeline (§3.2 order): disposed→drop · sanitize + stamp `_time` at enqueue ·
   * dedup (fixed window, transport-tag bypass, bounded map) · session cap (exactly-once
   * events_dropped meta, meta bypasses the cap) · queue cap drop-oldest · schedule.
   */
  function enqueueEvent(input: Record<string, unknown>, meta: boolean): void {
    if (disposed) return;
    const ev = sanitize(input, caps, allow);
    ev._time = new Date().toISOString();                        // stamped at enqueue time

    const tag = typeof ev.tag === 'string' ? ev.tag : '';
    if (tag !== 'transport') {                                  // transport meta events bypass dedup
      // Dedup key includes err_name + the first 40 chars of the (scrubbed) err_msg (fix 5):
      // distinct errors funnelled through ONE generic logger message (e.g. 'request failed')
      // otherwise collided on level|tag|message and were dropped as duplicates. Window (60s)
      // and per-key cap (5) are unchanged.
      const errName = typeof ev.err_name === 'string' ? ev.err_name : '';
      const errMsg = typeof ev.err_msg === 'string' ? ev.err_msg.slice(0, 40) : '';
      const key = `${String(ev.level ?? '')}|${tag}|${String(ev.message ?? '')}|${errName}|${errMsg}`;
      const now = Date.now();
      let entry = dedup.get(key);
      if (!entry || now - entry.windowStart >= caps.dedupWindowMs) {
        if (!dedup.has(key) && dedup.size >= DEDUP_MAP_MAX) dedup.clear();  // bounded at 500 keys
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

    if (queue.length >= caps.batchMaxEvents) {                  // ≥20 events → immediate flush
      clearTimer();
      flushNow('size');
    } else if (timerId === null) {                              // 5s timer armed on first enqueue
      timerId = setTimeout(() => {
        timerId = null;
        flushNow('timer');
      }, caps.flushIntervalMs);
    }
  }

  // Lifecycle listeners (§3.2): visibilitychange(hidden) + pagehide → flush('hidden').
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') flushNow('hidden');
  };
  const onPageHide = (): void => {
    flushNow('hidden');
  };
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', onPageHide);

  const handle: AxiomTransport = {
    enqueue(event: AxiomEventInput): void {
      try {
        enqueueEvent(event, false);
      } catch {
        /* never throws to the caller */
      }
    },

    setContext(ctx: Partial<Record<'acc' | 'usr' | 'obj' | 'board', string | number | undefined>>): void {
      if (disposed || !ctx) return;
      try {
        for (const k of ['acc', 'usr', 'obj', 'board'] as const) {
          const v = ctx[k];
          if (v === undefined || v === null) continue;          // merge semantics: undefined never clobbers
          context[k] = String(v).slice(0, caps.fieldMaxLen);
        }
      } catch {
        /* never throws */
      }
    },

    flush(reason?: FlushReason): void {
      flushNow(reason ?? 'manual');
    },

    stats(): AxiomTransportStats {
      return {
        enabled: true,
        queued: queue.length,
        shipped,
        droppedQueue,
        droppedDedup,
        droppedSessionCap,
        droppedShipFailure,
        breakerState,
        consecutiveFailures,
      };
    },

    dispose(): void {
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
