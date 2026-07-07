/**
 * DayOffView — the app shell. Ported from the prototype's App() in app.jsx:
 * header (brand + Settings), role-based tabs, the active <main> view, the modal
 * switchboard wired to useDayOffData() mutations, and the toast stack.
 *
 * Dropped from the prototype (per the port spec): the persona switcher, the
 * Tweaks panel/useTweaks, and the theme/layout toggles — theme follows the
 * platform and the "mine" layout is fixed to calendar+list.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../core';
import { settingsValidationIssues } from '../domain/settingsValidation';
import { useDayOffData } from '../contexts/DayOffDataProvider';
import { useDeepLinkItemId } from '../hooks/useDeepLink';
import { useIsMobile } from '../hooks/useIsMobile';
import { Icon, MiniLoader } from './ui';
import { EmployeeView } from './views/EmployeeView';
import { TeamView } from './views/TeamView';
import { ApprovalsView } from './views/ApprovalsView';
import { DashboardView, type DrillPayload } from './views/DashboardView';
import { RequestModal } from './modals/RequestModal';
import { RequestDetailModal } from './modals/RequestDetailModal';
import { ApproveModal } from './modals/ApproveModal';
import { RejectModal } from './modals/RejectModal';
import { DrillModal } from './modals/DrillModal';
import { SettingsDialog } from './Settings/SettingsDialog';
import type { DayOffRequest, RequestDraft } from '../domain/types';

interface TabDef {
  id: string;
  labelKey: string;
  icon: string;
}

const TABS: { employee: TabDef[]; manager: TabDef[] } = {
  employee: [
    { id: 'mine', labelKey: 'tabs.mine', icon: 'user' },
  ],
  // RTL: first entry renders rightmost. Right→left: mine | approvals | team | dashboard.
  // (Company days moved into the Settings dialog.)
  manager: [
    { id: 'mine', labelKey: 'tabs.mine', icon: 'user' },
    { id: 'approvals', labelKey: 'tabs.approvals', icon: 'inbox' },
    { id: 'team', labelKey: 'tabs.team', icon: 'users' },
    { id: 'dashboard', labelKey: 'tabs.dashboard', icon: 'chart' },
  ],
};

type ModalState =
  | { kind: 'request'; initial?: (Partial<RequestDraft> & { id?: string }) | null }
  | { kind: 'detail'; request: DayOffRequest; asManager: boolean }
  | { kind: 'reject'; request: DayOffRequest }
  | { kind: 'approve'; request: DayOffRequest }
  | { kind: 'drill'; payload: DrillPayload }
  | null;

export function DayOffView() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const appClass = isMobile ? 'app is-mobile' : 'app';
  const { settings, validation } = useSettings();
  const {
    loading,
    initializing,
    currentUser,
    isManager,
    isBoardOwner,
    toasts,
    requests,
    year,
    onYearChange,
    submitRequest,
    approve,
    reject,
    approveAll,
    cancelRequest,
    fetchRequestById,
  } = useDayOffData();

  const [activeTab, setActiveTab] = useState('mine');
  const [modal, setModal] = useState<ModalState>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [approvingRequest, setApprovingRequest] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // W1.3: the whole validation gates the app, not just the board id — a
  // half-configured board must show a loud error, never silently-empty data.
  const notConfigured = !validation.isValid;
  const boardMissing = !settings.vacationBoardId;

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  const tabs = isManager ? TABS.manager : TABS.employee;

  // ---- deep link: open a specific request's detail modal on load ----
  // External links (?app[itemId]=<id>) land here. We replicate a "My absences"
  // calendar-day click exactly — open the detail modal with asManager:false, so
  // it shows the edit/cancel actions for an editable (own, pending) request or
  // the read-only view otherwise. Consumed once: a later in-app close must not
  // re-trigger it.
  const deepLinkItemId = useDeepLinkItemId();
  const deepLinkConsumed = useRef(false);

  useEffect(() => {
    if (!deepLinkItemId || notConfigured || loading || deepLinkConsumed.current) return;
    deepLinkConsumed.current = true;
    const openDetail = (r: DayOffRequest) => {
      setActiveTab('mine');
      setModal({ kind: 'detail', request: r, asManager: false });
    };
    const local = requests.find((r) => r.id === deepLinkItemId);
    if (local) {
      openDetail(local);
      return;
    }
    // Outside the loaded year window — fetch the single item directly.
    void fetchRequestById(deepLinkItemId).then((r) => {
      if (r) openDetail(r);
    });
    // notConfigured/loading gate; requests/fetchRequestById are the lookup
    // sources. The ref guard keeps this a one-shot regardless of re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkItemId, notConfigured, loading]);

  // ---- mutation wiring: do the write via the data hook, then close the modal ----
  async function onSubmitRequest(draft: RequestDraft) {
    const editingId = modal?.kind === 'request' ? modal.initial?.id : undefined;
    setSubmittingRequest(true);
    try {
      const ok = await submitRequest(draft, editingId);
      if (ok) setModal(null);
    } finally {
      setSubmittingRequest(false);
    }
  }
  async function onApprove(r: DayOffRequest, note?: string) {
    setApprovingRequest(true);
    setApprovingId(r.id);
    try {
      const ok = await approve(r, note);
      if (ok) setModal(null);
    } finally {
      setApprovingRequest(false);
      setApprovingId(null);
    }
  }
  async function onInlineApprove(r: DayOffRequest) {
    setApprovingId(r.id);
    try {
      await approve(r);
    } finally {
      setApprovingId(null);
    }
  }
  function onReject(r: DayOffRequest, reason?: string) {
    void reject(r, reason);
    setModal(null);
  }
  function onApproveAll() {
    void approveAll();
  }
  function onCancelRequest(r: DayOffRequest) {
    void cancelRequest(r);
    setModal(null);
  }

  if (!notConfigured && initializing) {
    return (
      <div className={`${appClass} app-loading`} role="status" aria-live="polite">
        <MiniLoader size={36} />
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (notConfigured) {
    return (
      <div className={appClass}>
        <header className="app-header">
          <div className="header-brand">
            <span className="brand-mark">
              <Icon name="calendar" size={20} />
            </span>
            <div>
              <h1>{t('app.title')}</h1>
              <div className="brand-sub">{t('app.brandSub')}</div>
            </div>
          </div>
          <button className="persona-btn" onClick={() => setSettingsOpen(true)}>
            <Icon name="info" size={16} />
            {t('settings.open')}
          </button>
        </header>
        <main className="app-main">
          {boardMissing ? (
            // Fresh install — the friendly "pick a board" notice.
            <p style={{ color: 'var(--color-text-secondary)' }}>{t('app.notConfigured')}</p>
          ) : (
            // Board picked but the mapping is incomplete — fail loudly (W1.3):
            // list exactly what is missing instead of showing empty data.
            <div
              role="alert"
              style={{
                border: '1px solid var(--color-danger)',
                borderRadius: 8,
                padding: '14px 18px',
                maxWidth: 560,
                display: 'grid',
                gap: 8,
              }}
            >
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--color-danger)' }}>
                {t('app.settingsIncomplete')}
              </p>
              <ul style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 4 }}>
                {settingsValidationIssues(validation.errors).map((issue, i) => (
                  <li key={i}>
                    {issue.fieldLabelKey
                      ? t(issue.messageKey, { field: t(issue.fieldLabelKey) })
                      : t(issue.messageKey)}
                  </li>
                ))}
              </ul>
              <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>{t('app.settingsIncompleteHint')}</p>
            </div>
          )}
        </main>
        <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    );
  }

  return (
    <div className={appClass}>
      {/* header */}
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-mark">
            <Icon name="calendar" size={20} />
          </span>
          <div>
            <h1>{t('app.title')}</h1>
            <div className="brand-sub">{t('app.brandSub')}</div>
          </div>
        </div>

        {(isManager || isBoardOwner) && (
          <button
            className="settings-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label={t('settings.open')}
            title={t('settings.open')}
          >
            <Icon name="settings" size={20} />
          </button>
        )}
      </header>

      {/* tabs */}
      <nav className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <Icon name={tab.icon} size={17} />
            {t(tab.labelKey)}
            {tab.id === 'approvals' && pendingCount > 0 && (
              <span className="tab-count">{pendingCount}</span>
            )}
          </button>
        ))}
      </nav>

      {/* content */}
      <main className="app-main">
        {activeTab === 'mine' && (
          <EmployeeView
            onNewRequest={() => setModal({ kind: 'request' })}
            onAddOnDay={(k) => setModal({ kind: 'request', initial: { start: k, end: k } })}
            onOpenRequest={(r) => setModal({ kind: 'detail', request: r, asManager: false })}
          />
        )}
        {activeTab === 'team' && (
          <TeamView
            onOpenRequest={(r) => setModal({ kind: 'detail', request: r, asManager: isManager })}
          />
        )}
        {activeTab === 'approvals' && (
          <ApprovalsView
            onOpenRequest={(r) => setModal({ kind: 'detail', request: r, asManager: true })}
            onApprove={onInlineApprove}
            approvingId={approvingId}
            onReject={(r) => setModal({ kind: 'reject', request: r })}
            onApproveAll={onApproveAll}
          />
        )}
        {activeTab === 'dashboard' && (
          <DashboardView
            year={year}
            onYearChange={onYearChange}
            onOpenDrill={(payload) => setModal({ kind: 'drill', payload })}
          />
        )}
      </main>

      {/* mobile bottom tab bar (managers) — mirrors the top .tabs; employees get none */}
      {isMobile && isManager && (
        <nav className="tab-bar" aria-label={t('app.title')}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-bar-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              <span className="tab-bar-icon">
                <Icon name={tab.icon} size={20} />
                {tab.id === 'approvals' && pendingCount > 0 && (
                  <span className="tab-bar-badge">{pendingCount}</span>
                )}
              </span>
              <span className="tab-bar-label">{t(tab.labelKey)}</span>
            </button>
          ))}
        </nav>
      )}

      {/* modals */}
      {modal?.kind === 'request' && (
        <RequestModal
          currentUser={currentUser}
          initial={modal.initial}
          onClose={() => setModal(null)}
          onSubmit={onSubmitRequest}
          busy={submittingRequest}
        />
      )}
      {modal?.kind === 'detail' && (
        <RequestDetailModal
          request={modal.request}
          viewerIsManager={modal.asManager}
          onClose={() => setModal(null)}
          onApprove={(r) => setModal({ kind: 'approve', request: r })}
          onReject={(r) => setModal({ kind: 'reject', request: r })}
          onCancel={onCancelRequest}
          onEdit={(r) => setModal({ kind: 'request', initial: r })}
        />
      )}
      {modal?.kind === 'reject' && (
        <RejectModal
          request={modal.request}
          onClose={() => setModal({ kind: 'detail', request: modal.request, asManager: true })}
          onConfirm={(r, reason) => onReject(r, reason)}
        />
      )}
      {modal?.kind === 'approve' && (
        <ApproveModal
          request={modal.request}
          onClose={() => setModal({ kind: 'detail', request: modal.request, asManager: true })}
          onConfirm={(r, note) => onApprove(r, note)}
          busy={approvingRequest}
        />
      )}
      {modal?.kind === 'drill' && (
        <DrillModal
          title={modal.payload.title}
          sub={modal.payload.sub}
          requests={modal.payload.requests}
          onOpenRequest={(r) => setModal({ kind: 'detail', request: r, asManager: true })}
          onClose={() => setModal(null)}
        />
      )}

      {/* toasts */}
      <div className="toast-wrap">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.variant}`}>
            {toast.variant === 'success' && <Icon name="check" size={16} />}
            {toast.variant === 'danger' && <Icon name="ban" size={16} />}
            {toast.text}
          </div>
        ))}
      </div>

      <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
