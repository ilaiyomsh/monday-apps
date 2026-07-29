/**
 * axiomLogger.js — adapts this app's logger.js to the `Logger` interface that
 * `@mapps/error-kit/browser`'s attachAxiomSink expects.
 *
 * WHY THIS EXISTS (platform quirk, documented in docs/ERROR-AXIOM-STANDARD.md):
 * the package's mapRecordToEvent reads `record.kind` directly as the Axiom
 * domain discriminator ('error' default | 'usage' | 'health') — that is how
 * app-core's canonical logger shapes it.
 *
 * This app's logger.js instead overloads `record.kind` as the CONSOLE RENDER
 * kind ('simple' | 'error' | 'api' | 'apiResponse' | 'apiError') and keeps the
 * domain discriminator on a separate `record.domainKind` field (set only by
 * track()/health(); undefined otherwise, meaning 'error' by convention).
 *
 * Feeding this app's raw records straight into the package's sink would ship
 * every plain WARN/INFO record with kind='simple', and every usage/health
 * record with kind='simple' too (instead of 'usage'/'health'), silently
 * breaking the Axiom `kind=` filter the dashboards rely on. toAxiomLogger()
 * wraps ONLY the getBuffer/addSink view the package reads and remaps
 * kind -> domainKind ?? 'error' on the way out; the real logger and every other
 * consumer (console rendering, the UI toast sink) are untouched.
 *
 * Ported from apps/team-people-column/src/utils/axiomLogger.js.
 */

/**
 * @param {Object} record - a raw logger.js record
 * @returns {Object} a shallow copy with `kind` remapped to the Axiom domain kind
 */
export function remapKind(record) {
  if (!record) return record;
  return { ...record, kind: record.domainKind ?? 'error' };
}

/**
 * @param {Object} baseLogger - this app's real logger (utils/logger.js default export)
 * @returns {{debug:Function,info:Function,warn:Function,error:Function,getBuffer:Function,addSink:Function}}
 */
export function toAxiomLogger(baseLogger) {
  return {
    debug: baseLogger.debug,
    info: baseLogger.info,
    warn: baseLogger.warn,
    error: baseLogger.error,
    getBuffer: () => baseLogger.getBuffer().map(remapKind),
    addSink: (sink) => baseLogger.addSink((record) => sink(remapKind(record))),
  };
}
