/**
 * Helpers for Hebrew baseline snapshot tests.
 *
 * The intent (per the rollout plan, A.9): any change to Hebrew rendering
 * during extraction = a red snapshot. Implementation note:
 *
 *   We don't render the components — they have heavy provider dependencies.
 *   Instead we snapshot the *inventory* of Hebrew strings used by each component:
 *   the union of (a) Hebrew string literals inside the source file and
 *   (b) Hebrew string values inside `src/i18n/locales/he/translation.json` whose
 *   keys are referenced by the source file via `t('...')`.
 *
 *   Before extraction → strings live in source. After extraction → strings live
 *   in the locale bundle. Either way, the union stays stable, so the snapshot
 *   does not flip unless Hebrew text actually changed.
 */

import { readFileSync } from 'node:fs';

/** Hebrew Unicode block + Hebrew presentation forms. */
const HEBREW_REGEX = /[֐-׿יִ-ﭏ]+/;

const STRING_LITERAL_REGEX = /(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g;

/**
 * Extract every string literal from a TS/TSX source file that contains a Hebrew
 * code-point. Strings are returned **sorted, unique** so snapshots are stable.
 * JSX text nodes (e.g. `<span>סינון</span>`) are matched via a complementary
 * regex pass so we don't miss strings that aren't inside quotes.
 */
export const collectHebrewLiteralsFromSource = (filePath: string): string[] => {
  const src = readFileSync(filePath, 'utf-8');
  const found = new Set<string>();

  // Quoted/backtick strings.
  for (const m of src.matchAll(STRING_LITERAL_REGEX)) {
    const literal = m[1] ?? m[2] ?? m[3];
    if (literal && HEBREW_REGEX.test(literal)) {
      found.add(literal);
    }
  }

  // JSX text nodes — between `>` and `<`. Text may span lines; we trim and
  // collapse internal whitespace so multi-line JSX still produces a single entry.
  const JSX_TEXT_REGEX = />([^<>{}]+)</g;
  for (const m of src.matchAll(JSX_TEXT_REGEX)) {
    const collapsed = m[1].replace(/\s+/g, ' ').trim();
    if (collapsed && HEBREW_REGEX.test(collapsed)) {
      found.add(collapsed);
    }
  }

  return [...found].sort();
};

/** Walk a translation bundle and return every leaf string that contains Hebrew. */
export const collectHebrewLiteralsFromBundle = (bundle: unknown): string[] => {
  const found = new Set<string>();
  const visit = (v: unknown) => {
    if (v == null) return;
    if (typeof v === 'string') {
      if (HEBREW_REGEX.test(v)) found.add(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(visit);
    }
  };
  visit(bundle);
  return [...found].sort();
};

const T_CALL_REGEX = /\bt\(\s*['"`]([\w.]+)['"`]/g;
// Quoted string literal that looks like a dotted translation key path
// (at least one '.', and only word chars / dots). Used so keys passed
// indirectly (e.g. from a const array) are still counted.
const KEY_LITERAL_REGEX = /['"`]([a-zA-Z][\w]*\.[\w.]+)['"`]/g;

/**
 * Find every translation key the source file refers to. Picks up:
 *   - direct `t('a.b.c')` calls
 *   - dotted string literals like `'filter.timeframe.all'` used as data
 * False positives from non-translation strings that happen to contain dots
 * (e.g. CSS module imports) are filtered later by checking against the bundle.
 */
export const collectTranslationKeysFromSource = (filePath: string): string[] => {
  const src = readFileSync(filePath, 'utf-8');
  const keys = new Set<string>();
  for (const m of src.matchAll(T_CALL_REGEX)) keys.add(m[1]);
  for (const m of src.matchAll(KEY_LITERAL_REGEX)) keys.add(m[1]);
  return [...keys].sort();
};

/**
 * Look up a key path inside a bundle, returning the leaf value (if any).
 * Plural forms are resolved by also accepting `${key}_one`/`${key}_other`-style
 * suffixes that i18next uses, so the snapshot includes both forms.
 */
const resolveKeyVariants = (bundle: unknown, key: string): string[] => {
  const out: string[] = [];
  if (bundle == null || typeof bundle !== 'object') return out;
  const segs = key.split('.');
  let cursor: unknown = bundle;
  for (const seg of segs) {
    if (cursor == null || typeof cursor !== 'object') return out;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  if (typeof cursor === 'string') {
    out.push(cursor);
  } else if (cursor != null && typeof cursor === 'object') {
    // Plural / nested map: include every string leaf rooted here.
    out.push(...collectHebrewLiteralsFromBundle(cursor));
  }
  return out;
};

/** Collect Hebrew bundle values for keys that the source file references. */
export const collectScopedHebrewFromBundle = (
  filePath: string,
  bundle: unknown
): string[] => {
  const keys = collectTranslationKeysFromSource(filePath);
  const found = new Set<string>();
  for (const key of keys) {
    for (const v of resolveKeyVariants(bundle, key)) {
      if (HEBREW_REGEX.test(v)) found.add(v);
    }
  }
  return [...found].sort();
};

/**
 * Read the Hebrew bundle from disk if it exists, else return `{}`.
 * Used so this helper works in Phase A (no bundle yet) and after Increment 1.
 */
export const loadHebrewBundle = (bundlePath: string): unknown => {
  try {
    return JSON.parse(readFileSync(bundlePath, 'utf-8'));
  } catch {
    return {};
  }
};

/**
 * Compose the snapshot inventory for one component: Hebrew strings in the
 * source file PLUS Hebrew values for translation keys the source actually
 * references via `t('key.path')`. As strings move from the source file to the
 * bundle, the union stays stable, so the snapshot only shifts when a Hebrew
 * label genuinely changes.
 */
export const collectHebrewInventory = (
  sourcePath: string,
  hebrewBundlePath: string
): string[] => {
  const fromSource = collectHebrewLiteralsFromSource(sourcePath);
  const fromBundleScoped = collectScopedHebrewFromBundle(
    sourcePath,
    loadHebrewBundle(hebrewBundlePath)
  );
  return [...new Set([...fromSource, ...fromBundleScoped])].sort();
};
