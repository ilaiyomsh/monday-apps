/**
 * @mapps/error-kit/browser — the client-side error-to-Axiom shipping layer.
 * NO React imports live under this entry (the ErrorBoundary is `@mapps/error-kit/react`),
 * so a plain-JS or non-React consumer can import the transport, sink, and global handler
 * without pulling React into the bundle.
 */
export {
  createAxiomBrowserTransport,
  type AxiomTransport,
  type AxiomTransportOptions,
  type AxiomTransportCaps,
  type AxiomTransportStats,
  type AxiomEventInput,
} from './axiomTransport';

export {
  attachAxiomSink,
  setAxiomContext,
  setRemoteLevel,
  getAxiomStats,
  isAxiomSinkActive,
  shouldShip,
  mapRecordToEvent,
  scrubMessage,
  type AxiomSinkOptions,
} from './axiomSink';

export {
  setupGlobalErrorHandlers,
  setChunkErrorHandler,
  type SetupGlobalErrorHandlersOptions,
  type GlobalErrorWindowLike,
} from './globalErrorHandler';

export type { Logger, LogRecord, LogSink, LogLevelName } from '../types';
