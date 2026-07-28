import { describe, expect, it } from 'vitest';
import { buildMultiColumnWritePayload } from './columnValueFormats.js';

function columns(entries) {
  return new Map(entries.map((column) => [column.id, column]));
}

describe('buildMultiColumnWritePayload', () => {
  it('writes the status by label id and every required field through its own type', () => {
    expect(
      buildMultiColumnWritePayload({
        statusColumnId: 'status',
        statusLabelId: '2',
        formFields: [
          { columnId: 'notes' },
          { columnId: 'owner' },
          { columnId: 'signed' },
          { columnId: 'tags' },
        ],
        formValues: {
          notes: 'סיבה',
          owner: [{ id: '4012345', kind: 'person' }],
          signed: true,
          tags: ['3', '7'],
        },
        columnsById: columns([
          { id: 'notes', type: 'text' },
          { id: 'owner', type: 'people' },
          { id: 'signed', type: 'checkbox' },
          { id: 'tags', type: 'dropdown' },
        ]),
      }),
    ).toEqual({
      status: { index: 2 },
      notes: 'סיבה',
      owner: { personsAndTeams: [{ id: 4012345, kind: 'person' }] },
      signed: { checked: 'true' },
      tags: { ids: ['3', '7'] },
    });
  });

  it('writes an unchecked required checkbox as null, the shape that clears it', () => {
    expect(
      buildMultiColumnWritePayload({
        statusColumnId: 'status',
        statusLabelId: '0',
        formFields: [{ columnId: 'signed' }],
        formValues: { signed: false },
        columnsById: columns([{ id: 'signed', type: 'checkbox' }]),
      }),
    ).toEqual({ status: { index: 0 }, signed: null });
  });

  it('drops a field whose value sanitized to junk but still writes the status', () => {
    // The point of the sanitizer: one unusable people id must not fail the whole
    // transition, which is what a ColumnValueException on the mutation would do.
    const payload = buildMultiColumnWritePayload({
      statusColumnId: 'status',
      statusLabelId: '5',
      formFields: [{ columnId: 'owner' }],
      formValues: { owner: [{ id: 'not-an-id', kind: 'person' }] },
      columnsById: columns([{ id: 'owner', type: 'people' }]),
    });
    expect(payload).toEqual({ status: { index: 5 } });
    expect(payload).not.toHaveProperty('owner');
  });

  it('omits a column whose type cannot be written instead of writing raw text', () => {
    const payload = buildMultiColumnWritePayload({
      statusColumnId: 'status',
      statusLabelId: '1',
      formFields: [{ columnId: 'calc' }],
      formValues: { calc: '42' },
      columnsById: columns([{ id: 'calc', type: 'formula' }]),
    });
    expect(payload).toEqual({ status: { index: 1 } });
  });

  it('reads the column types off a plain object as well as a Map', () => {
    expect(
      buildMultiColumnWritePayload({
        statusColumnId: 'status',
        statusLabelId: '3',
        formFields: [{ columnId: 'when' }],
        formValues: { when: { date: '2026-07-28', time: '' } },
        columnsById: { when: { id: 'when', type: 'date' } },
      }),
    ).toEqual({ status: { index: 3 }, when: { date: '2026-07-28' } });
  });

  it('writes the status alone when the label has no required fields', () => {
    expect(
      buildMultiColumnWritePayload({
        statusColumnId: 'status',
        statusLabelId: '4',
        formFields: [],
        formValues: {},
        columnsById: columns([]),
      }),
    ).toEqual({ status: { index: 4 } });
  });

  it('rejects a label id that is not a non-negative integer', () => {
    expect(() => buildMultiColumnWritePayload({
      statusColumnId: 'status',
      statusLabelId: 'nope',
      formFields: [],
      formValues: {},
      columnsById: columns([]),
    })).toThrow();
  });
});
