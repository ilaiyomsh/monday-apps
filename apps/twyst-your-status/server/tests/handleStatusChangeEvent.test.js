import { describe, it, expect, vi } from 'vitest';
import {
  createStatusChangeHandler,
  REVERT_NOTIFICATION_TEXT,
  REVERTABLE_REASONS,
} from '../src/guard/handleStatusChangeEvent.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOKEN = 'tok-1';

const ACTIVATION = { token: TOKEN, botUserId: '9001', botName: 'Guard Bot' };

const COLUMN_LABELS = [
  { id: '0', text: 'ממתין' },
  { id: '2', text: 'בוצע' },
];

// Baseline rules blob: label '2' gated by a team allowlist only.
const BASE_RULES = {
  version: 1,
  hiddenLabelIds: [],
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
    accountId: '999',
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
    tokenStore: { getActivation: vi.fn().mockResolvedValue({ ...ACTIVATION }) },
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

const settle = () =>
  new Promise((resolve) => {
    setTimeout(() => setTimeout(resolve, 0), 0);
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createStatusChangeHandler', () => {
  it('resolves without touching rules or the api when the account has no activation record, logging exactly once', async () => {
    const deps = makeDeps();
    deps.tokenStore.getActivation.mockResolvedValue(null);
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.tokenStore.getActivation).toHaveBeenCalledWith('999');
    expect(deps.rulesStore.getRules).not.toHaveBeenCalled();
    expectNoIntervention(deps);
    expect(totalLogCalls(deps.logger)).toBe(1);
  });

  it('short-circuits when the acting user IS the bot user (numeric event id vs string record id) without reading rules or calling any api method', async () => {
    const deps = makeDeps();
    // Record holds the id as a string; the event carries a number — the loop
    // guard must compare as strings so the bot never polices its own reverts.
    deps.tokenStore.getActivation.mockResolvedValue({ token: TOKEN, botUserId: '41' });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent({ userId: 41 }));

    expect(deps.rulesStore.getRules).not.toHaveBeenCalled();
    for (const [name, fn] of Object.entries(deps.api)) {
      expect(fn, `api.${name} must not be called for a bot-authored change`).not.toHaveBeenCalled();
    }
  });

  it('short-circuits also when the record holds the bot id as a NUMBER (api.me returns numbers) — both sides must be normalized', async () => {
    // Survivor 002 (2026-08-03): with both fixtures as strings, dropping the
    // String() normalization on the record side was invisible.
    const deps = makeDeps();
    deps.tokenStore.getActivation.mockResolvedValue({ token: TOKEN, botUserId: 41 });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent({ userId: 41 }));

    expect(deps.rulesStore.getRules).not.toHaveBeenCalled();
    for (const [name, fn] of Object.entries(deps.api)) {
      expect(fn, `api.${name} must not be called for a bot-authored change`).not.toHaveBeenCalled();
    }
  });

  it('resolves without evaluating, reverting, or notifying when the column has no rules blob', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue(null);
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.rulesStore.getRules).toHaveBeenCalledTimes(1);
    const [rulesToken, rulesBoardId, rulesColumnId] = deps.rulesStore.getRules.mock.calls[0];
    expect(rulesToken).toBe(TOKEN);
    expect(String(rulesBoardId)).toBe('5098');
    expect(rulesColumnId).toBe('status_col');
    expect(deps.evaluate).not.toHaveBeenCalled();
    expectNoIntervention(deps);
  });

  it('leaves the item untouched when the verdict is allowed', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: true, reason: null });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.evaluate).toHaveBeenCalledTimes(1);
    expectNoIntervention(deps);
  });

  it('reverts to the previous label and notifies the actor with the owner copy when an illegal change is still current', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('2'); // still the new value
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.api.getCurrentStatusLabelId).toHaveBeenCalledTimes(1);
    const [readToken, readItemId, readColumnId] = deps.api.getCurrentStatusLabelId.mock.calls[0];
    expect(readToken).toBe(TOKEN);
    expect(String(readItemId)).toBe('777');
    expect(readColumnId).toBe('status_col');

    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);
    const [revToken, revBoardId, revItemId, revColumnId, revLabelId] =
      deps.api.revertStatus.mock.calls[0];
    expect(revToken).toBe(TOKEN);
    expect(String(revBoardId)).toBe('5098');
    expect(String(revItemId)).toBe('777');
    expect(revColumnId).toBe('status_col');
    expect(revLabelId).toBe('0'); // previousValue label index 0 → '0'

    expect(deps.api.notifyUser).toHaveBeenCalledTimes(1);
    const [ntfToken, ntfUserId, ntfItemId, ntfText] = deps.api.notifyUser.mock.calls[0];
    expect(ntfToken).toBe(TOKEN);
    expect(String(ntfUserId)).toBe('41');
    expect(String(ntfItemId)).toBe('777');
    expect(ntfText).toBe(REVERT_NOTIFICATION_TEXT);
  });

  it('pins the owner-specified notification copy so an edit to the constant fails a test', () => {
    expect(REVERT_NOTIFICATION_TEXT).toBe(
      'השינוי שבוצע בוטל - מכיוון שאינו עומד בהגדרות העמודה'
    );
  });

  it('writes back the previous label id when an illegal CLEAR (value null) is still current', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue(null); // cell is still cleared
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent({ value: null }));

    expect(deps.api.revertStatus).toHaveBeenCalledTimes(1);
    const [revToken, revBoardId, revItemId, revColumnId, revLabelId] =
      deps.api.revertStatus.mock.calls[0];
    expect(revToken).toBe(TOKEN);
    expect(String(revBoardId)).toBe('5098');
    expect(String(revItemId)).toBe('777');
    expect(revColumnId).toBe('status_col');
    expect(revLabelId).toBe('0');
    expect(deps.api.notifyUser).toHaveBeenCalledTimes(1);
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
    expect(revToken).toBe(TOKEN);
    expect(String(revBoardId)).toBe('5098');
    expect(String(revItemId)).toBe('777');
    expect(revColumnId).toBe('status_col');
    expect(revLabelId).toBeNull();
  });

  it('does not revert or notify when the cell no longer holds the event\'s new label (stale event)', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'not-offered' });
    deps.api.getCurrentStatusLabelId.mockResolvedValue('0'); // someone changed it again
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.api.getCurrentStatusLabelId).toHaveBeenCalledTimes(1);
    expectNoIntervention(deps);
  });

  it('fails soft on reason required-fields-unknown: no revert, no notification, a warn or error log', async () => {
    const deps = makeDeps();
    deps.evaluate.mockReturnValue({ allowed: false, reason: 'required-fields-unknown' });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expectNoIntervention(deps);
    const warnOrError =
      deps.logger.warn.mock.calls.length + deps.logger.error.mock.calls.length;
    expect(warnOrError).toBeGreaterThan(0);
  });

  it('pins REVERTABLE_REASONS to exactly the two reasons that trigger a revert', () => {
    expect(REVERTABLE_REASONS).toEqual(['not-offered', 'required-fields-empty']);
  });

  it('fetches exactly what the rules demand and passes it through to evaluate', async () => {
    const deps = makeDeps();
    deps.rulesStore.getRules.mockResolvedValue({
      version: 1,
      hiddenLabelIds: [],
      labels: {
        2: {
          allowedUserIds: [],
          allowedTeamIds: ['20'],
          requiredColumnIds: ['d'],
          requiredPeopleColumnIds: ['p'],
          nextLabelIds: ['0'],
        },
      },
    });
    deps.api.getUserTeamIds.mockResolvedValue(['20', '30']);
    deps.api.getItemGuardContext.mockResolvedValue({
      peopleByColumnId: { p: ['77'] },
      requiredFieldValues: { d: 'ערך' },
      currentByColumnId: {},
    });
    const handle = createStatusChangeHandler(deps);

    await handle(makeEvent());

    expect(deps.api.getItemGuardContext).toHaveBeenCalledTimes(1);
    const [ctxToken, ctxItemId, ctxSelector] = deps.api.getItemGuardContext.mock.calls[0];
    expect(ctxToken).toBe(TOKEN);
    expect(String(ctxItemId)).toBe('777');
    expect(ctxSelector).toEqual({ peopleColumnIds: ['p'], requiredColumnIds: ['d'] });

    expect(deps.api.getUserTeamIds).toHaveBeenCalledTimes(1);
    const [teamToken, teamUserId] = deps.api.getUserTeamIds.mock.calls[0];
    expect(teamToken).toBe(TOKEN);
    expect(String(teamUserId)).toBe('41');

    expect(deps.evaluate).toHaveBeenCalledTimes(1);
    const input = deps.evaluate.mock.calls[0][0];
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
      labels: {
        2: {
          allowedUserIds: [],
          allowedTeamIds: [],
          requiredColumnIds: [],
          requiredPeopleColumnIds: [],
          nextLabelIds: ['0'],
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

  it('resolves (never rejects) and logs an error when rulesStore.getRules rejects, without reverting or notifying', async () => {
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
