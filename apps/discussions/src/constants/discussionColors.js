/* Accent palette for discussion items — theme-token CSS var names, consumed as
   hsl(var(--x)). The LIST rotates by row index (unchanged historical behavior);
   the CALENDAR uses accentForId so a discussion keeps one color across
   ranges/views regardless of its position. */
export const DISC_COLORS = [
  '--dept-legal',
  '--dept-hr',
  '--dept-ceo',
  '--status-working',
  '--dept-strategy',
  '--dept-engineering',
  '--dept-it',
];

export function accentForId(id) {
  const s = String(id ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return DISC_COLORS[h % DISC_COLORS.length];
}

/* Default grey for a discussion with no "סוג" label (or an unknown color). */
export const DISCUSSION_DEFAULT_COLOR = 'hsl(var(--status-default))';

/* A discussion's display color. "סוג" is now a DROPDOWN column, so the value is
   the type's label TEXT and its color comes from app storage via the `typeColor`
   resolver (TemplatesContext) — NOT from a status label. A discussion with a
   type gets its stored/stable palette color; one without a type gets the default
   grey. Returns a COMPLETE css color string ready to drop into a style value. */
export function discussionAccentColor(item, typeColor) {
  const name = item?.discussionTypeID; // dropdown label text or null/empty
  if (name && typeof typeColor === 'function') return typeColor(name);
  return DISCUSSION_DEFAULT_COLOR;
}
