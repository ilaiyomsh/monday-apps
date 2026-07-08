/**
 * Guards against UI translation strings leaking into Monday API payloads.
 *
 * Used by payload-preservation tests on the three known write fronts:
 *   - allocation role / capability
 *   - project type
 *   - settings round-trip (status arrays)
 *
 * The collectors walk arbitrary nested structures (objects, arrays, plurals)
 * so a translation key buried inside `{ allocation: { roles: { plural: '...' } } }`
 * is still picked up. We intentionally do NOT rely on a flat `Object.values(...)`.
 */

export type StatusColumnShape = 'index' | 'label' | 'unknown';

export interface StatusColumnWrite {
  columnId: string;
  value: unknown;
  shape: StatusColumnShape;
}

/** Collect all string leaves from any value (recurses through arrays/objects). */
export const extractStrings = (value: unknown, acc: string[] = []): string[] => {
  if (value == null) return acc;
  if (typeof value === 'string') {
    acc.push(value);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const v of value) extractStrings(v, acc);
    return acc;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) extractStrings(v, acc);
    return acc;
  }
  // numbers, booleans, etc. — ignored.
  return acc;
};

/** Collect every string value from a translation bundle (he or en). */
export const flattenTranslationValues = (bundle: unknown): string[] => {
  return extractStrings(bundle);
};

export interface AssertNoForbiddenOptions {
  /**
   * Path patterns whose string values are allowed to match `forbidden` (e.g.,
   * known board-data fields). Patterns are dot-separated and accept `*` for
   * one segment — e.g. `'column_values.*.label'` matches every status-column
   * label, regardless of the status column ID. Array indices count as a
   * segment (use `*`).
   */
  allowedPaths?: string[];
  /**
   * @deprecated Use `allowedPaths` instead. `allowedKeys: ['label']` is
   * equivalent to `allowedPaths: ['**.label']` — it allowlists every `label`
   * field anywhere in the payload, which can mask future leaks. Retained
   * only so existing callers keep working.
   */
  allowedKeys?: string[];
  /** Optional message prefix for assertion failures. */
  context?: string;
}

const matchesPathPattern = (path: string[], pattern: string[]): boolean => {
  // Support a leading or single `**` segment as "any number of segments".
  // Used internally by the deprecated allowedKeys → allowedPaths shim.
  if (pattern.length === 2 && pattern[0] === '**') {
    return path.length >= 1 && path[path.length - 1] === pattern[1];
  }
  if (path.length !== pattern.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    const seg = pattern[i];
    if (seg === '*') continue;
    if (seg !== path[i]) return false;
  }
  return true;
};

/**
 * Throws if any `forbidden` string appears in `payload`, except for values
 * that sit at one of the `allowedPaths` (or under one of the legacy
 * `allowedKeys`). Empty strings in `forbidden` are ignored because they
 * would match trivially and aren't translation leaks.
 *
 * The check is path-precise: a string allowlisted at one location does NOT
 * become allowlisted everywhere with the same value. That's the difference
 * vs. the legacy `allowedKeys` flag — see the test in payloadGuard.test.ts.
 */
export const assertNoForbiddenStrings = (
  payload: unknown,
  forbidden: string[],
  options: AssertNoForbiddenOptions = {}
): void => {
  const { allowedPaths = [], allowedKeys = [], context = 'payload' } = options;
  const forbiddenSet = new Set(forbidden.filter((s) => s.length > 0));
  if (forbiddenSet.size === 0) return;

  // Translate legacy `allowedKeys` to the path form `**.<key>` so a single
  // walker handles both. Any future caller should prefer `allowedPaths`.
  const patterns = [
    ...allowedPaths,
    ...allowedKeys.map((k) => `**.${k}`),
  ].map((p) => p.split('.'));

  const leaked: string[] = [];
  const visit = (v: unknown, path: string[]) => {
    if (v == null) return;
    if (typeof v === 'string') {
      if (!forbiddenSet.has(v)) return;
      if (patterns.some((pat) => matchesPathPattern(path, pat))) return;
      leaked.push(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => visit(item, [...path, String(i)]));
      return;
    }
    if (typeof v === 'object') {
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
        visit(vv, [...path, k]);
      }
    }
  };
  visit(payload, []);

  if (leaked.length > 0) {
    throw new Error(
      `[payloadGuard] ${context} contains forbidden translation strings: ${JSON.stringify(
        Array.from(new Set(leaked))
      )}`
    );
  }
};

/**
 * Find writes targeting Monday status columns inside a `column_values` object.
 * `statusColumnIds` is the (possibly empty) list of column IDs known to be status type.
 */
export const findStatusColumnWrites = (
  columnValues: Record<string, unknown> | undefined | null,
  statusColumnIds: string[]
): StatusColumnWrite[] => {
  if (!columnValues) return [];
  const out: StatusColumnWrite[] = [];
  for (const id of statusColumnIds) {
    if (id in columnValues) {
      const value = columnValues[id];
      out.push({ columnId: id, value, shape: detectStatusColumnShape(value) });
    }
  }
  return out;
};

/** Detect whether a status column write is `{ index }`, `{ label }`, or unknown. */
export const detectStatusColumnShape = (value: unknown): StatusColumnShape => {
  if (value == null || typeof value !== 'object') return 'unknown';
  // Arrays and Dates pass `typeof === 'object'` but are never status writes.
  if (Array.isArray(value) || value instanceof Date) return 'unknown';
  const v = value as Record<string, unknown>;
  const hasIndex = 'index' in v && (typeof v.index === 'number' || typeof v.index === 'string');
  const hasLabel = 'label' in v && typeof v.label === 'string';
  if (hasIndex && !hasLabel) return 'index';
  if (hasLabel && !hasIndex) return 'label';
  if (hasLabel && hasIndex) return 'label'; // `label` takes precedence visually
  return 'unknown';
};

/**
 * If a status column write uses `{ label: ... }`, the label MUST equal the original
 * board label (round-trip). Throws otherwise — that means a translation slipped in.
 */
export const assertStatusWriteIsRoundTrip = (
  write: StatusColumnWrite,
  originalLabel: string
): void => {
  if (write.shape !== 'label') return;
  const written = (write.value as { label: string }).label;
  if (written !== originalLabel) {
    throw new Error(
      `[payloadGuard] status column ${write.columnId} wrote translated label "${written}" ` +
        `instead of original "${originalLabel}"`
    );
  }
};
