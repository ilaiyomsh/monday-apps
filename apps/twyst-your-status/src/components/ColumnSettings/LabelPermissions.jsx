import { useMemo } from 'react';
import { isSupportedFormColumnType } from '../../domain/columnFields';
import { PersonPicker } from '../shared/PersonPicker';
import SelectDropdown from '../shared/SelectDropdown';
import OptionChecklist from './OptionChecklist';

/**
 * The label card's accordion body — who may pick this label, its people gate, its
 * required fields and its allowed transitions.
 *
 * `requiredOpen`/`transitionsOpen` stay OWNED by LabelCard and arrive as props: this
 * body is mounted only while the accordion is open, so holding those two here would
 * silently reset both sub-sections every time the accordion is collapsed.
 */
function LabelPermissions({
  label,
  rule,
  users,
  teams,
  teamsAvailable,
  columns,
  peopleColumns,
  transitionTargets,
  saving,
  onChangeRule,
  requiredOpen,
  onToggleRequired,
  transitionsOpen,
  onToggleTransitions,
}) {
  const selectedActors = useMemo(() => {
    const people = (rule.allowedUserIds ?? []).map((id) => {
      const match = users.find((user) => String(user.id) === String(id));
      return match
        ? { id: String(match.id), name: match.name, kind: 'person' }
        : { id: String(id), name: String(id), kind: 'person' };
    });
    const teamEntries = (rule.allowedTeamIds ?? []).map((id) => {
      const match = teams.find((team) => String(team.id) === String(id));
      return match
        ? { id: String(match.id), name: match.name, kind: 'team' }
        : { id: String(id), name: String(id), kind: 'team' };
    });
    return [...people, ...teamEntries];
  }, [rule.allowedUserIds, rule.allowedTeamIds, users, teams]);

  const gatePeopleColumnId = rule.requiredPeopleColumnIds?.[0] ?? '';
  const peopleGateOptions = useMemo(() => ([
    { value: '', label: 'ללא הגבלה' },
    ...peopleColumns.map((column) => ({ value: column.id, label: column.title })),
  ]), [peopleColumns]);

  /*
   * round321 — transitions. The rule field is an ARRAY only while restricted
   * (see settingsSchema); no array = every target allowed, which is what the
   * all-checked checklist stores back as `null` so old blobs stay byte-identical.
   */
  const restricted = Array.isArray(rule.nextLabelIds);
  const allowedNext = restricted ? new Set(rule.nextLabelIds.map(String)) : null;
  const isTargetChecked = (id) => (allowedNext === null ? true : allowedNext.has(String(id)));
  const toggleTarget = (id) => {
    const next = transitionTargets
      .filter((target) => (String(target.id) === String(id)
        ? !isTargetChecked(target.id)
        : isTargetChecked(target.id)))
      .map((target) => String(target.id));
    onChangeRule(label.id, {
      nextLabelIds: next.length === transitionTargets.length ? null : next,
    });
  };

  const requiredCount = rule.requiredColumnIds?.length ?? 0;
  const cardName = label.isDefaultEmpty === true && !label.label.trim() ? 'ברירת המחדל' : label.label;

  return (
    <div className="twyst-permissions">
      <div className="twyst-section-title">מי רשאי לבחור את הלייבל</div>
      <div className="twyst-field twyst-field-actors">
        <span className="twyst-field-label">אנשים וצוותים מורשים</span>
        <PersonPicker
          selected={selectedActors}
          users={users}
          teams={teamsAvailable ? teams : []}
          bordered
          onChange={(actors) => {
            const nextActors = actors || [];
            onChangeRule(label.id, {
              allowedUserIds: nextActors
                .filter((actor) => actor.kind !== 'team')
                .map((actor) => String(actor.id)),
              allowedTeamIds: nextActors
                .filter((actor) => actor.kind === 'team')
                .map((actor) => String(actor.id)),
            });
          }}
        />
      </div>

      <div className="twyst-field twyst-field-people-gate">
        <label className="twyst-field-label" htmlFor={`people-gate-${label.clientKey}`}>
          חייב להופיע בעמודת אנשים
        </label>
        <SelectDropdown
          id={`people-gate-${label.clientKey}`}
          value={gatePeopleColumnId}
          options={peopleGateOptions}
          disabled={saving || peopleColumns.length === 0}
          placeholder="ללא הגבלה"
          emptyText="אין עמודות אנשים בלוח"
          onChange={(nextValue) => onChangeRule(label.id, {
            requiredPeopleColumnIds: nextValue ? [nextValue] : [],
          })}
        />
      </div>

      <div className="twyst-field twyst-field-required">
        <button
          type="button"
          className="twyst-collapse-toggle"
          aria-expanded={requiredOpen}
          disabled={saving}
          onClick={onToggleRequired}
        >
          <span className={`twyst-accordion-chevron${requiredOpen ? ' is-open' : ''}`} aria-hidden="true">▾</span>
          <span className="twyst-field-label">שדות חובה במעבר</span>
          {requiredCount > 0 && (
            <span className="twyst-collapse-count">{requiredCount}</span>
          )}
        </button>
        {requiredOpen && (
          <OptionChecklist
            options={columns.map((column) => ({
              id: column.id,
              label: column.title,
              disabled: !isSupportedFormColumnType(column.type),
            }))}
            values={rule.requiredColumnIds}
            disabled={saving}
            emptyText="אין עמודות זמינות"
            onChange={(next) => onChangeRule(label.id, { requiredColumnIds: next })}
          />
        )}
      </div>

      {/*
        round321 — transitions FROM this label: which labels the picker offers
        once this one is the current status. All checked = unrestricted (stored
        as no rule at all); a subset = only those; none = a terminal status.
        The default (grey) card is the EMPTY state's source — its rule, keyed
        by the reserved id 5, governs what may be picked first.
      */}
      <div className="twyst-field twyst-field-transitions">
        <button
          type="button"
          className="twyst-collapse-toggle"
          aria-expanded={transitionsOpen}
          disabled={saving}
          onClick={onToggleTransitions}
        >
          <span className={`twyst-accordion-chevron${transitionsOpen ? ' is-open' : ''}`} aria-hidden="true">▾</span>
          <span className="twyst-field-label">מעברים מותרים</span>
          {restricted && (
            <span className="twyst-collapse-count">{rule.nextLabelIds.length}</span>
          )}
        </button>
        {transitionsOpen && (
          transitionTargets.length === 0 ? (
            <div className="twyst-transition-list">
              <p className="twyst-field-empty">אין לייבלים נוספים בעמודה.</p>
              {/* A stored restriction with zero visible targets would otherwise
                  be UNCLEARABLE — the checkboxes are the only other writer. */}
              {restricted && (
                <button
                  type="button"
                  className="twyst-text-btn"
                  disabled={saving}
                  onClick={() => onChangeRule(label.id, { nextLabelIds: null })}
                >
                  ביטול ההגבלה
                </button>
              )}
            </div>
          ) : (
            <div
              className="twyst-transition-list"
              role="group"
              aria-label={`מעברים מותרים מ${cardName}`}
            >
              <p className="twyst-field-hint">
                אחרי הלייבל הזה יוצעו בבורר רק הלייבלים המסומנים. השארת כולם
                מסומנים = ללא הגבלה.
              </p>
              {transitionTargets.map((target) => (
                <label key={target.id} className="twyst-transition-chip">
                  <input
                    type="checkbox"
                    aria-label={target.label}
                    checked={isTargetChecked(target.id)}
                    disabled={saving}
                    onChange={() => toggleTarget(target.id)}
                  />
                  <span className="twyst-transition-dot" style={{ background: target.color }} aria-hidden="true" />
                  <span className="twyst-transition-name">{target.label}</span>
                </label>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export default LabelPermissions;
