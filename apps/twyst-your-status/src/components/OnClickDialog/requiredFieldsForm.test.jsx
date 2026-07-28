/**
 * The required-field guarantee, pinned.
 *
 * Round 3.4 replaced the fill form's single <input required> with per-type
 * controls, which means the BROWSER no longer enforces anything — an unchecked
 * checkbox and an empty people picker are both perfectly valid form state. If
 * this suite goes quiet, a governed transition can go through unfilled and
 * nothing else in the app would notice.
 *
 * Column shapes and prefilled values come from the recorded live probe
 * (test-utils/probes/required-field-values.json, sandbox board 18424030023),
 * not hand-written objects — the same capture that disproved two guessed shapes.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RequiredFieldsForm from './RequiredFieldsForm';
import { prefillFieldValue } from '../../domain/columnFields';
import probe from '../../test-utils/probes/required-field-values.json';

const PROBE_VALUES = probe.data.items[0].column_values;

function probeCell(type) {
  const cell = PROBE_VALUES.find((value) => value.column.type === type);
  if (!cell) throw new Error(`probe fixture has no ${type} column`);
  return cell;
}

/** Column metadata exactly as the app receives it, straight from the probe. */
function probeColumn(type) {
  return probeCell(type).column;
}

function renderForm({ types, values, onSubmit = vi.fn(), columnsOverride }) {
  const columnsById = new Map(
    (columnsOverride ?? types.map((type) => probeColumn(type)))
      .map((column) => [column.id, column]),
  );
  const fields = types.map((type) => ({ columnId: probeColumn(type).id }));
  render(
    <RequiredFieldsForm
      label={{ id: '2', label: 'תקוע' }}
      fields={fields}
      columnsById={columnsById}
      initialValues={values}
      busy={false}
      onCancel={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, submit: () => screen.getByRole('button', { name: 'שמירה ומעבר' }) };
}

/** The empty form value for a type, as the dialog seeds it for an unset cell. */
function emptyValue(type) {
  return prefillFieldValue(type, null);
}

afterEach(cleanup);

describe('RequiredFieldsForm blocking', () => {
  it('refuses to submit while a required checkbox is unchecked', () => {
    const column = probeColumn('checkbox');
    const { onSubmit, submit } = renderForm({
      types: ['checkbox'],
      values: { [column.id]: emptyValue('checkbox') },
    });

    fireEvent.click(submit());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('שדה חובה — יש למלא לפני המעבר.')).toBeInTheDocument();
  });

  it('submits the checked box once the user ticks it', () => {
    const column = probeColumn('checkbox');
    const { onSubmit, submit } = renderForm({
      types: ['checkbox'],
      values: { [column.id]: emptyValue('checkbox') },
    });

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ [column.id]: true });
  });

  it('refuses to submit while a required rating has no stars', () => {
    const column = probeColumn('rating');
    const { onSubmit, submit } = renderForm({
      types: ['rating'],
      values: { [column.id]: emptyValue('rating') },
    });

    fireEvent.click(submit());

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the star the user picked', () => {
    const column = probeColumn('rating');
    const { onSubmit, submit } = renderForm({
      types: ['rating'],
      values: { [column.id]: emptyValue('rating') },
    });

    fireEvent.click(screen.getByRole('radio', { name: '3 מתוך 5' }));
    fireEvent.click(submit());

    expect(onSubmit).toHaveBeenCalledWith({ [column.id]: 3 });
  });

  it('refuses to submit while only one end of a required timeline is set', () => {
    const column = probeColumn('timeline');
    const { onSubmit, submit } = renderForm({
      types: ['timeline'],
      values: { [column.id]: { from: '2026-07-01', to: '' } },
    });

    fireEvent.click(submit());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('שדה חובה — יש למלא לפני המעבר.')).toBeInTheDocument();
  });

  it('submits a required timeline once both ends are set', () => {
    const column = probeColumn('timeline');
    const value = { from: '2026-07-01', to: '2026-07-09' };
    const { onSubmit, submit } = renderForm({
      types: ['timeline'],
      values: { [column.id]: value },
    });

    fireEvent.click(submit());

    expect(onSubmit).toHaveBeenCalledWith({ [column.id]: value });
  });

  it('accepts a prefilled people selection read off the probe response', () => {
    const cell = probeCell('people');
    const prefilled = prefillFieldValue('people', cell);
    const { onSubmit, submit } = renderForm({
      types: ['people'],
      values: { [cell.column.id]: prefilled },
    });

    fireEvent.click(submit());

    expect(prefilled).toEqual([{ id: '48274917', kind: 'person' }]);
    expect(onSubmit).toHaveBeenCalledWith({ [cell.column.id]: prefilled });
  });

  it('refuses to submit while a required people field is empty', () => {
    const column = probeColumn('people');
    const { onSubmit, submit } = renderForm({
      types: ['people'],
      values: { [column.id]: emptyValue('people') },
    });

    fireEvent.click(submit());

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps a status label id of 0 as a filled answer', () => {
    const column = probeColumn('status');
    const { onSubmit, submit } = renderForm({
      types: ['status'],
      values: { [column.id]: '0' },
    });

    fireEvent.click(submit());

    expect(onSubmit).toHaveBeenCalledWith({ [column.id]: '0' });
  });

  it('blocks the transition entirely when a required column is gone from the board', () => {
    // Fail closed: a stale rule must not let the governed field be skipped.
    const { onSubmit, submit } = renderForm({
      types: ['checkbox'],
      values: {},
      columnsOverride: [],
    });

    expect(submit()).toBeDisabled();
    expect(screen.getByText(/אינה קיימת או אינה נתמכת/)).toBeInTheDocument();
    fireEvent.click(submit());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks the transition when a required column type cannot be written', () => {
    const { onSubmit, submit } = renderForm({
      types: ['checkbox'],
      values: {},
      columnsOverride: [{ id: probeColumn('checkbox').id, title: 'נוסחה', type: 'formula' }],
    });

    expect(submit()).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reports every unfilled field at once rather than one at a time', () => {
    const checkbox = probeColumn('checkbox');
    const rating = probeColumn('rating');
    const { onSubmit, submit } = renderForm({
      types: ['checkbox', 'rating'],
      values: {
        [checkbox.id]: emptyValue('checkbox'),
        [rating.id]: emptyValue('rating'),
      },
    });

    fireEvent.click(submit());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText('שדה חובה — יש למלא לפני המעבר.')).toHaveLength(2);
  });

  it('shows no error before the first submit attempt', () => {
    const column = probeColumn('checkbox');
    renderForm({
      types: ['checkbox'],
      values: { [column.id]: emptyValue('checkbox') },
    });

    expect(screen.queryByText('שדה חובה — יש למלא לפני המעבר.')).not.toBeInTheDocument();
  });
});
