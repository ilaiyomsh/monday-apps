/*
 * Active board/column configuration store.
 *
 * The SDK (BoardSDK.js) reads boards & column mappings from HERE, not from a
 * hardcoded import. SettingsContext publishes the loaded settings into this
 * store (setActiveConfig) once monday context + storage have resolved, so the
 * mapping is settings-driven and swappable per instance.
 *
 * There are NO defaults: the active config starts EMPTY. Until SettingsContext
 * publishes a stored mapping, getBoardId/getColumns return undefined/{} and the
 * app forces the Settings modal so the user maps boards/columns first.
 */

let active = {
  boards: {},
  columns: {},
};

export function setActiveConfig(cfg) {
  if (cfg?.boards) active.boards = cfg.boards;
  if (cfg?.columns) active.columns = cfg.columns;
}

export function getBoards() {
  return active.boards;
}

export function getBoardId(boardKey) {
  return active.boards?.[boardKey]?.id;
}

export function getColumns(boardKey) {
  return active.columns?.[boardKey] || {};
}
