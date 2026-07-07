import React, { useState, useRef, useEffect } from 'react';
import { Navigate } from 'react-big-calendar';
import { format } from 'date-fns';
import { Settings, BarChart3, Palette } from 'lucide-react';
import { NavigationChevronLeft, NavigationChevronRight, DropdownChevronDown } from "@vibe/icons";
import { useTranslation } from 'react-i18next';
import { useMobile } from '../contexts/MondayContext';
import { useLocale } from '../hooks/useLocale';
import FilterBar from './FilterBar';
import MonthlyBattery from './MonthlyBattery';

const CalendarToolbar = ({
  onNavigate,
  onView,
  label,
  view,
  date,
  views,
  localizer,
  onOpenSettings,
  onOpenProjectColors,
  onSwitchToDashboard,
  isOwner = false,
  // Filter props
  filterProps = null,
  // Battery props
  batteryProps = null,
  // Approval props
  isManager = false,
  isApprovalEnabled = false,
  isSelectionMode = false,
  onToggleSelectionMode = null,
  onApproveAllInWeek = null,
  hasIncompleteSettings = false
}) => {
  const { t } = useTranslation();
  const isMobile = useMobile();
  const { isLtr, dateFnsLocale } = useLocale();
  // ב-LTR החיצים מתהפכים — "קודם" שמאלה (<), "הבא" ימינה (>).
  // ב-RTL ההפך, כפי שהיה: ChevronRight = קודם, ChevronLeft = הבא.
  const PrevIcon = isLtr ? NavigationChevronLeft : NavigationChevronRight;
  const NextIcon = isLtr ? NavigationChevronRight : NavigationChevronLeft;
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const dropdownRef = useRef(null);

  // הודעות התצוגות מתורגמות בזמן ריצה
  const viewMessages = {
    month: t('calendarToolbar.views.month'),
    week: t('calendarToolbar.views.week'),
    work_week: t('calendarToolbar.views.work_week'),
    three_day: t('calendarToolbar.views.three_day'),
    day: t('calendarToolbar.views.day'),
    agenda: t('calendarToolbar.views.agenda')
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsViewMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleViewChange = (newView) => {
    onView(newView);
    setIsViewMenuOpen(false);
  };

  // Mobile toolbar - single compact row
  if (isMobile) {
    // שם חודש לחיץ (התאריך עצמו מוצג ב-time-gutter header בסגנון Google Calendar)
    const currentDate = date instanceof Date ? date : new Date();
    const monthLabel = format(currentDate, 'LLLL yyyy', { locale: dateFnsLocale });

    return (
      <div className="rbc-toolbar rbc-toolbar-mobile">
        {/* כפתור "היום" — ניווט בין ימים נעשה בסווייפ אופקי וב-month picker */}
        <button
          type="button"
          className="rbc-today-btn"
          onClick={() => onNavigate(Navigate.TODAY)}
        >
          {t('calendarToolbar.today')}
        </button>

        {/* תווית חודש לחיצה — מעבר לתצוגת חודש */}
        {/* תווית חודש — תצוגה בלבד, לא לחיצה */}
        <span className="rbc-month-label">{monthLabel}</span>

        {/* כפתור דשבורד - מובייל */}
        {onSwitchToDashboard ? (
          <button
            type="button"
            className="rbc-dashboard-btn"
            onClick={onSwitchToDashboard}
            aria-label={t('calendarToolbar.dashboard')}
          >
            <BarChart3 size={18} />
          </button>
        ) : null}

        {/* כפתורי אישור מנהל - מובייל */}
        {isManager && isApprovalEnabled && onToggleSelectionMode ? (
          <button
            type="button"
            className={`rbc-approval-btn-mobile ${isSelectionMode ? 'active' : ''}`}
            onClick={onToggleSelectionMode}
            aria-label={isSelectionMode ? t('calendarToolbar.cancelSelection') : t('calendarToolbar.selectReports')}
          >
            {isSelectionMode ? '✕' : '✓'}
          </button>
        ) : null}

        {/* בחירת תצוגה */}
        <div className="rbc-view-dropdown" ref={dropdownRef}>
          <button
            type="button"
            className="rbc-view-select-button"
            onClick={() => setIsViewMenuOpen(!isViewMenuOpen)}
            aria-haspopup="listbox"
            aria-expanded={isViewMenuOpen}
          >
            <span>{viewMessages[view] || view}</span>
            <DropdownChevronDown size="16" />
          </button>

          {isViewMenuOpen ? (
            <>
              <div className="rbc-mobile-backdrop" onClick={() => setIsViewMenuOpen(false)} />
              <div className="rbc-view-menu" role="listbox">
                {views.map(viewName => (
                  <button
                    key={viewName}
                    type="button"
                    role="option"
                    aria-selected={view === viewName}
                    className={view === viewName ? 'active' : ''}
                    onClick={() => handleViewChange(viewName)}
                  >
                    {viewMessages[viewName] || viewName}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* כפתור צבעי פרויקטים — חשוף לכולם */}
        {onOpenProjectColors ? (
          <button
            type="button"
            className="rbc-settings-btn"
            onClick={onOpenProjectColors}
            aria-label={t('calendarToolbar.projectColors')}
            title={t('calendarToolbar.projectColors')}
          >
            <Palette size={18} />
          </button>
        ) : null}

        {/* כפתור הגדרות — מובייל (תמיד מוצג, המשתמש מנהל את ה-instance שלו) */}
        <button
          type="button"
          className={
            hasIncompleteSettings
              ? 'rbc-settings-btn rbc-settings-btn--incomplete'
              : 'rbc-settings-btn'
          }
          onClick={onOpenSettings}
          aria-label={t('calendarToolbar.settings')}
          title={hasIncompleteSettings ? t('calendarToolbar.settingsIncomplete') : undefined}
        >
          <Settings size={18} />
        </button>
      </div>
    );
  }

  // Desktop toolbar
  return (
    <div className="rbc-toolbar">
      {/* צד ימין - ניווט וכותרת */}
      <div className="rbc-toolbar-section rbc-toolbar-nav">
        <button
          type="button"
          className="rbc-today-btn"
          onClick={() => onNavigate(Navigate.TODAY)}
        >
          {t('calendarToolbar.today')}
        </button>

        <div className="rbc-nav-arrows">
          <button type="button" className="rbc-nav-btn" onClick={() => onNavigate(Navigate.PREVIOUS)} aria-label={t('calendarToolbar.previous')}>
            <PrevIcon size="20" />
          </button>
          <button type="button" className="rbc-nav-btn" onClick={() => onNavigate(Navigate.NEXT)} aria-label={t('calendarToolbar.next')}>
            <NextIcon size="20" />
          </button>
        </div>

        <span className="rbc-toolbar-label">{label}</span>
      </div>

      {/* אמצע - פילטרים */}
      {filterProps ? (
        <div className="rbc-toolbar-section rbc-toolbar-filters">
          <FilterBar {...filterProps} />
        </div>
      ) : null}

      {/* בטרייה חודשית */}
      {batteryProps ? (
        <div className="rbc-toolbar-section rbc-toolbar-battery">
          <MonthlyBattery {...batteryProps} />
        </div>
      ) : null}

      {/* צד שמאל - תצוגות והגדרות */}
      <div className="rbc-toolbar-section rbc-toolbar-actions">
        {/* כפתורי אישור מנהל */}
        {isManager && isApprovalEnabled && onToggleSelectionMode ? (
          <>
            <button
              type="button"
              className={`rbc-approval-btn ${isSelectionMode ? 'active' : ''}`}
              onClick={onToggleSelectionMode}
              title={isSelectionMode ? t('calendarToolbar.cancelSelection') : t('calendarToolbar.selectReportsForApproval')}
            >
              <span>{isSelectionMode ? t('calendarToolbar.cancelSelection') : t('calendarToolbar.selectReports')}</span>
            </button>
            <button
              type="button"
              className="rbc-approval-btn rbc-approve-all-btn"
              onClick={() => onApproveAllInWeek()}
              title={t('calendarToolbar.approveAll')}
            >
              <span>{t('calendarToolbar.approveAll')}</span>
            </button>
          </>
        ) : null}

        {/* כפתור דשבורד */}
        {onSwitchToDashboard ? (
          <button
            type="button"
            className="rbc-dashboard-btn"
            onClick={onSwitchToDashboard}
            aria-label={t('calendarToolbar.dashboard')}
            title={t('calendarToolbar.dashboardTitle')}
          >
            <BarChart3 size={20} />
          </button>
        ) : null}

        {/* Dropdown תצוגות */}
        <div className="rbc-view-dropdown" ref={dropdownRef}>
          <button
            type="button"
            className="rbc-view-select-button"
            onClick={() => setIsViewMenuOpen(!isViewMenuOpen)}
            aria-haspopup="listbox"
            aria-expanded={isViewMenuOpen}
          >
            <span>{viewMessages[view] || view}</span>
            <DropdownChevronDown size="20" />
          </button>

          {isViewMenuOpen ? (
            <div className="rbc-view-menu" role="listbox">
              {views.map(viewName => (
                <button
                  key={viewName}
                  type="button"
                  role="option"
                  aria-selected={view === viewName}
                  className={view === viewName ? 'active' : ''}
                  onClick={() => handleViewChange(viewName)}
                >
                  {viewMessages[viewName] || viewName}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* כפתור צבעי פרויקטים — חשוף לכולם */}
        {onOpenProjectColors ? (
          <button
            type="button"
            className="rbc-settings-btn"
            onClick={onOpenProjectColors}
            aria-label={t('calendarToolbar.projectColors')}
            title={t('calendarToolbar.projectColors')}
          >
            <Palette size={20} />
          </button>
        ) : null}

        {/* כפתור הגדרות - מוסתר במובייל */}
        {isOwner ? (
          <button
            type="button"
            className={
              hasIncompleteSettings
                ? 'rbc-settings-btn rbc-settings-btn--incomplete'
                : 'rbc-settings-btn'
            }
            onClick={onOpenSettings}
            aria-label={t('calendarToolbar.settings')}
            title={hasIncompleteSettings ? t('calendarToolbar.settingsIncomplete') : undefined}
          >
            <Settings size={20} />
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default CalendarToolbar;
