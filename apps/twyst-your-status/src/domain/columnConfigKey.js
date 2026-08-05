// Column-view dialogs have no instanceId — use GLOBAL storage keyed by board+column.
export function columnConfigStorageKey(boardId, columnId) {
  return `twystStatus:${boardId}:${columnId}`;
}
