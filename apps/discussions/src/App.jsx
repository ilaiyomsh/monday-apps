import './styles/theme-tokens.css';
import styles from './App.module.css';
import { useEffect, useState, useCallback, useRef } from 'react';
import { DiscussionList } from '@generated/components/DiscussionList';
import { DiscussionCard } from '@generated/components/DiscussionCard';
import { CreateDiscussionModal } from '@generated/components/CreateDiscussionModal';
import { MyTasksView } from '@generated/components/MyTasksView';
import { MyDecisionsView } from '@generated/components/MyDecisionsView';
import { DiscussionsDashboard } from '@generated/components/DiscussionsDashboard';
import { PersonalShell } from '@generated/components/PersonalShell';
import { BrandLoader } from '@generated/components/BrandLoader';
import { useToast } from './hooks/useToast';
import { useUiErrorSink } from './hooks/useUiErrorSink';
import { useMinSplash } from './hooks/useMinSplash.js';
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
import { prefetchMyTasks } from './hooks/useMyTasks.js';
import { prefetchMyDecisions } from './hooks/useMyDecisions.js';
import { prefetchDiscussions } from './hooks/useDiscussions.js';
import logger from './utils/logger.js';
import { installChromeNarrowWatcher } from './utils/chromeNarrow.js';
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

// Round 45 — hard cap on the INITIAL boot loader: if any of the three boot
// datasets stalls, reveal the app anyway after this window so the user is never
// stuck on the white loading screen.
const BOOT_MAX_WAIT_MS = 8000;

// Round 50 — MINIMUM branded-splash window (ms). The loader runs at least this
// long on boot AND on every view transition, so the animation is clearly
// experienced rather than flashing when data is warm/cached; data that is ready
// early simply waits it out, then the (already-loaded) content appears in one shot.
const MIN_SPLASH_MS = 2000;

function readSavedAppView() {
  try {
    const saved = window.localStorage.getItem(APP_VIEW_KEY);
    return saved === 'myTasks' || saved === 'myDecisions' ? saved : 'discussions';
  } catch (err) {
    logger.warn('App', 'localStorage לא זמין — תצוגת ברירת המחדל נטענת', err);
    return 'discussions';
  }
}

// Has the user EVER chosen a view themselves (any value persisted)? Drives the
// member first-visit default below — an explicit choice always wins over it.
function hasSavedAppView() {
  try {
    return window.localStorage.getItem(APP_VIEW_KEY) != null;
  } catch (err) {
    logger.warn('App', 'localStorage לא זמין — אין תצוגה שמורה', err);
    return false;
  }
}

function readSavedWidth(key, maxW, minW = SIDEBAR_MIN_W) {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.min(maxW, Math.max(minW, n));
  } catch (err) {
    logger.warn('App', 'localStorage לא זמין — רוחב סרגל ברירת מחדל', err);
    return null;
  }
}

function readSavedViewMode() {
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === 'calendar' ? 'calendar' : 'list';
  } catch (err) {
    logger.warn('App', 'localStorage לא זמין — מצב תצוגת רשימה נטען', err);
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
  } catch (err) {
    logger.warn('App', 'ניתוח URL של פרמטרי פתיחה נכשל — נופל לניתוח query גולמי', err);
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
    try { window.localStorage.setItem(APP_VIEW_KEY, view); } catch (err) { logger.warn('App', 'localStorage לא זמין — בחירת התצוגה לא נשמרה', err); }
  }, []);
  // "המשימות שלי" is always reachable now (a dedicated button in the discussions
  // header + a "דיונים" back-button in the My Tasks toolbar drive `appView`), so
  // the view simply follows the persisted appView — no opt-in gate, no top toggle.
  const { settings, isLoading: settingsLoading } = useSettings();
  const effectiveView = appView;
  // round180 — the three personal modes share ONE PersonalShell; switching between
  // them must keep the switcher bar mounted and load ONLY the content card below
  // (see the personal render branch), so we treat them as one "personal" surface.
  const personalView =
    effectiveView === 'myTasks' || effectiveView === 'myDecisions' || effectiveView === 'dashboard';

  // Branded splash gate. Shows the fullscreen BrandLoader (a) on cold boot until
  // `context` resolves AND a ~2s min window elapses, and (b) for a ~2s min
  // window on EVERY top-level view switch — the window re-arms on each change of
  // `effectiveView` (the armKey). The per-view arm is essential because round-37's
  // stale-while-revalidate cache makes a warm view load instantly (its `loading`
  // never flips true), so a boot-only gate would skip the splash on cached
  // transitions. `context == null` is the only real loading the app observes here;
  // each view still runs its own internal loading/skeleton AFTER the splash reveals
  // it (per-view behavior unchanged). Round 50: the min window is now ~2s
  // (MIN_SPLASH_MS) so the branded loader is clearly experienced on each switch.
  const splash = useMinSplash(context == null, MIN_SPLASH_MS, effectiveView);
  // round170 — the discussions list now has ONE "האזור האישי" entry point; the
  // three personal modes (my tasks / my decisions / dashboard) live behind the
  // PersonalShell switcher. Entering the personal area defaults to my-tasks.
  const openPersonal = useCallback(() => handleAppViewChange('myTasks'), [handleAppViewChange]);
  const backToDiscussions = useCallback(() => handleAppViewChange('discussions'), [handleAppViewChange]);

  // Round 46 — RIGHT-PANE discussions splash. The branded loader must show in the
  // discussions view ONLY when RETURNING to it FROM a personal view (My Tasks /
  // My Decisions): NOT on cold boot (the boot gate above covers entry), NOT when
  // clicking between discussions in the list, and NEVER in the LEFT list. We track
  // the previous top-level view; when it flips to 'discussions' from 'myTasks' or
  // 'myDecisions' we bump an arm token, and useMinSplash then holds the loader in
  // the RIGHT (card) pane alone for the brief min window before revealing it (the
  // fullscreen `splash` gate below is disarmed for the discussions view, so it can
  // no longer cover the left list on this transition).
  const prevViewRef = useRef(effectiveView);
  const [discReturnArm, setDiscReturnArm] = useState(0);
  useEffect(() => {
    const prev = prevViewRef.current;
    prevViewRef.current = effectiveView;
    if (effectiveView === 'discussions' && (prev === 'myTasks' || prev === 'myDecisions')) {
      setDiscReturnArm((n) => n + 1);
    }
  }, [effectiveView]);
  // round103 — while monday's item-card (updates) panel is open it docks and
  // shrinks the iframe; watch for that width drop and toggle body[data-chrome-narrow]
  // so each view hides its non-essential chrome (header details / battery / toolbar)
  // instead of letting it slide left. Mounted once for the whole app.
  useEffect(() => installChromeNarrowWatcher(), []);
  // active=false: this is a pure TRANSITION replay armed by the token — never a
  // real loading flag. The card pane runs its own data loading after it reveals.
  const discussionsRightSplash = useMinSplash(false, MIN_SPLASH_MS, discReturnArm);

  const [selectedDiscussion, setSelectedDiscussion] = useState(null);
  const [showList, setShowList] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [listHover, setListHover] = useState(false);
  // round129 — while the sidebar is collapsed, reveal the expand button
  // whenever the pointer is LEFT of the item tables' edge line (the 52px white
  // gutter), not only on the thin edge strip. JS-driven (window pointermove):
  // a CSS overlay wide enough for this swallowed the button's clicks (round128).
  const [gutterHover, setGutterHover] = useState(false);
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
  // round132 — deep-link splash: opening the app FROM a copied discussion-tab
  // link holds the branded loading animation over the whole app until the
  // target card (and, for the topics tab, the topics data) is fully loaded,
  // then reveals the finished screen in one paint (sidebar already collapsed).
  // Armed at boot when the URL carries a discussionId, and re-armed if monday's
  // async `location` delivers the params later. A ref mirrors it so the
  // member-default effect can avoid re-routing a deep-linked entry to My Tasks.
  const [deepLinkSplash, setDeepLinkSplash] = useState(() => Boolean(readLaunchParams().discussionId));
  const deepLinkArmedRef = useRef(Boolean(launchParams.discussionId));

  // Advisory permission resolver, bound to the owner bypass + current user.
  // Used as a belt-and-suspenders guard in handleExport so a stale/unhidden
  // export control can't fire the mutation for a user who lacks `exportDocs`
  // (the DiscussionList row/calendar controls are the primary gate). Owners
  // bypass; while the feature is off it resolves via the legacy creator/lead
  // path → identical to before this guard existed.
  const can = usePermission({ canManageSettings, currentUser });

  // round180 — flag when the discussions selector panel occupies horizontal width
  // (desktop: list shown AND not collapsed). The card is narrow then, so the task
  // quick-filter battery (TasksTab / PreviousTasksTab) hides via
  // body[data-list-open] — mirroring the body[data-chrome-narrow] pattern used for
  // monday's docked updates panel. Clears in the personal area, on mobile card
  // view, and whenever the list is collapsed (i.e. the tabs area is expanded).
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const open = effectiveView === 'discussions' && showList && !collapsed;
    if (open) document.body.setAttribute('data-list-open', '1');
    else document.body.removeAttribute('data-list-open');
    return () => document.body.removeAttribute('data-list-open');
  }, [effectiveView, showList, collapsed]);

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
        // MEMBER first-visit default (owner decision 2026-07-14): a non-owner
        // who never chose a view themselves lands straight in "המשימות שלי".
        // Deliberately NOT persisted — it stays a default; the user's first
        // explicit navigation persists their choice and wins from then on.
        // round132 — a deep-linked entry (discussion link) must land on the
        // linked discussion, so the member default never re-routes it.
        if (!cancelled && !isOwner && !hasSavedAppView() && !deepLinkArmedRef.current) setAppView('myTasks');
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

  // Round 45 — BOOT GATE: on INITIAL app entry hold the fullscreen white
  // BrandLoader (see the render gate below) until the monday context + settings
  // are resolved AND all three datasets have loaded — the discussions list
  // (prefetchDiscussions, which ALSO warms the list's first paint) + the two
  // personal-view caches (prefetchMyTasks / prefetchMyDecisions) — then reveal
  // the discussions view already populated. Completion is tracked by Promise.all
  // over the three loads, each wrapped so a rejection still counts as settled
  // (reveal on success OR error — never hang), plus a hard BOOT_MAX_WAIT_MS
  // timeout that reveals even if a fetch stalls. `bootDataReady` latches true
  // once and never blocks a later view transition (the round-44 per-view splash
  // is untouched — see `splash`). Runs a single time per session.
  const [bootDataReady, setBootDataReady] = useState(false);
  const bootStartedRef = useRef(false);
  const prefetchedRef = useRef(false);
  useEffect(() => {
    if (context == null) return undefined;         // monday context not resolved yet
    if (settingsLoading) return undefined;         // settings mapping still resolving (config not published)
    if (bootStartedRef.current) return undefined;  // kick the boot load off once per session
    bootStartedRef.current = true;
    // The boot gate owns this session's initial warm of the personal-view
    // caches, so the round-37 idle prefetch below becomes a no-op (no double-fetch).
    prefetchedRef.current = true;

    let settled = false;
    let minTimer = null;
    const bootStart = Date.now();
    // Round 50 — reveal once BOTH the boot data has settled AND the ~2s minimum
    // splash window (MIN_SPLASH_MS, measured from context-resolution when this
    // effect first runs) has elapsed. Data ready early simply waits out the
    // remainder, so the branded loader is always clearly seen and the populated
    // content then appears in one shot. NEVER hangs: the hard BOOT_MAX_WAIT_MS
    // timeout also calls reveal, and by then the min window has long passed.
    const reveal = () => {
      if (settled) return;
      settled = true;
      // v2 boot health (D5): one-shot at the app's interactive point — total time
      // from bundle load (window.__appInitStart, set in logger.js). alwaysShip so it
      // ships regardless of level policy; inert until the Axiom sink is active.
      const totalMs = typeof window !== 'undefined' && window.__appInitStart
        ? Math.round(performance.now() - window.__appInitStart)
        : Date.now() - bootStart;
      logger.health('boot', { total_ms: totalMs });
      const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - bootStart));
      if (wait === 0) setBootDataReady(true);
      else minTimer = setTimeout(() => setBootDataReady(true), wait);
    };
    // Load all three in parallel; `settle` maps success OR error to a resolved
    // void so one failed fetch never blocks the reveal.
    const settle = (p) => Promise.resolve(p).then(() => {}, () => {});
    Promise.all([
      settle(prefetchDiscussions()),
      settle(prefetchMyTasks({ currentUser, context })),
      settle(prefetchMyDecisions('decider', { currentUser, context })),
    ]).then(reveal)
      // settle() maps every fetch to a resolved void, so only reveal() itself
      // could reject here — log it; the BOOT_MAX_WAIT_MS timer still reveals.
      .catch((err) => logger.error('App', 'חשיפת האפליקציה אחרי הטעינה נכשלה', err));
    // SAFETY: never leave the user stuck on the loader — reveal after the hard
    // timeout regardless of the fetches.
    const timer = setTimeout(reveal, BOOT_MAX_WAIT_MS);
    return () => { clearTimeout(timer); if (minTimer) clearTimeout(minTimer); };
  }, [context, settingsLoading, currentUser]);

  // Round 37 — BACKGROUND PREFETCH: once booted and sitting on the discussions
  // view, warm the "המשימות שלי" / "ההחלטות שלי" caches ONCE per session during
  // idle time, so first entry into those views paints instantly from cache.
  // Gated on `settings` (board config is published by then) + a ref so it fires
  // a single time; skipped when already on those views (their own fetch is the
  // source of truth). The prefetch helpers only WRITE the view cache and swallow
  // their own errors — they never touch a mounted view's React state or crash UI.
  // (The round-45 boot gate above already sets prefetchedRef this session, so on
  // the normal path this idle prefetch is a no-op fallback — no double-fetch.)
  useEffect(() => {
    if (context == null || !settings) return undefined;    // not booted / config not published yet
    if (effectiveView !== 'discussions') return undefined; // don't compete with a live view's own fetch
    if (prefetchedRef.current) return undefined;           // once per session
    prefetchedRef.current = true;

    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      prefetchMyTasks({ currentUser, context }).catch(() => {});
      prefetchMyDecisions('decider', { currentUser, context }).catch(() => {});
    };
    let idleId = null;
    let timerId = null;
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(warm, { timeout: 3000 });
    } else {
      timerId = setTimeout(warm, 1500);
    }
    return () => {
      cancelled = true;
      if (idleId != null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timerId != null) clearTimeout(timerId);
    };
  }, [context, settings, effectiveView, currentUser]);

  const handleSelect = (discussion) => {
    setSelectedDiscussion(discussion);
    setShowList(false);
    // round111 — picking a discussion auto-collapses the discussions column
    // (animated in CSS) so the card gets the full width; the existing edge
    // handle re-expands it. Desktop only: on mobile the panes swap via
    // showList, and a sticky `collapsed` would blank the list on "back".
    if (!isMobile) setCollapsed(true);
  };

  const handleBack = () => {
    setShowList(true);
  };

  useEffect(() => {
    if (!launchParams.discussionId) return;
    deepLinkArmedRef.current = true;
    // round132 — a deep link that actually switches the open discussion
    // (params landed late via monday's async `location`) re-arms the splash
    // so the reveal still waits for the full data (a same-id no-op doesn't).
    if (String(selectedDiscussion?.id) !== launchParams.discussionId) {
      setDeepLinkSplash(true);
      setSelectedDiscussion({ id: launchParams.discussionId });
    }
    setShowList(false);
    // round132 — the link lands on the finished screen: card at full width
    // (sidebar collapsed, like a manual discussion pick) in the discussions
    // view even if this user's default view is המשימות שלי. setAppView (not
    // handleAppViewChange) so the forced route is NOT persisted as a choice.
    if (!isMobile) setCollapsed(true);
    setAppView('discussions');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchParams.discussionId]);

  // round132 — deep-link splash safety valve: never trap the user on the loader
  // (e.g. a deleted discussion or a stalled fetch) — reveal after 12s regardless.
  useEffect(() => {
    if (!deepLinkSplash) return undefined;
    const t = setTimeout(() => setDeepLinkSplash(false), 12000);
    return () => clearTimeout(t);
  }, [deepLinkSplash]);
  const handleDeepLinkReady = useCallback(() => setDeepLinkSplash(false), []);

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
      // Edit: refresh the open card if it's the one being edited. round127 —
      // stamp a per-save token: same-id saves must still re-run the card's
      // resolve effects (e.g. the previous-discussion link, which is re-read
      // from the board and otherwise kept showing the pre-edit value).
      if (updated?.id && selectedDiscussion?.id === updated.id) {
        setSelectedDiscussion({ ...updated, __savedAt: Date.now() });
      }
      notify('הדיון עודכן בהצלחה');
    } else {
      // Create / duplicate: open the new discussion immediately.
      if (updated?.id) {
        setSelectedDiscussion(updated);
        setShowList(false);
      }
      // No success toast on a plain CREATE — opening the freshly created
      // discussion card is itself the confirmation. Duplicate keeps its own
      // notice (a distinct action), and edit keeps 'הדיון עודכן בהצלחה' above.
      if (meta.isDuplicate) notify('הדיון שוכפל בהצלחה');
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

  // round129 — gutter tracking for the collapsed expand button (see the
  // gutterHover state above). Passive pointermove; state flips only on change.
  // round135 — the root's left edge is CACHED (measured once on arm + on
  // resize) instead of a getBoundingClientRect() forced-layout read on every
  // pointer move (perf audit finding).
  useEffect(() => {
    if (!collapsed) {
      setGutterHover(false);
      return undefined;
    }
    const GUTTER_PX = 52; // --content-gutter-start
    let rootLeft = rootRef.current?.getBoundingClientRect().left ?? 0;
    const remeasure = () => {
      rootLeft = rootRef.current?.getBoundingClientRect().left ?? 0;
    };
    const onMove = (ev) => {
      setGutterHover((prev) => {
        const next = ev.clientX - rootLeft < GUTTER_PX;
        return next === prev ? prev : next;
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', remeasure);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', remeasure);
    };
  }, [collapsed]);

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
            } catch (err) {
              // storage unavailable (private mode / local dev) — width stays for the session
              logger.warn('App', 'localStorage לא זמין — רוחב הסרגל לא נשמר', err);
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
    } catch (err) {
      // storage unavailable — mode stays for the session
      logger.warn('App', 'localStorage לא זמין — מצב התצוגה לא נשמר', err);
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

  // Splash / boot gate: hold the fullscreen branded loader until
  //   (a) `context` is ready, AND
  //   (b) the INITIAL boot data is ready (`bootDataReady` — all three datasets
  //       loaded or the safety timeout fired; see the round-45 boot gate), AND
  //   (c) the min-splash window has elapsed — but ONLY for the personal views.
  // Round 46: the fullscreen min-splash replayed when switching between top-level
  // views; it is DISARMED for the discussions view (handled by the right-pane
  // `discussionsRightSplash`), and — round180 — ALSO disarmed for the personal
  // views: switching between the personal modes must keep the PersonalShell
  // switcher mounted and show the loader ONLY in the content card below (see the
  // personal branch, which gates its children on `splash`). The fullscreen loader
  // therefore fires only for genuine boot (`context == null` / `!bootDataReady`).
  // `bootDataReady` latches true after the first boot, so it only gates INITIAL
  // entry and never a later transition.
  if (context == null || !bootDataReady || (splash && effectiveView !== 'discussions' && !personalView)) {
    return (
      <div className={`${styles.appShell} ${layoutClass}`}>
        <BrandLoader fullscreen />
      </div>
    );
  }

  // round170 — the three personal modes render inside one PersonalShell (back
  // arrow top-left + centered 3-tab switcher). Each view renders `embedded` so it
  // drops its own back button + title; the shell owns that chrome. Modes still map
  // to the existing appView values, so persistence/splash logic is unchanged.
  if (personalView) {
    return (
      <div className={`${styles.appShell} ${layoutClass}`}>
        <div className={styles.appShellPersonal} dir="rtl">
          <PersonalShell activeMode={effectiveView} onSelectMode={handleAppViewChange} onBack={backToDiscussions}>
            {/* round180 — the switcher (PersonalShell header) stays mounted across
                mode switches; only THIS content card reloads. On each switch the
                per-view min-splash (`splash`) shows the branded loader in the card
                alone, then reveals the view — no full-screen reload, so it never
                feels like leaving the personal area. */}
            {splash ? (
              <BrandLoader />
            ) : (
              <>
                {effectiveView === 'myTasks' && (
                  <MyTasksView embedded canManageSettings={canManageSettings} onNotify={notify} />
                )}
                {effectiveView === 'myDecisions' && (
                  <MyDecisionsView embedded canManageSettings={canManageSettings} onNotify={notify} />
                )}
                {effectiveView === 'dashboard' && (
                  <DiscussionsDashboard embedded canManageSettings={canManageSettings} />
                )}
              </>
            )}
          </PersonalShell>
        </div>
        {overlays}
      </div>
    );
  }

  return (
    <div className={`${styles.appShell} ${layoutClass}`}>
    <div
      ref={rootRef}
      className={`${styles.root} ${styles.appFrame} ${resizing ? styles.resizing : ''}`}
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
        } ${collapsed && gutterHover ? styles.dividerHandleGutterHover : ''} ${!collapsed ? styles.dividerHandleResizable : ''}`}
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
        {/* round136 — refreshToken replaces the old key={refreshKey} remount:
            a save now refreshes the list IN PLACE (silent refetch, no teardown,
            search/filter/scroll preserved). */}
        <DiscussionList
          refreshToken={refreshKey}
          onSelect={handleSelect}
          selectedId={selectedDiscussion?.id}
          onCreateNew={() => setShowCreate(true)}
          onEdit={(d) => setEditDiscussion(d)}
          onCopyLink={(d) => handleCopyDiscussionLink(d.id, 'topics')}
          onDuplicate={(d) => setDuplicateFrom(d)}
          onExport={handleExport}
          onDelete={handleDeleteDiscussion}
          exportingId={exportingId}
          canManageSettings={canManageSettings}
          currentUser={currentUser}
          onOpenSettings={() => setShowSettings(true)}
          onOpenPersonal={openPersonal}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          calendarAnchor={calNav.anchor}
          calendarMode={calNav.mode}
          onCalendarNavigate={setCalNav}
          onCreateAt={handleCreateAt}
        />
      </div>

      <div className={`${styles.main} ${showList ? styles.hiddenMobile : ''} ${collapsed ? styles.mainFull : ''}`}>
        {discussionsRightSplash ? (
          // Return to discussions from My Tasks / My Decisions: the branded loader
          // shows HERE, in the card pane only, for the brief min window — the left
          // list keeps rendering independently (no splash there).
          <BrandLoader />
        ) : (
          <DiscussionCard
            discussion={selectedDiscussion}
            onBack={handleBack}
            onNotify={notify}
            onShowLoading={notifyLoading}
            onDismissToast={dismissNotice}
            onUpdated={handleSaved}
            initialTab={launchParams.tab}
            initialTabDiscussionId={launchParams.discussionId}
            onInitialTabReady={handleDeepLinkReady}
            canManageSettings={canManageSettings}
          />
        )}
        {/* round178 — the gear-opened Settings box is rendered INSIDE the card pane
            with `contained`, so it centers within this white pane and dims only its
            tabs (not the whole screen). */}
        <SettingsModal
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          onNotify={notify}
          templatesOnly={!canManageSettings}
          contained
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

    </div>
      {/* round132 — deep-link splash: the app keeps rendering (and loading)
          UNDERNEATH this opaque overlay, so the branded loader plays until the
          linked discussion + its target tab data are fully ready, then the
          finished screen is revealed in one paint. */}
      {deepLinkSplash && (
        <div className={styles.deepLinkSplash}>
          <BrandLoader fullscreen />
        </div>
      )}
      {overlays}
    </div>
  );
}
