/**
 * RequiredFieldsForm — the fill form shown before a governed status transition.
 *
 * This form OWNS the required-field guarantee. It deliberately does NOT use the
 * browser's `required` attribute: that attribute cannot express "this checkbox
 * must be checked" or "this picker must hold at least one entry", and the form
 * now renders both. Emptiness is decided per column type by
 * domain/columnFields.js — see requiredFieldsForm.test.jsx, which pins the
 * blocking behavior.
 */
import React, { useEffect, useState } from 'react';
import { AttentionBox } from '@vibe/core';
import { isFieldValueEmpty, isSupportedFormColumnType } from '../../domain/columnFields';
import { requiredFormLayout } from '../../utils/requiredFormModalSize';
import FieldControl from './FieldControl';
import FieldIcon from './FieldIcon';

function RequiredFieldsForm({
  label,
  fields,
  columnsById,
  initialValues,
  busy,
  error = null,
  onCancel,
  onSubmit,
}) {
  const [values, setValues] = useState(initialValues);
  // Errors appear on the first submit attempt, not while the user is still
  // filling the form.
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    setValues(initialValues);
    setShowErrors(false);
  }, [initialValues]);

  // A required column that no longer exists on the board (or is no longer
  // writable) cannot be filled. We FAIL CLOSED: the transition stays blocked and
  // the message points at the settings, rather than letting the governed field be
  // silently skipped. ColumnSettings' own validation is what stops this state
  // from being saved in the first place.
  const unfillable = fields.filter((field) => {
    const column = columnsById.get(field.columnId);
    return !column || !isSupportedFormColumnType(column.type);
  });

  // Same geometry the modal was sized with — one source, so the form can never
  // lay out taller than the window it was given.
  const layout = requiredFormLayout(fields);

  const emptyFieldIds = new Set(
    fields
      .filter((field) => {
        const column = columnsById.get(field.columnId);
        return column && isFieldValueEmpty(column.type, values[field.columnId]);
      })
      .map((field) => field.columnId),
  );

  const handleSubmit = (event) => {
    event.preventDefault();
    if (unfillable.length > 0) return;
    if (emptyFieldIds.size > 0) {
      setShowErrors(true);
      return;
    }
    onSubmit(values);
  };

  return (
    <form className="twyst-form" onSubmit={handleSubmit} aria-labelledby="required-fields-title">
      <header>
        <p className="status-guard-eyebrow">מעבר סטטוס</p>
        <h2 id="required-fields-title">
          השלמת פרטים לפני מעבר ל״
          {label.label || 'ללא שם'}
          ״
        </h2>
      </header>

      {error && <AttentionBox type="danger" text={error} />}

      {unfillable.length > 0 && (
        <AttentionBox
          type="danger"
          text={`שדה חובה מוגדר על עמודה שאינה קיימת או אינה נתמכת (${unfillable
            .map((field) => columnsById.get(field.columnId)?.title || field.columnId)
            .join(', ')}). יש לתקן את הגדרות העמודה כדי לאפשר את המעבר.`}
        />
      )}

      {/*
        One row per field, monday's own item-form shape: the column's icon and
        title in a fixed label column, the control in a wide one. Past 4 rows the
        LIST scrolls — the modal keeps the height it was opened with.
      */}
      <div className={`twyst-form-rows${layout.scrolls ? ' is-scrolling' : ''}`}>
        {fields.map((field) => {
          const column = columnsById.get(field.columnId);
          const controlId = `required-field-${field.columnId}`;
          const labelId = `${controlId}-label`;
          const isMissing = showErrors && emptyFieldIds.has(field.columnId);
          return (
            <div className="twyst-form-row" key={field.columnId}>
              <label className="twyst-field-title" id={labelId} htmlFor={controlId}>
                <FieldIcon columnType={column?.type} />
                <span className="twyst-field-name">{column?.title || field.columnId}</span>
                <b aria-hidden="true">*</b>
              </label>
              <div className="twyst-field-control">
                <FieldControl
                  column={column}
                  value={values[field.columnId]}
                  disabled={busy}
                  controlId={controlId}
                  labelId={labelId}
                  onChange={(next) => setValues((current) => ({
                    ...current,
                    [field.columnId]: next,
                  }))}
                />
                {isMissing && <p className="twyst-field-error">שדה חובה — יש למלא לפני המעבר.</p>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="twyst-form-actions">
        <button type="button" onClick={onCancel} disabled={busy}>ביטול</button>
        <button
          className="primary-action"
          type="submit"
          disabled={busy || unfillable.length > 0}
        >
          {busy ? 'שומר…' : 'שמירה ומעבר'}
        </button>
      </div>
    </form>
  );
}

export default RequiredFieldsForm;
