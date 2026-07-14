import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Layout, Database, Settings, Calendar, ChevronLeft, Save, Download, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../contexts/SettingsContext';
import { useLocale } from '../../hooks/useLocale';
import StructureTab from './StructureTab';
import MappingTab from './MappingTab';
import AdditionalTab from './AdditionalTab';
import CalendarTab from './CalendarTab';
import { useSettingsValidation } from './useSettingsValidation';
import { countTabErrors } from './settingsErrorMeta';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../Toast';
import ErrorDetailsModal from '../ErrorDetailsModal/ErrorDetailsModal';
import ConfirmDialog from '../ConfirmDialog/ConfirmDialog';
import { safeApi } from '../../utils/mondayApi';
import logger from '../../utils/logger';
import { getVersionLabel } from '../../utils/versionLabel';
import styles from './SettingsDialog.module.css';

// סדר הטאבים לניווט
const TAB_ORDER = ['structure', 'mapping', 'additional', 'calendar'];

/**
 * דיאלוג הגדרות ראשי
 * מחולק ל-4 טאבים: מבנה דיווח, מיפוי נתונים, הגדרות נוספות, הגדרות יומן
 */
export default function SettingsDialog({ monday, onClose, context }) {
  const { t } = useTranslation();
  // locale עבור Intl.DateTimeFormat (toLocaleDateString/toLocaleTimeString)
  // — נגזר משפת ה-i18n הפעילה כדי שה-footer יציג תאריך/שעה בפורמט המתאים.
  const { dateLocale } = useLocale();
  const { customSettings, updateSettings } = useSettings();
  const { showErrorWithDetails, showSuccess, toasts, removeToast, errorDetailsModal, openErrorDetailsModal, closeErrorDetailsModal } = useToast();

  // State - טאב נוכחי
  const [activeTab, setActiveTab] = useState('structure');

  // State - הגדרות זמניות (עד לשמירה)
  const [tempSettings, setTempSettings] = useState({ ...customSettings });

  // State - רשימת לוחות
  const [boards, setBoards] = useState([]);
  const [loadingBoards, setLoadingBoards] = useState(false);

  // State - דיאלוג אישור שמירה חלקית
  const [partialSaveDialog, setPartialSaveDialog] = useState({
    isOpen: false,
    message: ''
  });

  // State - דיאלוג אישור ייבוא הגדרות
  const [importConfirm, setImportConfirm] = useState({ isOpen: false, payload: null, fileName: '' });

  // ref לפתיחת בורר קבצים סמוי לייבוא
  const fileInputRef = useRef(null);

  // Validation
  const {
    errors,
    isValid,
    getMissingFieldsMessage
  } = useSettingsValidation(tempSettings, context);

  // חישוב מספר שגיאות לכל טאב
  const tabErrorCounts = useMemo(() => countTabErrors(errors), [errors]);

  // טעינת רשימת לוחות בעלייה
  useEffect(() => {
    fetchBoards();
  }, []);

  // איפוס הגדרות זמניות בפתיחת הדיאלוג
  useEffect(() => {
    setTempSettings({ ...customSettings });
    setActiveTab('structure');
  }, [customSettings]);

  // שליפת רשימת לוחות
  const fetchBoards = async () => {
    setLoadingBoards(true);
    try {
      const query = `query { boards(limit: 500) { id name type } }`;
      const res = await safeApi(monday, 'SettingsDialog.fetchBoards', query);
      if (res.data?.boards) {
        const filteredBoards = res.data.boards
          .filter(board => board.type === 'board')
          .map(b => ({ id: b.id, name: b.name }));
        setBoards(filteredBoards);
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'fetchBoards' });
    } finally {
      setLoadingBoards(false);
    }
  };

  // עדכון הגדרות זמניות
  const handleSettingsChange = (changes) => {
    setTempSettings(prev => ({ ...prev, ...changes }));
  };

  // מעבר לטאב הבא
  const handleNextTab = () => {
    const currentIndex = TAB_ORDER.indexOf(activeTab);
    if (currentIndex < TAB_ORDER.length - 1) {
      setActiveTab(TAB_ORDER[currentIndex + 1]);
    }
  };

  // חזרה לטאב הקודם
  const handlePrevTab = () => {
    const currentIndex = TAB_ORDER.indexOf(activeTab);
    if (currentIndex > 0) {
      setActiveTab(TAB_ORDER[currentIndex - 1]);
    }
  };

  const currentTabIndex = TAB_ORDER.indexOf(activeTab);
  const isFirstTab = currentTabIndex === 0;
  const isLastTab = currentTabIndex === TAB_ORDER.length - 1;

  // שמות הטאבים לניווט — נטענים מהתרגום בזמן ריצה
  const TAB_LABELS = {
    structure: t('settings.tabs.structure'),
    mapping: t('settings.tabs.mapping'),
    additional: t('settings.tabs.additional'),
    calendar: t('settings.tabs.calendar')
  };

  const nextTabLabel = !isLastTab ? TAB_LABELS[TAB_ORDER[currentTabIndex + 1]] : null;
  const prevTabLabel = !isFirstTab ? TAB_LABELS[TAB_ORDER[currentTabIndex - 1]] : null;

  // שמירה סופית
  const handleSave = async () => {
    // אם יש שגיאות, נציג דיאלוג אישור
    if (!isValid) {
      const message = getMissingFieldsMessage();
      setPartialSaveDialog({
        isOpen: true,
        message
      });
      return;
    }

    await performSave();
  };

  // ביצוע השמירה בפועל
  const performSave = async () => {
    logger.functionStart('SettingsDialog.performSave', { tempSettings });

    const success = await updateSettings(tempSettings);

    if (success) {
      showSuccess(t('settings.messages.saved'));
      onClose();
    } else {
      showErrorWithDetails(new Error(t('settings.messages.saveError')), { functionName: 'handleSave' });
    }

    setPartialSaveDialog({ isOpen: false, message: '' });
  };

  // אישור שמירה חלקית
  const handlePartialSaveConfirm = async () => {
    await performSave();
  };

  // ביטול שמירה חלקית
  const handlePartialSaveCancel = () => {
    setPartialSaveDialog({ isOpen: false, message: '' });
  };

  // ייצוא ההגדרות הנוכחיות (כולל עריכות לא שמורות) לקובץ JSON
  const handleExportSettings = () => {
    try {
      const { lastModifiedAt, lastModifiedBy, ...exportable } = tempSettings;
      const payload = {
        __type: 'tracker-settings',
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: exportable,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `tracker-settings-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccess(t('settings.messages.exported'));
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'handleExportSettings' });
    }
  };

  // קליק על כפתור ייבוא — פותח בורר קבצים
  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // קריאת קובץ ההגדרות שנבחר
  const handleImportFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const settings = parsed && typeof parsed === 'object' && parsed.settings && typeof parsed.settings === 'object'
          ? parsed.settings
          : parsed;
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
          throw new Error(t('settings.messages.invalidStructure'));
        }
        setImportConfirm({ isOpen: true, payload: settings, fileName: file.name });
      } catch (err) {
        // רשומה אחת שנושאת את הודעת המשתמש; שגיאת ה-parse המקורית נשמרת ב-details.
        // ה-UI sink מציג את הטוסט (איחוד A-double — בלי showErrorWithDetails צמוד)
        const importErr = new Error(t('settings.messages.invalidJson'));
        importErr.details = err;
        logger.error('SettingsDialog', 'Error parsing import file', importErr);
      }
    };
    reader.onerror = () => {
      const readErr = new Error(t('settings.messages.readError'));
      readErr.details = reader.error;
      logger.error('SettingsDialog', 'Error reading import file', readErr);
    };
    reader.readAsText(file);
  };

  // אישור ייבוא — מחליף את ההגדרות הזמניות; השמירה נעשית רק בלחיצה על "שמור הגדרות"
  const handleImportConfirm = () => {
    const incoming = importConfirm.payload || {};
    setTempSettings(prev => ({
      ...prev,
      ...incoming,
      // שומרים את חתימת הזמן הקיימת — תתעדכן בעת שמירה
      lastModifiedAt: prev.lastModifiedAt,
      lastModifiedBy: prev.lastModifiedBy,
    }));
    setImportConfirm({ isOpen: false, payload: null, fileName: '' });
    showSuccess(t('settings.messages.imported'));
  };

  const handleImportCancel = () => {
    setImportConfirm({ isOpen: false, payload: null, fileName: '' });
  };

  // Tab Header Component
  const TabHeader = ({ id, label, icon: Icon, isActive, onClick, errorCount }) => (
    <button
      className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
      onClick={onClick}
      type="button"
    >
      <Icon size={16} />
      {label}
      {errorCount > 0 && <span className={styles.tabErrorDot} title={t('settings.tabHasErrors')} />}
    </button>
  );

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <button
            className={styles.closeButton}
            onClick={onClose}
          >
            <X size={24} />
          </button>
          <div className={styles.headerText}>
            <h2 className={styles.title}>{t('settings.title')}</h2>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={handleExportSettings}
              title={t('settings.exportTitle')}
            >
              <Download size={16} />
              <span>{t('settings.exportLabel')}</span>
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={handleImportClick}
              title={t('settings.importTitle')}
            >
              <Upload size={16} />
              <span>{t('settings.importLabel')}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={handleImportFileChange}
            />
          </div>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          <TabHeader
            id="structure"
            label={`1. ${TAB_LABELS.structure}`}
            icon={Layout}
            isActive={activeTab === 'structure'}
            onClick={() => setActiveTab('structure')}
            errorCount={tabErrorCounts.structure}
          />
          <TabHeader
            id="mapping"
            label={`2. ${TAB_LABELS.mapping}`}
            icon={Database}
            isActive={activeTab === 'mapping'}
            onClick={() => setActiveTab('mapping')}
            errorCount={tabErrorCounts.mapping}
          />
          <TabHeader
            id="additional"
            label={`3. ${TAB_LABELS.additional}`}
            icon={Settings}
            isActive={activeTab === 'additional'}
            onClick={() => setActiveTab('additional')}
            errorCount={tabErrorCounts.additional}
          />
          <TabHeader
            id="calendar"
            label={`4. ${TAB_LABELS.calendar}`}
            icon={Calendar}
            isActive={activeTab === 'calendar'}
            onClick={() => setActiveTab('calendar')}
            errorCount={tabErrorCounts.calendar}
          />
        </div>

        {/* Content */}
        <div className={styles.content}>
          {activeTab === 'structure' && (
            <StructureTab
              settings={tempSettings}
              onChange={handleSettingsChange}
              fieldErrors={errors}
            />
          )}

          {activeTab === 'mapping' && (
            <MappingTab
              settings={tempSettings}
              onChange={handleSettingsChange}
              monday={monday}
              context={context}
              boards={boards}
              loadingBoards={loadingBoards}
              showErrorWithDetails={showErrorWithDetails}
              fieldErrors={errors}
            />
          )}

          {activeTab === 'additional' && (
            <AdditionalTab
              settings={tempSettings}
              onChange={handleSettingsChange}
              monday={monday}
              context={context}
              boards={boards}
              loadingBoards={loadingBoards}
              showErrorWithDetails={showErrorWithDetails}
              fieldErrors={errors}
            />
          )}

          {activeTab === 'calendar' && (
            <CalendarTab
              settings={tempSettings}
              onChange={handleSettingsChange}
            />
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {customSettings.lastModifiedAt && (
            <span className={styles.modifiedInfo}>
              {customSettings.lastModifiedBy?.name
                ? t('settings.lastModifiedBy', { name: customSettings.lastModifiedBy.name })
                : t('settings.lastModifiedAnonymous')}
              {' '}{t('settings.modifiedOnDate', { date: new Date(customSettings.lastModifiedAt).toLocaleDateString(dateLocale) })}
              {' '}{t('settings.modifiedAtTime', { time: new Date(customSettings.lastModifiedAt).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' }) })}
            </span>
          )}
          {isFirstTab ? (
            <button
              className={styles.buttonSecondary}
              onClick={onClose}
            >
              {t('settings.actions.cancel')}
            </button>
          ) : (
            <button
              className={styles.buttonSecondary}
              onClick={handlePrevTab}
            >
              {t('settings.actions.back', { tab: prevTabLabel })}
            </button>
          )}

          {isLastTab ? (
            <button
              className={`${styles.buttonPrimary} ${styles.buttonSave}`}
              onClick={handleSave}
            >
              <Save size={18} />
              {t('settings.actions.save')}
            </button>
          ) : (
            <button
              className={styles.buttonPrimary}
              onClick={handleNextTab}
            >
              {t('settings.actions.next', { tab: nextTabLabel })}
              <ChevronLeft size={18} />
            </button>
          )}
        </div>

        {/* Version caption — Latin string, forced LTR inside the RTL dialog.
            Kept inside .modal (not .overlay) so it stays on-screen when the
            mobile media query makes the modal fill the viewport. */}
        <div className={styles.versionCaption} dir="ltr">
          {getVersionLabel()}
        </div>
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onRemove={removeToast} onShowErrorDetails={openErrorDetailsModal} />

      {/* Error Details Modal */}
      <ErrorDetailsModal isOpen={!!errorDetailsModal} onClose={closeErrorDetailsModal} errorDetails={errorDetailsModal} />

      {/* Partial Save Confirmation Dialog */}
      <ConfirmDialog
        isOpen={partialSaveDialog.isOpen}
        onClose={handlePartialSaveCancel}
        onConfirm={handlePartialSaveConfirm}
        onCancel={handlePartialSaveCancel}
        title={t('settings.partialSave.title')}
        message={partialSaveDialog.message + '\n\n' + t('settings.partialSave.messageSuffix')}
        confirmText={t('settings.partialSave.confirm')}
        cancelText={t('settings.partialSave.cancel')}
        confirmButtonStyle="primary"
      />

      {/* Import Confirmation Dialog */}
      <ConfirmDialog
        isOpen={importConfirm.isOpen}
        onClose={handleImportCancel}
        onConfirm={handleImportConfirm}
        onCancel={handleImportCancel}
        title={t('settings.import.title')}
        message={t('settings.import.message', { fileName: importConfirm.fileName })}
        confirmText={t('settings.import.confirm')}
        cancelText={t('settings.import.cancel')}
        confirmButtonStyle="primary"
      />
    </div>
  );
}
