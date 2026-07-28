/**
 * @mapps/error-kit/server — the CANONICAL REFERENCE server sink (opts-injected, zero
 * process.env reads). Server apps push the app root only, so they keep a LOCAL copy of
 * this module and drift-test it against this entry.
 */
export {
  attachAxiomServerSink,
  isAxiomSinkActive,
  flushAxiom,
  mapRecordToEvent,
  shouldShip,
  scrubMessage,
  type ServerLogRecord,
  type ServerSinkOptions,
  type ServerSinkConfig,
} from './axiomServerSink';
