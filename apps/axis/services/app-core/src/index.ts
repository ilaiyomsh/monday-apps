/**
 * @axis/app-core — shared startup + infrastructure for Axis monday.com apps (standard #17).
 *
 * Wire-up order in an app:
 *   1. polyfillGlobal() at the very top, then create mondaySdk()
 *   2. const logger = createLogger({ app, axiom })
 *   3. const { SettingsProvider, useSettings } = createSettings({ storageKeyPrefix, defaults })
 *   4. bootstrapApp({ logger, children: <App/> })
 *   5. Tree: <ErrorBoundary><MondayProvider><SettingsProvider>…</SettingsProvider></MondayProvider></ErrorBoundary>
 */

// startup
export { bootstrapApp, polyfillGlobal, type BootstrapOptions } from './bootstrap';

// logging
export { createLogger, encodeDims, type Logger, type LogRecord, type LogSink, type LogLevelName, type LoggerOptions } from './logger';

// monday context
export { MondayProvider, useMondayContext, type MondayContextValue, type MondayProviderProps } from './monday/MondayContext';

// settings module
export {
  createSettings,
  type SettingsModuleConfig,
  type SettingsContextValue,
  type SettingsProviderProps,
} from './settings/createSettings';
export {
  SettingsDialogShell,
  type SettingsDialogShellProps,
  type SettingsTabDef,
  type SettingsTabRenderCtx,
} from './settings/SettingsDialogShell';

// error pipeline
export { ErrorBoundary } from './errors/ErrorBoundary';
export { setupGlobalErrorHandlers } from './errors/globalErrorHandler';
export { useErrorHandler } from './errors/useErrorHandler';
export {
  attachAxiomSink,
  setAxiomContext,
  isAxiomSinkActive,
  setRemoteLevel,
  shouldShip,
  mapRecordToEvent,
  scrubMessage,
  type AxiomSinkOptions,
} from './errors/axiomSink';

// usage / view tracking (D3)
export { createViewTracker, useViewTracking, type ViewTracker } from './usage/viewTracking';

// api queue + storage
export { createApiQueue } from './apiQueue';
export { createGlobalStorage, resolveInstanceId, withTimeout, ATTEMPT_TIMEOUT_MS } from './storage';

// axiom browser transport (hardened direct ingest — env injected by the consumer)
export {
  createAxiomBrowserTransport,
  type AxiomTransport,
  type AxiomTransportOptions,
  type AxiomEventInput,
  type AxiomTransportCaps,
  type AxiomTransportStats,
} from './axiomTransport';

// shared types
export type {
  Language,
  Dir,
  MondaySdk,
  MondaySdkContext,
  MondaySdkUser,
  UserPermissions,
  AppError,
  SettingsErrorKind,
  StorageResult,
} from './types';
