import { STATUS_DIRS } from '@generated/components/MyTasksView/controls/controls.js';

/*
 * Shared "Order" option sets + group sorter for the discussion task tabs'
 * GroupByBuilder. STATUS_DIRS is reused from the My Tasks builder so a status
 * grouping offers the same Label-order/A→Z choices; person/discussion groupings
 * are text-keyed and only offer alphabetical order.
 */
export const GROUP_STATUS_ORDERS = STATUS_DIRS;
export const GROUP_AZ_ORDERS = [
  { key: 'azAsc', label: 'A → Z', icon: 'alphaAsc' },
  { key: 'azDesc', label: 'Z → A', icon: 'alphaDesc' },
];

// Sort grouped buckets by the chosen order. The "no value" bucket (key === noKey)
// is kept FIRST — the existing tab behavior — regardless of direction. For
// label* orders the valued groups sort by `orderById` (status display rank, keyed
// by numeric label id); az* orders sort by the group label text (Hebrew).
export function sortGroupsByOrder(groups, { order = 'azAsc', orderById = {}, noKey } = {}) {
  const noVal = groups.filter((g) => g.key === noKey);
  const valued = groups.filter((g) => g.key !== noKey);
  if (order === 'azAsc' || order === 'azDesc') {
    const dir = order === 'azDesc' ? -1 : 1;
    valued.sort((a, b) => (a.label || '').localeCompare(b.label || '', 'he') * dir);
  } else {
    const dir = order === 'labelDesc' ? -1 : 1;
    valued.sort((a, b) => ((orderById[Number(a.key)] ?? Infinity) - (orderById[Number(b.key)] ?? Infinity)) * dir);
  }
  return [...noVal, ...valued];
}
