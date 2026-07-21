/**
 * errorReporting.ts — planner's single wiring point onto the shared @mapps/error-kit
 * browser error layer. Replaces the old vendored src/utils/axiomErrorSink.ts +
 * axiomBrowserTransport.ts (deleted): the hardened transport, sink, global handlers, and
 * privacy scrub now live in the shared package, so every wired app ships identical
 * behavior into the SHARED `app-errors` Axiom dataset (discriminated by `app`).
 *
 * The app-local Logger.ts (src/utils/Logger.ts) STAYS — it is the app's console pipeline,
 * ring buffer, and telemetry surface (track/health). error-kit subscribes to it through the
 * `errorKitLogger` adapter below.
 *
 * Two record-shape gaps between planner's Logger and error-kit's contract are bridged here,
 * NOT by mutating Logger.ts:
 *   1. DOMAIN discriminator — planner records carry the domain on `domainKind`
 *      (usage/health/error) and keep `kind` for the RENDERING kind (simple/error).
 *      error-kit's mapRecordToEvent reads `kind` as the domain discriminator, so
 *      `adaptRecord` copies `domainKind ?? 'error'` into `kind` before hand-off.
 *   2. CALL SIGNATURE — error-kit calls `logger.error(module, message, payload?, context?)`;
 *      planner's Logger surface is variadic. The adapter maps each level to logger.bridge(),
 *      which carries the context (e.g. the ErrorBoundary componentStack) onto the record.
 *
 * Activation gate (kept identical to the vendored sink): ships ONLY when
 * import.meta.env.PROD === true AND VITE_AXIOM_DATASET / VITE_AXIOM_TOKEN / VITE_AXIOM_APP
 * are all baked into the bundle. Dev server, tunnel, and vitest are structurally inert.
 */
import {
  attachAxiomSink,
  setupGlobalErrorHandlers,
  setAxiomContext,
  setRemoteLevel,
  getAxiomStats,
  scrubMessage,
  type Logger as ErrorKitLogger,
  type LogRecord as ErrorKitLogRecord,
} from '@mapps/error-kit/browser';
import { logger, type LogRecord } from './Logger';

// Build-time version constant injected by vite.config.ts `define` (mirrored in vitest.config.ts).
declare const __APP_VERSION__: string;

// ============================================
// Record adapter (pure — unit-test seam)
// ============================================

/**
 * Bridge a planner LogRecord into error-kit's record shape by promoting the DOMAIN
 * discriminator onto `kind` (error-kit reads `record.kind`; planner keeps the domain on
 * `domainKind` and uses `kind` for the rendering kind). Everything else passes through
 * structurally. `domainKind ?? 'error'` matches the previous vendored `ev.kind` default.
 */
export function adaptRecord(rec: LogRecord): ErrorKitLogRecord {
  return { ...rec, kind: rec.domainKind ?? 'error' } as unknown as ErrorKitLogRecord;
}

/**
 * Map a monday SDK context object to the id-only identity the Axiom transport enriches every
 * envelope with (acc/usr/obj/board). `account.id` and top-level `accountId` are both accepted
 * (the field name varies by context shape); `obj` falls back from instanceId to boardId inside
 * setAxiomContext. Pure — the unit-test seam for the useMondayContext wiring.
 */
export function mondayIdsForAxiom(ctx: {
  account?: { id?: string | number };
  accountId?: string | number;
  user?: { id?: string | number };
  boardId?: string | number;
  instanceId?: string | number;
}): { accountId?: string | number; userId?: string | number; boardId?: string | number; instanceId?: string | number } {
  return {
    accountId: ctx.account?.id ?? ctx.accountId,
    userId: ctx.user?.id,
    boardId: ctx.boardId,
    instanceId: ctx.instanceId,
  };
}

/**
 * The error-kit-shaped view of planner's singleton logger. Its error/warn/info/debug route
 * to logger.bridge() (carrying module/message/payload/context); its addSink/getBuffer wrap
 * the real logger and run each record through adaptRecord so the sink sees the domain on
 * `kind`.
 */
export const errorKitLogger: ErrorKitLogger = {
  debug: (module, message, payload, context) =>
    logger.bridge('DEBUG', module, message, payload, context as LogRecord['context']),
  info: (module, message, payload, context) =>
    logger.bridge('INFO', module, message, payload, context as LogRecord['context']),
  warn: (module, message, payload, context) =>
    logger.bridge('WARN', module, message, payload, context as LogRecord['context']),
  error: (module, message, payload, context) =>
    logger.bridge('ERROR', module, message, payload, context as LogRecord['context']),
  addSink: (sink) => logger.addSink((rec) => sink(adaptRecord(rec))),
  getBuffer: () => logger.getBuffer().map(adaptRecord),
};

// ============================================
// Wiring (side-effecting; called once from main.tsx before render)
// ============================================

const DATASET = import.meta.env.VITE_AXIOM_DATASET as string | undefined;
const TOKEN = import.meta.env.VITE_AXIOM_TOKEN as string | undefined;
const APP = import.meta.env.VITE_AXIOM_APP as string | undefined;
const ACTIVE =
  import.meta.env.PROD === true && Boolean(DATASET) && Boolean(TOKEN) && Boolean(APP);

/**
 * Install the global error handlers (always — they funnel uncaught errors + unhandled
 * rejections + resource-load failures into the logger, useful even in dev) and attach the
 * Axiom sink (inert unless the PROD gate + VITE_AXIOM_* are present). MUST run synchronously
 * in the app entry BEFORE createRoot(...).render, so the ring-buffer replay captures only
 * import-time records with no async gap.
 */
export function initErrorReporting(): void {
  setupGlobalErrorHandlers(errorKitLogger);
  attachAxiomSink(errorKitLogger, {
    app: APP ?? 'planner',
    dataset: DATASET,
    token: TOKEN,
    active: ACTIVE,
    appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0',
    environment: (import.meta.env.VITE_AXIOM_ENV as string | undefined) ?? 'production',
  });
}

// Re-export the shared operator/identity surface so app code imports from ONE place.
export { setAxiomContext, setRemoteLevel, getAxiomStats, scrubMessage };
