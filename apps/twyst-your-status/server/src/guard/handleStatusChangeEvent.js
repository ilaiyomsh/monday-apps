/**
 * handleStatusChangeEvent — the watchdog orchestrator (DI factory).
 *
 * Identity model (owner decision, round322): a revert is written AS the column's
 * PRIMARY OWNER, so monday records it under the person the settings screen
 * designated. There is no bot/service account.
 *
 * Per delivery:
 *   1. Account READER token (any authorized owner); none → skip (unactivated).
 *   2. Load the column's rules (same twystStatus:<board>:<column> blob the picker
 *      reads) with the reader token; no rules → column unguarded → skip.
 *   3. Resolve the PRIMARY OWNER from the rules' owner list. LOOP GUARD: an event
 *      whose actor IS the primary owner is the echo of our own revert — skip, or
 *      reverts would revert themselves forever.
 *   4. Gather only what the verdict needs (labels always; actor teams only when a
 *      rule names teams; people columns / required-field values only when the
 *      target rule gates on them) — all via the reader token.
 *   5. evaluate() — allowed → done.
 *   6. Revert path (reasons 'not-offered' / 'required-fields-empty' ONLY): the
 *      revert must be written with the PRIMARY OWNER's own token so monday
 *      attributes it to them. No primary-owner token (they have not authorized)
 *      → log and SKIP the revert (fail-open, and loop-safe: a revert written as
 *      the reader would echo as a non-primary user the loop guard cannot catch).
 *      Re-read the cell first and revert only while it still holds the illegal
 *      label (stale/rapid-change guard). Then notify the acting user.
 *      'required-fields-unknown' is logged, never reverted.
 *   7. Per-item serialization: same board+item+column deliveries run one at a time.
 *
 * Every failure is caught and logged — the HTTP layer ack'd 202 long ago, and a
 * throw here would only become an unhandledRejection (error-guard funnel rule).
 *
 * REVERT_NOTIFICATION_TEXT is the owner's exact copy (2026-08-03) — do not edit.
 */

import { classifyViolation, estimateSurface } from '../../../src/domain/bypassReason.js';
import { isFieldValueEmpty, prefillFieldValue } from '../../../src/domain/columnFields.js';
import { normalizeOwners } from '../../../src/domain/columnOwners.js';

/** Which of a label's required columns were actually empty at change time. */
function collectEmptyFieldIds(requiredColumnIds, requiredFieldValues) {
  if (!Array.isArray(requiredColumnIds) || requiredColumnIds.length === 0) return [];
  const byId = new Map((Array.isArray(requiredFieldValues) ? requiredFieldValues : []).map((f) => [String(f.columnId), f]));
  return requiredColumnIds.filter((columnId) => {
    const field = byId.get(String(columnId));
    if (!field) return true; // missing/unreadable → counts as empty (fail-closed)
    return isFieldValueEmpty(field.type, prefillFieldValue(field.type, field.columnValue));
  }).map(String);
}

export const REVERT_NOTIFICATION_TEXT =
  'השינוי שבוצע בוטל - מכיוון שאינו עומד בהגדרות העמודה';

/** Reasons that justify writing the previous value back. */
export const REVERTABLE_REASONS = ['not-offered', 'required-fields-empty'];

/**
 * @param {{
 *   api: object, tokenStore: object, rulesStore: object, bypassLog: object,
 *   logger: object, evaluate?: Function, now?: () => number,
 * }} deps
 */
export function createStatusChangeHandler({ api, tokenStore, rulesStore, bypassLog, logger, evaluate, now = () => Date.now() }) {
  const TAG = 'guard';
  const lanes = new Map();

  // Pending reverts, so the loop guard can tell OUR revert echo from a genuine
  // prohibited edit the primary owner makes by hand. Keyed by board:item:column
  // → the label id we wrote (the echo will carry it as its new value) + expiry.
  const pendingReverts = new Map();
  const REVERT_ECHO_TTL_MS = 60_000;
  const echoKey = (boardId, itemId, columnId) => `${boardId}:${itemId}:${columnId}`;

  /** Is this event the echo of a revert we just performed? (consumes the marker) */
  const isRevertEcho = (boardId, itemId, columnId, newLabelId) => {
    const key = echoKey(boardId, itemId, columnId);
    const pending = pendingReverts.get(key);
    if (!pending) return false;
    if (pending.expiresAt < now()) { pendingReverts.delete(key); return false; }
    if (pending.labelId !== newLabelId) return false;
    pendingReverts.delete(key); // one echo per revert
    return true;
  };

  const labelIdOf = (statusValue) => {
    const index = statusValue?.label?.index;
    return typeof index === 'number' && Number.isInteger(index) && index >= 0
      ? String(index)
      : null;
  };

  const rulesNameTeams = (rules) => Object.values(rules?.labels ?? {})
    .some((rule) => Array.isArray(rule?.allowedTeamIds) && rule.allowedTeamIds.length > 0);

  async function process(event) {
    const accountId = String(event.accountId);
    const boardId = String(event.boardId);
    const itemId = String(event.pulseId);
    const columnId = String(event.columnId);
    const actingUserId = String(event.userId);

    const reader = await tokenStore.getReaderToken(accountId);
    if (!reader) {
      logger.info('event skipped: account not activated', TAG, { accountId, boardId, columnId });
      return;
    }
    const readToken = reader.token;

    const rules = await rulesStore.getRules(readToken, boardId, columnId);
    if (!rules) return; // unguarded column

    const owners = normalizeOwners(rules.owners);
    const primaryOwnerId = owners?.primaryOwnerId ?? null;

    const previousLabelId = labelIdOf(event.previousValue);
    const newLabelId = labelIdOf(event.value);

    // Loop guard — skip ONLY the echo of a revert we just performed: authored by
    // the primary owner, on the same item/column, whose new value is exactly what
    // we reverted TO, within the TTL. A genuine prohibited change the primary
    // owner makes by hand does NOT match (different value / no pending marker), so
    // it is monitored and reverted like anyone else's — the owner is not exempt.
    if (primaryOwnerId !== null
      && actingUserId === String(primaryOwnerId)
      && isRevertEcho(boardId, itemId, columnId, newLabelId)) {
      return;
    }

    // Board reads (labels, item values, the cell re-read) and the revert are
    // BOARD-scoped, and OAuth board visibility is per user. The account reader is
    // whichever owner authorized last — it may not see this column's board. The
    // PRIMARY OWNER configured this column, so their token can read its board;
    // use it for every board-scoped call, falling back to the reader only when
    // the primary owner has not authorized. (getRules above is APP storage —
    // account-scoped — so the reader is always fine there.)
    const primaryToken = primaryOwnerId !== null
      ? await tokenStore.getOwnerToken(accountId, primaryOwnerId)
      : null;
    const boardReadToken = primaryToken ?? readToken;

    const targetRule = rules.labels?.[newLabelId ?? '5'] ?? {};
    const peopleColumnIds = Array.isArray(targetRule.requiredPeopleColumnIds)
      ? targetRule.requiredPeopleColumnIds
      : [];
    const requiredColumnIds = Array.isArray(targetRule.requiredColumnIds)
      ? targetRule.requiredColumnIds
      : [];

    const labels = await api.getColumnLabels(boardReadToken, boardId, columnId);
    const teamIds = rulesNameTeams(rules)
      ? await api.getUserTeamIds(boardReadToken, actingUserId)
      : [];

    let peopleByColumnId = {};
    let requiredFieldValues = requiredColumnIds.length > 0 ? [] : null;
    if (peopleColumnIds.length > 0 || requiredColumnIds.length > 0) {
      const itemContext = await api.getItemGuardContext(boardReadToken, itemId, {
        peopleColumnIds,
        requiredColumnIds,
      });
      peopleByColumnId = itemContext?.peopleByColumnId ?? {};
      requiredFieldValues = itemContext === null && requiredColumnIds.length > 0
        ? null
        : itemContext?.requiredFieldValues ?? requiredFieldValues;
    }

    const verdict = evaluate({
      settings: rules,
      labels,
      actor: { userId: actingUserId, teamIds },
      previousLabelId,
      newLabelId,
      peopleByColumnId,
      requiredFieldValues,
    });
    // One trace line per evaluated change (only guarded, enrolled columns reach
    // here), so the change→verdict outcome is followable in `code:logs`.
    logger.info(
      `status change ${verdict.allowed ? 'ALLOWED' : `BLOCKED (${verdict.reason})`} board=${boardId} col=${columnId} item=${itemId} ${previousLabelId}→${newLabelId} actor=${actingUserId}`,
      TAG,
      { accountId, boardId, columnId, itemId, allowed: verdict.allowed, reason: verdict.reason ?? null },
    );
    if (verdict.allowed) return;
    if (!REVERTABLE_REASONS.includes(verdict.reason)) {
      logger.warn('illegal change NOT reverted (verdict is not revert-worthy)', TAG, {
        accountId, boardId, itemId, columnId, reason: verdict.reason,
      });
      return;
    }

    // ---- decide whether a revert happens (auto-revert is opt-in, default off) ----
    // A revert must be written AS the primary owner (attribution). It happens only
    // when: auto-revert is enabled for this column, an owner is configured, that
    // owner authorized the guard, AND the cell still holds the illegal value.
    const autoRevert = rules.autoRevert === true;
    let reverted = false;
    if (autoRevert && primaryOwnerId !== null) {
      // primaryToken was resolved above (board-read identity). No token → the
      // primary owner has not authorized: cannot attribute a revert to them.
      if (!primaryToken) {
        logger.warn('auto-revert on, but primary owner has not authorized the guard', TAG, {
          accountId, boardId, itemId, columnId, primaryOwnerId,
        });
      } else {
        const currentLabelId = await api.getCurrentStatusLabelId(boardReadToken, itemId, columnId);
        if (currentLabelId === newLabelId) {
          // Mark the echo BEFORE writing: monday fires the change event for our
          // own revert, authored by the primary owner, carrying previousLabelId.
          pendingReverts.set(echoKey(boardId, itemId, columnId), {
            labelId: previousLabelId,
            expiresAt: now() + REVERT_ECHO_TTL_MS,
          });
          await api.revertStatus(primaryToken, boardId, itemId, columnId, previousLabelId);
          reverted = true;
          logger.info('illegal status change reverted', TAG, {
            accountId, boardId, itemId, columnId, actingUserId, primaryOwnerId,
            previousLabelId, newLabelId, reason: verdict.reason,
          });
          try {
            await api.notifyUser(primaryToken, event.userId, itemId, REVERT_NOTIFICATION_TEXT);
          } catch (err) {
            // The revert already landed — a failed notification must not fail the event.
            logger.error(`revert notification failed: ${String(err?.message ?? err)}`, TAG, {
              accountId, itemId, error: String(err?.message ?? err),
            });
          }
        }
      }
    }

    // ---- record the bypass ALWAYS (monitoring is independent of auto-revert) ----
    // The record carries ids + names + the specific violation; the settings
    // monitor resolves user names and renders the Hebrew explanation client-side.
    const labelsById = {};
    for (const l of labels) labelsById[String(l.id)] = l.label ?? '';
    const emptyFieldIds = collectEmptyFieldIds(requiredColumnIds, requiredFieldValues);
    const classification = classifyViolation(
      { settings: rules, actor: { userId: actingUserId, teamIds }, previousLabelId, newLabelId, peopleByColumnId, emptyFieldIds },
      verdict,
    );
    await bypassLog.append(accountId, boardId, columnId, {
      ts: now(),
      itemId,
      itemName: event.itemName ?? event.pulseName ?? '',
      userId: actingUserId,
      fromLabelId: previousLabelId,
      fromLabelName: previousLabelId === null ? '' : (labelsById[previousLabelId] ?? ''),
      toLabelId: newLabelId,
      toLabelName: newLabelId === null ? '' : (labelsById[newLabelId] ?? ''),
      classification,
      surface: estimateSurface(event.app),
      reverted,
    });
  }

  return function handle(event) {
    const laneKey = `${event?.boardId}:${event?.pulseId}:${event?.columnId}`;
    const previous = lanes.get(laneKey) ?? Promise.resolve();
    const run = previous.then(() => process(event)).catch((err) => {
      logger.error(`status-change handling failed: ${String(err?.message ?? err)}`, TAG, {
        boardId: String(event?.boardId), itemId: String(event?.pulseId),
        columnId: String(event?.columnId), error: String(err?.message ?? err),
      });
    });
    const settled = run.finally(() => {
      if (lanes.get(laneKey) === settled) lanes.delete(laneKey);
    });
    lanes.set(laneKey, settled);
    return settled;
  };
}
