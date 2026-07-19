import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDiscussions, useDiscussionMonths } from '@generated/hooks/useDiscussions';
import { Button, Text, IconButton } from '@vibe/core';
import { Calendar, CloseSmall, Search, Settings } from '@vibe/icons';
import { HighlightedText } from '@generated/components/HighlightedText';
import { BarChart3, Check, Copy, FileDown, Filter, Link2, List, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { DiscussionCalendar } from '@generated/components/DiscussionCalendar';
import { fmtTimeLabel, buildMonthOptions } from '@generated/utils/dateTime.js';
import { rangeForView } from '@generated/utils/calendarDates.js';
import { discussionAccentColor } from '@generated/constants/discussionColors.js';
import { useDropdownOptions } from '@generated/hooks/useDropdownOptions.js';
import { useTemplates } from '@generated/contexts/TemplatesContext.jsx';
import { usePermission, useIsSuperMember } from '@generated/hooks/usePermission.js';
import styles from './DiscussionList.module.css';

/* List-row subtitle: short weekday + "DD/MM", plus " · HH:MM" when the date
   column carries a real time part ("יום ב׳ 07/07 · 09:00" — mockup dateLabel).
   fmtTimeLabel reads the hasTime flag off the ORIGINAL Date, so this must get
   the item's own discussionDateID object (never a clone). */
function fmtListDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const weekday = d.toLocaleDateString('he-IL', { weekday: 'short' }); // "יום ב׳"
  const time = fmtTimeLabel(d);
  return time ? `${weekday} ${dd}/${mm} · ${time}` : `${weekday} ${dd}/${mm}`;
}

/* Compact list-row date (round 67): "DD/MM · HH:MM", or just "DD/MM" when the
   date column has no real time part. Drops the weekday so the name + date fit on
   ONE line in the new LTR soft-card row. Reuses fmtTimeLabel for the has-time
   check (same ORIGINAL-Date requirement as fmtListDate above). */
function fmtListDateCompact(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const time = fmtTimeLabel(d);
  return time ? `${dd}/${mm} · ${time}` : `${dd}/${mm}`;
}

/* Custom single-select filter — matches the app's other working dropdowns
   (PersonPicker / CreateDiscussionModal): the menu is rendered position:fixed
   with a high z-index so it is never clipped or covered, which the Vibe
   <Dropdown> menu was (its Dialog z-index isn't controllable from here). */
function FilterSelect({ options, value, onChange, ariaLabel, searchable = false, icon: Icon = null, fieldLabel = null }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [q, setQ] = useState('');
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const selected = options.find((o) => o.value === value) || options[0] || null;
  // Searchable filter: match by label, but always keep the leading "all" option.
  const shown = searchable && q.trim()
    ? options.filter((o) => o.value === 'all' || (o.label || '').toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    const reposition = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setQ('');
    setOpen(true);
  };

  return (
    <div className={styles.filterSelect}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.filterTrigger}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {/* monday-style funnel filter icon on the RTL-leading (right) side. */}
        {Icon && <Icon className={styles.filterIcon} aria-hidden="true" />}
        <span className={styles.filterValue}>
          {fieldLabel && (value == null || value === 'all') ? fieldLabel : (selected?.label ?? fieldLabel)}
        </span>
        <span className={`${styles.filterChevron} ${open ? styles.filterChevronOpen : ''}`} aria-hidden="true">▾</span>
      </button>
      {open && pos && createPortal(
        <ul
          ref={menuRef}
          className={styles.filterMenu}
          role="listbox"
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 10000 }}
        >
          {searchable && (
            <li className={styles.filterSearchRow} onMouseDown={(e) => e.stopPropagation()}>
              <Search className={styles.filterSearchIcon} aria-hidden="true" />
              <input
                type="text"
                className={styles.filterSearch}
                value={q}
                aria-label="חיפוש סוג דיון"
                autoFocus
                onChange={(e) => setQ(e.target.value)}
              />
            </li>
          )}
          {shown.map((opt) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              className={`${styles.filterItem} ${opt.value === value ? styles.filterItemSelected : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              {opt.label}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

/* Shared body for the discussion actions menus — the row kebab (⋯) AND the
   right-click context menu render the exact same four actions
   (edit / duplicate / export / delete) with an inline delete-confirm step.
   `run` closes the host menu then fires the reused handler. Actions that are
   null (gated off for this discussion) are simply omitted. */
function DiscussionMenuBody({ item, actions, confirmDel, setConfirmDel, onClose }) {
  const run = (fn) => (e) => {
    e.stopPropagation();
    onClose();
    fn?.(item);
  };
  // round114 — "לינק לדיון" moved here from the card header: copy, flash a
  // ✓ "הועתק" sign inside the item, then close the menu.
  const [linkCopied, setLinkCopied] = useState(false);
  const handleCopyLink = (e) => {
    e.stopPropagation();
    actions.onCopyLink?.(item);
    setLinkCopied(true);
    setTimeout(() => onClose(), 900);
  };
  if (confirmDel) {
    return (
      <div className={styles.menuConfirm} dir="rtl">
        <span className={styles.menuConfirmText}>למחוק את הדיון?</span>
        <div className={styles.menuConfirmActions}>
          <button type="button" className={`${styles.menuConfirmBtn} ${styles.menuConfirmYes}`} onClick={run(actions.onDelete)} role="menuitem">
            מחק
          </button>
          <button type="button" className={styles.menuConfirmBtn} onClick={(e) => { e.stopPropagation(); setConfirmDel(false); }} role="menuitem">
            ביטול
          </button>
        </div>
      </div>
    );
  }
  return (
    <>
      {actions.onEdit && (
        <button type="button" className={styles.menuItem} onClick={run(actions.onEdit)} role="menuitem">
          <Pencil className={styles.menuItemIcon} />
          <span>עריכה</span>
        </button>
      )}
      {actions.onCopyLink && (
        <button type="button" className={styles.menuItem} onClick={handleCopyLink} role="menuitem">
          {linkCopied ? <Check className={styles.menuItemIcon} /> : <Link2 className={styles.menuItemIcon} />}
          <span>{linkCopied ? 'הועתק' : 'לינק לדיון'}</span>
        </button>
      )}
      {actions.onDuplicate && (
        <button type="button" className={styles.menuItem} onClick={run(actions.onDuplicate)} role="menuitem">
          <Copy className={styles.menuItemIcon} />
          <span>שכפול</span>
        </button>
      )}
      {actions.onExport && (
        <button
          type="button"
          className={styles.menuItem}
          disabled={actions.exporting}
          onClick={run(actions.onExport)}
          role="menuitem"
        >
          {actions.exporting ? (
            <Loader2 className={`${styles.menuItemIcon} ${styles.spinning}`} />
          ) : (
            <FileDown className={styles.menuItemIcon} />
          )}
          <span>ייצוא</span>
        </button>
      )}
      {actions.onDelete && (
        <>
          <div className={styles.menuDivider} />
          <button
            type="button"
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={(e) => { e.stopPropagation(); setConfirmDel(true); }}
            role="menuitem"
          >
            <Trash2 className={styles.menuItemIcon} />
            <span>מחיקה</span>
          </button>
        </>
      )}
    </>
  );
}

/* Per-row kebab (⋯) menu — monday-like. Opens a fixed-position popup with four
   actions: edit / duplicate / export / delete. Delete swaps the menu to an
   inline confirm step (the app deliberately avoids window.confirm). Modeled on
   FilterSelect's fixed-position + click-outside pattern so it's never clipped. */
function RowMenu({ item, onEdit, onCopyLink, onDuplicate, onExport, onDelete, exporting }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const close = () => { setOpen(false); setConfirmDel(false); };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      close();
    };
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    const reposition = () => close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  const toggle = (e) => {
    e.stopPropagation();
    if (open) { close(); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    // Anchor to the trigger's left edge (RTL list, menu opens toward the card).
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.kebabBtn} ${open ? styles.kebabBtnOpen : ''}`}
        aria-label={`פעולות עבור ${item.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="פעולות"
        onClick={toggle}
      >
        <MoreHorizontal className={styles.kebabIcon} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className={styles.rowMenu}
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <DiscussionMenuBody
            item={item}
            actions={{ onEdit, onCopyLink, onDuplicate, onExport, onDelete, exporting }}
            confirmDel={confirmDel}
            setConfirmDel={setConfirmDel}
            onClose={close}
          />
        </div>,
        document.body
      )}
    </>
  );
}

/* Right-click context menu (round 33) for a discussion — the SAME four actions
   as the row kebab, anchored at the cursor. A single instance is hosted by
   DiscussionList and opened by BOTH the list rows and the calendar chips, so it
   works in both views. Portal + fixed position + z-index 10000 so it is never
   clipped and always paints above the app; closes on outside-click / Esc /
   scroll / resize (mirrors RowMenu / FilterSelect). */
function DiscussionContextMenu({ item, x, y, actions, onClose }) {
  const menuRef = useRef(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [pos, setPos] = useState({ top: y, left: x });

  useEffect(() => {
    const onDown = (e) => { if (menuRef.current?.contains(e.target)) return; onClose(); };
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    const reposition = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [onClose]);

  // Clamp inside the viewport once the menu has a measured size (so a click near
  // an edge doesn't push it off-screen).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
    });
  }, [x, y]);

  return createPortal(
    <div
      ref={menuRef}
      className={styles.rowMenu}
      role="menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000 }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <DiscussionMenuBody
        item={item}
        actions={actions}
        confirmDel={confirmDel}
        setConfirmDel={setConfirmDel}
        onClose={onClose}
      />
    </div>,
    document.body
  );
}

export function DiscussionList({
  onSelect, selectedId, onCreateNew, onEdit, onCopyLink, onDuplicate, onExport, onDelete,
  exportingId, canManageSettings, onOpenSettings, onOpenMyTasks, onOpenMyDecisions, onOpenDashboard, currentUser = null,
  // Calendar view — nav state lives in App (predates round136's removal of the
  // refreshKey remount; keeping it there is still correct).
  viewMode = 'list', onViewModeChange, calendarAnchor, calendarMode, onCalendarNavigate, onCreateAt,
  // round136 (perf audit) — a bumped token triggers a SILENT refetch after a
  // save. This replaced App's key={refreshKey} remount, which tore down and
  // rebuilt the whole list (all rows + a full refetch + lost search/filter/
  // scroll state) on every create/edit/duplicate.
  refreshToken = 0,
}) {
  const isCalendar = viewMode === 'calendar' && !!calendarAnchor;
  const [search, setSearch] = useState('');
  // Default to the current month for fast initial load — fetching only this month's
  // discussions instead of all (up to PAGE_SIZE). "כל החודשים" is still selectable.
  const [monthFilter, setMonthFilter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' or a status label id (string)
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Right-click context menu (round 33) — {item, x, y} while open. A single
  // instance serves BOTH the list rows and the calendar chips (both live inside
  // this component's tree).
  const [ctxMenu, setCtxMenu] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = useMemo(() => {
    const f = {};
    if (debouncedSearch) f.search = debouncedSearch;
    // Calendar mode fetches the visible grid range (replaces the month dropdown);
    // search + type filters apply in both views.
    if (isCalendar) f.range = rangeForView(calendarMode, calendarAnchor);
    else if (monthFilter && monthFilter !== 'all') f.month = monthFilter;
    // "סוג" is a dropdown column — filter by the label ID (server-side any_of).
    if (typeFilter && typeFilter !== 'all') f.type = [typeFilter];
    return f;
  }, [debouncedSearch, monthFilter, typeFilter, isCalendar, calendarMode, calendarAnchor]);

  const { items, loading, refetching, loadingMore, cursor, loadMore, softDeleteDiscussion, refetch } = useDiscussions(filters);

  // round136 — a save bumps refreshToken (App.handleSaved): refresh the list
  // IN PLACE (the hook's silent refetch — no unmount, no skeleton, search/
  // filter/scroll preserved). Skip the mount value; only react to bumps.
  const refreshSeenRef = useRef(refreshToken);
  useEffect(() => {
    if (refreshSeenRef.current === refreshToken) return;
    refreshSeenRef.current = refreshToken;
    refetch();
    // refetch is re-created per render (hook return); the token is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  // NOTE (round 46): the LEFT discussions list intentionally shows NO branded
  // Meetings splash. The list is preloaded at boot (prefetchDiscussions), so its
  // initial-load window is normally skipped entirely; when it does briefly load
  // we render a plain empty area and let it settle. The branded loader now lives
  // ONLY in the boot gate (App) and the RIGHT-hand card pane on a return to the
  // discussions view from My Tasks / My Decisions.

  // Per-discussion edit gate (mirrors DiscussionCard) resolved through the
  // advisory permission hook. The list rows carry discussionCreatorID/
  // discussionLeadID (see LIST_COLUMNS) so this resolves without an extra fetch.
  // currentUser/canManageSettings are passed from App (avoids requiring a
  // MondayProvider around the list in isolation/tests). Phase 1 derives a single
  // COARSE boolean per row so the edit/delete kebab gate is byte-for-byte
  // identical to the legacy creator/lead/owner gate while the feature is off.
  const can = usePermission({ canManageSettings, currentUser });
  // round147 — super members get the gear too, in templates-only mode (the
  // modal itself narrows what they see; App passes templatesOnly for non-owners).
  const isSuper = useIsSuperMember({ currentUser });
  const canEditItem = useCallback(
    (item) => can('editDiscussionFields', { discussion: item }),
    [can]
  );
  // DOCS-export is its own capability (default creator/lead/owner). Gate the row
  // kebab / calendar export item per-discussion, mirroring canEditItem. While the
  // feature is off it resolves via the legacy creator/lead/owner path → identical
  // to before this gate existed (owners bypass).
  const canExportItem = useCallback(
    (item) => can('exportDocs', { discussion: item }),
    [can]
  );
  // System-tier caps (global, not item-bound). While the feature is off both
  // resolve allow-all → buttons always shown (identical to today). Owners bypass.
  const canCreateDiscussion = can('createDiscussion');
  // "סוג" is a DROPDOWN column: the filter options are its labels (text) and the
  // per-row accent color comes from app storage (typeColor by type name).
  const { options: typeOptions } = useDropdownOptions('discussions', 'discussionTypeID');
  const { typeColor } = useTemplates();

  // Optimistic delete: drop the row now, hand the undo to App so it can show the
  // "הדיון נמחק" toast with a "בטל" button (and close the card if it was open).
  const handleRowDelete = (item) => {
    const { undo } = softDeleteDiscussion(item.id);
    onDelete?.(item, { undo });
  };

  // Per-discussion action set (round 33) — the SAME gating as the row kebab:
  // edit/delete need editDiscussionFields, export needs exportDocs, duplicate is
  // ungated (mirrors RowMenu). Reuses the existing App handlers + soft-delete.
  const resolveItemActions = (item) => ({
    onEdit: (onEdit && canEditItem(item)) ? onEdit : null,
    onCopyLink: onCopyLink || null,
    onDuplicate: onDuplicate || null,
    onExport: (onExport && canExportItem(item)) ? onExport : null,
    onDelete: (onDelete && canEditItem(item)) ? handleRowDelete : null,
    exporting: exportingId === item.id,
  });
  // Open the shared right-click menu at the cursor — from a list row OR a calendar
  // chip. Suppress the native browser menu; no-op when the user has no action on
  // this discussion (so we never show an empty menu).
  const openItemContextMenu = (item, e) => {
    const actions = resolveItemActions(item);
    if (!actions.onEdit && !actions.onDuplicate && !actions.onExport && !actions.onDelete) return;
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ item, x: e.clientX, y: e.clientY });
  };

  // Month-filter options: offer EVERY month that actually has a discussion — past,
  // present OR FUTURE (a discussion dated next month is selectable before that
  // month arrives) — always including the current month. Built from the distinct
  // months-with-discussions (one lean date-only fetch) ∪ {current}, newest-first.
  // The current month stays the DEFAULT selection (see monthFilter above), so the
  // initial load is unchanged; options just expand once the month set resolves.
  const { months: monthsWithDiscussions } = useDiscussionMonths(refreshToken);
  const monthOptions = useMemo(
    () => buildMonthOptions(monthsWithDiscussions),
    [monthsWithDiscussions]
  );

  const monthDropdownOptions = useMemo(
    () => [{ value: 'all', label: 'כל החודשים' }, ...monthOptions],
    [monthOptions]
  );
  // Filter by the dropdown label ID (server-side any_of, exact match) while
  // showing the label text. value is stringified so the picker round-trips it;
  // useDiscussions/BoardSDK Number() it back for the query rule.
  const typeDropdownOptions = useMemo(
    () => [{ value: 'all', label: 'כל הסוגים' }, ...typeOptions.map((o) => ({ value: String(o.id), label: o.label }))],
    [typeOptions]
  );

  const rowActions = useMemo(() => {
    if (!onEdit && !onDuplicate && !onExport && !onDelete) return null;
    // Edit/delete are gated per-discussion (creator/lead/owner). The calendar
    // renders its own RowMenu from these handlers, so enforce the gate here too.
    return {
      onEdit: onEdit ? (it) => { if (canEditItem(it)) onEdit(it); } : null,
      onCopyLink,
      onDuplicate,
      onExport: onExport ? (it) => { if (canExportItem(it)) onExport(it); } : null,
      onDelete: onDelete ? (it) => { if (canEditItem(it)) handleRowDelete(it); } : null,
      exportingId,
    };
  }, [onEdit, onCopyLink, onDuplicate, onExport, onDelete, exportingId, handleRowDelete, canEditItem, canExportItem]);

  return (
    <div className={styles.root}>
      {/* round131 — the 4px gradient accent bar was removed (owner request). */}
      <div className={styles.header}>
        <div className={styles.headerInner}>
          {/* Mockup buttons row: personal-view nav (outline) at inline-start,
              chrome (gear + view toggle) and the primary "חדש" at inline-end. */}
          <div className={styles.titleRow}>
            <div className={styles.titleActions}>
              {/* round128 — "המשימות שלי" sits LEFT of "ההחלטות שלי" (owner request). */}
              {onOpenMyTasks && (
                <Button kind={"secondary"} size={"small"} onClick={onOpenMyTasks}>
                  המשימות שלי
                </Button>
              )}
              {onOpenMyDecisions && (
                <Button kind={"secondary"} size={"small"} onClick={onOpenMyDecisions}>
                  ההחלטות שלי
                </Button>
              )}
              {/* round152/153 — entry to the discussions dashboard, alongside the
                  personal-view nav. round153: icon-only square button (owner
                  request — the graph glyph, no "דשבורד" label). */}
              {onOpenDashboard && (
                <IconButton
                  icon={BarChart3}
                  size={"small"}
                  kind={"tertiary"}
                  ariaLabel="דשבורד דיונים"
                  tooltipContent="דשבורד דיונים"
                  onClick={onOpenDashboard}
                />
              )}
            </div>
            <div className={styles.titleActions}>
              {(canManageSettings || isSuper) && (
                <IconButton
                  icon={Settings}
                  size={"small"}
                  kind={"tertiary"}
                  ariaLabel={canManageSettings ? 'הגדרות' : 'ניהול תבניות'}
                  onClick={onOpenSettings}
                />
              )}
              {onViewModeChange && (
                <IconButton
                  icon={isCalendar ? List : Calendar}
                  size={"small"}
                  kind={"tertiary"}
                  ariaLabel={isCalendar ? 'תצוגת רשימה' : 'תצוגת לוח שנה'}
                  tooltipContent={isCalendar ? 'תצוגת רשימה' : 'תצוגת לוח שנה'}
                  onClick={() => onViewModeChange(isCalendar ? 'list' : 'calendar')}
                />
              )}
              {canCreateDiscussion && (
                <Button kind={"primary"} size={"small"} onClick={onCreateNew}>
                  חדש
                </Button>
              )}
            </div>
          </div>
          {isCalendar ? (
            <div className={styles.calendarFilterRow} data-testid="calendar-filter-row">
              <div className={styles.searchWrap}>
                <Search className={styles.searchIcon} aria-hidden="true" />
                <input
                  type="text"
                  className={styles.search}
                  aria-label="חיפוש דיון"
                  placeholder="חיפוש דיון"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {/* clear-X — pinned to the input's LEFT edge (inline-end in RTL) */}
                {search ? (
                  <button
                    type="button"
                    className={styles.searchClear}
                    aria-label="נקה חיפוש"
                    onClick={() => setSearch('')}
                  >
                    <CloseSmall size={16} />
                  </button>
                ) : null}
              </div>
              <div className={styles.calendarTypeCell}>
                <FilterSelect
                  options={typeDropdownOptions}
                  value={typeFilter}
                  onChange={(val) => setTypeFilter(val ?? 'all')}
                  ariaLabel="סינון לפי סוג"
                  fieldLabel="סוג הדיון"
                  icon={Filter}
                  searchable
                />
              </div>
            </div>
          ) : (
            <>
              <div className={styles.searchWrap}>
                <Search className={styles.searchIcon} aria-hidden="true" />
                <input
                  type="text"
                  className={styles.search}
                  aria-label="חיפוש דיון"
                  placeholder="חיפוש דיון"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {/* clear-X — pinned to the input's LEFT edge (inline-end in RTL) */}
                {search ? (
                  <button
                    type="button"
                    className={styles.searchClear}
                    aria-label="נקה חיפוש"
                    onClick={() => setSearch('')}
                  >
                    <CloseSmall size={16} />
                  </button>
                ) : null}
              </div>
              {/* Full-width filter chips (round 38): each stretches to fill half
                  the row so together they span the search-input width above. Order
                  (DOM = RTL): סוג הדיון on the right (start), month on the left
                  (end). Both carry a funnel icon. */}
              <div className={styles.filterRow}>
                <div className={styles.filterCell}>
                  <FilterSelect
                    options={typeDropdownOptions}
                    value={typeFilter}
                    onChange={(val) => setTypeFilter(val ?? 'all')}
                    ariaLabel="סינון לפי סוג"
                    fieldLabel="סוג הדיון"
                    icon={Filter}
                    searchable
                  />
                </div>
                <div className={styles.filterCell}>
                  <FilterSelect
                    options={monthDropdownOptions}
                    value={monthFilter}
                    onChange={(val) => setMonthFilter(val ?? 'all')}
                    ariaLabel="סינון לפי חודש"
                    icon={Filter}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {isCalendar ? (
        <DiscussionCalendar
          items={items}
          loading={loading}
          refetching={refetching}
          selectedId={selectedId}
          anchor={calendarAnchor}
          mode={calendarMode}
          onNavigate={onCalendarNavigate}
          onSelect={onSelect}
          onCreateAt={canCreateDiscussion ? onCreateAt : undefined}
          rowActions={rowActions}
          onItemContextMenu={openItemContextMenu}
        />
      ) : (
      <div className={`${styles.scroll} ${refetching ? styles.refetching : ''}`}>
        {loading ? (
          // Preloaded at boot → this window is normally skipped. Render a plain
          // empty area (NO branded splash) while it settles — never the animation.
          <div className={styles.listLoading} aria-hidden="true" />
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            <Text color={"secondary"}>לא נמצאו דיונים</Text>
          </div>
        ) : (
          <div className={styles.list}>
            {items.map((item, idx) => {
              const accent = discussionAccentColor(item, typeColor);
              const isSelected = selectedId === item.id;
              return (
                <div key={item.id} className={styles.itemWrap}>
                  <button
                    onClick={() => onSelect(item)}
                    onContextMenu={(e) => openItemContextMenu(item, e)}
                    aria-label={item.name}
                    dir="ltr"
                    className={`${styles.item} ${isSelected ? styles.itemSelected : ''}`}
                  >
                    <span className={styles.rail} style={{ backgroundColor: accent }} />
                    <p className={styles.itemName}>
                      <HighlightedText text={item.name} query={debouncedSearch} />
                    </p>
                    {item.discussionDateID && (
                      <span className={styles.itemDate}>{fmtListDateCompact(item.discussionDateID)}</span>
                    )}
                  </button>
                  {(onDuplicate || onEdit || onCopyLink || onExport || onDelete) && (
                    <div className={styles.itemActions}>
                      <RowMenu
                        item={item}
                        onEdit={canEditItem(item) ? onEdit : null}
                        onCopyLink={onCopyLink}
                        onDuplicate={onDuplicate}
                        onExport={canExportItem(item) ? onExport : null}
                        onDelete={canEditItem(item) && onDelete ? handleRowDelete : null}
                        exporting={exportingId === item.id}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {cursor && (
              <div className={styles.loadMoreRow}>
                <Button
                  kind={"secondary"}
                  size={"small"}
                  onClick={loadMore}
                  disabled={loadingMore}
                  loading={loadingMore}
                >
                  {loadingMore ? 'טוען' : 'טען עוד'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Single right-click menu instance — serves both the list rows and the
          calendar chips (round 33). Rendered here so one portal covers both views. */}
      {ctxMenu && (
        <DiscussionContextMenu
          item={ctxMenu.item}
          x={ctxMenu.x}
          y={ctxMenu.y}
          actions={resolveItemActions(ctxMenu.item)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
