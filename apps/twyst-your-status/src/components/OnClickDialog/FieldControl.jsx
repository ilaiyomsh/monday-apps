/**
 * FieldControl — renders ONE required field, picked by the control kind its
 * column type declares in domain/columnFields.js.
 *
 * This file holds no knowledge of monday formats: the registry decides which
 * control a type gets, what value shape it holds, and when it counts as filled.
 * Adding a column type means adding a registry record and, only if it needs a
 * control that does not exist yet, one branch here.
 */
import React from 'react';
import { dropdownOptionsFrom, fieldControlFor } from '../../domain/columnFields';
import { normalizeStatusLabels } from '../../domain/statusPolicy';
import { PersonPicker } from '../shared/PersonPicker';
import DateFieldControl from './DateFieldControl';

// Control kinds that are a plain <input>, mapped to their HTML input type.
const TEXT_INPUT_TYPES = {
  text: 'text',
  number: 'number',
  email: 'email',
  phone: 'tel',
  link: 'url',
};

const RATING_MAX = 5; // monday exposes no scale in column.settings (probe-verified).

/**
 * @param controlId  id put on the single focusable input, so the field's <label
 *                   htmlFor> reaches it. Group controls (chips, stars) have no
 *                   single input and use labelId instead.
 * @param labelId    id of the visible field title, referenced by group controls.
 */
function FieldControl({ column, value, onChange, disabled, controlId, labelId }) {
  const control = fieldControlFor(column?.type);

  if (control && TEXT_INPUT_TYPES[control]) {
    return (
      <input
        id={controlId}
        type={TEXT_INPUT_TYPES[control]}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (control === 'textarea') {
    return (
      <textarea
        id={controlId}
        rows={3}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (control === 'date') {
    // The hour is set inside the picker, not as a second input beside the date.
    return (
      <DateFieldControl
        value={value}
        onChange={onChange}
        disabled={disabled}
        controlId={controlId}
      />
    );
  }

  if (control === 'timeline') {
    return (
      <div className="twyst-field-row">
        <input
          id={controlId}
          type="date"
          aria-label="מתאריך"
          value={value?.from ?? ''}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, from: event.target.value })}
        />
        <input
          type="date"
          aria-label="עד תאריך"
          value={value?.to ?? ''}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, to: event.target.value })}
        />
      </div>
    );
  }

  if (control === 'checkbox') {
    return (
      <input
        id={controlId}
        type="checkbox"
        className="twyst-field-checkbox"
        checked={value === true}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  if (control === 'people') {
    return (
      <PersonPicker
        selected={Array.isArray(value) ? value : []}
        bordered
        onChange={(entries) => onChange(entries || [])}
      />
    );
  }

  if (control === 'dropdown') {
    const options = dropdownOptionsFrom(column?.settings);
    const selected = Array.isArray(value) ? value : [];
    if (options.length === 0) {
      return <p className="twyst-field-note">אין תוויות זמינות בעמודה הזו.</p>;
    }
    return (
      <div className="twyst-chip-group" role="group" aria-labelledby={labelId}>
        {options.map((option) => {
          const isOn = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              className={`twyst-chip${isOn ? ' is-on' : ''}`}
              aria-pressed={isOn}
              disabled={disabled}
              onClick={() => onChange(
                isOn ? selected.filter((id) => id !== option.id) : [...selected, option.id],
              )}
            >
              {option.label || option.id}
            </button>
          );
        })}
      </div>
    );
  }

  if (control === 'status') {
    const labels = normalizeStatusLabels(column?.settings).filter((label) => !label.isDeactivated);
    if (labels.length === 0) {
      return <p className="twyst-field-note">אין סטטוסים זמינים בעמודה הזו.</p>;
    }
    return (
      <div className="twyst-chip-group" role="radiogroup" aria-labelledby={labelId}>
        {labels.map((label) => {
          const isOn = String(value) === label.id;
          return (
            <button
              key={label.id}
              type="button"
              role="radio"
              aria-checked={isOn}
              className={`twyst-chip twyst-chip-status${isOn ? ' is-on' : ''}`}
              style={isOn ? { background: label.color, borderColor: label.color } : undefined}
              disabled={disabled}
              onClick={() => onChange(label.id)}
            >
              {label.label || 'ללא שם'}
            </button>
          );
        })}
      </div>
    );
  }

  if (control === 'rating') {
    const current = Number(value) || 0;
    return (
      <div className="twyst-rating" role="radiogroup" aria-labelledby={labelId}>
        {Array.from({ length: RATING_MAX }, (unused, index) => index + 1).map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={current === star}
            aria-label={`${star} מתוך ${RATING_MAX}`}
            className={`twyst-star${star <= current ? ' is-on' : ''}`}
            disabled={disabled}
            // Clicking the current rating clears it — otherwise a mis-click on a
            // required field can never be undone without reopening the form.
            onClick={() => onChange(current === star ? null : star)}
          >
            ★
          </button>
        ))}
      </div>
    );
  }

  // Unreachable through the settings screen — it only offers registered types —
  // but a settings file saved before a type was retired could still land here.
  return (
    <p className="twyst-field-note">
      סוג העמודה הזה (
      {column?.type || 'לא ידוע'}
      ) אינו נתמך כשדה חובה.
    </p>
  );
}

export default FieldControl;
