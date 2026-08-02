/**
 * monday StatusColumnColors — numeric color index ↔ enum name ↔ hex.
 * Index map matches the platform's labels[].color read shape (not enum ordinal).
 * @see monday-api references/column-formats.md
 * @see apps/axis/day-off mondayApi STATUS_COLORS_BY_INDEX
 */

const STATUS_COLORS_BY_INDEX = {
  0: { enum: 'working_orange', hex: '#fdab3d' },
  1: { enum: 'done_green', hex: '#00c875' },
  2: { enum: 'stuck_red', hex: '#e2445c' },
  3: { enum: 'dark_blue', hex: '#0086c0' },
  4: { enum: 'purple', hex: '#9d50dd' },
  5: { enum: 'explosive', hex: '#ff642e' },
  6: { enum: 'grass_green', hex: '#037f4c' },
  7: { enum: 'bright_blue', hex: '#579bfc' },
  8: { enum: 'saladish', hex: '#cab641' },
  9: { enum: 'egg_yolk', hex: '#ffcb00' },
  10: { enum: 'blackish', hex: '#333333' },
  11: { enum: 'dark_red', hex: '#bb3354' },
  12: { enum: 'sofia_pink', hex: '#ff158a' },
  13: { enum: 'lipstick', hex: '#ff5ac4' },
  14: { enum: 'dark_purple', hex: '#784bd1' },
  15: { enum: 'bright_green', hex: '#9cd326' },
  16: { enum: 'chili_blue', hex: '#66ccff' },
  17: { enum: 'american_gray', hex: '#808080' },
  18: { enum: 'brown', hex: '#7f5347' },
  19: { enum: 'dark_orange', hex: '#d974b0' },
  101: { enum: 'sunset', hex: '#ff7575' },
  102: { enum: 'bubble', hex: '#faa1f1' },
  103: { enum: 'peach', hex: '#ffadad' },
  104: { enum: 'berry', hex: '#e8697d' },
  105: { enum: 'winter', hex: '#9aadbd' },
  106: { enum: 'river', hex: '#68a1bd' },
  107: { enum: 'navy', hex: '#225091' },
  108: { enum: 'aquamarine', hex: '#4eccc6' },
  109: { enum: 'indigo', hex: '#5559df' },
  110: { enum: 'dark_indigo', hex: '#401694' },
  151: { enum: 'pecan', hex: '#563e3e' },
  152: { enum: 'lavender', hex: '#a25ddc' },
  153: { enum: 'royal', hex: '#2b76e5' },
  154: { enum: 'steel', hex: '#a9bee8' },
  155: { enum: 'orchid', hex: '#dce3ea' },
  156: { enum: 'lilac', hex: '#bda8f0' },
  157: { enum: 'tan', hex: '#a0a0a0' },
  158: { enum: 'sky', hex: '#a1e3f6' },
  159: { enum: 'coffee', hex: '#bd816e' },
  160: { enum: 'teal', hex: '#2da283' },
};

export const MONDAY_STATUS_COLORS = Object.entries(STATUS_COLORS_BY_INDEX)
  .map(([id, value]) => ({ id: Number(id), enum: value.enum, hex: value.hex }))
  .sort((a, b) => a.id - b.id);

const ENUM_BY_INDEX = Object.fromEntries(
  Object.entries(STATUS_COLORS_BY_INDEX).map(([key, value]) => [Number(key), value.enum]),
);
const HEX_BY_INDEX = Object.fromEntries(
  Object.entries(STATUS_COLORS_BY_INDEX).map(([key, value]) => [Number(key), value.hex]),
);
const HEX_BY_ENUM = Object.fromEntries(
  Object.values(STATUS_COLORS_BY_INDEX).map((value) => [value.enum, value.hex]),
);
const ENUM_SET = new Set(Object.values(STATUS_COLORS_BY_INDEX).map((value) => value.enum));

/**
 * Resolve a monday status color write value (StatusColumnColors enum name).
 * @param {string|number|undefined|null} color
 * @returns {string}
 */
export function normalizeStatusColorEnum(color) {
  if (typeof color === 'number' && Number.isFinite(color)) {
    const mapped = ENUM_BY_INDEX[color];
    if (mapped) return mapped;
    throw new Error(`Unsupported status color numeric ID: ${color}`);
  }
  if (typeof color === 'string') {
    const normalized = color.trim().toLowerCase();
    if (ENUM_SET.has(normalized)) return normalized;
    if (HEX_BY_ENUM[normalized]) return normalized;
    const asNumber = Number(normalized);
    if (normalized !== '' && Number.isFinite(asNumber)) {
      const mapped = ENUM_BY_INDEX[asNumber];
      if (mapped) return mapped;
      throw new Error(`Unsupported status color numeric ID string: ${color}`);
    }
    const byHex = MONDAY_STATUS_COLORS.find(
      (entry) => entry.hex.toLowerCase() === normalized,
    );
    if (byHex) return byHex.enum;
    throw new Error(`Unsupported status color enum: ${color}`);
  }
  throw new Error('Missing status color value');
}

/**
 * Non-throwing map to a StatusColumnColors enum name.
 * @param {string|number|undefined|null} color
 * @returns {string|null}
 */
export function tryNormalizeStatusColorEnum(color) {
  if (typeof color === 'number' && Number.isFinite(color)) {
    return ENUM_BY_INDEX[color] ?? null;
  }
  if (typeof color === 'string') {
    const normalized = color.trim().toLowerCase();
    if (ENUM_SET.has(normalized)) return normalized;
    const underscored = normalized.replace(/-/g, '_');
    if (ENUM_SET.has(underscored)) return underscored;
    const asNumber = Number(normalized);
    if (normalized !== '' && Number.isFinite(asNumber)) {
      return ENUM_BY_INDEX[asNumber] ?? null;
    }
    const byHex = MONDAY_STATUS_COLORS.find(
      (entry) => entry.hex.toLowerCase() === normalized,
    );
    if (byHex) return byHex.enum;
  }
  return null;
}

/**
 * Vibe ColorPicker uses hyphens for some monday content colors; GraphQL
 * StatusColumnColors uses underscores. Bridge both directions.
 */
const VIBE_HYPHEN_BY_ENUM = {
  done_green: 'done-green',
  stuck_red: 'stuck-red',
  bright_green: 'bright-green',
  dark_orange: 'dark-orange',
  dark_red: 'dark-red',
  bright_blue: 'bright-blue',
  dark_blue: 'dark-blue',
  chili_blue: 'chili-blue',
};
const ENUM_BY_VIBE_HYPHEN = Object.fromEntries(
  Object.entries(VIBE_HYPHEN_BY_ENUM).map(([enumName, vibe]) => [vibe, enumName]),
);

/**
 * @param {string|number|undefined|null} statusEnum
 * @returns {string}
 */
export function toVibeColorName(statusEnum) {
  const normalized = tryNormalizeStatusColorEnum(statusEnum)
    ?? String(statusEnum ?? '').trim().toLowerCase().replace(/-/g, '_');
  return VIBE_HYPHEN_BY_ENUM[normalized] ?? normalized;
}

/**
 * @param {string|undefined|null} vibeName
 * @returns {string|null} StatusColumnColors enum name
 */
export function fromVibeColorName(vibeName) {
  const raw = String(vibeName ?? '').trim().toLowerCase();
  if (!raw) return null;
  // ColorPicker returns vibe names (often hyphenated). Resolve via the explicit
  // map first — do not fall through to tryNormalize's hyphen rewrite, so the
  // ColorPicker contract stays pinned to this bridge.
  if (ENUM_BY_VIBE_HYPHEN[raw]) return ENUM_BY_VIBE_HYPHEN[raw];
  if (ENUM_SET.has(raw)) return raw;
  return null;
}

/** Whitelist for Vibe ColorPicker (status-column writeable colors). */
export const VIBE_STATUS_COLOR_NAMES = MONDAY_STATUS_COLORS.map((entry) => (
  toVibeColorName(entry.enum)
));


/**
 * monday's reserved slot for the default EMPTY label.
 *
 * A label created into it (i.e. with `explosive`, colour 5) cannot be deleted afterwards
 * — `"Unable to delete a label already in use"` even with no item referencing it — and
 * monday overrides its colour to grey `#c4c4c4` whatever enum was sent. That is what
 * produced the "picked purple, board shows grey, settings shows orange" report: grey is
 * monday's override, orange is `explosive` re-derived from the stored colour index.
 * Probe-verified 2026-07-29; see monday-api references/column-formats.md.
 */
export const RESERVED_EMPTY_LABEL_ID = 5;

/**
 * The colour that IS that slot. Sending it is how a default label gets created; monday
 * then pins the label to id 5 and renders it grey whatever enum arrived.
 */
export const RESERVED_EMPTY_LABEL_COLOR = 'explosive';

/** The grey monday forces on it — the swatch the board shows. */
export const RESERVED_EMPTY_LABEL_HEX = '#c4c4c4';

/**
 * @param {string|number|undefined|null} id
 * @returns {boolean} true for monday's default (grey) label
 */
export function isReservedEmptyLabelId(id) {
  return Number(id) === RESERVED_EMPTY_LABEL_ID;
}

/**
 * The numeric id of a status colour — which IS the id monday assigns a label created
 * with that colour.
 * @param {string|number|undefined|null} colorEnum
 * @returns {number|null}
 */
export function statusColorEnumId(colorEnum) {
  const normalized = tryNormalizeStatusColorEnum(colorEnum);
  if (normalized == null) return null;
  const entry = MONDAY_STATUS_COLORS.find((candidate) => candidate.enum === normalized);
  return entry ? entry.id : null;
}

/**
 * Choose the colour for a label about to be CREATED.
 *
 * Two separate questions have to come out clean, and conflating them is the bug this
 * function exists to prevent:
 *   - is the colour free? (monday requires colours unique across the whole column)
 *   - is the colour's own numeric id free as a LABEL id? (that id is what the new label
 *     gets, and a taken one — active OR deactivated — rejects the mutation)
 *
 * Removing a label frees its colour and keeps its id, so on a natural column the freed
 * colour is precisely the one a colours-only picker reaches for first. Every label id
 * ever used stays taken, so this walks by id-freeness, not by colour-freeness alone.
 *
 * @param {Array<{ id: string|number, colorValue?: string|number, color?: string,
 *   isDeactivated?: boolean }>} allLabels every label on the column, deactivated included
 * @returns {string} a StatusColumnColors enum name
 */
export function pickColorForNewLabel(allLabels) {
  const labels = Array.isArray(allLabels) ? allLabels : [];

  const takenIds = new Set([RESERVED_EMPTY_LABEL_ID]);
  const usedColors = new Set();
  labels.forEach((label) => {
    const numericId = Number(label?.id);
    if (Number.isInteger(numericId)) takenIds.add(numericId);
    const color = tryNormalizeStatusColorEnum(label?.colorValue ?? label?.color);
    if (color != null) usedColors.add(color);
  });

  const free = MONDAY_STATUS_COLORS.find((entry) => (
    !takenIds.has(entry.id) && !usedColors.has(entry.enum)
  ));
  if (!free) {
    throw new Error('No monday status color remains whose id is free for a new label');
  }
  return free.enum;
}

/**
 * @param {Iterable<string>} usedEnums
 * @returns {string} next free StatusColumnColors enum name
 */
export function pickUnusedStatusColor(usedEnums) {
  const used = new Set(
    [...(usedEnums ?? [])]
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean),
  );
  const free = MONDAY_STATUS_COLORS.find((entry) => !used.has(entry.enum));
  if (!free) {
    throw new Error('No unused monday status colors remain');
  }
  return free.enum;
}

/**
 * monday update_status_column rejects payloads where any two labels share a
 * color (including deactivated). Keep active colors stable; reassign collisions.
 * @param {Array<{ color: string, isDeactivated?: boolean, isDefaultEmpty?: boolean }>} payload
 */
export function ensureUniqueStatusColors(payload) {
  const list = Array.isArray(payload) ? payload : [];
  const active = [];
  const deactivated = [];
  list.forEach((label) => {
    if (label?.isDeactivated) deactivated.push(label);
    else active.push(label);
  });

  const used = new Set();
  // The default (grey) label claims its color BEFORE anyone else. `explosive` is not a
  // preference there, it is the reserved slot itself — reassigning it would turn the
  // default label into an ordinary one, so a collision moves the other label instead.
  list.forEach((label) => {
    if (!label?.isDefaultEmpty) return;
    const color = tryNormalizeStatusColorEnum(label?.color);
    if (color != null) used.add(color);
  });

  const assignUnique = (label) => {
    let color = tryNormalizeStatusColorEnum(label?.color);
    if (label?.isDefaultEmpty && color != null) return { ...label, color };
    if (color == null || used.has(color)) {
      color = pickUnusedStatusColor(used);
    }
    used.add(color);
    return { ...label, color };
  };

  return [...active.map(assignUnique), ...deactivated.map(assignUnique)];
}

/**
 * @param {string|number|undefined|null} color
 * @returns {string|undefined}
 */
export function resolveStatusColorHex(color) {
  if (typeof color === 'number' && Number.isFinite(color)) return HEX_BY_INDEX[color];
  if (typeof color === 'string') {
    const normalized = color.trim().toLowerCase();
    if (HEX_BY_ENUM[normalized]) return HEX_BY_ENUM[normalized];
    const asNumber = Number(normalized);
    if (normalized !== '' && Number.isFinite(asNumber)) return HEX_BY_INDEX[asNumber];
    if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;
  }
  return undefined;
}
