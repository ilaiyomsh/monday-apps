/**
 * Feature flags surfaced via Vite env vars.
 *
 * Strict equality with `'true'` only — `'TRUE'`/`'1'`/`true` (boolean) all
 * resolve to disabled. This keeps it impossible to flip a flag on by accident
 * via a deploy that mishandles type coercion.
 */

export const isLanguagePickerEnabled = (): boolean =>
  import.meta.env.VITE_ENABLE_LANGUAGE_PICKER === 'true';
