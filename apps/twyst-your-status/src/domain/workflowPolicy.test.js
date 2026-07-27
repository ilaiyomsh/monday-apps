import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_CONFIG_VERSION,
  WorkflowConfigError,
  evaluateTransitionAttempt,
  findMissingRequiredColumnIds,
  isActorPermitted,
  isFilledColumnValue,
  normalizeWorkflowConfig,
} from './workflowPolicy';

function expectConfigError(rawConfig, expectedCode) {
  let thrown = null;

  try {
    normalizeWorkflowConfig(rawConfig);
  } catch (error) {
    thrown = error;
  }

  expect({
    isWorkflowConfigError: thrown instanceof WorkflowConfigError,
    name: thrown?.name,
    code: thrown?.code,
    hasMessage: typeof thrown?.message === 'string' && thrown.message.length > 0,
  }).toEqual({
    isWorkflowConfigError: true,
    name: 'WorkflowConfigError',
    code: expectedCode,
    hasMessage: true,
  });
}

const ALLOW_TRANSITION = {
  id: 'approve',
  fromLabelId: '0',
  toLabelId: '1',
  permissions: {
    mode: 'allowlist',
    userIds: ['42'],
    teamIds: ['7'],
  },
  requiredColumnIds: ['owner', 'notes'],
  formFields: [
    {
      columnId: 'owner',
      required: true,
      label: 'Owner',
    },
    {
      columnId: 'notes',
      required: false,
      label: 'Notes',
    },
  ],
};

const EVALUATION_CONFIG = {
  schemaVersion: 1,
  accountId: '100',
  boardId: '200',
  targetColumnId: 'status_guard',
  hiddenManualLabelIds: ['1'],
  transitions: [ALLOW_TRANSITION],
  enforcement: {
    enabled: true,
  },
  updatedAt: '2026-07-27T00:00:00.000Z',
  updatedBy: '42',
};

describe('normalizeWorkflowConfig', () => {
  it('returns the exact canonical v1 config while preserving declared transition order and excluding unknown fields', () => {
    expect(
      normalizeWorkflowConfig({
        schemaVersion: WORKFLOW_CONFIG_VERSION,
        accountId: ' 100 ',
        boardId: 200,
        targetColumnId: ' status_guard ',
        hiddenManualLabelIds: [0, '2', '0', ' 2 ', 3],
        transitions: [
          {
            id: ' approve ',
            fromLabelId: 0,
            toLabelId: '1',
            permissions: {
              mode: 'any',
              ignored: true,
            },
            requiredColumnIds: [' owner ', 'notes', 'owner', 0, '0'],
            formFields: [
              {
                columnId: ' owner ',
                required: true,
                label: ' Owner ',
                ignored: true,
              },
              {
                columnId: 'notes',
              },
            ],
            ignored: true,
          },
          {
            id: 'reject',
            fromLabelId: '1',
            toLabelId: 2,
            permissions: {
              mode: 'allowlist',
              userIds: [42, '42', ' 7 '],
              teamIds: [0, '0', ' 8 '],
              ignored: true,
            },
            requiredColumnIds: [],
            formFields: [],
          },
        ],
        enforcement: {
          enabled: true,
          ignored: true,
        },
        updatedAt: '2026-07-27T00:00:00.000Z',
        updatedBy: 0,
        ignored: true,
      }),
    ).toEqual({
      schemaVersion: 1,
      accountId: '100',
      boardId: '200',
      targetColumnId: 'status_guard',
      hiddenManualLabelIds: ['0', '2', '3'],
      transitions: [
        {
          id: 'approve',
          fromLabelId: '0',
          toLabelId: '1',
          permissions: {
            mode: 'any',
            userIds: [],
            teamIds: [],
          },
          requiredColumnIds: ['owner', 'notes', '0'],
          formFields: [
            {
              columnId: 'owner',
              required: true,
              label: 'Owner',
            },
            {
              columnId: 'notes',
              required: false,
              label: '',
            },
          ],
        },
        {
          id: 'reject',
          fromLabelId: '1',
          toLabelId: '2',
          permissions: {
            mode: 'allowlist',
            userIds: ['42', '7'],
            teamIds: ['0', '8'],
          },
          requiredColumnIds: [],
          formFields: [],
        },
      ],
      enforcement: {
        enabled: true,
      },
      updatedAt: '2026-07-27T00:00:00.000Z',
      updatedBy: '0',
    });
  });

  it('supplies exact empty and nullable defaults for omitted optional config fields', () => {
    expect(
      normalizeWorkflowConfig({
        schemaVersion: 1,
        accountId: 0,
        boardId: '200',
        targetColumnId: 'status_guard',
        transitions: [],
      }),
    ).toEqual({
      schemaVersion: 1,
      accountId: '0',
      boardId: '200',
      targetColumnId: 'status_guard',
      hiddenManualLabelIds: [],
      transitions: [],
      enforcement: {
        enabled: false,
      },
      updatedAt: null,
      updatedBy: null,
    });
  });

  it.each([
    ['null config', null],
    ['array config', []],
    ['string config', 'config'],
    ['missing schema version', { accountId: '1', boardId: '2', targetColumnId: 'status', transitions: [] }],
    ['non-array transitions', { schemaVersion: 1, accountId: '1', boardId: '2', targetColumnId: 'status', transitions: {} }],
    ['non-boolean enforcement', { schemaVersion: 1, accountId: '1', boardId: '2', targetColumnId: 'status', transitions: [], enforcement: { enabled: 'true' } }],
    ['non-array hidden labels', { schemaVersion: 1, accountId: '1', boardId: '2', targetColumnId: 'status', transitions: [], hiddenManualLabelIds: '1' }],
  ])('throws invalid_config for %s', (_caseName, rawConfig) => {
    expectConfigError(rawConfig, 'invalid_config');
  });

  it('throws unsupported_version when the schema version is not v1', () => {
    expectConfigError(
      {
        schemaVersion: 2,
        accountId: '1',
        boardId: '2',
        targetColumnId: 'status',
        transitions: [],
      },
      'unsupported_version',
    );
  });

  it.each([
    ['blank account id', { accountId: ' ' }],
    ['missing board id', { boardId: null }],
    ['blank target column id', { targetColumnId: ' ' }],
    ['blank hidden label id', { hiddenManualLabelIds: [''] }],
    ['negative hidden label id', { hiddenManualLabelIds: [-1] }],
    ['fractional hidden label id', { hiddenManualLabelIds: ['1.5'] }],
    ['blank transition id', { transitions: [{ ...ALLOW_TRANSITION, id: ' ' }] }],
    ['invalid transition label id', { transitions: [{ ...ALLOW_TRANSITION, fromLabelId: '-1' }] }],
    ['blank required column id', { transitions: [{ ...ALLOW_TRANSITION, requiredColumnIds: ['owner', ' '] }] }],
    ['blank form column id', { transitions: [{ ...ALLOW_TRANSITION, formFields: [{ columnId: ' ', required: false, label: '' }] }] }],
  ])('throws invalid_identifier for %s', (_caseName, override) => {
    expectConfigError(
      {
        schemaVersion: 1,
        accountId: '1',
        boardId: '2',
        targetColumnId: 'status',
        hiddenManualLabelIds: [],
        transitions: [],
        ...override,
      },
      'invalid_identifier',
    );
  });

  it('throws invalid_transition for a non-object transition entry', () => {
    expectConfigError(
      {
        schemaVersion: 1,
        accountId: '1',
        boardId: '2',
        targetColumnId: 'status',
        transitions: [null],
      },
      'invalid_transition',
    );
  });

  it('throws self_transition when canonical from and to label ids are equal, including id zero', () => {
    expectConfigError(
      {
        schemaVersion: 1,
        accountId: '1',
        boardId: '2',
        targetColumnId: 'status',
        transitions: [{ ...ALLOW_TRANSITION, fromLabelId: 0, toLabelId: '0' }],
      },
      'self_transition',
    );
  });

  it('throws duplicate_transition when two transition ids define the same canonical edge', () => {
    expectConfigError(
      {
        schemaVersion: 1,
        accountId: '1',
        boardId: '2',
        targetColumnId: 'status',
        transitions: [
          ALLOW_TRANSITION,
          { ...ALLOW_TRANSITION, id: 'approve-again', fromLabelId: 0, toLabelId: 1 },
        ],
      },
      'duplicate_transition',
    );
  });

  it.each([
    ['missing permissions', undefined],
    ['unknown permission mode', { mode: 'owner', userIds: [], teamIds: [] }],
    ['non-array allowlist user ids', { mode: 'allowlist', userIds: '42', teamIds: [] }],
    ['blank allowlist team id', { mode: 'allowlist', userIds: [], teamIds: [' '] }],
  ])('throws invalid_permissions for %s', (_caseName, permissions) => {
    expectConfigError(
      {
        schemaVersion: 1,
        accountId: '1',
        boardId: '2',
        targetColumnId: 'status',
        transitions: [{ ...ALLOW_TRANSITION, permissions }],
      },
      'invalid_permissions',
    );
  });

  it.each([
    ['non-array form fields', {}],
    ['non-boolean required flag', [{ columnId: 'owner', required: 'true', label: 'Owner' }]],
  ])('throws invalid_form_field for %s', (_caseName, formFields) => {
    expectConfigError(
      {
        schemaVersion: 1,
        accountId: '1',
        boardId: '2',
        targetColumnId: 'status',
        transitions: [{ ...ALLOW_TRANSITION, formFields }],
      },
      'invalid_form_field',
    );
  });

  it('throws duplicate_form_field when trimmed column ids repeat in one transition', () => {
    expectConfigError(
      {
        schemaVersion: 1,
        accountId: '1',
        boardId: '2',
        targetColumnId: 'status',
        transitions: [
          {
            ...ALLOW_TRANSITION,
            formFields: [
              { columnId: 'owner', required: true, label: 'Owner' },
              { columnId: ' owner ', required: false, label: 'Backup' },
            ],
          },
        ],
      },
      'duplicate_form_field',
    );
  });
});

describe('isFilledColumnValue', () => {
  it.each([
    ['null is empty', null, false],
    ['undefined is empty', undefined, false],
    ['empty string is empty', '', false],
    ['whitespace string is empty', '   ', false],
    ['empty array is empty', [], false],
    ['empty object is empty', {}, false],
    ['number zero is filled', 0, true],
    ['boolean false is filled', false, true],
    ['nonempty array is filled', [0], true],
    ['nonempty object is filled', { present: null }, true],
  ])('returns %s', (_caseName, value, expected) => {
    expect(isFilledColumnValue(value)).toBe(expected);
  });

  it.each([
    ['nonblank rendered text wins over an empty value', { id: 'status', text: 'Ready', value: null }, true],
    ['blank rendered text and null value are empty', { id: 'status', text: '  ', value: null }, false],
    ['an id-only monday wrapper is empty', { id: 'status' }, false],
    ['empty serialized string is empty', { id: 'status', text: '', value: '' }, false],
    ['whitespace serialized string is empty', { id: 'status', text: '', value: '   ' }, false],
    ['serialized empty object is empty', { id: 'status', text: '', value: '{}' }, false],
    ['serialized empty array is empty', { id: 'status', text: '', value: '[]' }, false],
    ['serialized JSON null is empty', { id: 'status', text: '', value: 'null' }, false],
    ['serialized JSON zero is filled', { id: 'status', text: '', value: '0' }, true],
    ['serialized JSON false is filled', { id: 'status', text: '', value: 'false' }, true],
    ['serialized object containing only empty content is empty', { id: 'people', text: '', value: '{"ids":[],"text":" "}' }, false],
    ['serialized object containing a nonempty array is filled', { id: 'people', text: '', value: '{"ids":[0]}' }, true],
    ['serialized object containing false is filled', { id: 'check', text: '', value: '{"checked":false}' }, true],
    ['malformed nonblank serialized value is conservatively filled', { id: 'status', text: '', value: '{not-json' }, true],
  ])('returns the expected wrapper result when %s', (_caseName, value, expected) => {
    expect(isFilledColumnValue(value)).toBe(expected);
  });
});

describe('findMissingRequiredColumnIds', () => {
  it('returns deduplicated canonical empty column ids in required order while treating zero and false as filled', () => {
    expect(
      findMissingRequiredColumnIds(
        ['owner', 'notes', 'owner', 0, '0', 'flag', 'blank', 'missing', '', '   '],
        [
          { id: 'owner', text: 'Ada', value: null },
          { id: 'notes', text: '', value: '{}' },
          { id: 0, text: '', value: '0' },
          { id: 'flag', text: '', value: 'false' },
          { id: 'blank', text: ' ', value: '[]' },
        ],
      ),
    ).toEqual(['notes', 'blank', 'missing']);
  });

  it('returns every canonical required id when item values are absent', () => {
    expect(findMissingRequiredColumnIds([0, 'owner', '0', ' owner '], null)).toEqual([
      '0',
      'owner',
    ]);
  });
});

describe('isActorPermitted', () => {
  it('allows any-mode permissions even when actor details are missing', () => {
    expect(isActorPermitted({ mode: 'any', userIds: [], teamIds: [] }, null)).toBe(true);
  });

  it('allows an allowlist when the canonical actor user id matches', () => {
    expect(
      isActorPermitted(
        { mode: 'allowlist', userIds: ['0', '42'], teamIds: [] },
        { userId: 0, teamIds: [] },
      ),
    ).toBe(true);
  });

  it('allows an allowlist when any canonical actor team id intersects', () => {
    expect(
      isActorPermitted(
        { mode: 'allowlist', userIds: [], teamIds: ['7', '8'] },
        { userId: '42', teamIds: [6, 8] },
      ),
    ).toBe(true);
  });

  it('denies an allowlist when neither user nor team ids match', () => {
    expect(
      isActorPermitted(
        { mode: 'allowlist', userIds: ['41'], teamIds: ['7'] },
        { userId: '42', teamIds: ['8'] },
      ),
    ).toBe(false);
  });

  it('denies an empty allowlist', () => {
    expect(
      isActorPermitted(
        { mode: 'allowlist', userIds: [], teamIds: [] },
        { userId: '42', teamIds: ['7'] },
      ),
    ).toBe(false);
  });

  it.each([
    ['missing permissions', null],
    ['unknown permission mode', { mode: 'owner', userIds: [], teamIds: [] }],
    ['malformed user allowlist', { mode: 'allowlist', userIds: '42', teamIds: [] }],
    ['malformed team allowlist', { mode: 'allowlist', userIds: [], teamIds: '7' }],
  ])('denies when permissions are invalid: %s', (_caseName, permissions) => {
    expect(isActorPermitted(permissions, { userId: '42', teamIds: ['7'] })).toBe(false);
  });
});

describe('evaluateTransitionAttempt', () => {
  const permittedActor = { userId: '42', teamIds: [] };
  const filledValues = [
    { id: 'owner', text: 'Ada', value: null },
    { id: 'notes', text: '', value: '{"body":"Approved"}' },
  ];

  it('ignores a non-managed column before evaluating rollback, state, edge, permission, or required fields', () => {
    expect(
      evaluateTransitionAttempt({
        config: EVALUATION_CONFIG,
        columnId: 'other_status',
        fromLabelId: 0,
        toLabelId: 0,
        actor: null,
        itemColumnValues: [],
        internalRollback: true,
      }),
    ).toEqual({
      kind: 'ignore',
      code: 'target_column_not_managed',
    });
  });

  it('ignores an internal rollback before evaluating a same-state change or transition edge', () => {
    expect(
      evaluateTransitionAttempt({
        config: EVALUATION_CONFIG,
        columnId: 'status_guard',
        fromLabelId: 0,
        toLabelId: '0',
        actor: null,
        itemColumnValues: [],
        internalRollback: true,
      }),
    ).toEqual({
      kind: 'ignore',
      code: 'internal_rollback',
    });
  });

  it('ignores a transition whose canonical from and to label ids are unchanged', () => {
    expect(
      evaluateTransitionAttempt({
        config: EVALUATION_CONFIG,
        columnId: 'status_guard',
        fromLabelId: 0,
        toLabelId: '0',
        actor: permittedActor,
        itemColumnValues: filledValues,
        internalRollback: false,
      }),
    ).toEqual({
      kind: 'ignore',
      code: 'no_state_change',
    });
  });

  it('denies an undefined edge before evaluating actor permissions or required fields', () => {
    expect(
      evaluateTransitionAttempt({
        config: EVALUATION_CONFIG,
        columnId: 'status_guard',
        fromLabelId: 0,
        toLabelId: 9,
        actor: null,
        itemColumnValues: [],
        internalRollback: false,
      }),
    ).toEqual({
      kind: 'deny',
      code: 'transition_not_defined',
    });
  });

  it('denies an unpermitted actor before reporting simultaneously missing required fields', () => {
    expect(
      evaluateTransitionAttempt({
        config: EVALUATION_CONFIG,
        columnId: 'status_guard',
        fromLabelId: 0,
        toLabelId: 1,
        actor: { userId: '99', teamIds: ['8'] },
        itemColumnValues: [],
        internalRollback: false,
      }),
    ).toEqual({
      kind: 'deny',
      code: 'actor_not_permitted',
      transitionId: 'approve',
    });
  });

  it('denies a permitted transition with required fields missing in declared order', () => {
    expect(
      evaluateTransitionAttempt({
        config: EVALUATION_CONFIG,
        columnId: 'status_guard',
        fromLabelId: 0,
        toLabelId: 1,
        actor: permittedActor,
        itemColumnValues: [{ id: 'notes', text: '', value: '{}' }],
        internalRollback: false,
      }),
    ).toEqual({
      kind: 'deny',
      code: 'required_fields_missing',
      transitionId: 'approve',
      missingColumnIds: ['owner', 'notes'],
    });
  });

  it('allows a defined transition when actor and required-field policies pass', () => {
    expect(
      evaluateTransitionAttempt({
        config: EVALUATION_CONFIG,
        columnId: 'status_guard',
        fromLabelId: 0,
        toLabelId: 1,
        actor: permittedActor,
        itemColumnValues: filledValues,
        internalRollback: false,
      }),
    ).toEqual({
      kind: 'allow',
      code: 'transition_allowed',
      transition: ALLOW_TRANSITION,
    });
  });
});
