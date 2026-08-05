/**
 * axiomSink.ts — FACADE SHIM.
 *
 * The logger→Axiom bridge now lives in `@mapps/error-kit` (packages/error-kit). This
 * file is a thin re-export so existing importers keep the same path + public API
 * (app-core's index barrel, and MondayContext's `setAxiomContext`/`isAxiomSinkActive`),
 * while inheriting error-kit's fixes — mapRecordToEvent now also emits a scrubbed
 * multi-frame `stack` and, when the record carries it, `component_stack` (ErrorBoundary
 * fix 4). `getAxiomStats` is additionally exposed (additive, error-guard parity).
 */
export {
  attachAxiomSink,
  setAxiomContext,
  isAxiomSinkActive,
  setRemoteLevel,
  shouldShip,
  mapRecordToEvent,
  scrubMessage,
  getAxiomStats,
  type AxiomSinkOptions,
} from '@mapps/error-kit/browser';
