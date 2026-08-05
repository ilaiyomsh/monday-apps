/**
 * axiomTransport.ts — FACADE SHIM.
 *
 * The hardened browser transport now lives in the standalone package
 * `@mapps/error-kit` (packages/error-kit). This file used to hold a byte-identical
 * copy; it is now a thin re-export so existing `@axis/app-core` consumers and the
 * app-core barrel keep importing `createAxiomBrowserTransport` (+ its types) from the
 * same path, with the same public API — while inheriting error-kit's fixes
 * (droppedShipFailure stat, dedup key incl. err_name+err_msg, terminal-flush keepalive
 * with an open breaker, extended `stack`/`component_stack` allowlist keys).
 *
 * error-kit ships COMPILED (dist/), so both consumer build systems resolve it:
 * tracker (Vite alias to app-core TS source) and day-off (workspace `link:` to source).
 */
export {
  createAxiomBrowserTransport,
  type AxiomTransport,
  type AxiomTransportOptions,
  type AxiomTransportCaps,
  type AxiomTransportStats,
  type AxiomEventInput,
} from '@mapps/error-kit/browser';
