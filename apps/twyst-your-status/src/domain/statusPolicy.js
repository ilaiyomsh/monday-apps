export const STATUS_GUARD_CONFIG_VERSION = 1;

function normalizeRequiredIdentifier(value, name) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new Error(`${name} is required`);
  }

  return String(value).trim();
}

function normalizeNonNegativeInteger(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

function emptyConfig() {
  return {
    version: STATUS_GUARD_CONFIG_VERSION,
    restrictedLabelIds: [],
  };
}

/**
 * Status cell `index` carries the label **id** (monday naming quirk).
 * @see monday-api references/column-formats.md
 */
export function currentLabelIdFromValue(currentValue) {
  const directIndex = normalizeNonNegativeInteger(currentValue?.index);
  if (directIndex !== null) return String(directIndex);

  if (typeof currentValue?.value !== 'string') return null;
  const serializedIndex = currentValue.value.match(/"index"\s*:\s*(\d+)/);
  if (!serializedIndex) return null;

  const fallbackIndex = normalizeNonNegativeInteger(serializedIndex[1]);
  return fallbackIndex === null ? null : String(fallbackIndex);
}

export function makeStatusGuardStorageKey(boardId, columnId) {
  const normalizedBoardId = normalizeRequiredIdentifier(boardId, 'boardId');
  const normalizedColumnId = normalizeRequiredIdentifier(columnId, 'columnId');
  return `status-guard:v${STATUS_GUARD_CONFIG_VERSION}:${normalizedBoardId}:${normalizedColumnId}`;
}

export function normalizeStatusGuardConfig(rawConfig) {
  if (
    !rawConfig
    || Array.isArray(rawConfig)
    || typeof rawConfig !== 'object'
    || rawConfig.version !== STATUS_GUARD_CONFIG_VERSION
    || !Array.isArray(rawConfig.restrictedLabelIds)
  ) {
    return emptyConfig();
  }

  const seen = new Set();
  const restrictedLabelIds = [];

  rawConfig.restrictedLabelIds.forEach((labelId) => {
    const normalizedId = normalizeNonNegativeInteger(labelId);
    if (normalizedId === null) return;

    const stringId = String(normalizedId);
    if (seen.has(stringId)) return;

    seen.add(stringId);
    restrictedLabelIds.push(stringId);
  });

  return {
    version: STATUS_GUARD_CONFIG_VERSION,
    restrictedLabelIds,
  };
}

/**
 * Normalize monday status column settings.labels.
 * `id` is the stable write key; `index` is display order only.
 */
export function normalizeStatusLabels(columnSettings) {
  const labels = Array.isArray(columnSettings?.labels) ? columnSettings.labels : [];

  return labels.flatMap((label) => {
    if (
      !Number.isInteger(label?.id)
      || label.id < 0
      || !Number.isInteger(label?.index)
      || label.index < 0
    ) {
      return [];
    }

    const colorValue = typeof label.color === 'number' || typeof label.color === 'string'
      ? label.color
      : undefined;
    const color = typeof label.hex === 'string' && label.hex
      ? label.hex
      : '#c4c4c4';

    return [{
      id: String(label.id),
      index: label.index,
      label: typeof label.label === 'string' ? label.label : '',
      color,
      colorValue,
      isDone: label.is_done === true,
      // Read so a save can send it BACK: update_status_column replaces the labels
      // array, so a field left out of the payload is cleared, not preserved.
      description: typeof label.description === 'string' ? label.description : undefined,
      isDeactivated: label.is_deactivated === true,
    }];
  });
}

/**
 * @deprecated Prefer buildAvailableLabels from ./buildAvailableLabels.js for
 * permission-aware picking. Kept for legacy restricted-label-only callers/tests.
 */
export function buildStatusPickerModel({ labels, currentValue, config }) {
  const normalizedLabels = Array.isArray(labels) ? labels : [];
  const normalizedConfig = normalizeStatusGuardConfig(config);
  const restrictedIds = new Set(normalizedConfig.restrictedLabelIds);
  const currentLabelId = currentLabelIdFromValue(currentValue);
  const currentLabel = currentLabelId === null
    ? null
    : normalizedLabels.find((label) => label.id === currentLabelId) ?? null;

  return {
    currentLabelId,
    currentLabel,
    currentIsRestricted: currentLabel !== null && restrictedIds.has(currentLabel.id),
    options: normalizedLabels.filter(
      (label) => !label.isDeactivated && !restrictedIds.has(label.id),
    ),
  };
}

/**
 * Serialize a status mutation. The JSON key is `index` but the value is the
 * label **id** (monday quirk — see column-formats.md).
 */
export function serializeStatusMutationValue(labelId) {
  const normalizedId = normalizeNonNegativeInteger(labelId);
  if (normalizedId === null) {
    throw new Error('labelId must be a non-negative integer');
  }

  return JSON.stringify({ index: normalizedId });
}
