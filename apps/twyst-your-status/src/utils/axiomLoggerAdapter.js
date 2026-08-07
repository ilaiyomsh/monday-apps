/**
 * axiomLoggerAdapter — bridge this app's logger record shape to the shape that
 * `@mapps/error-kit/browser`'s Axiom sink expects.
 *
 * error-kit reads the Axiom envelope's DOMAIN discriminator off `record.kind`
 * ('error' | 'usage' | 'health'). This app's logger carries that value as
 * `record.domainKind` — its `record.kind` is the console-RENDERING kind
 * ('simple' | 'api' | 'error' | ...). Without this bridge the migration would be a
 * regression: warnings would ship as kind='simple' (dropped from error dashboards)
 * and usage/health telemetry would lose its discriminator. `toAxiomRecord` restores
 * the established wire meaning that the retired vendored sink shipped:
 * `domainKind` when present, else 'error'.
 */

/**
 * Remap one record so its `kind` carries the domain discriminator error-kit ships.
 * @public error/observability boot layer (.error-guard) — platform-reached, knip must not report it.
 */
export function toAxiomRecord(record) {
  const r = record || {};
  return { ...r, kind: r.domainKind ?? 'error' };
}

/**
 * Wrap a logger in the minimal { getBuffer, addSink } surface attachAxiomSink uses,
 * remapping every buffered and live record through toAxiomRecord so the shipped
 * envelope keeps its domain discriminator.
 */
export function makeAxiomLogger(logger) {
  return {
    getBuffer: () => logger.getBuffer().map(toAxiomRecord),
    addSink: (sink) => logger.addSink((record) => sink(toAxiomRecord(record))),
  };
}
