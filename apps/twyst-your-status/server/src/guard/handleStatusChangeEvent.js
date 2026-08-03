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

import { normalizeOwners } from '../../../src/domain/columnOwners.js';

export const REVERT_NOTIFICATION_TEXT =
  'השינוי שבוצע בוטל - מכיוון שאינו עומד בהגדרות העמודה';

/** Reasons that justify writing the previous value back. */
export const REVERTABLE_REASONS = ['not-offered', 'required-fields-empty'];

/**
 * @param {{
 *   api: object, tokenStore: object, rulesStore: object, logger: object,
 *   evaluate?: Function,
 * }} deps
 */
export function createStatusChangeHandler({ api, tokenStore, rulesStore, logger, evaluate }) {
  const TAG = 'guard';
  const lanes = new Map();

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
    // Loop guard: our own revert comes back as an event authored by the primary
    // owner. Skip it — policing it would revert the revert, forever.
    if (primaryOwnerId !== null && actingUserId === primaryOwnerId) return;

    const previousLabelId = labelIdOf(event.previousValue);
    const newLabelId = labelIdOf(event.value);

    const targetRule = rules.labels?.[newLabelId ?? '5'] ?? {};
    const peopleColumnIds = Array.isArray(targetRule.requiredPeopleColumnIds)
      ? targetRule.requiredPeopleColumnIds
      : [];
    const requiredColumnIds = Array.isArray(targetRule.requiredColumnIds)
      ? targetRule.requiredColumnIds
      : [];

    const labels = await api.getColumnLabels(readToken, boardId, columnId);
    const teamIds = rulesNameTeams(rules)
      ? await api.getUserTeamIds(readToken, actingUserId)
      : [];

    let peopleByColumnId = {};
    let requiredFieldValues = requiredColumnIds.length > 0 ? [] : null;
    if (peopleColumnIds.length > 0 || requiredColumnIds.length > 0) {
      const itemContext = await api.getItemGuardContext(readToken, itemId, {
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
    if (verdict.allowed) return;

    if (!REVERTABLE_REASONS.includes(verdict.reason)) {
      logger.warn('illegal change NOT reverted (verdict is not revert-worthy)', TAG, {
        accountId, boardId, itemId, columnId, reason: verdict.reason,
      });
      return;
    }

    // The revert must be written AS the primary owner (attribution). Without a
    // primary owner, or without that owner's token, we cannot attribute — and
    // reverting as anyone else breaks the loop guard — so skip, loudly.
    if (primaryOwnerId === null) {
      logger.warn('illegal change NOT reverted: column has no owners configured', TAG, {
        accountId, boardId, itemId, columnId,
      });
      return;
    }
    const primaryToken = await tokenStore.getOwnerToken(accountId, primaryOwnerId);
    if (!primaryToken) {
      logger.warn('illegal change NOT reverted: primary owner has not authorized the guard', TAG, {
        accountId, boardId, itemId, columnId, primaryOwnerId,
      });
      return;
    }

    // Stale guard: only revert while the cell still holds the illegal value.
    const currentLabelId = await api.getCurrentStatusLabelId(readToken, itemId, columnId);
    if (currentLabelId !== newLabelId) return;

    await api.revertStatus(primaryToken, boardId, itemId, columnId, previousLabelId);
    logger.info('illegal status change reverted', TAG, {
      accountId, boardId, itemId, columnId, actingUserId, primaryOwnerId,
      previousLabelId, newLabelId, reason: verdict.reason,
    });
    try {
      await api.notifyUser(primaryToken, event.userId, itemId, REVERT_NOTIFICATION_TEXT);
    } catch (err) {
      // The revert already landed — a failed notification must not fail the event.
      logger.error('revert notification failed', TAG, {
        accountId, itemId, error: String(err?.message ?? err),
      });
    }
  }

  return function handle(event) {
    const laneKey = `${event?.boardId}:${event?.pulseId}:${event?.columnId}`;
    const previous = lanes.get(laneKey) ?? Promise.resolve();
    const run = previous.then(() => process(event)).catch((err) => {
      logger.error('status-change handling failed', TAG, {
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
