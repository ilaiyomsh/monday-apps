// logger.ts — client telemetry + error/warn logging (Axiom logging v2).
//
// This is the single client-side log choke-point. It emits structured records
// that fan out to registered sinks (a dev-only console breadcrumb, plus the
// Axiom browser transport once attached — see ../utils/axiomErrorSink.ts).
//
// - track()/health() emit INFO records carrying a domainKind ('usage'/'health')
//   + alwaysShip, message folded via encodeDims — the SAME wire contract as the
//   server sink (src/services/axiomServerSink.js).
// - error()/warn() emit ERROR/WARN records carrying the thrown value (record.error)
//   and optional structured context (e.g. { componentStack }); the Axiom sink ships
//   only WARN/ERROR by default (privacy-scrubbed).
// - A bounded ring buffer retains recent records so attachAxiomSink() can replay
//   import-time WARN/ERROR/usage/health records synchronously before render.
//
// The record shape (level/module/message + domainKind + alwaysShip + error +
// context) matches the transport/sink contract, so no sink adapter is needed.

type Dims = Record<string, unknown>;

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogRecord {
  level: LogLevel;
  module: string;
  message: string;
  timestamp: number;
  /** Domain discriminator for the Axiom envelope: 'error' (default) | 'usage' | 'health'. */
  domainKind?: 'error' | 'usage' | 'health';
  /** Bypass the default WARN/ERROR ship policy — usage/health records ship at INFO. */
  alwaysShip?: boolean;
  /** Rendering discriminator (never shipped remotely). track()/health() emit 'simple'. */
  kind?: string;
  /** The thrown value for WARN/ERROR records (an Error, or an arbitrary payload). */
  error?: unknown;
  /** Structured context attached by the caller (e.g. { componentStack }). */
  context?: Record<string, unknown>;
  correlationId?: number;
  duplicate?: boolean;
}

export type Sink = (record: LogRecord) => void;
export type LogSink = Sink;

/**
 * The logger surface the error-kit vendored stack (globalErrorHandler / axiomErrorSink)
 * consumes. Kept structurally compatible with @mapps/error-kit's `Logger`.
 */
export interface Logger {
  debug(module: string, message: string, payload?: unknown, context?: Record<string, unknown>): void;
  info(module: string, message: string, payload?: unknown, context?: Record<string, unknown>): void;
  warn(module: string, message: string, payload?: unknown, context?: Record<string, unknown>): void;
  error(module: string, message: string, payload?: unknown, context?: Record<string, unknown>): void;
  track(event: string, dims?: Dims): void;
  health(signal: string, metrics?: Dims): void;
  addSink(fn: Sink): () => void;
  removeSink(fn: Sink): void;
  getBuffer(): LogRecord[];
}

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

// Bounded ring buffer of recent records so attachAxiomSink() can replay import-time
// WARN/ERROR (and usage/health) records synchronously before the first render.
const BUFFER_MAX = 50;
const buffer: LogRecord[] = [];

function emit(record: LogRecord): void {
  buffer.push(record);
  while (buffer.length > BUFFER_MAX) buffer.shift();
  for (const sink of sinks) {
    try {
      sink(record);
    } catch {
      /* a sink must never throw back into the app or re-enter the logger */
    }
  }
}

/** Recent records (a copy), oldest first — replayed by attachAxiomSink(). */
export function getBuffer(): LogRecord[] {
  return buffer.slice();
}

/** Register a sink (e.g. the Axiom browser transport). Returns an unsubscribe fn. */
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

function log(
  level: LogLevel,
  module: string,
  message: string,
  payload?: unknown,
  context?: Record<string, unknown>,
): void {
  const record: LogRecord = {
    level,
    module,
    message,
    domainKind: 'error',
    timestamp: Date.now(),
  };
  if (payload !== undefined) record.error = payload;
  if (context !== undefined) record.context = context;
  emit(record);
}

/** debug — local breadcrumb; never ships (below the default WARN/ERROR policy). */
function debug(module: string, message: string, payload?: unknown, context?: Record<string, unknown>): void {
  log('DEBUG', module, message, payload, context);
}

/** info — local breadcrumb; never ships by default (use track/health for INFO that ships). */
function info(module: string, message: string, payload?: unknown, context?: Record<string, unknown>): void {
  log('INFO', module, message, payload, context);
}

/** warn — WARN record; ships (privacy-scrubbed) via the Axiom sink. */
function warn(module: string, message: string, payload?: unknown, context?: Record<string, unknown>): void {
  log('WARN', module, message, payload, context);
}

/** error — ERROR record carrying the thrown value; ships (privacy-scrubbed) via the Axiom sink. */
function error(module: string, message: string, payload?: unknown, context?: Record<string, unknown>): void {
  log('ERROR', module, message, payload, context);
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

const logger: Logger = { debug, info, warn, error, track, health, addSink, removeSink, getBuffer };

// Dev-only console breadcrumb so telemetry + errors are visible while developing.
// Gated on Vite's DEV flag → silent in production builds (the Axiom sink takes over).
if (import.meta.env.DEV) {
  addSink((r) => {
    const line = `[${r.module}] ${r.message}`;
    if (r.level === 'ERROR') console.error(line, r.error ?? '');
    else if (r.level === 'WARN') console.warn(line, r.error ?? '');
    else console.debug(`[telemetry] ${r.module} | ${r.message}`);
  });
}

export default logger;
