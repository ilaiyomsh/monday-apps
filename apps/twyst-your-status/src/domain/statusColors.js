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
    if (HEX_BY_ENUM[normalized]) return normalized;
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
 * @param {Array<{ color: string, isDeactivated?: boolean }>} payload
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
  const assignUnique = (label) => {
    let color = tryNormalizeStatusColorEnum(label?.color);
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
