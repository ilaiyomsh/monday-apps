/* Status labels and colors are NOT hardcoded — they are read at runtime from the
   configured status column's settings (see hooks/useStatusOptions.js). This file
   only holds the value validator shared by the task table + tabs. */

// A status value is now the STABLE LABEL ID (a number; 0 is valid). Treat only
// null/undefined/'' / the legacy '[object Object]' sentinel as "no status".
export function isValidStatus(s) {
  return s !== null && s !== undefined && s !== '' && s !== '[object Object]';
}

/*
 * round377 — monday pre-creates every status column with a GRAY label on stable
 * id 5, and this app treats that label as the "not set yet" state (round353 §3).
 *
 * It lives here, in the pure constants module, rather than in useStatusOptions:
 * `StatusCell` needs it too, and many tests mock that hook — importing a constant
 * from a mocked module makes every one of those mocks incomplete (it broke three
 * TaskTable smoke tests). Nothing mocks this file.
 */
export const GRAY_DEFAULT_LABEL_ID = 5;
