/* monday's content-color NAMES (the same identifiers the Vibe ColorPicker and
   monday status/dropdown columns use). We store the NAME per discussion type —
   not a hex — because:
     • the Vibe <ColorPicker> value/colorsList/onSave are color NAMES, and
     • the `--color-<name>` CSS vars (loaded via @vibe/core/tokens) are
       theme-aware, so a stored name auto-adapts to light/dark, while a hex
       would freeze to one theme.
   To render a name, use colorNameToCss(name) → `var(--color-<name>)`. */

// The FULL monday content palette, in monday's canonical order — shown in the
// type color picker (all monday colors).
export const MONDAY_COLOR_NAMES = [
  'grass_green', 'done-green', 'bright-green', 'saladish', 'egg_yolk',
  'working_orange', 'dark-orange', 'peach', 'sunset', 'stuck-red',
  'dark-red', 'sofia_pink', 'lipstick', 'bubble', 'purple',
  'dark_purple', 'berry', 'dark_indigo', 'indigo', 'navy',
  'bright-blue', 'dark-blue', 'aquamarine', 'chili-blue', 'river',
  'winter', 'explosive', 'american_gray', 'blackish', 'brown',
  'orchid', 'tan', 'sky', 'coffee', 'royal',
  'teal', 'lavender', 'steel', 'lilac', 'pecan',
];

// Vivid subset (no greys/browns/neutrals) — used for RANDOM auto-assignment and
// the stable-hash fallback, so a new type never gets a dull grey accent.
const NEUTRALS = new Set(['winter', 'explosive', 'american_gray', 'blackish', 'brown', 'tan', 'coffee', 'steel', 'pecan']);
export const MONDAY_VIVID_NAMES = MONDAY_COLOR_NAMES.filter((c) => !NEUTRALS.has(c));

/* A monday color NAME → a CSS color string (theme-aware var). Falls back to the
   neutral status-default token when there's no name. */
export function colorNameToCss(name) {
  return name ? `var(--color-${name})` : 'hsl(var(--status-default))';
}

/* Stable color NAME for a key (type name) via a string hash — the deterministic
   fallback when a type has no explicitly chosen color yet. */
export function stableColorForKey(key) {
  const s = String(key ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return MONDAY_VIVID_NAMES[h % MONDAY_VIVID_NAMES.length];
}

/* A random palette color NAME — used when a NEW discussion type is created.
   `avoid` is optional names already in use, so a fresh type tends to get a
   distinct color (falls back to any once the vivid palette is exhausted). */
export function randomPaletteColor(avoid = []) {
  const used = new Set((avoid || []).map((c) => String(c)));
  const free = MONDAY_VIVID_NAMES.filter((c) => !used.has(c));
  const pool = free.length ? free : MONDAY_VIVID_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}
