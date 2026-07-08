import './styles/theme-tokens.css';
import styles from './App.module.css';
import { useEffect, useState, useCallback, useRef } from 'react';
import { DiscussionList } from '@generated/components/DiscussionList';
import { DiscussionCard } from '@generated/components/DiscussionCard';
import { CreateDiscussionModal } from '@generated/components/CreateDiscussionModal';
import { MyTasksView } from '@generated/components/MyTasksView';
import { MyDecisionsView } from '@generated/components/MyDecisionsView';
import { useToast } from './hooks/useToast';
import { useUiErrorSink } from './hooks/useUiErrorSink';
import { useMondayContext } from './contexts/MondayContext.jsx';
import { useSettings } from './contexts/SettingsContext.jsx';
import { api } from './utils/mondayApi/monday-client.js';
import { monday } from './utils/mondayApi/monday-client.js';
import { exportDiscussionToDocx } from './utils/docxExport.js';
import { loadExportAssets } from './utils/exportAssets.js';
import { DEFAULT_EXPORT_TEMPLATE } from './utils/mondayApi/boards.config.js';
import { hydrateFromStorage, ensureRoster } from './utils/usersStore.js';
import { ensurePeopleColumns } from './utils/mondayApi/peopleColumns.js';
import { usePermission } from './hooks/usePermission.js';
import logger from './utils/logger.js';
import { ToastContainer } from './components/Toast';
import { ErrorDetailsModal } from './components/ErrorDetailsModal';
import { SettingsModal } from './components/SettingsModal';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Drag-to-resize bounds for the discussions column (px). The default width
// (when nothing is saved) comes from the CSS `--sidebar-w` responsive var.
// List and calendar modes remember separate widths: the calendar opens at 60%
// of the screen on each toggle and may be dragged wider than the list's 720px cap.
const SIDEBAR_MIN_W = 240;
const SIDEBAR_MAX_W = 720;
// Calendar mode needs real estate: it can't be dragged narrower than the grid
// stays readable, and it OPENS at 60% of the container on each switch to calendar.
const SIDEBAR_CAL_MIN_W = 480;
const SIDEBAR_W_KEY = 'discussions_sidebar_width';
const SIDEBAR_W_CAL_KEY = 'discussions_sidebar_width_calendar';
const VIEW_MODE_KEY = 'discussions_view_mode';
// Top-level app view: the discussions workspace vs the personal "My Tasks" list.
// Persisted like viewMode so a reload restores the last tab.
const APP_VIEW_KEY = 'discussions_app_view';

function readSavedAppView() {
  try {
    const saved = window.localStorage.getItem(APP_VIEW_KEY);
    return saved === 'myTasks' || saved === 'myDecisions' ? saved : 'discussions';
  } catch {
    return 'discussions';
  }
}

function readSavedWidth(key, maxW, minW = SIDEBAR_MIN_W) {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.min(maxW, Math.max(minW, n));
  } catch {
    return null;
  }
}

function readSavedViewMode() {
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === 'calendar' ? 'calendar' : 'list';
  } catch {
    return 'list';
  }
}

// Calendar mode allows dragging wider than the list cap — up to 80% of the
// container (half of a wide monitor easily exceeds 720px).
function calendarMaxWidth(rootEl) {
  const w = rootEl?.clientWidth || window.innerWidth;
  return Math.max(SIDEBAR_MAX_W, Math.round(w * 0.8));
}

function calendarOpenWidth(rootEl) {
  const w = rootEl?.clientWidth || window.innerWidth;
  return Math.min(calendarMaxWidth(rootEl), Math.max(SIDEBAR_CAL_MIN_W, Math.round(w * 0.6)));
}

function initialSidebarWidth(mode) {
  if (mode === 'calendar') {
    return (
      readSavedWidth(SIDEBAR_W_CAL_KEY, calendarMaxWidth(null), SIDEBAR_CAL_MIN_W) ??
      calendarOpenWidth(null)
    );
  }
  return readSavedWidth(SIDEBAR_W_KEY, SIDEBAR_MAX_W);
}

function readLaunchParams() {
  return readLaunchParamsFromSearch(typeof window !== 'undefined' ? window.location.search : '');
}

function readLaunchParamsFromSearch(search) {
  const params = new URLSearchParams(search || '');
  const discussionId = params.get('discussionId') || params.get('app[discussionId]');
  const tab = params.get('tab') || params.get('app[tab]');
  return {
    discussionId: discussionId ? String(discussionId).trim() : null,
    tab: tab ? String(tab).trim() : null,
  };
}

function readLaunchParamsFromUrl(urlValue) {
  if (!urlValue) return { discussionId: null, tab: null };
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://monday.com';
    const url = new URL(String(urlValue), base);
    return readLaunchParamsFromSearch(url.search);
  } catch {
    const query = String(urlValue).split('?')[1] || '';
    return readLaunchParamsFromSearch(query ? `?${query}` : '');
  }
}

function readLaunchParamsFromQuery(query) {
  if (!query || typeof query !== 'object') return { discussionId: null, tab: null };
  const discussionId = query.discussionId ?? query['app[discussionId]'] ?? query.app?.discussionId ?? null;
  const tab = query.tab ?? query['app[tab]'] ?? query.app?.tab ?? null;
  return {
    discussionId: discussionId ? String(discussionId).trim() : null,
    tab: tab ? String(tab).trim() : null,
  };
}

function readLaunchParamsFromLocationData(locationData) {
  if (!locationData) return { discussionId: null, tab: null };

  const byQuery = readLaunchParamsFromQuery(locationData.query);
  const bySearch = readLaunchParamsFromSearch(locationData.search);
  const byHref = readLaunchParamsFromUrl(locationData.href || locationData.url || '');

  return {
    discussionId: byQuery.discussionId || bySearch.discussionId || byHref.discussionId || null,
    tab: byQuery.tab || bySearch.tab || byHref.tab || null,
  };
}

function buildDiscussionTabUrl({ href, discussionId, tab }) {
  if (!discussionId || !tab) return null;
  const fallbackHref = typeof window !== 'undefined' ? window.location.href : 'https://monday.com';
  const baseHref = href || fallbackHref;
  const url = new URL(baseHref, fallbackHref);
  const params = new URLSearchParams(url.search || '');
  params.delete('discussionId');
  params.delete('tab');
  params.delete('app[discussionId]');
  params.delete('app[tab]');
  params.set('app[discussionId]', String(discussionId));
  params.set('app[tab]', String(tab));
  url.search = params.toString();
  return url.toString();
}

async function copyText(text) {
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  if (typeof document === 'undefined') return false;
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.focus();
  el.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(el);
  return copied;
}

export default function App() {
  const { context, currentUser, isMobile } = useMondayContext();
  // Global root class driving the responsive layout. Keyed on the monday mobile
  // app flag (NOT viewport width) so an item-card / updates panel that narrows
  // the board-view iframe never flips the app into its mobile layout. The CSS
  // gates desktop chrome on `.is-desktop` and mobile-only rules on `.mobile-app`.
  const layoutClass = isMobile ? 'mobile-app' : 'is-desktop';

  // Toast queue + the single UI error-display path (logger ERROR records -> toast).
  const {
    toasts,
    removeToast,
    showToast,
    showLoading,
    errorDetailsModal,
    openErrorDetailsModal,
    closeErrorDetailsModal,
  } = useToast();
  useUiErrorSink({ showToast });

  // User-facing success / loading messages render through our in-iframe @vibe
  // Toast (ToastContainer below) — same funnel the error sink uses, so it's
  // visible inside the fixed-height (100vh) board view. We render it ourselves
  // (rather than monday's native notice) precisely so we control RTL direction
  // and can drop the type icon — neither is configurable on the native notice.
  const notify = useCallback((message, type = 'success', timeout = 3000, action = null) => {
    if (!message) return null;
    return showToast(message, type, timeout, null, null, action);
  }, [showToast]);
  // "loading" indication — a persistent spinner toast; the matching dismiss
  // removes it by id (the success notify then follows).
  const notifyLoading = useCallback((message) => showLoading(message), [showLoading]);
  const dismissNotice = useCallback((id) => { if (id != null) removeToast(id); }, [removeToast]);

  const [appView, setAppView] = useState(readSavedAppView);
  const handleAppViewChange = useCallback((view) => {
    setAppView(view);
    try { window.localStorage.setItem(APP_VIEW_KEY, view); } catch { /* storage unavailable */ }
  }, []);
  // "המשימות שלי" is always reachable now (a dedicated button in the discussions
  // header + a "דיונים" back-button in the My Tasks toolbar drive `appView`), so
  // the view simply follows the persisted appView — no opt-in gate, no top toggle.
  const { settings } = useSettings();
  const effectiveView = appView;
  const openMyTasks = useCallback(() => handleAppViewChange('myTasks'), [handleAppViewChange]);
  const openMyDecisions = useCallback(() => handleAppViewChange('myDecisions'), [handleAppViewChange]);
  const backToDiscussions = useCallback(() => handleAppViewChange('discussions'), [handleAppViewChange]);

  const [selectedDiscussion, setSelectedDiscussion] = useState(null);
  const [showList, setShowList] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [listHover, setListHover] = useState(false);
  // 'list' | 'calendar' — persisted; drives the sidebar width regime and which
  // body DiscussionList renders. Calendar nav state (anchor + month/week) lives
  // HERE so it survives the refreshKey remount of DiscussionList after saves.
  const [viewMode, setViewMode] = useState(readSavedViewMode);
  const [calNav, setCalNav] = useState(() => {
    const t = new Date();
    return { anchor: new Date(t.getFullYear(), t.getMonth(), t.getDate()), mode: 'month' };
  });
  // {date:'YYYY-MM-DD', time:'HH:MM'} from a week-view empty-slot click —
  // pre-fills the create modal.
  const [createPrefill, setCreatePrefill] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => initialSidebarWidth(readSavedViewMode()));
  const [resizing, setResizing] = useState(false);
  const rootRef = useRef(null);
  const [editDiscussion, setEditDiscussion] = useState(null);
  const [duplicateFrom, setDuplicateFrom] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [canManageSettings, setCanManageSettings] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportingId, setExportingId] = useState(null);
  const [launchParams, setLaunchParams] = useState(() => readLaunchParams());
  const [currentLocationHref, setCurrentLocationHref] = useState(() =>
    typeof window !== 'undefined' ? window.location.href : ''
  );

  // Advisory permission resolver, bound to the owner bypass + current user.
  // Used as a belt-and-suspenders guard in handleExport so a stale/unhidden
  // export control can't fire the mutation for a user who lacks `exportDocs`
  // (the DiscussionList row/calendar controls are the primary gate). Owners
  // bypass; while the feature is off it resolves via the legacy creator/lead
  // path → identical to before this guard existed.
  const can = usePermission({ canManageSettings, currentUser });

  useEffect(() => {
    let cancelled = false;

    const checkBoardOwnership = async () => {
      // Management/edit bypass is OWNER-ONLY (owner of the OBJECT = context.boardId).
      // Account admins are NOT auto-treated as owners — an admin who wants access
      // adds themselves as an owner via the native board subscribers.
      const boardId = context?.boardId;
      const userId = context?.user?.id ?? currentUser?.id;
      if (!boardId || !userId) {
        setCanManageSettings(false);
        return;
      }

      const fetchOwners = async () =>
        api(
          `query ($boardIds: [ID!]) {
            boards(ids: $boardIds) {
              owners {
                id
              }
            }
          }`,
          { boardIds: [String(boardId)] },
          'checkBoardOwnership'
        );

      // Distinguish a confirmed "not an owner" from "the query errored/timed out":
      // on error we don't silently treat the user as a non-owner. We log it and
      // make one bounded retry (api() already retries transient failures inside
      // safeApi; this is a thin extra guard for the resolution itself). Only after
      // the retry also fails do we fall back to false — the creator/lead edit gate
      // in DiscussionCard/DiscussionList remains the independent safety net.
      try {
        let data;
        try {
          data = await fetchOwners();
        } catch (err) {
          if (cancelled) return;
          logger.warn('App', 'בדיקת בעלות על הלוח נכשלה, מנסה שוב', err);
          data = await fetchOwners();
        }

        const owners = data?.boards?.[0]?.owners || [];
        const isOwner = owners.some((owner) => String(owner.id) === String(userId));
        if (!cancelled) setCanManageSettings(isOwner);
      } catch (err) {
        if (cancelled) return;
        // Fail closed for management, but make the failure visible instead of
        // swallowing it — without this an owner silently loses access on a flaky
        // network with no trace.
        if (!err?.__loggedId) logger.error('App', 'לא ניתן לאמת בעלות על הלוח', err);
        setCanManageSettings(false);
      }
    };

    checkBoardOwnership();
    return () => {
      cancelled = true;
    };
  }, [context?.boardId, context?.user?.id, currentUser?.id]);

  // Avatars: hydrate the in-memory users cache from storage on boot (instant
  // photos from the last session), then — when a manager/owner connects — run a
  // silent full-roster sync that refreshes + re-persists the cache for everyone.
  useEffect(() => {
    hydrateFromStorage();
  }, []);
  useEffect(() => {
    if (context?.user?.isAdmin || canManageSettings) ensureRoster();
  }, [context?.user?.isAdmin, canManageSettings]);

  // When permissions are ON, load the board's live people columns so the resolver
  // can enforce roles for people columns beyond the mapped aliases (for ALL users).
  useEffect(() => {
    if (settings?.permissions?.enabled) ensurePeopleColumns();
  }, [settings?.permissions?.enabled]);

  const handleSelect = (discussion) => {
    setSelectedDiscussion(discussion);
    setShowList(false);
  };

  const handleBack = () => {
    setShowList(true);
  };

  useEffect(() => {
    if (!launchParams.discussionId) return;
    setSelectedDiscussion((prev) => {
      if (String(prev?.id) === launchParams.discussionId) return prev;
      return { id: launchParams.discussionId };
    });
    setShowList(false);
  }, [launchParams.discussionId]);

  useEffect(() => {
    const applyLocation = (locationData) => {
      const href = locationData?.href || locationData?.url || '';
      if (href) setCurrentLocationHref(String(href));
      const fromLocation = readLaunchParamsFromLocationData(locationData);
      if (!fromLocation.discussionId && !fromLocation.tab) return;
      setLaunchParams((prev) => ({
        discussionId: fromLocation.discussionId || prev.discussionId || null,
        tab: fromLocation.tab || prev.tab || null,
      }));
    };

    let cancelled = false;
    monday.get('location')
      .then((res) => {
        if (cancelled) return;
        applyLocation(res?.data || res || {});
      })
      .catch(() => {});

    const unsubscribe = monday.listen('location', (res) => {
      applyLocation(res?.data || res || {});
    });

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // Export a discussion to .docx (all users). Fetches + renders client-side; the
  // per-row spinner is keyed off exportingId. API errors are already logged +
  // toasted by the api() funnel, so re-log only un-logged failures.
  const handleExport = async (discussion) => {
    if (!discussion?.id || exportingId) return;
    // Advisory gate (belt-and-suspenders): the DiscussionList row/calendar
    // controls already hide/withhold export for users without `exportDocs`, but
    // guard the handler too so a stale control can't fire the export.
    if (!can('exportDocs', { discussion })) return;
    setExportingId(discussion.id);
    try {
      // Per-instance export template (sections/fields/order + header/footer config).
      // Falls back to the default (today's layout) when unset. Heavy binaries
      // (logos / uploaded template) load from the separate assets store.
      const template = settings?.exportTemplate || DEFAULT_EXPORT_TEMPLATE;
      const assets = await loadExportAssets(context);
      const { uploadAttempted, uploaded } = await exportDiscussionToDocx(discussion, { template, assets });
      if (uploadAttempted && uploaded) notify('הדיון יוצא ונשמר לעמודת הקובץ');
      else if (uploadAttempted) notify('הקובץ ירד למחשב, אך השמירה לעמודת הקובץ נכשלה', 'warning');
      else notify('הדיון יוצא ל-DOCS בהצלחה');
    } catch (err) {
      if (!err?.__loggedId) logger.error('App', 'ייצוא הדיון ל-DOCS נכשל', err);
    } finally {
      setExportingId(null);
    }
  };

  // Delete a discussion (owner action from the row kebab menu). The list removes
  // the row optimistically and defers the real delete_item (see
  // useDiscussions.softDeleteDiscussion); here we just close the card if it was
  // the open one and show a "הדיון נמחק" toast with a "בטל" (undo) button.
  const handleDeleteDiscussion = (discussion, { undo } = {}) => {
    if (!discussion?.id) return;
    if (selectedDiscussion?.id === discussion.id) {
      setSelectedDiscussion(null);
      setShowList(true);
    }
    notify('הדיון נמחק', 'info', 6000, undo ? { label: 'בטל', onClick: undo } : null);
  };

  // Shared by create + edit (the modal passes the updated discussion when editing).
  const handleSaved = (updated, meta = {}) => {
    setShowCreate(false);
    setEditDiscussion(null);
    setDuplicateFrom(null);
    setCreatePrefill(null);
    setRefreshKey(k => k + 1);
    if (meta.isEdit) {
      // Edit: refresh the open card if it's the one being edited.
      if (updated?.id && selectedDiscussion?.id === updated.id) setSelectedDiscussion(updated);
      notify('הדיון עודכן בהצלחה');
    } else {
      // Create / duplicate: open the new discussion immediately.
      if (updated?.id) {
        setSelectedDiscussion(updated);
        setShowList(false);
      }
      notify(meta.isDuplicate ? 'הדיון שוכפל בהצלחה' : 'הדיון נוצר בהצלחה');
    }
  };

  const handleCopyDiscussionLink = async (discussionId, tab) => {
    if (!discussionId || !tab) return false;
    try {
      const url = buildDiscussionTabUrl({ href: currentLocationHref, discussionId, tab });
      if (!url) return false;
      const copied = await copyText(url);
      if (copied) notify('הלינק לדיון ולטאב הועתק ללוח');
      else notify('לא הצלחנו להעתיק את הלינק', 'error');
      return copied;
    } catch (err) {
      if (!err?.__loggedId) logger.error('App', 'העתקת לינק לדיון נכשלה', err);
      notify('לא הצלחנו להעתיק את הלינק', 'error');
      return false;
    }
  };

  // Drag the divider to resize the discussions column at the expense of the
  // card pane. The layout is dir="ltr" (sidebar on the left), so the new width
  // is the cursor's x relative to the root's left edge, clamped to [min, max].
  const startResize = useCallback(
    (e) => {
      if (collapsed) return;
      e.preventDefault();
      const rootEl = rootRef.current;
      if (!rootEl) return;
      const rootLeft = rootEl.getBoundingClientRect().left;
      // Each view has its own clamp + storage key (calendar is wider on both ends).
      const maxW = viewMode === 'calendar' ? calendarMaxWidth(rootEl) : SIDEBAR_MAX_W;
      const minW = viewMode === 'calendar' ? SIDEBAR_CAL_MIN_W : SIDEBAR_MIN_W;
      const storageKey = viewMode === 'calendar' ? SIDEBAR_W_CAL_KEY : SIDEBAR_W_KEY;
      setResizing(true);

      const onMove = (ev) => {
        const next = Math.min(
          maxW,
          Math.max(minW, ev.clientX - rootLeft)
        );
        setSidebarWidth(next);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setResizing(false);
        setSidebarWidth((w) => {
          if (w != null) {
            try {
              window.localStorage.setItem(storageKey, String(w));
            } catch {
              /* storage unavailable (private mode / local dev) — width stays for the session */
            }
          }
          return w;
        });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [collapsed, viewMode]
  );

  // List ⇄ calendar toggle. Entering the calendar always opens MONTHLY on
  // today and widens the column to 60% of the screen; going back restores the
  // list's own saved width. On mobile (<768px) the CSS keeps the sidebar at 100%, so
  // the width var is simply inert there.
  const handleViewModeChange = useCallback((mode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* storage unavailable — mode stays for the session */
    }
    if (mode === 'calendar') {
      const t = new Date();
      setCalNav({ anchor: new Date(t.getFullYear(), t.getMonth(), t.getDate()), mode: 'month' });
      setSidebarWidth(calendarOpenWidth(rootRef.current));
    } else {
      setSidebarWidth(readSavedWidth(SIDEBAR_W_KEY, SIDEBAR_MAX_W));
    }
  }, []);

  // Week-view empty-slot click → open the create modal with date+time set.
  const handleCreateAt = useCallback((prefill) => {
    setCreatePrefill(prefill);
    setShowCreate(true);
  }, []);

  const rootStyle = sidebarWidth != null ? { '--sidebar-w': `${sidebarWidth}px` } : undefined;

  // Shared overlays (toasts + error details) render for BOTH views, so a
  // logger.error from My Tasks still surfaces a toast.
  const overlays = (
    <>
      <ToastContainer
        toasts={toasts}
        onRemove={removeToast}
        onShowErrorDetails={openErrorDetailsModal}
      />
      <ErrorDetailsModal
        isOpen={!!errorDetailsModal}
        errorDetails={errorDetailsModal}
        onClose={closeErrorDetailsModal}
      />
    </>
  );

  if (effectiveView === 'myTasks') {
    return (
      <div className={`${styles.appShell} ${layoutClass}`}>
        <div className={styles.appShellBody} dir="rtl">
          <MyTasksView canManageSettings={canManageSettings} onBackToDiscussions={backToDiscussions} onNotify={notify} />
        </div>
        {overlays}
      </div>
    );
  }

  if (effectiveView === 'myDecisions') {
    return (
      <div className={`${styles.appShell} ${layoutClass}`}>
        <div className={styles.appShellBody} dir="rtl">
          <MyDecisionsView canManageSettings={canManageSettings} onBackToDiscussions={backToDiscussions} onNotify={notify} />
        </div>
        {overlays}
      </div>
    );
  }

  return (
    <div className={`${styles.appShell} ${layoutClass}`}>
    <div
      ref={rootRef}
      className={`${styles.root} ${resizing ? styles.resizing : ''}`}
      style={rootStyle}
      dir="ltr"
    >
      {/* Desktop-only: collapse/expand the discussions column to give the card full width. */}
      {/* Collapse handle sits on the divider between the list column and the
          card. While expanded it reveals when hovering anywhere over the
          discussions column (listHover) or the divider strip; while collapsed
          the expand arrow stays visible on a thin edge strip. */}
      <div
        className={`${styles.dividerHandle} ${collapsed ? styles.dividerHandleCollapsed : ''} ${
          !collapsed && (listHover || resizing) ? styles.dividerHandleHover : ''
        } ${!collapsed ? styles.dividerHandleResizable : ''}`}
        onMouseDown={startResize}
        role={collapsed ? undefined : 'separator'}
        aria-orientation="vertical"
        aria-label={collapsed ? undefined : 'גרור כדי לשנות את רוחב רשימת הדיונים'}
      >
        <button
          type="button"
          className={styles.collapseBtn}
          aria-label={collapsed ? 'הצג את רשימת הדיונים' : 'הסתר את רשימת הדיונים'}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
      <div
        className={`${styles.sidebar} ${!showList ? styles.hiddenMobile : ''} ${collapsed ? styles.collapsed : ''}`}
        onMouseEnter={() => setListHover(true)}
        onMouseLeave={() => setListHover(false)}
      >
        <DiscussionList
          key={refreshKey}
          onSelect={handleSelect}
          selectedId={selectedDiscussion?.id}
          onCreateNew={() => setShowCreate(true)}
          onEdit={(d) => setEditDiscussion(d)}
          onDuplicate={(d) => setDuplicateFrom(d)}
          onExport={handleExport}
          onDelete={handleDeleteDiscussion}
          exportingId={exportingId}
          canManageSettings={canManageSettings}
          currentUser={currentUser}
          onOpenSettings={() => setShowSettings(true)}
          onOpenMyTasks={openMyTasks}
          onOpenMyDecisions={openMyDecisions}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          calendarAnchor={calNav.anchor}
          calendarMode={calNav.mode}
          onCalendarNavigate={setCalNav}
          onCreateAt={handleCreateAt}
        />
      </div>

      <div className={`${styles.main} ${showList ? styles.hiddenMobile : ''} ${collapsed ? styles.mainFull : ''}`}>
        <DiscussionCard
          discussion={selectedDiscussion}
          onBack={handleBack}
          onNotify={notify}
          onShowLoading={notifyLoading}
          onDismissToast={dismissNotice}
          onUpdated={handleSaved}
          onCopyDiscussionLink={handleCopyDiscussionLink}
          initialTab={launchParams.tab}
          initialTabDiscussionId={launchParams.discussionId}
          canManageSettings={canManageSettings}
        />
      </div>

      <CreateDiscussionModal
        open={showCreate || !!editDiscussion || !!duplicateFrom}
        editDiscussion={editDiscussion}
        duplicateFrom={duplicateFrom}
        prefill={createPrefill}
        onClose={() => { setShowCreate(false); setEditDiscussion(null); setDuplicateFrom(null); setCreatePrefill(null); }}
        onCreated={handleSaved}
        canManageSettings={canManageSettings}
      />

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} onNotify={notify} />
    </div>
      {overlays}
    </div>
  );
}
