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

  it('short-circuits the revert echo when the acting user IS the primary owner (numeric event id vs string rule id), never evaluating, recording, or fetching an owner token', async () => {
    // The revert is written as the primary owner, so its echo arrives with
    // event.userId === primaryOwnerId. Policing it would loop forever — the
    // guard compares the two as strings (50 vs '50').
    const deps = makeDeps();
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent({ userId: 50 })); // rules primaryOwnerId is '50'

    expect(deps.tokenStore.getReaderToken).toHaveBeenCalledWith(ACCOUNT);
    expect(deps.rulesStore.getRules).toHaveBeenCalledTimes(1);
    expect(deps.evaluate).not.toHaveBeenCalled();
    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
    expect(deps.api.getColumnLabels).not.toHaveBeenCalled();
    expect(deps.bypassLog.append).not.toHaveBeenCalled();
    expectNoIntervention(deps);
  });

  it('leaves the item untouched, records nothing, and fetches no owner token when the verdict is allowed', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: true, reason: null });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.evaluate).toHaveBeenCalledTimes(1);
    expect(deps.bypassLog.append).not.toHaveBeenCalled();
    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
    expect(deps.api.getCurrentStatusLabelId).not.toHaveBeenCalled();
    expectNoIntervention(deps);
  });

  it('neither records nor reverts on the non-revertable reason required-fields-unknown, and warns', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'required-fields-unknown' });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.bypassLog.append).not.toHaveBeenCalled();
    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
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

    // Monitoring means: no owner identity, no write, no ping.
    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
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

    // The current-cell re-read uses the READER token.
    expect(deps.api.getCurrentStatusLabelId).toHaveBeenCalledTimes(1);
    const [readToken, readItemId, readColumnId] = deps.api.getCurrentStatusLabelId.mock.calls[0];
    expect(readToken).toBe(READER_TOKEN);
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
    expect(deps.api.getCurrentStatusLabelId.mock.calls[0][0]).toBe(READER_TOKEN);
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

    // Item context: READER token + the demanded selector.
    expect(deps.api.getItemGuardContext).toHaveBeenCalledTimes(1);
    const [ctxToken, ctxItemId, ctxSelector] = deps.api.getItemGuardContext.mock.calls[0];
    expect(ctxToken).toBe(READER_TOKEN);
    expect(String(ctxItemId)).toBe('777');
    expect(ctxSelector).toEqual({ peopleColumnIds: ['p'], requiredColumnIds: ['d'] });

    // Actor teams: READER token + the actor's user id.
    expect(deps.api.getUserTeamIds).toHaveBeenCalledTimes(1);
    const [teamToken, teamUserId] = deps.api.getUserTeamIds.mock.calls[0];
    expect(teamToken).toBe(READER_TOKEN);
    expect(String(teamUserId)).toBe('41');

    // Column labels: READER token.
    expect(deps.api.getColumnLabels.mock.calls[0][0]).toBe(READER_TOKEN);

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

  it('serializes two events for the same board+item+column: the second makes no api or record progress until the first finishes', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(autoRules());
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });

    const order = [];
    let releaseFirstAppend;
    const firstAppendGate = new Promise((resolve) => {
      releaseFirstAppend = resolve;
    });

    deps.api.getCurrentStatusLabelId.mockImplementation(async () => {
      order.push(`current-read-${deps.api.getCurrentStatusLabelId.mock.calls.length}`);
      return '2';
    });
    deps.api.revertStatus.mockImplementation(async () => {
      order.push(`revert-${deps.api.revertStatus.mock.calls.length}`);
    });
    deps.bypassLog.append.mockImplementation(async () => {
      const n = deps.bypassLog.append.mock.calls.length;
      order.push(`append-${n}`);
      if (n === 1) await firstAppendGate; // hold event 1 at the very end of its handling
    });

    const handle = createStatusChangeHandler(deps);
    const eventA = makeEvent({ userId: 41 });
    const eventB = makeEvent({ userId: 42 }); // same boardId/pulseId/columnId

    const p1 = handle(eventA).then(() => order.push('first-finished'));
    const p2 = handle(eventB).then(() => order.push('second-finished'));
    await settle();

    // Event 1 is parked inside its append; event 2 must not have started its own
    // re-read, revert, or record yet.
    expect(deps.api.getCurrentStatusLabelId).toHaveBeenCalledTimes(1);
    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);
    expect(deps.bypassLog.append).toHaveBeenCalledTimes(1);

    releaseFirstAppend();
    await Promise.all([p1, p2]);

    expect(deps.api.getCurrentStatusLabelId).toHaveBeenCalledTimes(2);
    expect(deps.api.revertStatus).toHaveBeenCalledTimes(2);
    expect(deps.bypassLog.append).toHaveBeenCalledTimes(2);

    // The first event finished strictly before the second event's re-read,
    // revert, and record began.
    const firstFinishedAt = order.indexOf('first-finished');
    expect(firstFinishedAt).toBeGreaterThan(-1);
    expect(firstFinishedAt).toBeLessThan(order.indexOf('current-read-2'));
    expect(firstFinishedAt).toBeLessThan(order.indexOf('revert-2'));
    expect(firstFinishedAt).toBeLessThan(order.indexOf('append-2'));

    // Notifications land in event order: actor 41 first, then actor 42.
    const notifiedUserIds = deps.api.notifyUser.mock.calls.map((call) => String(call[1]));
    expect(notifiedUserIds).toEqual(['41', '42']);
  });
});
