/**
 * FieldControl — renders ONE required field, picked by the control kind its
 * column type declares in domain/columnFields.js.
 *
 * This file holds no knowledge of monday formats: the registry decides which
 * control a type gets, what value shape it holds, and when it counts as filled.
 * Adding a column type means adding a registry record and, only if it needs a
 * control that does not exist yet, one branch here.
 */
import { fieldControlFor } from '../../domain/columnFields';
import { PersonPicker } from '../shared/PersonPicker';
import BoardRelationFieldControl from './BoardRelationFieldControl';
import DateFieldControl from './DateFieldControl';
import { DropdownFieldControl, StatusFieldControl } from './OptionFieldControls';

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
    return (
      <DropdownFieldControl
        column={column}
        value={value}
        onChange={onChange}
        disabled={disabled}
        controlId={controlId}
      />
    );
  }

  if (control === 'status') {
    return (
      <StatusFieldControl
        column={column}
        value={value}
        onChange={onChange}
        disabled={disabled}
        controlId={controlId}
      />
    );
  }

  if (control === 'boardRelation') {
    return (
      <BoardRelationFieldControl
        column={column}
        value={value}
        onChange={onChange}
        disabled={disabled}
        controlId={controlId}
      />
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
