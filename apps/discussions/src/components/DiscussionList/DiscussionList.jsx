import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDiscussions } from '@generated/hooks/useDiscussions';
import { Skeleton, Button, Text, IconButton } from '@vibe/core';
import { Calendar, Search, Settings } from '@vibe/icons';
import { Copy, FileDown, List, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { DiscussionCalendar } from '@generated/components/DiscussionCalendar';
import { MONTHS_HE } from '@generated/utils/dateTime.js';
import { rangeForView } from '@generated/utils/calendarDates.js';
import { discussionAccentColor } from '@generated/constants/discussionColors.js';
import { useDropdownOptions } from '@generated/hooks/useDropdownOptions.js';
import { useTemplates } from '@generated/contexts/TemplatesContext.jsx';
import { usePermission } from '@generated/hooks/usePermission.js';
import styles from './DiscussionList.module.css';

/* Loading-skeleton bar height. MUST equal the rendered height of a real `.item`
   row (single 14px line + 8px top/bottom padding ≈ 36px; see .item min-height
   in DiscussionList.module.css, kept in sync via --list-row-height) so the grey
   bars don't visibly shrink/jump when the real rows arrive. */
const ROW_SKELETON_H = 36;

/* List-row date label: short weekday + "DD/MM" ("יום ב׳ 06/07"). No time,
   no icon — compact metadata pinned to the row's right. */
function fmtListDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const weekday = d.toLocaleDateString('he-IL', { weekday: 'short' }); // "יום ב׳"
  return `${weekday} ${dd}/${mm}`;
}

/* Custom single-select filter — matches the app's other working dropdowns
   (PersonPicker / CreateDiscussionModal): the menu is rendered position:fixed
   with a high z-index so it is never clipped or covered, which the Vibe
   <Dropdown> menu was (its Dialog z-index isn't controllable from here). */
function FilterSelect({ options, value, onChange, ariaLabel, searchable = false }) {
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
        <span className={styles.filterValue}>{selected?.label}</span>
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

/* Per-row kebab (⋯) menu — monday-like. Opens a fixed-position popup with four
   actions: edit / duplicate / export / delete. Delete swaps the menu to an
   inline confirm step (the app deliberately avoids window.confirm). Modeled on
   FilterSelect's fixed-position + click-outside pattern so it's never clipped. */
function RowMenu({ item, onEdit, onDuplicate, onExport, onDelete, exporting }) {
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

  const run = (fn) => (e) => {
    e.stopPropagation();
    close();
    fn?.(item);
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
          {confirmDel ? (
            <div className={styles.menuConfirm}>
              <span className={styles.menuConfirmText}>למחוק את הדיון?</span>
              <div className={styles.menuConfirmActions}>
                <button type="button" className={`${styles.menuConfirmBtn} ${styles.menuConfirmYes}`} onClick={run(onDelete)} role="menuitem">
                  מחק
                </button>
                <button type="button" className={styles.menuConfirmBtn} onClick={(e) => { e.stopPropagation(); setConfirmDel(false); }} role="menuitem">
                  ביטול
                </button>
              </div>
            </div>
          ) : (
            <>
              {onEdit && (
                <button type="button" className={styles.menuItem} onClick={run(onEdit)} role="menuitem">
                  <Pencil className={styles.menuItemIcon} />
                  <span>עריכה</span>
                </button>
              )}
              {onDuplicate && (
                <button type="button" className={styles.menuItem} onClick={run(onDuplicate)} role="menuitem">
                  <Copy className={styles.menuItemIcon} />
                  <span>שכפול</span>
                </button>
              )}
              {onExport && (
                <button
                  type="button"
                  className={styles.menuItem}
                  disabled={exporting}
                  onClick={run(onExport)}
                  role="menuitem"
                >
                  {exporting ? (
                    <Loader2 className={`${styles.menuItemIcon} ${styles.spinning}`} />
                  ) : (
                    <FileDown className={styles.menuItemIcon} />
                  )}
                  <span>ייצוא ל-DOCS</span>
                </button>
              )}
              {onDelete && (
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
          )}
        </div>,
        document.body
      )}
    </>
  );
}

export function DiscussionList({
  onSelect, selectedId, onCreateNew, onEdit, onDuplicate, onExport, onDelete,
  exportingId, canManageSettings, onOpenSettings, onOpenMyTasks, currentUser = null,
  // Calendar view — nav state lives in App so it survives the refreshKey remount.
  viewMode = 'list', onViewModeChange, calendarAnchor, calendarMode, onCalendarNavigate, onCreateAt,
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

  const { items, loading, refetching, loadingMore, cursor, loadMore, softDeleteDiscussion } = useDiscussions(filters);

  // Per-discussion edit gate (mirrors DiscussionCard) resolved through the
  // advisory permission hook. The list rows carry discussionCreatorID/
  // discussionLeadID (see LIST_COLUMNS) so this resolves without an extra fetch.
  // currentUser/canManageSettings are passed from App (avoids requiring a
  // MondayProvider around the list in isolation/tests). Phase 1 derives a single
  // COARSE boolean per row so the edit/delete kebab gate is byte-for-byte
  // identical to the legacy creator/lead/owner gate while the feature is off.
  const can = usePermission({ canManageSettings, currentUser });
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

  const monthOptions = useMemo(() => {
    const now = new Date();
    const options = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = `${MONTHS_HE[d.getMonth()]} ${d.getFullYear()}`;
      options.push({ value: val, label });
    }
    return options;
  }, []);

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
      onDuplicate,
      onExport: onExport ? (it) => { if (canExportItem(it)) onExport(it); } : null,
      onDelete: onDelete ? (it) => { if (canEditItem(it)) handleRowDelete(it); } : null,
      exportingId,
    };
  }, [onEdit, onDuplicate, onExport, onDelete, exportingId, handleRowDelete, canEditItem, canExportItem]);

  return (
    <div className={styles.root}>
      {/* Vibrant header with gradient accent */}
      <div className={styles.header}>
        <div
          className={styles.gradientBar}
          style={{ background: 'linear-gradient(to left, hsl(var(--dept-legal)), hsl(var(--dept-hr)), hsl(var(--dept-ceo)), hsl(var(--status-done)))' }}
        />
        <div className={styles.headerInner}>
          <div className={styles.titleRow}>
            <div className={styles.titleActions}>
              {canManageSettings && (
                <IconButton
                  icon={Settings}
                  size={"small"}
                  kind={"tertiary"}
                  ariaLabel="הגדרות"
                  onClick={onOpenSettings}
                />
              )}
              {onOpenMyTasks && (
                <Button kind={"secondary"} size={"small"} onClick={onOpenMyTasks}>
                  המשימות שלי
                </Button>
              )}
            </div>
            <div className={styles.titleActions}>
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
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className={styles.calendarTypeCell}>
                <FilterSelect
                  options={typeDropdownOptions}
                  value={typeFilter}
                  onChange={(val) => setTypeFilter(val ?? 'all')}
                  ariaLabel="סינון לפי סוג"
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
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className={styles.filterRow}>
                <div className={styles.filterCell}>
                  <FilterSelect
                    options={monthDropdownOptions}
                    value={monthFilter}
                    onChange={(val) => setMonthFilter(val ?? 'all')}
                    ariaLabel="סינון לפי חודש"
                  />
                </div>
                <div className={styles.filterCell}>
                  <FilterSelect
                    options={typeDropdownOptions}
                    value={typeFilter}
                    onChange={(val) => setTypeFilter(val ?? 'all')}
                    ariaLabel="סינון לפי סוג"
                  searchable
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
        />
      ) : (
      <div className={`${styles.scroll} ${refetching ? styles.refetching : ''}`}>
        {loading ? (
          <div className={styles.skeletonList}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} type={"rectangle"} fullWidth height={ROW_SKELETON_H} />
            ))}
          </div>
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
                    aria-label={item.name}
                    className={`${styles.item} ${isSelected ? styles.itemSelected : ''}`}
                    style={isSelected ? { borderLeftColor: accent } : undefined}
                  >
                    <div className={styles.itemContent}>
                      <span
                        className={styles.dot}
                        style={{ backgroundColor: accent }}
                      />
                      <div className={styles.itemBody}>
                        <p className={styles.itemName}>{item.name}</p>
                        {item.discussionDateID && (
                          <span className={styles.itemDate}>{fmtListDate(item.discussionDateID)}</span>
                        )}
                      </div>
                    </div>
                  </button>
                  {(onDuplicate || onEdit || onExport || onDelete) && (
                    <div className={styles.itemActions}>
                      <RowMenu
                        item={item}
                        onEdit={canEditItem(item) ? onEdit : null}
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
    </div>
  );
}
