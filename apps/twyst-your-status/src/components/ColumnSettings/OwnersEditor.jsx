import { PersonPicker } from '../shared/PersonPicker';

/**
 * The owners half of the settings' `.twyst-owners` section: the count heading, the
 * note, the add-owner picker and the owner list.
 *
 * Returns a FRAGMENT, not a wrapper element: `.twyst-owners` is a flex column with a
 * gap, so wrapping these four blocks in a `<div>` would collapse them into one flex
 * item and silently change the layout.
 */
function OwnersEditor({ draftOwners, users, saving, onAddOwner, onRemoveOwner, onMakePrimary }) {
  return (
    <>
      <div className="twyst-settings-toolbar-title">
        <span className="twyst-settings-section-title">בעלי העמודה</span>
        <span className="twyst-settings-count">{draftOwners?.ownerIds.length ?? 0}</span>
      </div>
      <p className="twyst-owners-note">
        רק בעלי העמודה רואים ומנהלים את ההגדרות. הבעל הראשי הוא מי שעל שמו יירשם
        ביטול אוטומטי של שינוי שאינו עומד בהגדרות.
      </p>
      <div className="twyst-field twyst-field-actors">
        <span className="twyst-field-label">הוספת בעלים</span>
        <PersonPicker
          selected={(draftOwners?.ownerIds ?? []).map((id) => ({ kind: 'person', id }))}
          users={users}
          teams={[]}
          bordered
          onChange={(actors) => {
            const nextIds = new Set(
              (actors || []).filter((actor) => actor.kind !== 'team').map((actor) => String(actor.id)),
            );
            const currentIds = draftOwners?.ownerIds ?? [];
            nextIds.forEach((id) => { if (!currentIds.includes(id)) onAddOwner(id); });
            currentIds.forEach((id) => { if (!nextIds.has(id)) onRemoveOwner(id); });
          }}
        />
      </div>
      <ul className="twyst-owners-list" aria-label="רשימת בעלי העמודה">
        {(draftOwners?.ownerIds ?? []).map((ownerId) => {
          const owner = users.find((user) => String(user.id) === ownerId);
          const isPrimary = draftOwners?.primaryOwnerId === ownerId;
          const isLast = (draftOwners?.ownerIds.length ?? 0) <= 1;
          return (
            <li key={ownerId} className="twyst-owner-row">
              <span className="twyst-owner-name">{owner?.name ?? `משתמש ${ownerId}`}</span>
              <label className="twyst-owner-primary">
                <input
                  type="radio"
                  name="twyst-primary-owner"
                  checked={isPrimary}
                  disabled={saving}
                  onChange={() => onMakePrimary(ownerId)}
                  aria-label={`הגדר כבעלים ראשי: ${owner?.name ?? ownerId}`}
                />
                בעלים ראשי
              </label>
              <button
                type="button"
                className="twyst-owner-remove"
                disabled={saving || isLast}
                onClick={() => onRemoveOwner(ownerId)}
                aria-label={`הסרת בעלים: ${owner?.name ?? ownerId}`}
                title={isLast ? 'חייב להישאר לפחות בעלים אחד' : 'הסרת בעלים'}
              >
                הסרה
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export default OwnersEditor;
