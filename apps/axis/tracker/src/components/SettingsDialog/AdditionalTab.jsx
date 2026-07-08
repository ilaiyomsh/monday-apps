import React, { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, Lock, Users, Info, X, AlertTriangle, Sun, Moon, Monitor, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SearchableSelect from './SearchableSelect';
import MultiSelect from './MultiSelect';
import { parseStatusColumnLabels } from '../../utils/eventTypeValidation';
import { APPROVAL_CATEGORY_LABELS, APPROVAL_UNMAPPED, APPROVAL_UNMAPPED_LABEL, validateApprovalMapping, createAutoApprovalMapping } from '../../utils/approvalMapping';
import { EDIT_LOCK_MODES, EDIT_LOCK_LABEL_KEYS, DEFAULT_EDIT_LOCK_DAYS, MIN_EDIT_LOCK_DAYS, MAX_EDIT_LOCK_DAYS } from '../../utils/editLockUtils';
import { getEffectiveBoardId } from '../../utils/boardIdResolver';
import { safeApi } from '../../utils/mondayApi';
import sStyles from './StructureTab.module.css';
import mStyles from './MappingTab.module.css';
import { columnSelectLabel } from '../../utils/mondayColumns';

/**
 * טאב הגדרות נוספות
 * אישור מנהל (כולל מיפוי), נעילת עריכה, פילטרים ומקורות
 */
const AdditionalTab = ({
  settings,
  onChange,
  monday,
  context,
  boards,
  loadingBoards,
  showErrorWithDetails,
  fieldErrors = {}
}) => {
  const { t } = useTranslation();
  // === State - אישור מנהל: People Picker ===
  const [accountUsers, setAccountUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');

  // === State - עמודות סטטוס מלוח הדיווחים (לאישור מנהל) ===
  const [statusColumns, setStatusColumns] = useState([]);
  const [statusColumnsWithSettings, setStatusColumnsWithSettings] = useState([]);
  const [loadingStatusColumns, setLoadingStatusColumns] = useState(false);

  // === State - מיפוי אישור מנהל ===
  const [approvalStatusLabels, setApprovalStatusLabels] = useState([]);
  const [approvalValidation, setApprovalValidation] = useState({ isValid: true, errors: [] });

  // === State - פילטרים ===
  const [employeesPeopleColumns, setEmployeesPeopleColumns] = useState([]);
  const [loadingEmployeesColumns, setLoadingEmployeesColumns] = useState(false);

  // חישוב לוח דיווחים אפקטיבי
  const effectiveBoardId = useMemo(() =>
    getEffectiveBoardId(settings, context),
    [settings, context]
  );

  const isAssignmentsMode = settings.useAssignmentsMode;

  // === Effects ===

  // טעינת משתמשים כש-approval מופעל
  useEffect(() => {
    if (settings.enableApproval && monday && accountUsers.length === 0) {
      fetchAccountUsers();
    }
  }, [settings.enableApproval, monday]);

  // טעינת עמודות סטטוס מלוח הדיווחים
  useEffect(() => {
    if (effectiveBoardId) {
      fetchStatusColumns(effectiveBoardId);
    }
  }, [effectiveBoardId]);

  // טעינת לייבלים של עמודת אישור
  useEffect(() => {
    if (settings.approvalStatusColumnId && statusColumnsWithSettings.length > 0) {
      const selectedCol = statusColumnsWithSettings.find(col => col.id === settings.approvalStatusColumnId);
      if (selectedCol?.settings) {
        const labels = parseStatusColumnLabels(selectedCol.settings);
        setApprovalStatusLabels(labels.map(l => ({ id: String(l.id), name: l.label, color: l.color || '' })));
        if (settings.approvalStatusMapping) {
          setApprovalValidation(validateApprovalMapping(settings.approvalStatusMapping));
        }
      }
    }
  }, [settings.approvalStatusColumnId, statusColumnsWithSettings]);

  // טעינת עמודות People מלוח עובדים
  useEffect(() => {
    if (settings.filterEmployeesBoardId) {
      loadEmployeesPeopleColumns(settings.filterEmployeesBoardId);
    }
  }, [settings.filterEmployeesBoardId]);

  // === API Functions ===

  const fetchAccountUsers = async () => {
    if (!monday) return;
    setLoadingUsers(true);
    try {
      const res = await safeApi(monday, 'AdditionalTab.fetchAccountUsers', `query { users(kind: non_guests) { id name photo_thumb_small } }`);
      if (res.data?.users) {
        setAccountUsers(res.data.users.map(u => ({
          id: String(u.id),
          name: u.name,
          photo: u.photo_thumb_small
        })));
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'fetchAccountUsers' });
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchStatusColumns = async (boardId) => {
    if (!boardId) return;
    setLoadingStatusColumns(true);
    try {
      const query = `query { boards(ids: [${boardId}]) { columns { id title type settings } } }`;
      const res = await safeApi(monday, 'AdditionalTab.fetchStatusColumns', query);
      if (res.data?.boards?.[0]) {
        const columns = res.data.boards[0].columns;
        const statusCols = columns
          .filter(col => col.type === 'status')
          .map(col => ({ id: col.id, name: columnSelectLabel(col) }));
        const statusColsWithSettings = columns
          .filter(col => col.type === 'status')
          .map(col => ({ id: col.id, name: columnSelectLabel(col), settings: col.settings }));
        setStatusColumns(statusCols);
        setStatusColumnsWithSettings(statusColsWithSettings);
      }
    } catch (err) {
      showErrorWithDetails(err, { functionName: 'fetchStatusColumns' });
    } finally {
      setLoadingStatusColumns(false);
    }
  };

  const loadEmployeesPeopleColumns = async (boardId) => {
    if (!boardId) return;
    setLoadingEmployeesColumns(true);
    try {
      const query = `query { boards(ids: [${boardId}]) { columns { id title type } } }`;
      const res = await safeApi(monday, 'AdditionalTab.loadEmployeesPeopleColumns', query);
      if (res.data?.boards?.[0]) {
        const cols = res.data.boards[0].columns
          .filter(col => col.type === 'people')
          .map(col => ({ id: col.id, name: columnSelectLabel(col) }));
        setEmployeesPeopleColumns(cols);
      }
    } catch (error) {
      showErrorWithDetails(error, { functionName: 'loadEmployeesPeopleColumns' });
      setEmployeesPeopleColumns([]);
    } finally {
      setLoadingEmployeesColumns(false);
    }
  };

  // === Handlers - אישור מנהל ===

  const handleAddManager = (userId) => {
    const current = settings.approvedManagerIds || [];
    if (!current.includes(userId)) {
      onChange({ approvedManagerIds: [...current, userId] });
    }
    setUserSearchQuery('');
  };

  const handleRemoveManager = (userId) => {
    const current = settings.approvedManagerIds || [];
    onChange({ approvedManagerIds: current.filter(id => id !== userId) });
  };

  const filteredUsers = accountUsers.filter(u => {
    const managerIds = settings.approvedManagerIds || [];
    if (managerIds.includes(u.id)) return false;
    if (!userSearchQuery) return true;
    return u.name.toLowerCase().includes(userSearchQuery.toLowerCase());
  });

  const handleApprovalColumnChange = (newColumnId) => {
    onChange({ approvalStatusColumnId: newColumnId });

    if (newColumnId) {
      const selectedCol = statusColumnsWithSettings.find(col => col.id === newColumnId);
      if (selectedCol?.settings) {
        const labels = parseStatusColumnLabels(selectedCol.settings);
        setApprovalStatusLabels(labels.map(l => ({ id: String(l.id), name: l.label, color: l.color || '' })));

        // ניסיון מיגרציה אוטומטית אם אין מיפוי
        if (!settings.approvalStatusMapping) {
          const result = createAutoApprovalMapping(labels);
          if (result) {
            onChange({
              approvalStatusColumnId: newColumnId,
              approvalStatusMapping: result.mapping,
              approvalStatusLabelMeta: result.labelMeta
            });
            setApprovalValidation(validateApprovalMapping(result.mapping));
            return;
          }
        }

        if (settings.approvalStatusMapping) {
          setApprovalValidation(validateApprovalMapping(settings.approvalStatusMapping));
        } else {
          setApprovalValidation({ isValid: false, errors: [t('settings.additional.approval.mappingRequired')] });
        }
      } else {
        setApprovalStatusLabels([]);
        setApprovalValidation({ isValid: true, errors: [] });
      }
    } else {
      setApprovalStatusLabels([]);
      setApprovalValidation({ isValid: true, errors: [] });
      onChange({ approvalStatusColumnId: null, approvalStatusMapping: null, approvalStatusLabelMeta: null });
    }
  };

  const handleApprovalMappingLabelChange = (labelIndex, category) => {
    const currentMapping = { ...(settings.approvalStatusMapping || {}) };
    const currentMeta = { ...(settings.approvalStatusLabelMeta || {}) };

    if (category === APPROVAL_UNMAPPED) {
      delete currentMapping[labelIndex];
      delete currentMeta[labelIndex];
    } else {
      currentMapping[labelIndex] = category;
      const labelObj = approvalStatusLabels.find(l => l.id === labelIndex);
      if (labelObj) {
        currentMeta[labelIndex] = { label: labelObj.name, color: labelObj.color || '' };
      }
    }

    onChange({ approvalStatusMapping: currentMapping, approvalStatusLabelMeta: currentMeta });
    setApprovalValidation(validateApprovalMapping(currentMapping));
  };

  const isApprovalCategoryTaken = (category) => {
    if (!settings.approvalStatusMapping) return false;
    return Object.values(settings.approvalStatusMapping).filter(c => c === category).length >= 1;
  };

  // === Handler - פילטר עובדים ===

  const handleEmployeesBoardChange = (newBoardId) => {
    onChange({
      filterEmployeesBoardId: newBoardId,
      filterEmployeesColumnId: null
    });
    setEmployeesPeopleColumns([]);
    if (newBoardId) {
      loadEmployeesPeopleColumns(newBoardId);
    }
  };

  // === UI Components ===

  const SectionHeader = ({ icon: Icon, title, showErrorDot = false }) => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '16px',
      paddingBottom: '12px',
      borderBottom: '1px solid var(--color-border)'
    }}>
      <div style={{
        width: '36px',
        height: '36px',
        borderRadius: '8px',
        backgroundColor: 'var(--color-info-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Icon size={20} style={{ color: 'var(--color-primary)' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-text)' }}>{title}</h3>
        {showErrorDot && (
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: 'var(--color-danger-strong)',
              flexShrink: 0,
              boxShadow: '0 0 0 2px var(--color-bg-primary)'
            }}
            title={t('settings.additional.approval.sectionHasErrors')}
            aria-hidden
          />
        )}
      </div>
    </div>
  );

  const InfoBox = ({ children }) => (
    <div style={{
      backgroundColor: 'var(--color-info-bg)',
      border: '1px solid var(--color-info-border)',
      borderRadius: '8px',
      padding: '12px 16px',
      marginBottom: '16px',
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start'
    }}>
      <Info size={18} style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: '2px' }} />
      <div style={{ fontSize: '0.9rem', color: 'var(--color-text-strong-alt)' }}>{children}</div>
    </div>
  );

  const FieldWrapper = ({ label, required, description, children }) => (
    <div className={mStyles.fieldWrapper}>
      <label className={mStyles.fieldLabel}>
        {label} {required && <span className={mStyles.required}>*</span>}
      </label>
      {description && <p className={mStyles.fieldDescription}>{description}</p>}
      {children}
    </div>
  );

  const themeMode = settings.themeMode || 'auto';
  const themeOptions = [
    { value: 'light', icon: Sun, label: t('settings.additional.appearance.light') },
    { value: 'dark', icon: Moon, label: t('settings.additional.appearance.dark') },
    { value: 'auto', icon: Monitor, label: t('settings.additional.appearance.auto') }
  ];

  return (
    <div className={mStyles.container}>
      {/* === סקשן: מראה (Dark Mode) === */}
      <div style={{ marginBottom: '32px' }}>
        <SectionHeader
          icon={Palette}
          title={t('settings.additional.appearance.sectionTitle')}
        />
        <p style={{
          margin: '0 0 12px 0',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-secondary)'
        }}>
          {t('settings.additional.appearance.sectionDescription')}
        </p>
        <div
          role="radiogroup"
          aria-label={t('settings.additional.appearance.sectionTitle')}
          style={{
            display: 'inline-flex',
            gap: '4px',
            padding: '4px',
            background: 'var(--color-bg-tertiary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-button)'
          }}
        >
          {themeOptions.map(({ value, icon: Icon, label }) => {
            const isActive = themeMode === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => onChange({ themeMode: value })}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: isActive ? 'var(--color-bg-primary)' : 'transparent',
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  fontWeight: isActive ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
                  fontSize: 'var(--font-size-button)',
                  cursor: 'pointer',
                  boxShadow: isActive ? 'var(--shadow-xs)' : 'none',
                  transition: 'var(--transition-base)'
                }}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* === סקשן 1: אישור מנהל === */}
      <div style={{ marginBottom: '32px' }}>
        <SectionHeader
          icon={ShieldCheck}
          title={t('settings.additional.approval.sectionTitle')}
          showErrorDot={!!(fieldErrors.approvalStatusColumnId || fieldErrors.approvalStatusMapping)}
        />

        <label className={sStyles.notesToggle} style={{ marginTop: 0 }}>
          <div className={sStyles.notesCheckbox}>
            <input
              type="checkbox"
              checked={settings.enableApproval || false}
              onChange={() => onChange({ enableApproval: !settings.enableApproval })}
            />
          </div>
          <div className={sStyles.notesContent}>
            <span className={sStyles.notesTitle}>
              {t('settings.additional.approval.toggleTitle')}
            </span>
            <span className={sStyles.notesDescription}>
              {t('settings.additional.approval.toggleDescription')}
            </span>
          </div>
        </label>

        {settings.enableApproval && (
          <>
            {/* בוחר מנהלים */}
            <div className={sStyles.approvalManagersSection}>
              <label className={sStyles.approvalLabel}>{t('settings.additional.approval.managersLabel')}</label>

              {(settings.approvedManagerIds || []).length > 0 && (
                <div className={sStyles.managersList}>
                  {(settings.approvedManagerIds || []).map(managerId => {
                    const user = accountUsers.find(u => u.id === managerId);
                    return (
                      <div key={managerId} className={sStyles.managerChip}>
                        {user?.photo && <img src={user.photo} alt="" className={sStyles.managerAvatar} />}
                        <span>{user?.name || t('settings.additional.approval.userFallbackName', { id: managerId })}</span>
                        <button
                          className={sStyles.managerRemoveBtn}
                          onClick={() => handleRemoveManager(managerId)}
                          type="button"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className={sStyles.managerSearchWrapper}>
                <input
                  type="text"
                  className={sStyles.managerSearchInput}
                  placeholder={loadingUsers ? t('settings.additional.approval.loadingUsersPlaceholder') : t('settings.additional.approval.searchUsersPlaceholder')}
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  onFocus={() => {
                    if (accountUsers.length === 0 && !loadingUsers) {
                      fetchAccountUsers();
                    }
                  }}
                  disabled={loadingUsers}
                />
                {userSearchQuery && filteredUsers.length > 0 && (
                  <div className={sStyles.managerDropdown}>
                    {filteredUsers.slice(0, 10).map(user => (
                      <button
                        key={user.id}
                        className={sStyles.managerDropdownItem}
                        onClick={() => handleAddManager(user.id)}
                        type="button"
                      >
                        {user.photo && <img src={user.photo} alt="" className={sStyles.managerAvatar} />}
                        <span>{user.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* עמודת סטטוס אישור + מיפוי */}
            <div style={{ marginTop: '16px' }}>
              <FieldWrapper label={t('settings.additional.approval.statusColumnLabel')} required>
                <div className={!effectiveBoardId ? mStyles.disabled : ''}>
                  <SearchableSelect
                    options={statusColumns}
                    value={settings.approvalStatusColumnId}
                    onChange={handleApprovalColumnChange}
                    placeholder={t('settings.additional.approval.statusColumnPlaceholder')}
                    isLoading={loadingStatusColumns}
                    showSearch={false}
                  />
                </div>
                {!effectiveBoardId && (
                  <p className={mStyles.fieldDescription} style={{ color: 'var(--color-warning)', marginTop: '6px' }}>
                    {t('settings.additional.approval.needTimesheetBoard')}
                  </p>
                )}
                {/* מיפוי סטטוסי אישור */}
                {settings.approvalStatusColumnId && approvalStatusLabels.length > 0 && (
                  <div className={mStyles.mappingSection}>
                    <div className={mStyles.mappingSectionTitle}>{t('settings.additional.approval.mappingSectionTitle')}</div>
                    <small className={mStyles.mappingSectionDesc}>{t('settings.additional.approval.mappingSectionDesc')}</small>
                    {approvalStatusLabels.map(labelObj => {
                      const currentCategory = (settings.approvalStatusMapping || {})[labelObj.id] || APPROVAL_UNMAPPED;
                      return (
                        <div key={labelObj.id} className={mStyles.mappingRow}>
                          <span className={mStyles.mappingColorDot} style={{ backgroundColor: labelObj.color || 'var(--color-border-medium)' }} />
                          <span className={mStyles.mappingLabelText}>{labelObj.name}</span>
                          <select
                            className={mStyles.mappingSelect}
                            value={currentCategory}
                            onChange={(e) => handleApprovalMappingLabelChange(labelObj.id, e.target.value)}
                          >
                            <option value={APPROVAL_UNMAPPED}>{APPROVAL_UNMAPPED_LABEL}</option>
                            {Object.entries(APPROVAL_CATEGORY_LABELS).map(([cat, catLabel]) => (
                              <option
                                key={cat}
                                value={cat}
                                disabled={isApprovalCategoryTaken(cat) && currentCategory !== cat}
                              >
                                {catLabel}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                    {approvalValidation.isValid ? (
                      <div className={mStyles.mappingValid}>{t('settings.additional.approval.mappingValid')}</div>
                    ) : (
                      <div className={mStyles.mappingErrors}>
                        <AlertTriangle size={14} />
                        <div>
                          {approvalValidation.errors.map((err, i) => (
                            <div key={i}>{err}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </FieldWrapper>
            </div>
          </>
        )}
      </div>

      {/* === סקשן 2: נעילת עריכה === */}
      <div style={{ marginBottom: '32px' }}>
        <SectionHeader icon={Lock} title={t('settings.additional.editLock.sectionTitle')} />

        <div className={sStyles.editLockOptions}>
          {Object.entries(EDIT_LOCK_LABEL_KEYS).map(([mode, labelKey]) => {
            const isSelected = (settings.editLockMode || EDIT_LOCK_MODES.NONE) === mode;
            const lockDays = Number(settings.editLockDays) || DEFAULT_EDIT_LOCK_DAYS;
            const isDaysAfter = mode === EDIT_LOCK_MODES.DAYS_AFTER;
            return (
              <label key={mode} className={sStyles.editLockOption}>
                <input
                  type="radio"
                  name="editLockMode"
                  value={mode}
                  checked={isSelected}
                  onChange={() => onChange({ editLockMode: mode })}
                />
                {isDaysAfter && isSelected ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <span>{t('settings.additional.editLock.daysAfterPrefix')}</span>
                    <input
                      type="number"
                      min={MIN_EDIT_LOCK_DAYS}
                      max={MAX_EDIT_LOCK_DAYS}
                      value={lockDays}
                      onChange={(e) => {
                        const raw = parseInt(e.target.value, 10);
                        if (Number.isNaN(raw)) return;
                        const clamped = Math.min(MAX_EDIT_LOCK_DAYS, Math.max(MIN_EDIT_LOCK_DAYS, raw));
                        onChange({ editLockDays: clamped });
                      }}
                      aria-label={t('settings.additional.editLock.daysLabel')}
                      style={{ width: '64px', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '6px', textAlign: 'center' }}
                    />
                    <span>{t('settings.additional.editLock.daysAfterSuffix')}</span>
                  </span>
                ) : (
                  <span>{t(labelKey, { days: lockDays })}</span>
                )}
              </label>
            );
          })}
        </div>

        {/* נעילה לאחר אישור מנהל */}
        {settings.enableApproval && (
          <label className={sStyles.notesToggle} style={{ marginTop: '12px' }}>
            <div className={sStyles.notesCheckbox}>
              <input
                type="checkbox"
                checked={settings.lockAfterApproval || false}
                onChange={() => onChange({ lockAfterApproval: !settings.lockAfterApproval })}
              />
            </div>
            <div className={sStyles.notesContent}>
              <span className={sStyles.notesTitle}>
                {t('settings.additional.editLock.lockAfterApprovalTitle')}
              </span>
              <span className={sStyles.notesDescription}>
                {t('settings.additional.editLock.lockAfterApprovalDescription')}
              </span>
            </div>
          </label>
        )}

        {settings.enableApproval && (settings.editLockMode || 'none') !== 'none' && (
          <div className={sStyles.editLockNote}>
            {t('settings.additional.editLock.managersExempt')}
          </div>
        )}
      </div>

      {/* === סקשן 3: פילטרים ומקורות === */}
      <div>
        {/* מקור עובדים */}
        <div>
          <SectionHeader icon={Users} title={t('settings.additional.filters.employeesSourceTitle')} />

          <InfoBox>
            <div>
              {t('settings.additional.filters.employeesIntro')}
            </div>
          </InfoBox>

          <FieldWrapper
            label={t('settings.additional.filters.employeesBoardLabel')}
            description={t('settings.additional.filters.employeesBoardDescription')}
          >
            <SearchableSelect
              options={boards}
              value={settings.filterEmployeesBoardId}
              onChange={handleEmployeesBoardChange}
              placeholder={t('settings.additional.filters.employeesBoardPlaceholder')}
              isLoading={loadingBoards}
            />
          </FieldWrapper>

          {settings.filterEmployeesBoardId && (
            <FieldWrapper
              label={t('settings.additional.filters.employeesColumnLabel')}
              required
              description={t('settings.additional.filters.employeesColumnDescription')}
            >
              <SearchableSelect
                options={employeesPeopleColumns}
                value={settings.filterEmployeesColumnId}
                onChange={(id) => onChange({ filterEmployeesColumnId: id })}
                placeholder={t('settings.additional.filters.employeesColumnPlaceholder')}
                isLoading={loadingEmployeesColumns}
                showSearch={false}
              />
            </FieldWrapper>
          )}

          {!settings.filterEmployeesBoardId && (
            <div style={{
              backgroundColor: 'var(--color-bg-tertiary)',
              borderRadius: '8px',
              padding: '16px',
              textAlign: 'center',
              color: 'var(--color-text-secondary)',
              fontSize: '0.9rem'
            }}>
              {t('settings.additional.filters.employeesEmptyNote')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdditionalTab;
