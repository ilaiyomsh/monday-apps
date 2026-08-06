/**
 * handleStatusChangeEvent — the watchdog orchestrator (DI factory).
 *
 * Identity model (owner decision, round322): a revert is written AS the column's
 * PRIMARY OWNER, so monday records it under the person the settings screen
 * designated. There is no bot/service account.
 *
 * Per delivery:
 *   1. LOOP GUARD FIRST — before ANY I/O (round360): an event matching a pending
 *      revert marker (same item/column, new value == what we reverted TO, actor
 *      == the marker's stored author) is the echo of our own revert — skip with
 *      zero store/api calls. The marker carries the author, so no rules read is
 *      needed. This check used to sit AFTER the token+rules reads; with 40s-4min
 *      deliveries observed live the 60s marker expired mid-flight and the guard
 *      reverted its own revert in a ~25-minute oscillation storm.
 *   2. Account READER token (any authorized owner); none → skip (unactivated).
 *   3. Load the column's rules (same twystStatus:<board>:<column> blob the picker
 *      reads) with the reader token; no rules → column unguarded → skip.
 *   4. Resolve the PRIMARY OWNER from the rules' owner list and their token
 *      (board-read identity — see the inline comment).
 *   5. Gather only what the verdict needs (labels always; actor teams only when a
 *      rule names teams; people columns / required-field values only when the
 *      target rule gates on them) — the demanded reads are issued CONCURRENTLY
 *      (round360), they are independent. Labels coming back empty → the column
 *      is unreadable → FAIL OPEN: log an error and let the change stand (cannot
 *      classify without labels, so no bypass record either).
 *   6. evaluate() — allowed → done.
 *   7. Revert path (reasons 'not-offered' / 'required-fields-empty' ONLY): the
 *      revert must be written with the PRIMARY OWNER's own token so monday
 *      attributes it to them. No primary-owner token (they have not authorized)
 *      → log and SKIP the revert (fail-open, and loop-safe: a revert written as
 *      the reader would echo as a non-primary user the loop guard cannot catch).
 *      Re-read the cell first and revert only while it still holds the illegal
 *      label (stale/rapid-change guard). AFTER the revert lands the lane is
 *      RELEASED (round360): the notification + bypass append run as a DETACHED
 *      tail (both fail-soft; the tail has its own catch). A non-reverted blocked
 *      event keeps its append awaited — nothing to release early for.
 *      'required-fields-unknown' is logged, never reverted.
 *   8. Per-item serialization: same board+item+column deliveries run one at a
 *      time. BOUNDED REDELIVERY (round360): a delivery that fails on a TRANSIENT
 *      storage error (Vault hiccup) is retried exactly once after retryDelayMs;
 *      any other failure — or the retry failing — lands in the error log.
 *   9. Per-step timing (round360, code:logs only): every evaluated delivery emits
 *      one 'guard timing …' info line with tokens/rules/gql/reread/revert/total
 *      durations, so the 40s-4min latency can be attributed to a step.
 *
 * Every failure is caught and logged — the HTTP layer ack'd 202 long ago, and a
 * throw here would only become an unhandledRejection (error-guard funnel rule).
 *
 * REVERT_NOTIFICATION_TEXT is the owner's exact copy (2026-08-03) — do not edit.
 */

import { classifyViolation, estimateSurface } from '../../../src/domain/bypassReason.js';
import { isFieldValueEmpty, prefillFieldValue } from '../../../src/domain/columnFields.js';
import { normalizeOwners } from '../../../src/domain/columnOwners.js';
import { isTransientStorageError } from '../helpers/secure-storage-resilient.js';

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
 *   api: object, tokenStore: object, rulesStore: object, logger: object,
 *   evaluate?: Function, now?: () => number, retryDelayMs?: number,
 * }} deps
 */
export function createStatusChangeHandler({ api, tokenStore, rulesStore, bypassLog, logger, evaluate, now = () => Date.now(), retryDelayMs = 5000 }) {
  const TAG = 'guard';
  const lanes = new Map();

  // Pending reverts, so the loop guard can tell OUR revert echo from a genuine
  // prohibited edit the primary owner makes by hand. Keyed by board:item:column
  // → the label id we wrote (the echo will carry it as its new value), the
  // revert's AUTHOR (the primary owner — stored at revert time so the echo
  // check needs no rules read), and an expiry.
  //
  // TTL trade-off (round360): 10 minutes, up from 60s. Deliveries were observed
  // live taking 40s-4min end-to-end, so a 60s marker expired before its own
  // echo arrived — the echo was then evaluated as a genuine change, blocked,
  // and the guard reverted its own revert in a ~25-minute oscillation storm.
  // The cost of the longer window: a GENUINE change by the primary owner to
  // exactly the reverted-to value within 10 minutes is skipped ONCE (the marker
  // is consumed on match, so only the first such change is missed). That is a
  // no-op write in almost every case (the cell already holds that value) —
  // vastly cheaper than the storm.
  const pendingReverts = new Map();
  const REVERT_ECHO_TTL_MS = 600_000;
  const echoKey = (boardId, itemId, columnId) => `${boardId}:${itemId}:${columnId}`;

  /**
   * Arm the echo marker for one revert. COUNTED, not a single slot (round360
   * review finding, P1): two reverts to the SAME value can be in flight before
   * the first echo arrives (deliveries were observed taking 40s-4min), and a
   * one-shot marker would let the second echo be evaluated as a genuine change.
   * A revert to a DIFFERENT value overwrites the marker — the orphaned echo (if
   * any) is then evaluated; TTL-bounded and strictly rarer than the same-value
   * case the counter exists for.
   */
  const armEchoMarker = (boardId, itemId, columnId, labelId, actorId) => {
    const key = echoKey(boardId, itemId, columnId);
    const pending = pendingReverts.get(key);
    if (pending && pending.expiresAt >= now() && pending.labelId === labelId && pending.actorId === actorId) {
      pending.count += 1;
      pending.expiresAt = now() + REVERT_ECHO_TTL_MS;
      return;
    }
    pendingReverts.set(key, { labelId, actorId, count: 1, expiresAt: now() + REVERT_ECHO_TTL_MS });
  };

  /**
   * Roll back one arm — called when the revert mutation THREW, so its echo will
   * never arrive (round360 review finding, P2): an orphaned marker would swallow
   * one genuine primary-owner change to this value for up to the 10-minute TTL.
   */
  const disarmEchoMarker = (boardId, itemId, columnId, labelId, actorId) => {
    const key = echoKey(boardId, itemId, columnId);
    const pending = pendingReverts.get(key);
    if (!pending || pending.labelId !== labelId || pending.actorId !== actorId) return;
    pending.count -= 1;
    if (pending.count <= 0) pendingReverts.delete(key);
  };

  /**
   * Is this event the echo of a revert we just performed? (consumes one arm)
   * Pure in-memory check — no I/O — so process() can run it FIRST: it matches
   * item/column, the label we wrote, AND the acting user against the marker's
   * stored author (a same-value change by anyone else is genuine and leaves the
   * marker intact for the real echo).
   */
  const isRevertEcho = (boardId, itemId, columnId, newLabelId, actingUserId) => {
    const key = echoKey(boardId, itemId, columnId);
    const pending = pendingReverts.get(key);
    if (!pending) return false;
    if (pending.expiresAt < now()) { pendingReverts.delete(key); return false; }
    if (pending.labelId !== newLabelId) return false;
    if (pending.actorId !== actingUserId) return false;
    pending.count -= 1; // one echo per revert
    if (pending.count <= 0) pendingReverts.delete(key);
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

    const previousLabelId = labelIdOf(event.previousValue);
    const newLabelId = labelIdOf(event.value);

    // Loop guard — FIRST, before ANY I/O (round360). Skip ONLY the echo of a
    // revert we just performed: same item/column, new value exactly what we
    // reverted TO, authored by the marker's stored author (the primary owner —
    // recorded at revert time, so no rules read is needed here). A genuine
    // prohibited change the primary owner makes by hand does NOT match
    // (different value / no pending marker), so it is monitored and reverted
    // like anyone else's — the owner is not exempt.
    if (isRevertEcho(boardId, itemId, columnId, newLabelId, actingUserId)) {
      logger.info('revert echo skipped — own revert delivered back', TAG, {
        accountId, boardId, columnId, itemId,
      });
      return;
    }

    // Per-step timing (round360): attribute the delivery's latency to a step,
    // one info line per evaluated delivery (see emitTiming). Uses the injected
    // now() so tests control the clock.
    const tStart = now();
    const stepMs = { tokens: 0, rules: 0, gql: 0, reread: 0, revert: 0 };
    const timed = async (step, run) => {
      const t0 = now();
      try {
        return await run();
      } finally {
        // finally, not catch — a failing step still rethrows (error-guard),
        // but its duration is recorded either way.
        stepMs[step] += now() - t0;
      }
    };
    const emitTiming = () => {
      logger.info(
        `guard timing total=${now() - tStart}ms tokens=${stepMs.tokens}ms rules=${stepMs.rules}ms gql=${stepMs.gql}ms reread=${stepMs.reread}ms revert=${stepMs.revert}ms`,
        TAG,
        { accountId, boardId, columnId, itemId },
      );
    };

    const reader = await timed('tokens', () => tokenStore.getReaderToken(accountId));
    if (!reader) {
      logger.info('event skipped: account not activated', TAG, { accountId, boardId, columnId });
      return;
    }
    const readToken = reader.token;

    // accountId enables the rules TTL cache — webhook-only by design: this id is
    // JWT-verified, unlike the sessionToken routes' client-chosen boardId (which
    // must never populate the cache — round360 review finding, P1).
    const rules = await timed('rules', () => rulesStore.getRules(readToken, boardId, columnId, accountId));
    if (!rules) return; // unguarded column

    const owners = normalizeOwners(rules.owners);
    const primaryOwnerId = owners?.primaryOwnerId ?? null;

    // Board reads (labels, item values, the cell re-read) and the revert are
    // BOARD-scoped, and OAuth board visibility is per user. The account reader is
    // whichever owner authorized last — it may not see this column's board. The
    // PRIMARY OWNER configured this column, so their token can read its board;
    // use it for every board-scoped call, falling back to the reader only when
    // the primary owner has not authorized. (getRules above is APP storage —
    // account-scoped — so the reader is always fine there.)
    const primaryToken = primaryOwnerId !== null
      ? await timed('tokens', () => tokenStore.getOwnerToken(accountId, primaryOwnerId))
      : null;
    const boardReadToken = primaryToken ?? readToken;

    const targetRule = rules.labels?.[newLabelId ?? '5'] ?? {};
    const peopleColumnIds = Array.isArray(targetRule.requiredPeopleColumnIds)
      ? targetRule.requiredPeopleColumnIds
      : [];
    const requiredColumnIds = Array.isArray(targetRule.requiredColumnIds)
      ? targetRule.requiredColumnIds
      : [];

    // The board reads are independent of each other — issue the ones this rule
    // demands CONCURRENTLY (round360). The lazy-fetch gating is unchanged: teams
    // only when a rule names teams, item context only when the target rule gates
    // on people/required columns; a gated-off slot resolves to its neutral value.
    const wantsItemContext = peopleColumnIds.length > 0 || requiredColumnIds.length > 0;
    const [labels, teamIds, itemContext] = await timed('gql', () => Promise.all([
      api.getColumnLabels(boardReadToken, boardId, columnId),
      rulesNameTeams(rules)
        ? api.getUserTeamIds(boardReadToken, actingUserId)
        : [],
      wantsItemContext
        ? api.getItemGuardContext(boardReadToken, itemId, { peopleColumnIds, requiredColumnIds })
        : undefined,
    ]));

    // FAIL-OPEN (round360): no labels means the column is unreadable (token
    // scope, deleted column, API hiccup) — evaluate() would classify EVERY new
    // value as not-offered and block legitimate changes (fail-closed, the exact
    // opposite of the app's doctrine). Cannot classify → cannot record a bypass
    // either; let the change stand and make the gap loud in code:logs.
    if (!Array.isArray(labels) || labels.length === 0) {
      logger.error('column labels unreadable/empty — failing open, change not evaluated', TAG, {
        accountId, boardId, columnId, itemId,
      });
      // These are exactly the degraded deliveries the timing line exists to
      // attribute — emit it here too (round360 review finding, P2).
      emitTiming();
      return;
    }

    let peopleByColumnId = {};
    let requiredFieldValues = requiredColumnIds.length > 0 ? [] : null;
    if (wantsItemContext) {
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
    if (verdict.allowed) {
      emitTiming();
      return;
    }
    if (!REVERTABLE_REASONS.includes(verdict.reason)) {
      logger.warn('illegal change NOT reverted (verdict is not revert-worthy)', TAG, {
        accountId, boardId, itemId, columnId, reason: verdict.reason,
      });
      emitTiming();
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
        const currentLabelId = await timed('reread', () => api.getCurrentStatusLabelId(boardReadToken, itemId, columnId));
        if (currentLabelId === newLabelId) {
          // Arm the echo marker BEFORE writing: monday fires the change event for
          // our own revert, authored by the primary owner, carrying
          // previousLabelId. The author is stored so the top-of-process echo
          // check can match it without reading the rules.
          armEchoMarker(boardId, itemId, columnId, previousLabelId, String(primaryOwnerId));
          try {
            await timed('revert', () => api.revertStatus(primaryToken, boardId, itemId, columnId, previousLabelId));
          } catch (err) {
            // The revert never landed → no echo is coming. Disarm what we just
            // armed, then rethrow to the lane funnel (error-guard).
            disarmEchoMarker(boardId, itemId, columnId, previousLabelId, String(primaryOwnerId));
            throw err;
          }
          reverted = true;
          logger.info('illegal status change reverted', TAG, {
            accountId, boardId, itemId, columnId, actingUserId, primaryOwnerId,
            previousLabelId, newLabelId, reason: verdict.reason,
          });
        }
      }
    }

    emitTiming();

    // ---- record the bypass ALWAYS (monitoring is independent of auto-revert) ----
    // The record carries ids + names + the specific violation; the settings
    // monitor resolves user names and renders the Hebrew explanation client-side.
    const recordBypass = async () => {
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
    };

    if (reverted) {
      // RELEASE THE LANE (round360): the revert — the only ordering-critical
      // write — has landed and the echo marker is set. The notification and the
      // bypass append are both fail-soft; running them DETACHED lets the next
      // delivery for this item start immediately instead of queueing behind
      // them. The two tail calls run CONCURRENTLY — a slow notification must not
      // delay the append (the record's ts is stamped when recordBypass starts,
      // i.e. right here, and the monitor sorts by ts; bypassLog's own per-column
      // lane serializes the physical writes) (round360 review finding, P2). The
      // tail's catch keeps every failure logged (error-guard) — never an
      // unhandledRejection.
      const tail = Promise.all([
        api.notifyUser(primaryToken, event.userId, itemId, REVERT_NOTIFICATION_TEXT).catch((err) => {
          // The revert already landed — a failed notification must not fail the event.
          logger.error(`revert notification failed: ${String(err?.message ?? err)}`, TAG, {
            accountId, itemId, error: String(err?.message ?? err),
          });
        }),
        recordBypass(),
      ]);
      tail.catch((err) => {
        logger.error(`post-revert tail failed: ${String(err?.message ?? err)}`, TAG, {
          accountId, boardId, itemId, columnId, error: String(err?.message ?? err),
        });
      });
      return;
    }

    // Non-reverted blocked event: nothing was released early — the append stays
    // on the lane so the record is settled before the delivery counts as done.
    await recordBypass();
  }

  return function handle(event) {
    const laneKey = `${event?.boardId}:${event?.pulseId}:${event?.columnId}`;
    const previous = lanes.get(laneKey) ?? Promise.resolve();
    const run = previous.then(() => process(event)).catch(async (err) => {
      // BOUNDED REDELIVERY (round360): monday-code Vault hiccups are transient
      // (see secure-storage-resilient) — one in-process retry after retryDelayMs
      // salvages the delivery instead of dropping it. Exactly ONE retry, and
      // ONLY for transient storage errors: anything else rethrows to the error
      // log below, and a failing retry does too.
      if (!isTransientStorageError(err)) throw err;
      logger.warn(`transient storage failure — retrying delivery once in ${retryDelayMs}ms: ${String(err?.message ?? err)}`, TAG, {
        boardId: String(event?.boardId), itemId: String(event?.pulseId),
        columnId: String(event?.columnId),
      });
      await new Promise((resolve) => { setTimeout(resolve, retryDelayMs); });
      return process(event);
    }).catch((err) => {
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
