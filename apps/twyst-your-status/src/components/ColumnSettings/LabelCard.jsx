import { useState } from 'react';
import LabelPermissions from './LabelPermissions';
import StatusColorPicker from './StatusColorPicker';
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from './inlineIcons';

function LabelCard({
  label,
  hidden,
  rule,
  users,
  teams,
  teamsAvailable,
  columns,
  peopleColumns,
  usedColors,
  transitionTargets,
  saving,
  isFirst,
  isLast,
  onRename,
  onRecolor,
  onRemove,
  onMove,
  onToggleHidden,
  onChangeRule,
}) {
  // Accordion closed by default for every label — never auto-open on config.
  const [open, setOpen] = useState(false);
  const [requiredOpen, setRequiredOpen] = useState(false);
  const [transitionsOpen, setTransitionsOpen] = useState(false);

  const gatePeopleTitle = peopleColumns
    .find((column) => column.id === (rule.requiredPeopleColumnIds?.[0] ?? ''))?.title;
  const restricted = Array.isArray(rule.nextLabelIds);

  const summaryBits = [];
  if (hidden) summaryBits.push('מוסתר');
  if (rule.allowedUserIds?.length || rule.allowedTeamIds?.length) {
    const n = (rule.allowedUserIds?.length ?? 0) + (rule.allowedTeamIds?.length ?? 0);
    summaryBits.push(`${n} מורשים`);
  }
  if (gatePeopleTitle) summaryBits.push(gatePeopleTitle);
  if (rule.requiredColumnIds?.length) summaryBits.push(`${rule.requiredColumnIds.length} שדות חובה`);
  if (restricted) summaryBits.push(rule.nextLabelIds.length > 0 ? `מעברים: ${rule.nextLabelIds.length}` : 'ללא מעברים');

  /*
   * The grey DEFAULT label — monday's empty status. Its card carries the one thing that
   * IS editable about it, the text, and nothing that is not: monday forces the colour to
   * grey and refuses to delete the label once it exists, so a colour picker and a remove
   * button here would be two controls that lie. Leaving the text empty is a valid state
   * (and the one a fresh column is in) — nothing is written until something is typed.
   */
  const isDefaultLabel = label.isDefaultEmpty === true;

  return (
    <article className={`twyst-label-card${open ? ' is-open' : ''}${isDefaultLabel ? ' is-default' : ''}`}>
      <div className="twyst-label-identity">
        {isDefaultLabel ? (
          <span
            className="twyst-color-circle is-static"
            style={{ background: label.color }}
            title="ברירת המחדל של monday — תמיד אפור"
            aria-hidden="true"
          />
        ) : (
          <StatusColorPicker
            colorValue={label.colorValue}
            hex={label.color}
            usedColorEnums={usedColors}
            disabled={saving}
            onChange={(next) => onRecolor(label.clientKey, next)}
          />
        )}
        <input
          className="twyst-label-name-input"
          type="text"
          value={label.label}
          aria-label={isDefaultLabel ? 'שם לייבל ברירת המחדל' : 'שם הלייבל'}
          placeholder={isDefaultLabel ? 'ללא טקסט' : undefined}
          disabled={saving}
          onChange={(event) => onRename(label.clientKey, event.target.value)}
        />
        <div className="twyst-label-actions">
          {isDefaultLabel ? (
            <span className="twyst-label-default-tag">ברירת מחדל</span>
          ) : (
            <>
              <div className="twyst-label-order" role="group" aria-label="סדר הלייבל">
                <button
                  type="button"
                  className="twyst-icon-btn"
                  disabled={saving || isFirst}
                  aria-label="הזז למעלה"
                  title="הזז למעלה"
                  onClick={() => onMove(label.clientKey, -1)}
                >
                  <ChevronUpIcon />
                </button>
                <button
                  type="button"
                  className="twyst-icon-btn"
                  disabled={saving || isLast}
                  aria-label="הזז למטה"
                  title="הזז למטה"
                  onClick={() => onMove(label.clientKey, 1)}
                >
                  <ChevronDownIcon />
                </button>
              </div>
              <button
                type="button"
                className="twyst-icon-btn is-danger"
                disabled={saving}
                aria-label="הסרה"
                title="הסרה"
                onClick={() => onRemove(label.clientKey)}
              >
                <TrashIcon />
              </button>
            </>
          )}
        </div>
      </div>

      {/*
        Rendered for a NEW label too, which is the point of 3.9.0. Its rules are held
        under the draft's client key ("new:1") and moved onto the id monday assigns in
        the same save — see handleSave. This section used to be hidden until the label
        existed, so creating one and restricting it took two visits with nothing on the
        card to say why the accordion was missing.
      */}
      <div className="twyst-label-access">
        <div className="twyst-label-access-bar">
          <label className="twyst-check">
            <input
              type="checkbox"
              checked={hidden}
              disabled={saving}
              onChange={() => onToggleHidden(label.id)}
            />
            <span>מוסתר בבורר</span>
          </label>
          {/* The configuration at a glance, without opening anything: one quiet chip
              per active restriction. Rendered beside the toggle (not inside it) so a
              chip's text never leaks into the button's accessible name. */}
          {!open && summaryBits.length > 0 && (
            <span className="twyst-summary-chips" aria-hidden="false">
              {summaryBits.map((bit, chipIndex) => (
                // Index-qualified key: one bit is an admin-chosen people-column
                // TITLE, which may equal another bit's literal text (review P3).
                <span key={`${chipIndex}-${bit}`} className="twyst-summary-chip">{bit}</span>
              ))}
            </span>
          )}
          <button
            type="button"
            className="twyst-text-btn twyst-accordion-toggle"
            aria-expanded={open}
            disabled={saving}
            onClick={() => setOpen((current) => !current)}
          >
            <span className={`twyst-accordion-chevron${open ? ' is-open' : ''}`} aria-hidden="true">▾</span>
            {open ? 'הסתר הרשאות' : 'הרשאות'}
          </button>
        </div>

        {open && (
          <LabelPermissions
            label={label}
            rule={rule}
            users={users}
            teams={teams}
            teamsAvailable={teamsAvailable}
            columns={columns}
            peopleColumns={peopleColumns}
            transitionTargets={transitionTargets}
            saving={saving}
            onChangeRule={onChangeRule}
            requiredOpen={requiredOpen}
            onToggleRequired={() => setRequiredOpen((current) => !current)}
            transitionsOpen={transitionsOpen}
            onToggleTransitions={() => setTransitionsOpen((current) => !current)}
          />
        )}
      </div>
    </article>
  );
}

export default LabelCard;
