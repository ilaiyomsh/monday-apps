import React from 'react';
import { Clock, Battery, CalendarDays, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isLanguagePickerEnabled } from '../../utils/featureFlags';
import styles from './StructureTab.module.css';

/**
 * טאב הגדרות יומן
 * אירועים זמניים, ימי עבודה, ויעדי שעות
 */
const CalendarTab = ({ settings, onChange }) => {
  const { t } = useTranslation();
  const dayLabels = t('settings.calendar.dayLabels', { returnObjects: true });
  const workDays = settings.workDays ?? [0, 1, 2, 3, 4];
  const weekStartDay = settings.weekStartDay ?? 0;

  const handleDayToggle = (day) => {
    const isChecked = workDays.includes(day);
    if (isChecked && workDays.length === 1) return; // לפחות יום אחד

    const newWorkDays = isChecked
      ? workDays.filter(d => d !== day)
      : [...workDays, day].sort((a, b) => a - b);

    // אם יום תחילת השבוע הוסר — קבע את הראשון שנשאר
    const newWeekStart = newWorkDays.includes(weekStartDay)
      ? weekStartDay
      : newWorkDays[0];

    onChange({ workDays: newWorkDays, weekStartDay: newWeekStart });
  };

  const handleWeekStartChange = (e) => {
    onChange({ weekStartDay: parseInt(e.target.value, 10) });
  };

  return (
    <div className={styles.container}>
      {/* אירועים זמניים */}
      <label className={styles.notesToggle}>
        <div className={styles.notesCheckbox}>
          <input
            type="checkbox"
            checked={settings.showTemporaryEvents !== false}
            onChange={() => onChange({ showTemporaryEvents: !(settings.showTemporaryEvents !== false) })}
          />
        </div>
        <div className={styles.notesContent}>
          <span className={styles.notesTitle}>
            <Clock size={20} className={styles.notesIcon} />
            {t('settings.calendar.showTemporary')}
          </span>
          <span className={styles.notesDescription}>
            {t('settings.calendar.temporaryDescription')}
          </span>
        </div>
      </label>

      {/* ימי עבודה */}
      <div className={styles.editLockSection}>
        <div className={styles.editLockHeader}>
          <CalendarDays size={20} className={styles.notesIcon} />
          <span className={styles.editLockTitle}>{t('settings.calendar.workDays')}</span>
        </div>

        <div className={styles.workDaysRow}>
          <div className={styles.workDayChips}>
            {[0, 1, 2, 3, 4, 5, 6].map(day => (
              <label key={day} className={`${styles.workDayChip} ${workDays.includes(day) ? styles.workDayChipActive : ''}`}>
                <input
                  type="checkbox"
                  checked={workDays.includes(day)}
                  onChange={() => handleDayToggle(day)}
                  className={styles.workDayCheckbox}
                />
                {dayLabels[day]}
              </label>
            ))}
          </div>

          <div className={styles.weekStartSelector}>
            <span className={styles.weekStartLabel}>{t('settings.calendar.weekStart')}</span>
            <select
              value={weekStartDay}
              onChange={handleWeekStartChange}
              className={styles.weekStartSelect}
            >
              {workDays.map(day => (
                <option key={day} value={day}>{dayLabels[day]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* בורר שפה — מאחורי VITE_ENABLE_LANGUAGE_PICKER (אינקרמנטים 8-9) */}
      {isLanguagePickerEnabled() && (
        <div className={styles.editLockSection}>
          <div className={styles.editLockHeader}>
            <Languages size={20} className={styles.notesIcon} />
            <span className={styles.editLockTitle}>{t('settings.calendar.languagePickerTitle')}</span>
          </div>
          <p className={styles.notesDescription} style={{ marginBottom: '12px' }}>
            {t('settings.calendar.languagePickerDescription')}
          </p>
          <select
            value={settings.languageOverride || ''}
            onChange={(e) => onChange({ languageOverride: e.target.value || null })}
            className={styles.weekStartSelect}
          >
            <option value="">{t('settings.calendar.languageOptionDefault')}</option>
            <option value="he">{t('settings.calendar.languageOptionHe')}</option>
            <option value="en">{t('settings.calendar.languageOptionEn')}</option>
          </select>
          {/* הערת RTL הוסרה באינקרמנט 10 — אנגלית עכשיו מוצגת ב-LTR מלא. */}
        </div>
      )}

      {/* יעד שעות */}
      <div className={styles.editLockSection}>
        <div className={styles.editLockHeader}>
          <Battery size={20} className={styles.notesIcon} />
          <span className={styles.editLockTitle}>{t('settings.calendar.hoursTargetTitle')}</span>
        </div>
        <div className={styles.monthlyTargetInputs}>
          <label className={styles.monthlyTargetField}>
            <span>{t('settings.calendar.dailyTargetLabel')}</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={settings.workdayLength ?? 8.5}
              onChange={(e) => onChange({ workdayLength: parseFloat(e.target.value) || 0 })}
              className={styles.monthlyTargetInput}
            />
          </label>
          <label className={styles.monthlyTargetField}>
            <span>{t('settings.calendar.weeklyTargetLabel')}</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={settings.weeklyHoursTarget ?? ''}
              placeholder={((settings.monthlyHoursTarget ?? 182.5) / 4.33).toFixed(1)}
              onChange={(e) => {
                const val = e.target.value;
                onChange({ weeklyHoursTarget: val === '' ? null : (parseFloat(val) || 0) });
              }}
              className={styles.monthlyTargetInput}
            />
          </label>
          <label className={styles.monthlyTargetField}>
            <span>{t('settings.calendar.monthlyTargetLabel')}</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={settings.monthlyHoursTarget ?? 182.5}
              onChange={(e) => onChange({ monthlyHoursTarget: parseFloat(e.target.value) || 0 })}
              className={styles.monthlyTargetInput}
            />
          </label>
        </div>
      </div>
    </div>
  );
};

export default CalendarTab;
