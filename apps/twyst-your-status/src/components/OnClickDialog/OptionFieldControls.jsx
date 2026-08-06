/**
 * Status and dropdown fields as ONE field-height bar that opens its options in a
 * popover — the shape monday's item form uses.
 *
 * They used to render every option as a chip inline, which spilled across the row
 * and made a status field look nothing like the fields above it. A column with a
 * dozen labels now costs the same single row as a text field.
 */
import { useMemo, useRef, useState } from 'react';
import { Dropdown as DropdownIcon } from '@vibe/icons';
import { dropdownOptionsFrom } from '../../domain/columnFields';
import { normalizeStatusLabels } from '../../domain/statusPolicy';
import { Popover } from '../shared/Popover';

/**
 * How tall the option menu ASKS to be.
 *
 * It has to be read against the window it opens in: the required-fields modal is an
 * iframe sized to fit its form to the pixel (requiredFormModalSize.js — 276px for one
 * field, 588px at the 8-field cap). A menu taller than that iframe cannot open beside
 * its field at all: overlayPlacement clamps it to `viewport - 16`, flips it, and pins
 * it 8px from the top, so it covers the trigger and every row. That is exactly what
 * "the list opens somewhere else" was — geometry, not a placement bug.
 *
 * 220 leaves room for the bar plus the menu in every modal from one field up (one field
 * is floored to two rows by FORM_MIN_ROWS = 2, so a one-field modal is 276px — the same
 * height as a two-field one), and still shows ~6 options before scrolling.
 */
const OPTION_POPOVER_HEIGHT_PX = 220;

/** Single-select status field: the bar wears the chosen label's colour. */
export function StatusFieldControl({
  column, value, onChange, disabled, controlId,
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const labels = useMemo(
    () => normalizeStatusLabels(column?.settings).filter((label) => !label.isDeactivated),
    [column],
  );
  // String compare, never truthiness: label id 0 is a real label.
  const selected = labels.find((label) => label.id === String(value)) ?? null;

  if (labels.length === 0) {
    return <p className="twyst-field-note">אין סטטוסים זמינים בעמודה הזו.</p>;
  }

  return (
    <>
      <button
        id={controlId}
        ref={triggerRef}
        type="button"
        className={`twyst-field-trigger twyst-status-trigger${selected ? ' is-filled' : ''}`}
        style={selected ? { background: selected.color, borderColor: selected.color } : undefined}
        disabled={disabled}
        onClick={() => !disabled && setOpen(true)}
      >
        {/* An unnamed label renders as an empty bar in its own colour — the same thing
            monday's cell shows. There is no "ללא שם" stand-in. */}
        <span>{selected ? selected.label : 'בחרו סטטוס'}</span>
      </button>

      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        preferred="bottom-start"
        matchAnchorWidth
        width={260}
        height={OPTION_POPOVER_HEIGHT_PX}
      >
        <div className="twyst-option-list" role="listbox" aria-label="סטטוסים">
          {labels.map((label) => (
            <button
              key={label.id}
              type="button"
              role="option"
              aria-selected={label.id === String(value)}
              className="twyst-option-pill"
              style={{ background: label.color }}
              onClick={() => {
                onChange(label.id);
                setOpen(false);
              }}
            >
              {label.label}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

/** Multi-select dropdown field: the bar lists what is chosen. */
export function DropdownFieldControl({
  column, value, onChange, disabled, controlId,
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const options = useMemo(() => dropdownOptionsFrom(column?.settings), [column]);
  const selected = Array.isArray(value) ? value : [];

  if (options.length === 0) {
    return <p className="twyst-field-note">אין תוויות זמינות בעמודה הזו.</p>;
  }

  const chosenLabels = options
    .filter((option) => selected.includes(option.id))
    .map((option) => option.label || option.id);

  return (
    <>
      <button
        id={controlId}
        ref={triggerRef}
        type="button"
        className={`twyst-field-trigger${chosenLabels.length > 0 ? '' : ' is-empty'}`}
        disabled={disabled}
        onClick={() => !disabled && setOpen(true)}
      >
        <span>{chosenLabels.length > 0 ? chosenLabels.join(', ') : 'בחרו מהרשימה'}</span>
        <DropdownIcon aria-hidden="true" />
      </button>

      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        preferred="bottom-start"
        matchAnchorWidth
        width={260}
        height={OPTION_POPOVER_HEIGHT_PX}
      >
        <div className="twyst-option-list" role="group" aria-label="תוויות">
          {options.map((option) => {
            const isOn = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={isOn}
                className={`twyst-option-row${isOn ? ' is-on' : ''}`}
                // Multi-select: the popover stays open so several can be ticked.
                onClick={() => onChange(
                  isOn ? selected.filter((id) => id !== option.id) : [...selected, option.id],
                )}
              >
                <span className="twyst-option-check" aria-hidden="true">{isOn ? '✓' : ''}</span>
                {option.label || option.id}
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
