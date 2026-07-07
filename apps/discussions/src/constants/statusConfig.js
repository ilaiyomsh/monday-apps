/* Status labels and colors are NOT hardcoded — they are read at runtime from the
   configured status column's settings (see hooks/useStatusOptions.js). This file
   only holds the value validator shared by the task table + tabs. */

// A status value is now the STABLE LABEL ID (a number; 0 is valid). Treat only
// null/undefined/'' / the legacy '[object Object]' sentinel as "no status".
export function isValidStatus(s) {
  return s !== null && s !== undefined && s !== '' && s !== '[object Object]';
}
