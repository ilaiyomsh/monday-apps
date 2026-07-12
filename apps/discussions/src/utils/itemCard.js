/*
 * Shared helper for opening monday's native ITEM CARD — the panel opened via
 * monday.execute('openItemCard', …). Every row "Updates" bubble / name / source
 * chip across the app routes through here (TaskTableRow, MyTasksRow,
 * MyDecisionsRow, DecisionsTab, TopicPointRow, PreviousTasksTab), so no component
 * needs its own `monday` import.
 *
 * OPEN-ONLY — VERIFIED PLATFORM LIMITATION: monday's client SDK (monday-sdk-js
 * 0.5.9) exposes NO programmatic way to CLOSE the item card. Its execute()
 * surface has openItemCard but only closeAppFeatureModal / closeDialog /
 * closeDocModal — there is NO closeItemCard. A prior round tried to TOGGLE the
 * panel closed on a second click, and to close it on view/discussion
 * transitions, via a best-effort execute('closeItemCard') plus module-level
 * open-id tracking. But that command is a no-op on the platform, so the tracked
 * open/closed state only DESYNCED (after a no-op "close" a later click wouldn't
 * re-open as expected). We therefore do NOT track state and never attempt a
 * close: every click reliably (re)OPENS the card, and clicking a different row
 * just re-points monday's panel to that item. This is intentionally open-only
 * until monday ships a programmatic close.
 */
import { monday } from './mondayApi/monday-client.js';

// Open the item card for `itemId` (Updates pane by default). Called on every
// updates-bubble / name / source-chip click. Always opens — monday has no
// programmatic close (see the file header), so this is intentionally open-only.
export function openOrToggleItemCard(itemId, kind = 'updates') {
  if (itemId == null) return;
  try {
    monday.execute('openItemCard', { itemId: Number(itemId), kind });
  } catch {
    /* execute unavailable (e.g. outside the monday iframe) — ignore */
  }
}
