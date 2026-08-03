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
// IDENTITY MODEL under test: reverts are written AS the column's PRIMARY OWNER.
//   - READS  (labels, teams, item context, current-cell re-read) use the
//     READER token — from tokenStore.getReaderToken(accountId).token.
//   - The REVERT + its notification use the PRIMARY OWNER's token — from
//     tokenStore.getOwnerToken(accountId, primaryOwnerId), where the primary
//     owner id is read out of the rules blob's owners list.

const ACCOUNT = '999';
const READER_TOKEN = 'READ';
const OWNER_TOKEN = 'OWNER50';
const PRIMARY_OWNER_ID = '50';

const COLUMN_LABELS = [
  { id: '0', text: 'ממתין' },
  { id: '2', text: 'בוצע' },
];

// Baseline rules blob: label '2' gated by a team allowlist, WITH owners.
// The primary owner ('50') is who a revert is attributed to.
const BASE_RULES = {
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

function makeEvent(overrides = {}) {
  return {
    accountId: ACCOUNT,
    userId: 41,
    boardId: 5098,
    pulseId: 777,
    columnId: 'status_col',
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
    rulesStore: { getRules: vi.fn().mockResolvedValue(structuredClone(BASE_RULES)) },
    evaluate: vi.fn().mockReturnValue({ allowed: true, reason: null }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
  it('resolves without reading rules or touching the api when the account has no reader token, logging exactly once', async () => {
    const deps = makeDeps();
    deps.tokenStore.getReaderToken.mockResolvedValue(null);
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.tokenStore.getReaderToken).toHaveBeenCalledWith(ACCOUNT);
    expect(deps.rulesStore.getRules).not.toHaveBeenCalled();
    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
    expect(deps.api.getColumnLabels).not.toHaveBeenCalled();
    expectNoIntervention(deps);
    expect(totalLogCalls(deps.logger)).toBe(1);
  });

  it('reads rules with the reader token but resolves without evaluating or intervening when the column has no rules blob', async () => {
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
    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
    expectNoIntervention(deps);
  });

  it('short-circuits the revert echo when the acting user IS the primary owner (numeric event id vs string rule id), never evaluating or fetching an owner token', async () => {
    // The revert is written as the primary owner, so the echo it produces
    // arrives with event.userId === primaryOwnerId. Policing that echo would
    // loop forever — the guard must compare the two as strings (50 vs '50').
    const deps = makeDeps();
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent({ userId: 50 })); // BASE_RULES primaryOwnerId is '50'

    expect(deps.tokenStore.getReaderToken).toHaveBeenCalledWith(ACCOUNT);
    expect(deps.rulesStore.getRules).toHaveBeenCalledTimes(1);
    expect(deps.evaluate).not.toHaveBeenCalled();
    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
    expect(deps.api.getColumnLabels).not.toHaveBeenCalled();
    expectNoIntervention(deps);
  });

  it('leaves the item untouched and fetches no owner token when the verdict is allowed', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: true, reason: null });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.evaluate).toHaveBeenCalledTimes(1);
    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
    expect(deps.api.getCurrentStatusLabelId).not.toHaveBeenCalled();
    expectNoIntervention(deps);
  });

  it('reverts as the primary owner and notifies the actor with the owner copy when an illegal change is still current', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2'); // still the new value
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    // The owner token is fetched for the primary owner of THIS account.
    expect(deps.tokenStore.getOwnerToken).toHaveBeenCalledTimes(1);
    expect(deps.tokenStore.getOwnerToken.mock.calls[0]).toEqual([ACCOUNT, PRIMARY_OWNER_ID]);

    // The current-cell re-read uses the READER token, not the owner's.
    expect(deps.api.getCurrentStatusLabelId).toHaveBeenCalledTimes(1);
    const [readToken, readItemId, readColumnId] = deps.api.getCurrentStatusLabelId.mock.calls[0];
    expect(readToken).toBe(READER_TOKEN);
    expect(String(readItemId)).toBe('777');
    expect(readColumnId).toBe('status_col');

    // The revert is WRITTEN as the primary owner (owner token as arg 1).
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
  });

  it('pins the owner-specified notification copy so an edit to the constant fails a test', () => {
    expect(REVERT_NOTIFICATION_TEXT).toBe(
      'השינוי שבוצע בוטל - מכיוון שאינו עומד בהגדרות העמודה'
    );
  });

  it('reverts to labelId null when the illegal change was made on a previously empty cell', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2');
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent({ previousValue: null }));

    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);
    const [revToken, revBoardId, revItemId, revColumnId, revLabelId] =
      deps.api.revertStatus.mock.calls[0];
    expect(revToken).toBe(OWNER_TOKEN);
    expect(String(revBoardId)).toBe('5098');
    expect(String(revItemId)).toBe('777');
    expect(revColumnId).toBe('status_col');
    expect(revLabelId).toBeNull();
    expect(deps.api.notifyUser).toHaveBeenCalledTimes(1);
    expect(deps.api.notifyUser.mock.calls[0][0]).toBe(OWNER_TOKEN);
  });

  it('does not fetch an owner token, revert, or notify when the illegal column has no owners configured, and warns', async () => {
    const deps = makeDeps();
    const rulesNoOwners = structuredClone(BASE_RULES);
    delete rulesNoOwners.owners;
    deps.rulesStore.getRules.mockResolvedValue(rulesNoOwners);
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
    expect(deps.api.getCurrentStatusLabelId).not.toHaveBeenCalled();
    expectNoIntervention(deps);
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('does not re-read, revert, or notify when the primary owner has not authorized the guard (owner token null), and warns', async () => {
    const deps = makeDeps();
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
  });

  it('does not revert or notify when the cell no longer holds the event\'s new label (stale event), even with a valid owner token', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('9'); // someone changed it again
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.tokenStore.getOwnerToken).toHaveBeenCalledTimes(1);
    expect(deps.api.getCurrentStatusLabelId).toHaveBeenCalledTimes(1);
    expect(deps.api.getCurrentStatusLabelId.mock.calls[0][0]).toBe(READER_TOKEN);
    expectNoIntervention(deps);
  });

  it('fails soft on reason required-fields-unknown: no owner token, no revert, no notification, a warn or error log', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'required-fields-unknown' });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.tokenStore.getOwnerToken).not.toHaveBeenCalled();
    expectNoIntervention(deps);
    const warnOrError =
      deps.logger.warn.mock.calls.length + deps.logger.error.mock.calls.length;
    expect(warnOrError).toBeGreaterThan(0);
  });

  it('pins REVERTABLE_REASONS to exactly the two reasons that trigger a revert', () => {
    expect(REVERTABLE_REASONS).toEqual(['not-offered', 'required-fields-empty']);
  });

  it('fetches exactly what the rules demand with the reader token and passes it through to evaluate', async () => {
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

    // Item context is fetched with the READER token and the demanded selector.
    expect(deps.api.getItemGuardContext).toHaveBeenCalledTimes(1);
    const [ctxToken, ctxItemId, ctxSelector] = deps.api.getItemGuardContext.mock.calls[0];
    expect(ctxToken).toBe(READER_TOKEN);
    expect(String(ctxItemId)).toBe('777');
    expect(ctxSelector).toEqual({ peopleColumnIds: ['p'], requiredColumnIds: ['d'] });

    // Actor teams are fetched with the READER token for the actor's user id.
    expect(deps.api.getUserTeamIds).toHaveBeenCalledTimes(1);
    const [teamToken, teamUserId] = deps.api.getUserTeamIds.mock.calls[0];
    expect(teamToken).toBe(READER_TOKEN);
    expect(String(teamUserId)).toBe('41');

    // Column labels are read with the READER token too.
    expect(deps.api.getColumnLabels.mock.calls[0][0]).toBe(READER_TOKEN);

    // Everything is threaded into the single evaluate input.
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

  it('resolves (never rejects) and logs an error when revertStatus rejects', async () => {
    const deps = makeDeps();
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

  it('resolves (never rejects) and logs an error when rulesStore.getRules rejects, without fetching an owner token or intervening', async () => {
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
    expectNoIntervention(deps);
  });

  it('serializes two events for the same board+item+column: the second makes no api progress until the first finishes', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });

    const order = [];
    let releaseFirstRevert;
    const firstRevertGate = new Promise((resolve) => {
      releaseFirstRevert = resolve;
    });

    deps.api.getCurrentStatusLabelId.mockImplementation(async () => {
      order.push(`current-read-${deps.api.getCurrentStatusLabelId.mock.calls.length}`);
      return '2';
    });
    deps.api.revertStatus.mockImplementation(async () => {
      const n = deps.api.revertStatus.mock.calls.length;
      order.push(`revert-${n}`);
      if (n === 1) await firstRevertGate; // hold event 1 mid-handling
    });

    const handle = createStatusChangeHandler(deps);
    const eventA = makeEvent({ userId: 41 });
    const eventB = makeEvent({ userId: 42 }); // same boardId/pulseId/columnId

    const p1 = handle(eventA).then(() => order.push('first-finished'));
    const p2 = handle(eventB).then(() => order.push('second-finished'));
    await settle();

    // Event 1 is parked inside its revert; event 2 must not have started its
    // own re-read or revert yet.
    expect(deps.api.getCurrentStatusLabelId).toHaveBeenCalledTimes(1);
    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);

    releaseFirstRevert();
    await Promise.all([p1, p2]);

    expect(deps.api.getCurrentStatusLabelId).toHaveBeenCalledTimes(2);
    expect(deps.api.revertStatus).toHaveBeenCalledTimes(2);

    // The first event's handling finished strictly before the second event's
    // re-read and revert began.
    const firstFinishedAt = order.indexOf('first-finished');
    expect(firstFinishedAt).toBeGreaterThan(-1);
    expect(firstFinishedAt).toBeLessThan(order.indexOf('current-read-2'));
    expect(firstFinishedAt).toBeLessThan(order.indexOf('revert-2'));

    // Notifications land in event order: actor 41 first, then actor 42.
    const notifiedUserIds = deps.api.notifyUser.mock.calls.map((call) => String(call[1]));
    expect(notifiedUserIds).toEqual(['41', '42']);
  });
});
