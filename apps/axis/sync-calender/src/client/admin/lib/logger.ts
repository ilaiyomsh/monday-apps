// logger.ts — minimal client telemetry (Axiom logging v2 usage/health primitives).
//
// This admin has no client error-logging surface today; this is the
// smallest-correct path for view/usage tracking. `track()` / `health()` emit INFO
// records carrying a domainKind ('usage' / 'health') + alwaysShip, with the message
// folded via encodeDims — the SAME wire contract as the server sink
// (src/services/axiomServerSink.js) and the browser template. Records fan out to
// registered sinks; a dev-only console sink provides breadcrumbs.
//
// DEFERRED (intentional): the Axiom browser transport is NOT wired here yet. When
// it is, attach it via `addSink` — this file needs no change, because the record
// shape already matches the transport/sink contract (level/module/message +
// domainKind + alwaysShip).

type Dims = Record<string, unknown>;

export interface LogRecord {
  level: 'INFO';
  module: string;
  message: string;
  domainKind: 'usage' | 'health';
  alwaysShip: true;
  kind: 'simple';
  timestamp: number;
}

export type Sink = (record: LogRecord) => void;

/**
 * Fold categorical/measured dims into a stable, queryable `base key=v` suffix with
 * keys sorted. Only string/bool/finite-number values are included (objects,
 * functions, NaN/Infinity dropped) so the message stays flat and APL-parseable.
 * Identical spec to the server sink's encodeDims (single wire format).
 */
export function encodeDims(base: string, dims?: Dims): string {
  if (!dims) return base;
  const parts: string[] = [];
  for (const key of Object.keys(dims).sort()) {
    const v = dims[key];
    if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
      parts.push(`${key}=${v}`);
    }
  }
  return parts.length ? `${base} ${parts.join(' ')}` : base;
}

const sinks = new Set<Sink>();

function emit(record: LogRecord): void {
  for (const sink of sinks) {
    try {
      sink(record);
    } catch {
      /* a sink must never throw back into the app or re-enter the logger */
    }
  }
}

/** Register a sink (e.g. a future Axiom browser transport). Returns an unsubscribe fn. */
export function addSink(fn: Sink): () => void {
  sinks.add(fn);
  return () => {
    sinks.delete(fn);
  };
}

/** Remove a previously-registered sink. */
export function removeSink(fn: Sink): void {
  sinks.delete(fn);
}

/** track — usage telemetry (D3): an INFO record, domainKind 'usage', alwaysShip. Dims fold via encodeDims (D4). */
function track(event: string, dims?: Dims): void {
  emit({
    level: 'INFO',
    module: 'usage',
    message: encodeDims(event, dims),
    domainKind: 'usage',
    alwaysShip: true,
    kind: 'simple',
    timestamp: Date.now(),
  });
}

/** health — health signal (D5): an INFO record, domainKind 'health', alwaysShip. Metrics fold via encodeDims (D4). */
function health(signal: string, metrics?: Dims): void {
  emit({
    level: 'INFO',
    module: 'health',
    message: encodeDims(signal, metrics),
    domainKind: 'health',
    alwaysShip: true,
    kind: 'simple',
    timestamp: Date.now(),
  });
}

const logger = { track, health, addSink, removeSink };

// Dev-only console breadcrumb so telemetry is visible while the remote transport
// is still deferred. Gated on Vite's DEV flag → silent in production builds.
if (import.meta.env.DEV) {
  addSink((r) => {
    console.debug(`[telemetry] ${r.module} | ${r.message}`);
  });
}

export default logger;
