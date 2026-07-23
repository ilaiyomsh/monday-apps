/*
 * round211 — EXTERNAL participants (not monday users). Stored on the discussion
 * in a mapped long_text column (alias externalParticipantsID) as a single
 * comma-separated names string, so the board column stays human-readable.
 * These are TEXT-ONLY names: no monday identity, never assignable to tasks.
 */

/** The stored column value (string or parsed {text}) → an array of clean names. */
export function parseExternalParticipants(value) {
  const text = typeof value === 'string' ? value : (value?.text ?? '');
  if (!text) return [];
  return String(text)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Names array → the stored comma-separated string (trims + drops empties). */
export function formatExternalParticipants(names) {
  return (Array.isArray(names) ? names : [])
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/** First+last initials for the avatar circle (mirrors PersonAvatar.initialsOf). */
export function externalInitials(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2);
}
