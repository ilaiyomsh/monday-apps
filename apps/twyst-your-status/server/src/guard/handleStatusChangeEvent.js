/**
 * handleStatusChangeEvent — the watchdog orchestrator (DI factory).
 *
 * One instance per process handles every change_status_column_value delivery:
 *   1. Resolve the account's stored OAuth token; no token → log + skip (fail-soft:
 *      an unactivated account is not an error storm).
 *   2. Loop guard: an event whose userId is the guard's own bot user is the echo
 *      of a revert — skip silently, or reverts would revert themselves forever.
 *   3. Load the column's rules (same twystStatus:<boardId>:<columnId> blob the
 *      picker reads); no rules → column unguarded → skip.
 *   4. Gather exactly what the verdict needs (labels always; actor teams only when
 *      some rule names teams; people columns only when the target rule gates on
 *      them; required-field values only when the target rule requires fields).
 *   5. evaluate() — allowed → done.
 *   6. Revert path (reasons 'not-offered' / 'required-fields-empty' ONLY):
 *      re-read the CURRENT cell value first and revert only while it still holds
 *      the illegal label — never clobber a newer, possibly-legal change (stale
 *      webhook / rapid sequence). Then notify the acting user (exact copy below).
 *      'required-fields-unknown' is logged, never reverted (see evaluateStatusChange).
 *   7. Per-item serialization: deliveries for the same board+item+column run one
 *      at a time (rapid changes must not interleave their read-then-revert).
 *
 * Every failure is caught and logged — the HTTP layer ack'd 202 long ago, and a
 * throw here would only become an unhandledRejection (error-guard funnel rule).
 *
 * REVERT_NOTIFICATION_TEXT is the owner's exact copy (2026-08-03) — do not edit.
 */

export const REVERT_NOTIFICATION_TEXT =
  'השינוי שבוצע בוטל - מכיוון שאינו עומד בהגדרות העמודה';

/** Reasons that justify writing the previous value back. */
export const REVERTABLE_REASONS = ['not-offered', 'required-fields-empty'];

/**
 * @param {{
 *   api: object,          // monday-api funnel (createMondayApi)
 *   tokenStore: object,   // getToken(accountId), getBotUserId(accountId)
 *   rulesStore: object,   // getRules(token, boardId, columnId)
 *   logger: object,
 *   evaluate?: Function,  // evaluateStatusChange (injectable for tests)
 * }} deps
 * @returns {(event: {
 *   accountId: string, userId: string|number, boardId: string|number,
 *   pulseId: string|number, columnId: string,
 *   value: object|null, previousValue: object|null,
 * }) => Promise<void>}
 */
export function createStatusChangeHandler({ api, tokenStore, rulesStore, logger, evaluate }) {
  const TAG = 'guard';
  /** Per-item promise chains — same board+item+column runs strictly one at a time. */
  const lanes = new Map();

  const labelIdOf = (statusValue) => {
    const index = statusValue?.label?.index;
    return typeof index === 'number' && Number.isInteger(index) && index >= 0
      ? String(index)
      : null;
  };

  /** Does any rule in the blob name a team allowlist? (fetch teams only then) */
  const rulesNameTeams = (rules) => Object.values(rules?.labels ?? {})
    .some((rule) => Array.isArray(rule?.allowedTeamIds) && rule.allowedTeamIds.length > 0);

  async function process(event) {
    const accountId = String(event.accountId);
    const boardId = String(event.boardId);
    const itemId = String(event.pulseId);
    const columnId = String(event.columnId);
    const actingUserId = String(event.userId);

    const activation = await tokenStore.getActivation(accountId);
    if (!activation) {
      logger.info('event skipped: account not activated', TAG, { accountId, boardId, columnId });
      return;
    }
    // Loop guard — our own revert comes back as an event by the bot user; policing
    // it would revert the revert, forever.
    if (actingUserId === String(activation.botUserId)) return;

    const { token } = activation;
    const rules = await rulesStore.getRules(token, boardId, columnId);
    if (!rules) return; // unguarded column

    const previousLabelId = labelIdOf(event.previousValue);
    const newLabelId = labelIdOf(event.value);

    const targetRule = rules.labels?.[newLabelId ?? '5'] ?? {};
    const peopleColumnIds = Array.isArray(targetRule.requiredPeopleColumnIds)
      ? targetRule.requiredPeopleColumnIds
      : [];
    const requiredColumnIds = Array.isArray(targetRule.requiredColumnIds)
      ? targetRule.requiredColumnIds
      : [];

    const labels = await api.getColumnLabels(token, boardId, columnId);
    const teamIds = rulesNameTeams(rules)
      ? await api.getUserTeamIds(token, actingUserId)
      : [];

    let peopleByColumnId = {};
    let requiredFieldValues = requiredColumnIds.length > 0 ? [] : null;
    if (peopleColumnIds.length > 0 || requiredColumnIds.length > 0) {
      const itemContext = await api.getItemGuardContext(token, itemId, {
        peopleColumnIds,
        requiredColumnIds,
      });
      // Item unreadable while its rule demands fields → evaluate must see "unknown",
      // not "empty" — a revert on OUR read failure would punish a legal change.
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

    // Stale guard: only revert while the cell still holds the illegal value —
    // never clobber a newer (possibly legal) change from a rapid sequence.
    const currentLabelId = await api.getCurrentStatusLabelId(token, itemId, columnId);
    if (currentLabelId !== newLabelId) return;

    await api.revertStatus(token, boardId, itemId, columnId, previousLabelId);
    logger.info('illegal status change reverted', TAG, {
      accountId, boardId, itemId, columnId, actingUserId, previousLabelId, newLabelId, reason: verdict.reason,
    });
    try {
      await api.notifyUser(token, event.userId, itemId, REVERT_NOTIFICATION_TEXT);
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
      // Fail-soft funnel: the HTTP layer ack'd long ago; a throw here would only
      // become an unhandledRejection. Log with enough context to triage.
      logger.error('status-change handling failed', TAG, {
        boardId: String(event?.boardId), itemId: String(event?.pulseId),
        columnId: String(event?.columnId), error: String(err?.message ?? err),
      });
    });
    // The lane must survive a failed run (the catch above already absorbed any
    // rejection, so this finally-chained promise cannot reject either).
    const settled = run.finally(() => {
      if (lanes.get(laneKey) === settled) lanes.delete(laneKey);
    });
    lanes.set(laneKey, settled);
    return settled;
  };
}
