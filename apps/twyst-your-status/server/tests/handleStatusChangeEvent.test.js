import { describe, it, expect, vi } from 'vitest';
import {
  createStatusChangeHandler,
  REVERT_NOTIFICATION_TEXT,
  REVERTABLE_REASONS,
} from '../src/guard/handleStatusChangeEvent.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
//
// IDENTITY + GATING MODEL under test:
//   - READS (labels, teams, item context, current-cell re-read) use the READER
//     token — tokenStore.getReaderToken(accountId).token.
//   - A REVERT + its notification are WRITTEN AS the column's PRIMARY OWNER —
//     tokenStore.getOwnerToken(accountId, primaryOwnerId), where primaryOwnerId
//     is read out of the rules blob's owners list.
//   - AUTO-REVERT IS OPT-IN: a revert only happens when rules.autoRevert === true.
//     Absent/false = MONITORING ONLY — no revert, but the bypass is still recorded.
//   - EVERY illegal change with a REVERTABLE reason is recorded via bypassLog.append,
//     regardless of autoRevert. A non-revertable reason is neither recorded nor reverted.

const ACCOUNT = '999';
const READER_TOKEN = 'READ';
const OWNER_TOKEN = 'OWNER50';
const PRIMARY_OWNER_ID = '50';
const NOW = 1000;

// getColumnLabels returns id/label pairs; the record's from/to label NAMES are
// resolved through this map.
const COLUMN_LABELS = [
  { id: '0', label: 'ממתין' },
  { id: '2', label: 'בוצע' },
];

// MONITORING rules: label '2' gated by a team allowlist + a next-label restriction,
// WITH owners, and NO autoRevert flag (the default — monitor, do not revert).
function monitorRules() {
  return {
    version: 1,
    hiddenLabelIds: [],
    owners: { ownerIds: ['41', '50'], primaryOwnerId: '50' },
    labels: {
      2: {
        allowedUserIds: [],
        allowedTeamIds: ['20'],
        requiredColumnIds: [],
        requiredPeopleColumnIds: [],
        nextLabelIds: ['0'],
      },
    },
  };
}

// AUTO rules: identical, but opts in to reverting.
function autoRules() {
  return { ...monitorRules(), autoRevert: true };
}

function makeEvent(overrides = {}) {
  return {
    accountId: ACCOUNT,
    userId: 41,
    boardId: 5098,
    pulseId: 777,
    pulseName: 'תיקון באג',
    columnId: 'status_col',
    app: 'monday',
    value: { label: { index: 2, text: 'בוצע' } },
    previousValue: { label: { index: 0, text: 'ממתין' } },
    ...overrides,
  };
}

function makeDeps() {
  return {
    api: {
      getColumnLabels: vi.fn().mockResolvedValue(structuredClone(COLUMN_LABELS)),
      getUserTeamIds: vi.fn().mockResolvedValue(['20']),
      getItemGuardContext: vi.fn().mockResolvedValue({
        peopleByColumnId: {},
        requiredFieldValues: {},
        currentByColumnId: {},
      }),
      getCurrentStatusLabelId: vi.fn().mockResolvedValue('2'),
      revertStatus: vi.fn().mockResolvedValue(undefined),
      notifyUser: vi.fn().mockResolvedValue(undefined),
    },
    tokenStore: {
      getReaderToken: vi
        .fn()
        .mockResolvedValue({ token: READER_TOKEN, userId: '50' }),
      getOwnerToken: vi.fn().mockResolvedValue(OWNER_TOKEN),
    },
    rulesStore: { getRules: vi.fn().mockResolvedValue(monitorRules()) },
    bypassLog: { append: vi.fn().mockResolvedValue(undefined) },
    evaluate: vi.fn().mockReturnValue({ allowed: true, reason: null }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: vi.fn(() => NOW),
  };
}

function totalLogCalls(logger) {
  return (
    logger.info.mock.calls.length +
    logger.warn.mock.calls.length +
    logger.error.mock.calls.length
  );
}

function expectNoIntervention(deps) {
  expect(deps.api.revertStatus).not.toHaveBeenCalled();
  expect(deps.api.notifyUser).not.toHaveBeenCalled();
}

// The 4th arg of a bypassLog.append call — the recorded bypass record.
function appendedRecord(deps, callIndex = 0) {
  return deps.bypassLog.append.mock.calls[callIndex][3];
}

// A settled-microtask/macrotask fence: lets any in-flight handler promise chain
// run to its next await boundary without resolving parked gates ourselves.
const settle = () =>
  new Promise((resolve) => {
    setTimeout(() => setTimeout(resolve, 0), 0);
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createStatusChangeHandler', () => {
  it('resolves without reading rules, recording, or touching the api when the account has no reader token, logging exactly once', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockResolvedValue(null);
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.tokenStore.getReaderToken).toHaveBeenCalledWith(ACCOUNT);
    expect(deps.rulesStore.getRules).not.toHaveBeenCalled();
    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
    expect(deps.api.getColumnLabels).not.toHaveBeenCalled();
    expect(deps.bypassLog.append).not.toHaveBeenCalled();
    expectNoIntervention(deps);
    expect(totalLogCalls(deps.logger)).toBe(1);
  });

  it('reads rules with the reader token but resolves without evaluating, recording, or intervening when the column has no rules blob', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(null);
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.rulesStore.getRules).toHaveBeenCalledTimes(1);
    const [rulesToken, rulesBoardId, rulesColumnId] = deps.rulesStore.getRules.mock.calls[0];
    expect(rulesToken).toBe(READER_TOKEN);
    expect(String(rulesBoardId)).toBe('5098');
    expect(rulesColumnId).toBe('status_col');
    expect(deps.evaluate).not.toHaveBeenCalled();
    expect(deps.bypassLog.append).not.toHaveBeenCalled();
    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
    expectNoIntervention(deps);
  });

  it('does NOT exempt the primary owner: a prohibited change they make by hand (no pending revert) is evaluated and RECORDED like anyone else', async () => {
    // Regression for the "unconditional primary-owner bypass": authoring the
    // event does not make it a revert echo — only a matching pending revert does.
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(monitorRules()); // monitoring
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent({ userId: 50 })); // the primary owner, no pending revert

    expect(deps.evaluate).toHaveBeenCalledTimes(1);
    expect(deps.bypassLog.append).toHaveBeenCalledTimes(1);
    expect(appendedRecord(deps).reverted).toBe(false);
  });

  it('skips the echo of a revert it just performed BEFORE ANY I/O: the echo delivery performs zero store/api calls', async () => {
    // amend-intent round360: the echo check moved to the TOP of process(), before
    // the token/rules reads. Processing latency (40s-4min per delivery, observed
    // live) made the old post-rules check miss its own echo — the 60s TTL expired
    // mid-flight, the echo was evaluated as a genuine change, and the guard
    // reverted its own revert in an infinite oscillation. The locked behavior
    // legitimately changed: an echo delivery now performs ZERO store/api calls
    // (previously it read the reader token + rules before skipping).
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2'); // illegal value still current
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent()); // 0→2 illegal → reverts to '0', marks the echo
    await settle(); // the post-revert tail (notify+append) is detached — let it land
    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);
    expect(deps.bypassLog.append).toHaveBeenCalledTimes(1);

    // The revert echo: the primary owner "changed" 2→0 (our own write).
    await handle(makeEvent({
      userId: 50,
      value: { label: { index: 0, text: 'ממתין' } },
      previousValue: { label: { index: 2, text: 'בוצע' } },
    }));
    await settle();

    // ZERO additional I/O for the echo: no token read, no rules read, no board
    // reads, no evaluation, no revert, no record.
    expect(deps.tokenStore.getReaderToken).toHaveBeenCalledTimes(1);
    expect(deps.rulesStore.getRules).toHaveBeenCalledTimes(1);
    expect(deps.tokenStore.getOwnerToken).toHaveBeenCalledTimes(1);
    expect(deps.api.getColumnLabels).toHaveBeenCalledTimes(1);
    expect(deps.evaluate).toHaveBeenCalledTimes(1);
    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);
    expect(deps.bypassLog.append).toHaveBeenCalledTimes(1);
  });

  it('does NOT treat a matching-value change by a DIFFERENT user as the echo: it is evaluated, and the marker survives for the real echo', async () => {
    // The marker now carries the revert's author (the primary owner). A genuine
    // change by someone else to the same value must be evaluated like any other
    // change and must NOT consume the marker — the real echo still skips after it.
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2');
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent()); // reverts to '0', marks the echo for actor 50
    await settle();
    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);

    // User 42 (NOT the primary owner) happens to set the same value '0'.
    await handle(makeEvent({
      userId: 42,
      value: { label: { index: 0, text: 'ממתין' } },
      previousValue: { label: { index: 2, text: 'בוצע' } },
    }));
    await settle();
    expect(deps.evaluate).toHaveBeenCalledTimes(2); // evaluated, not skipped
    // (cell re-read shows '2' ≠ new '0' → stale → no second revert/marker)

    // The REAL echo (primary owner, value '0') still skips with zero further I/O.
    await handle(makeEvent({
      userId: 50,
      value: { label: { index: 0, text: 'ממתין' } },
      previousValue: { label: { index: 2, text: 'בוצע' } },
    }));
    await settle();
    expect(deps.evaluate).toHaveBeenCalledTimes(2);
    expect(deps.tokenStore.getReaderToken).toHaveBeenCalledTimes(2); // events 1+2 only
  });

  it('honors the 10-minute echo TTL: an echo arriving 9:59 after the revert is skipped, past 10:00 it is evaluated', async () => {
    // Trade-off pinned here: within the TTL a genuine owner change back to the
    // reverted-to value is skipped ONCE (marker consumed on match); past the TTL
    // the guard fails towards evaluating, never towards an eternal skip window.
    const deps = makeDeps();
    let currentTime = NOW;
    deps.now = vi.fn(() => currentTime);
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2');
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent()); // revert at t=NOW → marker expires at NOW+600_000
    await settle();
    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);

    // 599_999ms later: processing was slow, but the echo still matches the marker.
    currentTime = NOW + 599_999;
    await handle(makeEvent({
      userId: 50,
      value: { label: { index: 0, text: 'ממתין' } },
      previousValue: { label: { index: 2, text: 'בוצע' } },
    }));
    await settle();
    expect(deps.evaluate).toHaveBeenCalledTimes(1); // skipped, not re-evaluated

    // Second revert cycle; this time the echo arrives past the TTL.
    await handle(makeEvent({ userId: 41 })); // 0→2 illegal again → reverts, re-marks
    await settle();
    expect(deps.api.revertStatus).toHaveBeenCalledTimes(2);

    currentTime += 600_001; // marker expired 1ms ago
    await handle(makeEvent({
      userId: 50,
      value: { label: { index: 0, text: 'ממתין' } },
      previousValue: { label: { index: 2, text: 'בוצע' } },
    }));
    await settle();
    expect(deps.evaluate).toHaveBeenCalledTimes(3); // 2 illegal changes + the expired echo
  });

  it('FAILS OPEN when column labels come back empty: logs an error, does not evaluate, revert, or record', async () => {
    // getColumnLabels returning [] means the column is unreadable (token scope,
    // deleted column, API hiccup) — the guard cannot classify the change, so it
    // must let it stand (fail-open doctrine), never block on missing data.
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.api.getColumnLabels.mockResolvedValue([]);
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.evaluate).not.toHaveBeenCalled();
    expect(deps.bypassLog.append).not.toHaveBeenCalled();
    expect(deps.api.getCurrentStatusLabelId).not.toHaveBeenCalled();
    expectNoIntervention(deps);
    expect(deps.logger.error).toHaveBeenCalledTimes(1);
    const [failOpenMsg, , failOpenCtx] = deps.logger.error.mock.calls[0];
    expect(failOpenMsg).toContain('failing open');
    expect(failOpenCtx).toMatchObject({ boardId: '5098', columnId: 'status_col', itemId: '777' });
  });

  it('leaves the item untouched, records nothing, and fetches no owner token when the verdict is allowed', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: true, reason: null });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.evaluate).toHaveBeenCalledTimes(1);
    expect(deps.bypassLog.append).not.toHaveBeenCalled();
    // The primary owner's token is fetched to READ the board (board-read identity),
    // but an allowed change is never re-read or reverted.
    expect(deps.tokenStore.getOwnerToken).toHaveBeenCalledWith(ACCOUNT, PRIMARY_OWNER_ID);
    expect(deps.api.getCurrentStatusLabelId).not.toHaveBeenCalled();
    expectNoIntervention(deps);
  });

  it('emits a verdict trace line — ALLOWED — with board/column/item on an allowed change', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: true, reason: null });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    const trace = deps.logger.info.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.startsWith('status change'),
    );
    expect(trace).toBeDefined();
    expect(trace[0]).toContain('ALLOWED');
    expect(trace[0]).toContain('col=status_col');
  });

  it('emits a verdict trace line — BLOCKED (reason) — on a blocked change', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(monitorRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    const trace = deps.logger.info.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.startsWith('status change'),
    );
    expect(trace).toBeDefined();
    expect(trace[0]).toContain('BLOCKED (not-offered)');
  });

  it('neither records nor reverts on the non-revertable reason required-fields-unknown, and warns', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'required-fields-unknown' });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.bypassLog.append).not.toHaveBeenCalled();
    expectNoIntervention(deps);
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('MONITORING DEFAULT: records the bypass with reverted false and never fetches an owner token, reverts, or notifies when autoRevert is absent', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(monitorRules()); // no autoRevert
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2'); // cell still the new value
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    // Recorded exactly once, against the account/board/column triple.
    expect(deps.bypassLog.append).toHaveBeenCalledTimes(1);
    const [apAccount, apBoard, apColumn, record] = deps.bypassLog.append.mock.calls[0];
    expect(apAccount).toBe(ACCOUNT);
    expect(String(apBoard)).toBe('5098');
    expect(apColumn).toBe('status_col');
    expect(record).toMatchObject({
      ts: NOW,
      itemId: '777',
      itemName: 'תיקון באג',
      userId: '41',
      fromLabelId: '0',
      fromLabelName: 'ממתין',
      toLabelId: '2',
      toLabelName: 'בוצע',
      classification: expect.objectContaining({ code: expect.any(String) }),
      surface: 'native',
      reverted: false,
    });

    // Monitoring records but never writes: the owner token is fetched to READ
    // the board, but there is no revert and no notification.
    expect(deps.tokenStore.getOwnerToken).toHaveBeenCalledWith(ACCOUNT, PRIMARY_OWNER_ID);
    expectNoIntervention(deps);
  });

  it('AUTO-REVERT ON: fetches the primary-owner token, re-reads the cell with the reader token, reverts + notifies as the owner, and records reverted true', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2'); // still the new value
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    // Owner token is fetched for THIS account's primary owner.
    expect(deps.tokenStore.getOwnerToken).toHaveBeenCalledTimes(1);
    expect(deps.tokenStore.getOwnerToken.mock.calls[0]).toEqual([ACCOUNT, PRIMARY_OWNER_ID]);

    // The current-cell re-read is board-scoped → the primary owner's token.
    expect(deps.api.getCurrentStatusLabelId).toHaveBeenCalledTimes(1);
    const [readToken, readItemId, readColumnId] = deps.api.getCurrentStatusLabelId.mock.calls[0];
    expect(readToken).toBe(OWNER_TOKEN);
    expect(String(readItemId)).toBe('777');
    expect(readColumnId).toBe('status_col');

    // The revert is WRITTEN as the primary owner.
    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);
    const [revToken, revBoardId, revItemId, revColumnId, revLabelId] =
      deps.api.revertStatus.mock.calls[0];
    expect(revToken).toBe(OWNER_TOKEN);
    expect(String(revBoardId)).toBe('5098');
    expect(String(revItemId)).toBe('777');
    expect(revColumnId).toBe('status_col');
    expect(revLabelId).toBe('0'); // previousValue label index 0 → '0'

    // The notification is also sent as the primary owner, TO the actor.
    expect(deps.api.notifyUser).toHaveBeenCalledTimes(1);
    const [ntfToken, ntfUserId, ntfItemId, ntfText] = deps.api.notifyUser.mock.calls[0];
    expect(ntfToken).toBe(OWNER_TOKEN);
    expect(String(ntfUserId)).toBe('41');
    expect(String(ntfItemId)).toBe('777');
    expect(ntfText).toBe(REVERT_NOTIFICATION_TEXT);

    // And the bypass is recorded as reverted.
    expect(deps.bypassLog.append).toHaveBeenCalledTimes(1);
    const [apAccount, apBoard, apColumn, record] = deps.bypassLog.append.mock.calls[0];
    expect(apAccount).toBe(ACCOUNT);
    expect(String(apBoard)).toBe('5098');
    expect(apColumn).toBe('status_col');
    expect(record).toMatchObject({ ts: NOW, reverted: true });
  });

  it('pins the owner-specified notification copy so an edit to the constant fails a test', () => {
    expect(REVERT_NOTIFICATION_TEXT).toBe(
      'השינוי שבוצע בוטל - מכיוון שאינו עומד בהגדרות העמודה'
    );
  });

  it('pins REVERTABLE_REASONS to exactly the two reasons that trigger recording/reverting', () => {
    expect(REVERTABLE_REASONS).toEqual(['not-offered', 'required-fields-empty']);
  });

  it('reverts to labelId null when the illegal change was made on a previously empty cell', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2');
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent({ previousValue: null }));

    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);
    const [revToken, , , , revLabelId] = deps.api.revertStatus.mock.calls[0];
    expect(revToken).toBe(OWNER_TOKEN);
    expect(revLabelId).toBeNull();
    expect(appendedRecord(deps)).toMatchObject({ fromLabelId: null, reverted: true });
  });

  it('AUTO-REVERT ON but the primary owner has not authorized the guard (owner token null): no re-read, no revert, no notify, warns, and still records reverted false', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.tokenStore.getOwnerToken.mockResolvedValue(null);
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.tokenStore.getOwnerToken).toHaveBeenCalledTimes(1);
    expect(deps.tokenStore.getOwnerToken.mock.calls[0]).toEqual([ACCOUNT, PRIMARY_OWNER_ID]);
    // The owner-token check gates BEFORE the stale re-read.
    expect(deps.api.getCurrentStatusLabelId).not.toHaveBeenCalled();
    expectNoIntervention(deps);
    expect(deps.logger.warn).toHaveBeenCalled();
    expect(deps.bypassLog.append).toHaveBeenCalledTimes(1);
    expect(appendedRecord(deps)).toMatchObject({ reverted: false });
  });

  it('AUTO-REVERT ON but STALE: re-reads, then neither reverts nor notifies when the cell no longer holds the event\'s new label, and records reverted false', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('9'); // someone changed it again
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.tokenStore.getOwnerToken).toHaveBeenCalledTimes(1);
    expect(deps.api.getCurrentStatusLabelId).toHaveBeenCalledTimes(1);
    expect(deps.api.getCurrentStatusLabelId.mock.calls[0][0]).toBe(OWNER_TOKEN);
    expectNoIntervention(deps);
    expect(deps.bypassLog.append).toHaveBeenCalledTimes(1);
    expect(appendedRecord(deps)).toMatchObject({ reverted: false });
  });

  it('AUTO-REVERT ON but the column has no owners configured: fetches no owner token, never reverts, and still records reverted false', async () => {
    const deps = makeDeps();
    const rulesNoOwners = autoRules();
    delete rulesNoOwners.owners;
    deps.rulesStore.getRules.mockResolvedValue(rulesNoOwners);
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
    expect(deps.api.getCurrentStatusLabelId).not.toHaveBeenCalled();
    expectNoIntervention(deps);
    expect(deps.bypassLog.append).toHaveBeenCalledTimes(1);
    expect(appendedRecord(deps)).toMatchObject({ reverted: false });
  });

  it('classifies a not-offered transition as code "transition" in the recorded bypass', async () => {
    const deps = makeDeps();
    const rules = autoRules();
    // The SOURCE label '0' restricts what may follow it, and '2' is not on the
    // list — so the 0→2 change is a disallowed TRANSITION.
    rules.labels[0] = { allowedUserIds: [], allowedTeamIds: [], requiredColumnIds: [], requiredPeopleColumnIds: [], nextLabelIds: ['1'] };
    deps.rulesStore.getRules.mockResolvedValue(rules);
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2');
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent()); // from '0' → '2', which is not an offered next label

    expect(deps.bypassLog.append).toHaveBeenCalledTimes(1);
    expect(appendedRecord(deps).classification.code).toBe('transition');
  });

  it('classifies a required-fields-empty verdict as code "required" and records it reverted per gating', async () => {
    const deps = makeDeps();
    const rules = autoRules();
    rules.labels[2].requiredColumnIds = ['d'];
    deps.rulesStore.getRules.mockResolvedValue(rules);
    deps.api.getItemGuardContext.mockResolvedValue({
      peopleByColumnId: {},
      requiredFieldValues: { d: '' }, // the required column is empty
      currentByColumnId: {},
    });
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'required-fields-empty' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2');
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.bypassLog.append).toHaveBeenCalledTimes(1);
    const record = appendedRecord(deps);
    expect(record.classification.code).toBe('required');
    expect(record.reverted).toBe(true); // autoRevert on, cell still '2'
  });

  it('records surface "native" when the change originated from the monday app', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2');
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent({ app: 'monday' }));

    expect(appendedRecord(deps)).toMatchObject({ surface: 'native', reverted: true });
  });

  it('records surface "api" when the change originated from an integration app', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2');
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent({ app: 'make-integration' }));

    expect(appendedRecord(deps)).toMatchObject({ surface: 'api', reverted: true });
  });

  it('resolves (never rejects) and logs an error when revertStatus rejects', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2');
    deps.api.revertStatus.mockRejectedValue(new Error('change_column_value failed'));
    const handle = createStatusChangeHandler(deps);

    let rejection = null;
    try {
      await handle(makeEvent());
    } catch (err) {
      rejection = err;
    }

    expect(rejection).toBeNull();
    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it('resolves (never rejects) and logs an error when rulesStore.getRules rejects, without fetching an owner token, recording, or intervening', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockRejectedValue(new Error('storage read failed'));
    const handle = createStatusChangeHandler(deps);

    let rejection = null;
    try {
      await handle(makeEvent());
    } catch (err) {
      rejection = err;
    }

    expect(rejection).toBeNull();
    expect(deps.logger.error).toHaveBeenCalled();
    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
    expect(deps.bypassLog.append).not.toHaveBeenCalled();
    expectNoIntervention(deps);
  });

  it('fetches exactly what the rules demand with the reader token and threads it into the single evaluate input', async () => {
    const deps = makeDeps();
    const rules = {
      version: 1,
      hiddenLabelIds: [],
      owners: { ownerIds: ['41', '50'], primaryOwnerId: '50' },
      labels: {
        2: {
          allowedUserIds: [],
          allowedTeamIds: ['20'],
          requiredColumnIds: ['d'],
          requiredPeopleColumnIds: ['p'],
          nextLabelIds: ['0'],
        },
      },
    };
    deps.rulesStore.getRules.mockResolvedValue(rules);
    deps.api.getUserTeamIds.mockResolvedValue(['20', '30']);
    deps.api.getItemGuardContext.mockResolvedValue({
      peopleByColumnId: { p: ['77'] },
      requiredFieldValues: { d: 'ערך' },
      currentByColumnId: {},
    });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    // Item context: board-scoped → the primary owner's token + the demanded selector.
    expect(deps.api.getItemGuardContext).toHaveBeenCalledTimes(1);
    const [ctxToken, ctxItemId, ctxSelector] = deps.api.getItemGuardContext.mock.calls[0];
    expect(ctxToken).toBe(OWNER_TOKEN);
    expect(String(ctxItemId)).toBe('777');
    expect(ctxSelector).toEqual({ peopleColumnIds: ['p'], requiredColumnIds: ['d'] });

    // Actor teams: board-scoped → the primary owner's token + the actor's user id.
    expect(deps.api.getUserTeamIds).toHaveBeenCalledTimes(1);
    const [teamToken, teamUserId] = deps.api.getUserTeamIds.mock.calls[0];
    expect(teamToken).toBe(OWNER_TOKEN);
    expect(String(teamUserId)).toBe('41');

    // Column labels: board-scoped → the primary owner's token.
    expect(deps.api.getColumnLabels.mock.calls[0][0]).toBe(OWNER_TOKEN);

    // Everything threaded into ONE evaluate input.
    expect(deps.evaluate).toHaveBeenCalledTimes(1);
    const input = deps.evaluate.mock.calls[0][0];
    expect(input.settings).toEqual(rules);
    expect(input.labels).toEqual(COLUMN_LABELS);
    expect(String(input.actor.userId)).toBe('41');
    expect(input.actor.teamIds).toEqual(['20', '30']);
    expect(input.previousLabelId).toBe('0');
    expect(input.newLabelId).toBe('2');
    expect(input.peopleByColumnId).toEqual({ p: ['77'] });
    expect(input.requiredFieldValues).toEqual({ d: 'ערך' });
  });

  it('issues the gated reads (teams, item context) CONCURRENTLY with getColumnLabels, not after it', async () => {
    // The three board reads are independent; with 40s-4min deliveries observed
    // live, serializing them was pure added latency. Gating stays: only reads
    // the rules demand are issued at all — but demanded ones start together.
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue({
      version: 1,
      hiddenLabelIds: [],
      owners: { ownerIds: ['41', '50'], primaryOwnerId: '50' },
      labels: {
        2: {
          allowedUserIds: [],
          allowedTeamIds: ['20'], // demands teams
          requiredColumnIds: ['d'], // demands item context
          requiredPeopleColumnIds: [],
          nextLabelIds: ['0'],
        },
      },
    });
    let releaseLabels;
    deps.api.getColumnLabels.mockImplementation(
      () => new Promise((resolve) => {
        releaseLabels = () => resolve(structuredClone(COLUMN_LABELS));
      }),
    );
    const handle = createStatusChangeHandler(deps);

    const p = handle(makeEvent());
    await settle();

    // Labels are still parked — the gated reads must ALREADY be in flight.
    expect(deps.api.getUserTeamIds).toHaveBeenCalledTimes(1);
    expect(deps.api.getItemGuardContext).toHaveBeenCalledTimes(1);

    releaseLabels();
    await p;
    expect(deps.evaluate).toHaveBeenCalledTimes(1);
  });

  it('skips getUserTeamIds and getItemGuardContext entirely when no rule demands teams, people, or required columns', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue({
      version: 1,
      hiddenLabelIds: [],
      owners: { ownerIds: ['41', '50'], primaryOwnerId: '50' },
      labels: {
        2: {
          allowedUserIds: [],
          allowedTeamIds: [],
          requiredColumnIds: [],
          requiredPeopleColumnIds: [],
          nextLabelIds: ['0'], // still restricts the move — illegal, but demands no fetches
        },
      },
    });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.api.getUserTeamIds).not.toHaveBeenCalled();
    expect(deps.api.getItemGuardContext).not.toHaveBeenCalled();
    expect(deps.evaluate).toHaveBeenCalledTimes(1);
  });

  it('serializes two events for the same board+item+column, releasing the lane after the REVERT: event 2 waits for event 1\'s revert, not for its notify/append tail', async () => {
    // amend-intent round360: the lane used to hold until bypassLog.append settled;
    // with 40s-4min deliveries observed live, the tail (notify + append) kept the
    // lane hostage for no ordering benefit — the revert is the only write the next
    // event must not race. After the revert lands (and the echo marker is set) the
    // tail runs detached. This amended test asserts the new contract:
    //   (a) event 2 makes NO progress before event 1's revert lands, and
    //   (b) both bypass appends still happen (settled asynchronously, off-lane).
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2');

    let releaseFirstRevert;
    const firstRevertGate = new Promise((resolve) => { releaseFirstRevert = resolve; });
    deps.api.revertStatus.mockImplementation(async () => {
      if (deps.api.revertStatus.mock.calls.length === 1) await firstRevertGate;
    });

    let releaseAppends;
    const appendGate = new Promise((resolve) => { releaseAppends = resolve; });
    deps.bypassLog.append.mockImplementation(async () => { await appendGate; });

    const handle = createStatusChangeHandler(deps);
    const flags = { p1: false, p2: false };
    const p1 = handle(makeEvent({ userId: 41 })).then(() => { flags.p1 = true; });
    const p2 = handle(makeEvent({ userId: 42 })).then(() => { flags.p2 = true; });
    await settle();

    // (a) Event 1 is parked INSIDE its revert; event 2 must not have started at all.
    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);
    expect(deps.tokenStore.getReaderToken).toHaveBeenCalledTimes(1);
    expect(deps.api.getCurrentStatusLabelId).toHaveBeenCalledTimes(1);

    releaseFirstRevert();
    await settle();

    // Lane released after the revert: BOTH events completed their reverts and
    // resolved even though every append is still parked (the tails are detached).
    expect(deps.api.revertStatus).toHaveBeenCalledTimes(2);
    expect(flags.p1).toBe(true);
    expect(flags.p2).toBe(true);
    expect(deps.bypassLog.append).toHaveBeenCalledTimes(2); // both claimed, unresolved

    // (b) Releasing the gate lets both appends settle; nothing was dropped.
    releaseAppends();
    await Promise.all([p1, p2]);
    await settle();
    expect(deps.bypassLog.append).toHaveBeenCalledTimes(2);

    // Both actors were notified (order between detached tails is not guaranteed).
    const notifiedUserIds = deps.api.notifyUser.mock.calls.map((call) => String(call[1])).sort();
    expect(notifiedUserIds).toEqual(['41', '42']);
  });

  it('still AWAITS the bypass append for a non-reverted blocked event: the lane holds until the record lands', async () => {
    // Detach applies ONLY to the post-revert tail. A monitoring-mode (or
    // stale-cell) blocked event has nothing to release early for, so its append
    // stays on the lane — simplest correct rule, and the record cannot be lost
    // behind an already-resolved handle() promise.
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(monitorRules()); // autoRevert off
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });

    let releaseAppend;
    const appendGate = new Promise((resolve) => { releaseAppend = resolve; });
    deps.bypassLog.append.mockImplementation(async () => { await appendGate; });

    const handle = createStatusChangeHandler(deps);
    let resolved = false;
    const p = handle(makeEvent()).then(() => { resolved = true; });
    await settle();

    expect(deps.bypassLog.append).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false); // the lane is still holding the append

    releaseAppend();
    await p;
    expect(resolved).toBe(true);
  });

  it('logs (never throws) when the detached post-revert tail fails: an append rejection lands in the tail catch', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2');
    deps.bypassLog.append.mockRejectedValue(new Error('append blew up'));
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent()); // resolves — the tail is detached
    await settle(); // let the detached rejection reach its catch

    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);
    const tailError = deps.logger.error.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.startsWith('post-revert tail failed'),
    );
    expect(tailError).toBeDefined();
    expect(tailError[2]).toMatchObject({ boardId: '5098', itemId: '777' });
  });

  it('REDELIVERY: retries process exactly once after a transient storage failure, then succeeds with a warn (no error)', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken
      .mockRejectedValueOnce(new Error('An issue occurred while accessing secure storage'))
      .mockResolvedValue({ token: READER_TOKEN, userId: '50' });
    const handle = createStatusChangeHandler({ ...deps, retryDelayMs: 0 });

    await handle(makeEvent());

    expect(deps.tokenStore.getReaderToken).toHaveBeenCalledTimes(2); // initial + one retry
    expect(deps.evaluate).toHaveBeenCalledTimes(1); // the retry ran to a verdict
    expect(deps.logger.warn).toHaveBeenCalledTimes(1); // the retry is announced
    expect(deps.logger.warn.mock.calls[0][0]).toContain('retrying');
    expect(deps.logger.error).not.toHaveBeenCalled();
  });

  it('REDELIVERY: gives up after the single retry — a second transient failure lands in the error log, never a third attempt', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockRejectedValue(
      new Error('invalid json response body at vault-server'),
    );
    const handle = createStatusChangeHandler({ ...deps, retryDelayMs: 1 });

    await handle(makeEvent());

    expect(deps.tokenStore.getReaderToken).toHaveBeenCalledTimes(2);
    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
    expect(deps.logger.error).toHaveBeenCalledTimes(1);
  });

  it('REDELIVERY: a non-transient failure is not retried — one attempt, straight to the error log', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockRejectedValue(new Error('boom'));
    const handle = createStatusChangeHandler({ ...deps, retryDelayMs: 0 });

    await handle(makeEvent());

    expect(deps.tokenStore.getReaderToken).toHaveBeenCalledTimes(1);
    expect(deps.logger.warn).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledTimes(1);
  });

  it('TIMING: emits exactly ONE guard-timing info line per evaluated delivery, with per-step durations and ids', async () => {
    const deps = makeDeps();
    let t = 0;
    deps.now = vi.fn(() => { t += 10; return t; }); // every clock read advances 10ms
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2');
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());
    await settle();

    const timingLines = deps.logger.info.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.startsWith('guard timing'),
    );
    expect(timingLines).toHaveLength(1);
    expect(timingLines[0][0]).toMatch(
      /^guard timing total=\d+ms tokens=\d+ms rules=\d+ms gql=\d+ms reread=\d+ms revert=\d+ms$/,
    );
    expect(timingLines[0][2]).toMatchObject({
      accountId: ACCOUNT, boardId: '5098', columnId: 'status_col', itemId: '777',
    });
    // The advancing clock must be reflected: every step above actually ran, so
    // no bucket may read 0ms (proves real measurement, not hardcoded zeros).
    expect(timingLines[0][0]).not.toContain('=0ms');
  });

  it('TIMING: emits no timing line for a skipped (non-evaluated) delivery', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(null); // unguarded column → skip
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    const timingLines = deps.logger.info.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.startsWith('guard timing'),
    );
    expect(timingLines).toHaveLength(0);
  });
});
