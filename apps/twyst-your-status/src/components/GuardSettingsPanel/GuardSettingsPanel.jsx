import React from 'react';
import './GuardSettingsPanel.css';

function GuardSettingsPanel({
  labels,
  restrictedLabelIds,
  onRestrictedLabelIdsChange,
  onSave,
  onCancel,
  saving,
}) {
  const restrictedSet = new Set(restrictedLabelIds);
  const activeLabels = labels.filter((label) => !label.isDeactivated);

  const toggleLabel = (labelId) => {
    const nextRestrictedIds = restrictedSet.has(labelId)
      ? restrictedLabelIds.filter((id) => id !== labelId)
      : [...restrictedLabelIds, labelId];
    onRestrictedLabelIdsChange(nextRestrictedIds);
  };

  return (
    <main className="guard-settings" aria-labelledby="guard-settings-title">
      <div>
        <p className="guard-settings-eyebrow">Twyst Your Status</p>
        <h1 id="guard-settings-title">לייבלים מוגנים</h1>
        <p className="guard-settings-intro">
          לייבל מוגן לא יופיע ברשימת הבחירה הידנית. אוטומציות ו־API עדיין יוכלו לבחור בו,
          וכשהוא נבחר המשתמשים יראו אותו במצב צפייה בלבד.
        </p>
      </div>

      <fieldset className="guard-label-list" disabled={saving}>
        <legend>בחר אילו לייבלים להסתיר מהבורר</legend>
        {activeLabels.map((label) => (
          <label className="guard-label-option" key={label.id}>
            <input
              type="checkbox"
              checked={restrictedSet.has(label.id)}
              onChange={() => toggleLabel(label.id)}
            />
            <span className="guard-label-dot" style={{ '--status-color': label.color }} />
            <span>{label.label || 'ללא שם'}</span>
          </label>
        ))}
      </fieldset>

      <p className="guard-settings-caveat">
        ההגנה חלה על הבורר של האפליקציה בעמודה הזו; היא אינה חוסמת אינטגרציות או כתיבה ישירה דרך ה־API.
      </p>

      <div className="guard-settings-actions">
        <button type="button" onClick={onCancel} disabled={saving}>ביטול</button>
        <button className="primary-action" type="button" onClick={onSave} disabled={saving}>
          {saving ? 'שומר…' : 'שמירת הגדרה'}
        </button>
      </div>
    </main>
  );
}

export default GuardSettingsPanel;
