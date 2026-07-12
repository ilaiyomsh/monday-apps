/*
 * Shared tracking + control for monday's native ITEM CARD — the panel opened
 * via monday.execute('openItemCard', …) (the row "Updates" bubble across the
 * app: TaskTableRow, MyTasksRow, MyDecisionsRow, DecisionsTab, TopicPointRow,
 * PreviousTasksTab, …).
 *
 * WHY A MODULE SINGLETON: only ONE monday item card can be open at a time (it is
 * a platform-level overlay docked beside the board-view iframe) and it is opened
 * from MANY unrelated rows. A single module-level "open id" is therefore the
 * natural model — no prop/context threading through every table — and it lets a
 * view/screen transition close whatever is open from ONE place (an App effect).
 *
 * CLOSE CAPABILITY — VERIFIED LIMITATION: the monday client SDK (monday-sdk-js
 * 0.5.9) does NOT expose a close command for the item card. Its typed execute()
 * surface covers openItemCard but only closeAppFeatureModal / closeDialog /
 * closeDocModal — there is NO closeItemCard (see
 * node_modules/.pnpm/monday-sdk-js@0.5.9/…/types/client-execute.interface.ts).
 * execute() forwards ANY type string to the parent monday window, so we make a
 * BEST-EFFORT execute('closeItemCard') for forward-compatibility, but it may be
 * a no-op on the current platform. We never FAKE success: the tracked open-id is
 * always cleared and the attempt's rejection is swallowed, so the toggle /
 * close-on-transition INTENT is honored regardless of whether the panel visually
 * closes.
 */
import { monday } from './mondayApi/monday-client.js';

// Id (string) of the item whose card is currently open, or null when none.
let openItemCardId = null;

// Current open item-card id (string) or null. Exported for tests / callers that
// want to reflect the open state.
export function getOpenItemCardId() {
  return openItemCardId;
}

// Best-effort close of the native item card. See the file header: this SDK
// version has no guaranteed closeItemCard, so the command is forwarded to the
// monday parent and any rejection is swallowed — it must never surface an error.
function attemptCloseItemCard() {
  try {
    const res = monday.execute('closeItemCard');
    if (res && typeof res.catch === 'function') res.catch(() => {});
  } catch {
    /* execute unavailable (e.g. outside the monday iframe) — ignore */
  }
}

// Open the item card for `itemId` (Updates pane by default) OR — when that same
// item's card is already the tracked-open one — TOGGLE it closed. Every row's
// updates bubble / name / source chip routes through this, so a second click on
// the SAME item closes the panel; clicking a DIFFERENT item just switches to it.
export function openOrToggleItemCard(itemId, kind = 'updates') {
  if (itemId == null) return;
  const id = String(itemId);
  if (openItemCardId === id) {
    attemptCloseItemCard();
    openItemCardId = null;
    return;
  }
  try {
    monday.execute('openItemCard', { itemId: Number(itemId), kind });
    openItemCardId = id;
  } catch {
    /* execute unavailable — ignore */
  }
}

// Close whatever item card is open (if any). Called on ANY view/screen
// transition so a lingering Updates panel doesn't survive a context change.
export function closeOpenItemCard() {
  if (openItemCardId == null) return;
  attemptCloseItemCard();
  openItemCardId = null;
}
