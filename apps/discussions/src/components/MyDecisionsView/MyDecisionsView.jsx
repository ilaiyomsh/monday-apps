import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Skeleton, Button } from '@vibe/core';
import { DropdownChevronDown, Search, Filter, Sort, Group, Collapse, Expand } from '@vibe/icons';
import { useMyDecisions } from '@generated/hooks/useMyDecisions.js';
import { usePermission } from '@generated/hooks/usePermission.js';
import { useStatusOptions } from '@generated/hooks/useStatusOptions';
import { useDiscussions } from '@generated/hooks/useDiscussions.js';
import { useViewport } from '@generated/hooks/useViewport.js';
import { useSavedViews } from '@generated/hooks/useSavedViews.js';
import { isValidStatus } from '@generated/constants/statusConfig';
import { useMondayContext } from '@generated/contexts/MondayContext.jsx';
import { DatePickerPopover } from '@generated/components/DatePickerPopover';
import { getBoardId } from '@api/board-config-store.js';
import { MyDecisionsTable } from './MyDecisionsTable.jsx';
import { toPipelineRows } from './decisionPipeline.js';
// Shared My-Tasks machinery, imported (NOT duplicated): the grouping/pipeline
// helpers are alias-generic (decisionPipeline derives statusID/priorityID/
// deadlineID onto each row) and the builder controls are pure chrome.
import { groupMyTasks } from '../MyTasksView/grouping.js';
import { BuilderControl } from '../MyTasksView/controls/BuilderControl.jsx';
import { Segment } from '../MyTasksView/controls/Segment.jsx';
import { BuilderIcon } from '../MyTasksView/controls/BuilderIcon.jsx';
import {
  SORT_COLUMNS, GROUP_COLUMNS, FILTER_COLUMNS, OP_LABEL, DEADLINE_RANGES,
  sortTasks, filterTasks, filterCount, emptyFilter, DEFAULT_SORT, DEFAULT_GROUP,
  serializeFilter, deserializeFilter,
} from '../MyTasksView/controls/controls.js';
import styles from './MyDecisionsView.module.css';
import bs from '../MyTasksView/controls/builder.module.css';

/*
 * "ההחלטות שלי" — the global My-Decisions view. Architecture mirrors MyTasksView
 * one-to-one (English toolbar pills, client-side filter → sort → group pipeline
 * over the loaded page, one shared board scroll, cursor pagination, shared saved
 * views), swapping tasks for DECISION rows.
 *
 * Two SERVER-SIDE sub-tabs (segmented control above the toolbar):
 *   'decider'  → החלטות שאני מחליט   (deciderID any_of me)
 *   'affected' → החלטות שמשפיעות עליי (affectedID any_of me)
 * Switching re-fetches (useMyDecisions' filter key changes); the client
 * pipeline state (filter/sort/group/collapse) intentionally carries across.
 *
 * The decisions board is mapped MANUALLY in Settings — when it (or the active
 * sub-tab's people column) is unmapped, the view renders an empty state and no
 * query ever fires (the hook guards too).
 *
 * Column display names here are the DECISIONS board's Hebrew names; the sort/
 * group/filter engines run over the derived pipeline aliases (statusID/
 * priorityID/deadlineID) added by toPipelineRows.
 */

const TYPE_ICON = { status: 'status', date: 'date', text: 'text', relation: 'relation' };

const firstSortDir = (col) => (SORT_COLUMNS.find((c) => c.key === col) || SORT_COLUMNS[0]).dirs[0].key;
const firstGroupOrder = (col) => (GROUP_COLUMNS.find((c) => c.key === col) || GROUP_COLUMNS[0]).orders[0].key;
const rangeLabel = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.label || 'Choose a date range';
const rangeIcon = (key) => DEADLINE_RANGES.find((r) => r.key === key)?.icon || 'date';

// Decision-board display names for the shared pipeline's column keys.
const COL_NAME = {
  priority: 'עדיפות',
  deadline: 'תאריך',
  status: 'סטאטוס',
  name: 'החלטה',
  discussion: 'דיון מקור',
};

const SUB_TABS = [
  { key: 'decider', label: 'החלטות שאני מחליט' },
  { key: 'affected', label: 'החלטות שמשפיעות עליי' },
];

// Hidden loader: mounted ONLY when "group by discussion → order by date" is
// active, so discussion dates (which decisions don't carry) load lazily.
function DiscussionDates({ onLoaded }) {
  const { items, loading } = useDiscussions();
  useEffect(() => {
    if (loading) return;
    const map = {};
    items.forEach((d) => { if (d.discussionDateID instanceof Date) map[String(d.id)] = d.discussionDateID; });
    onLoaded(map);
  }, [items, loading, onLoaded]);
  return null;
}

export function MyDecisionsView({ canManageSettings = false, onBackToDiscussions, onNotify }) {
  const { context, currentUser } = useMondayContext();
  const { isMobile } = useViewport();

  const [subTab, setSubTab] = useState('decider');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Shared saved view (settings.preferences.savedViews.myDecisions) is the
  // LOAD-TIME state for everyone; local changes are session-only.
  const { view: savedView, canSave: canSaveView, saveView } = useSavedViews('myDecisions', { canManageSettings });
  const [sort, setSort] = useState(() => {
    const s = savedView?.sort;
    if (!s || !s.active || !SORT_COLUMNS.some((c) => c.key === s.col)) return { ...DEFAULT_SORT };
    return { col: s.col, dir: s.dir || firstSortDir(s.col), active: true };
  });
  const [group, setGroup] = useState(() => {
    const g = savedView?.group;
    if (!g || !GROUP_COLUMNS.some((c) => c.key === g.col)) return { ...DEFAULT_GROUP };
    return { col: g.col, order: g.order || firstGroupOrder(g.col) };
  });
  const [filter, setFilter] = useState(() => (savedView?.filter ? deserializeFilter(savedView.filter) : emptyFilter()));
  const [filterRows, setFilterRows] = useState(() => (
    Array.isArray(savedView?.filterRows)
      ? savedView.filterRows.filter((k) => FILTER_COLUMNS.some((c) => c.key === k))
      : []
  ));
  const [collapsed, setCollapsed] = useState({});
  const [discDateMap, setDiscDateMap] = useState({});

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const {
    items, loading, loadingMore, hasMore, error, configured, loadMore,
    updateDecisionStatus, updateDecisionPriority, updateDecisionDate,
  } = useMyDecisions(subTab, { currentUser, context, search: debouncedSearch });

  // Board mapped at all? (vs only the ACTIVE sub-tab's people column missing).
  // Unmapped board → the full "not configured" empty state, no toolbar/tabs;
  // mapped board with one unmapped filter column → keep the tabs so the user
  // can switch back, and explain which column is missing.
  const boardMapped = !!getBoardId('decisions');

  // Per-decision permission gate: decision-tier caps resolve from the DECISION's
  // own people columns (decisionCreatorID/deciderID) — no parent discussion in
  // this surface, so resolveCan takes { item } alone (same as My Tasks).
  const can = usePermission({ canManageSettings, currentUser });
  const canDecision = useCallback(
    (cap, decision) => can(cap, { boardKey: 'decisions', item: decision }),
    [can]
  );

  const { options: statusOptions, labelById, colorById, orderById } = useStatusOptions('decisions', 'decisionStatusID');
  const {
    options: priorityOptions,
    labelById: priorityLabelById,
    colorById: priorityColorById,
    orderById: priorityOrderById,
  } = useStatusOptions('decisions', 'decisionPriorityID');

  // --- client pipeline: derive → filter → sort → group (instant, no re-fetch).
  // Derived pipeline aliases recompute from `items` every change, so optimistic
  // edits flow straight through filter/sort/group.
  const pipelineRows = useMemo(() => toPipelineRows(items), [items]);
  const filteredItems = useMemo(() => filterTasks(pipelineRows, filter), [pipelineRows, filter]);
  const sortedItems = useMemo(
    () => sortTasks(filteredItems, sort, { orderById, labelById, priorityOrderById, priorityLabelById }),
    [filteredItems, sort, orderById, labelById, priorityOrderById, priorityLabelById]
  );
  const grouped = useMemo(
    () => groupMyTasks(sortedItems, group.col, {
      labelById, colorById, orderById,
      priorityLabelById, priorityColorById, priorityOrderById,
      isValidStatus,
      order: group.order,
      discussionDateById: discDateMap,
      noStatusLabel: 'ללא סטאטוס',
      noPriorityLabel: 'ללא עדיפות',
      noDiscussionLabel: 'ללא דיון',
      allTasksLabel: 'החלטות',
    }),
    [sortedItems, group, discDateMap, labelById, colorById, orderById, priorityLabelById, priorityColorById, priorityOrderById]
  );

  // ---- sort handlers ----
  const setSortCol = useCallback((col) => setSort({ col, dir: firstSortDir(col), active: true }), []);
  const setSortDir = useCallback((dir) => setSort((s) => ({ ...s, dir, active: true })), []);
  const clearSort = useCallback(() => setSort({ ...DEFAULT_SORT }), []);

  // ---- group handlers (session-only; persisting is the explicit Save action) ----
  const setGroupCol = useCallback((col) => { setGroup({ col, order: firstGroupOrder(col) }); setCollapsed({}); }, []);
  const setGroupOrder = useCallback((order) => setGroup((g) => ({ ...g, order })), []);
  const clearGroup = useCallback(() => { setGroup({ col: 'none' }); setCollapsed({}); }, []);

  // ---- filter handlers (immutable updates so the pipeline memo re-runs) ----
  const resetCol = (col) => (col === 'deadline' ? { op: 'within', range: null, date: null } : { op: 'is', values: new Set() });
  const setFilterOp = useCallback((col, op) => setFilter((f) => ({ ...f, [col]: { ...f[col], op } })), []);
  const toggleFilterVal = useCallback((col, id) => setFilter((f) => {
    const next = new Set(f[col].values);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { ...f, [col]: { ...f[col], values: next } };
  }), []);
  const setDeadlineRange = useCallback((range) => setFilter((f) => ({ ...f, deadline: { op: 'within', range, date: null } })), []);
  const setDeadlineDate = useCallback((date) => setFilter((f) => ({ ...f, deadline: { ...f.deadline, date } })), []);
  const addFilterRow = useCallback(() => setFilterRows((rows) => {
    const next = FILTER_COLUMNS.map((c) => c.key).find((k) => !rows.includes(k));
    return next ? [...rows, next] : rows;
  }), []);
  const removeFilterRow = useCallback((col) => {
    setFilterRows((rows) => rows.filter((k) => k !== col));
    setFilter((f) => ({ ...f, [col]: resetCol(col) }));
  }, []);
  const retargetFilterRow = useCallback((fromCol, toCol) => {
    if (fromCol === toCol) return;
    setFilterRows((rows) => rows.map((k) => (k === fromCol ? toCol : k)));
    setFilter((f) => ({ ...f, [fromCol]: resetCol(fromCol), [toCol]: resetCol(toCol) }));
  }, []);
  const clearFilter = useCallback(() => { setFilter(emptyFilter()); setFilterRows([]); }, []);

  const fc = filterCount(filter);

  // ---- Save (shared saved view): each panel persists ITS selection for all users ----
  const notifySaved = () => onNotify?.('הבחירה נשמרה עבור כל המשתמשים', 'success');
  const saveSortView = () => { saveView({ sort }); notifySaved(); };
  const saveGroupView = () => { saveView({ group }); notifySaved(); };
  const saveFilterView = () => { saveView({ filter: serializeFilter(filter), filterRows }); notifySaved(); };

  // ---- collapse ----
  const allCollapsed = grouped.length > 0 && grouped.every((g) => collapsed[g.key]);
  const toggleAll = () => {
    if (allCollapsed) setCollapsed({});
    else { const c = {}; grouped.forEach((g) => { c[g.key] = true; }); setCollapsed(c); }
  };

  const field = (mobile, label, seg) => (mobile
    ? <div className={bs.bField} key={label}><div className={bs.bFieldLabel}>{label}</div>{seg}</div>
    : seg);

  // ---------- Sort panel body ----------
  const renderSortBody = ({ mobile, openId, setOpenId }) => {
    const colOptions = SORT_COLUMNS.map((c) => ({ key: c.key, label: COL_NAME[c.key], icon: TYPE_ICON[c.type], selected: c.key === sort.col }));
    if (!sort.col) {
      const emptySeg = (
        <Segment id="col" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Column"
          text="Choose a column" placeholder options={colOptions} onPick={setSortCol} />
      );
      return mobile ? field(true, 'Column', emptySeg) : <div className={bs.bRow}>{emptySeg}</div>;
    }
    const sc = SORT_COLUMNS.find((c) => c.key === sort.col) || SORT_COLUMNS[0];
    const dir = sc.dirs.find((d) => d.key === sort.dir) || sc.dirs[0];
    const colSeg = (
      <Segment id="col" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Column"
        icon={TYPE_ICON[sc.type]} text={COL_NAME[sc.key]}
        options={colOptions}
        onPick={setSortCol} />
    );
    const dirSeg = (
      <Segment id="dir" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Direction" note={sc.note}
        icon={dir.icon} text={dir.label}
        options={sc.dirs.map((d) => ({ key: d.key, label: d.label, icon: d.icon, selected: d.key === sort.dir }))}
        onPick={setSortDir} />
    );
    return mobile
      ? <>{field(true, 'Column', colSeg)}{field(true, 'Direction', dirSeg)}</>
      : <div className={bs.bRow}>{colSeg}{dirSeg}</div>;
  };

  // ---------- Group panel body ----------
  const renderGroupBody = ({ mobile, openId, setOpenId }) => {
    const colOptions = GROUP_COLUMNS.map((c) => ({ key: c.key, label: COL_NAME[c.key], icon: TYPE_ICON[c.type], selected: c.key === group.col }));
    if (group.col === 'none') {
      const colSeg = (
        <Segment id="gcol" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Column"
          text="Choose a column" placeholder options={colOptions} onPick={setGroupCol} />
      );
      return mobile ? field(true, 'Column', colSeg) : <div className={bs.bRow}>{colSeg}</div>;
    }
    const gc = GROUP_COLUMNS.find((c) => c.key === group.col) || GROUP_COLUMNS[0];
    const ord = gc.orders.find((o) => o.key === group.order) || gc.orders[0];
    const colSeg = (
      <Segment id="gcol" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Column"
        icon={TYPE_ICON[gc.type]} text={COL_NAME[gc.key]} options={colOptions} onPick={setGroupCol} />
    );
    const ordSeg = (
      <Segment id="gord" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Order"
        icon={ord.icon} text={ord.label}
        options={gc.orders.map((o) => ({ key: o.key, label: o.label, icon: o.icon, selected: o.key === group.order }))}
        onPick={setGroupOrder} />
    );
    return mobile
      ? <>{field(true, 'Column', colSeg)}{field(true, 'Order', ordSeg)}</>
      : <div className={bs.bRow}>{colSeg}{ordSeg}</div>;
  };

  // ---------- Filter panel body ----------
  const valueChips = (col) => {
    const opts = col === 'status' ? statusOptions : priorityOptions;
    return opts.filter((o) => filter[col].values.has(String(o.id))).map((o) => ({ color: o.color, text: o.label }));
  };
  const renderFilterRow = (col, i, mobile, openId, setOpenId) => {
    const fcfg = FILTER_COLUMNS.find((c) => c.key === col);
    const colSeg = (
      <Segment id={`fcol-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Column"
        icon={TYPE_ICON[fcfg.type]} text={COL_NAME[col]}
        options={FILTER_COLUMNS.map((c) => ({
          key: c.key, label: COL_NAME[c.key], icon: TYPE_ICON[c.type],
          selected: c.key === col, disabled: c.key !== col && filterRows.includes(c.key),
        }))}
        onPick={(to) => retargetFilterRow(col, to)} />
    );
    const opSeg = (
      <Segment id={`fop-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="Condition"
        text={OP_LABEL[filter[col].op]}
        options={fcfg.ops.map((op) => ({ key: op, label: OP_LABEL[op], selected: filter[col].op === op }))}
        onPick={(op) => setFilterOp(col, op)} />
    );
    let valueCtl = null;
    if (col === 'deadline') {
      const f = filter.deadline;
      if (f.op === 'within') {
        valueCtl = (
          <Segment id="fval-deadline" openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle="When"
            icon={f.range ? rangeIcon(f.range) : 'date'} text={f.range ? rangeLabel(f.range) : 'Choose a date range'} placeholder={!f.range}
            options={DEADLINE_RANGES.map((r) => ({ key: r.key, label: r.label, icon: r.icon, selected: f.range === r.key }))}
            onPick={setDeadlineRange} />
        );
      } else {
        valueCtl = (
          <div className={mobile ? bs.bDateWrapFull : bs.bDateWrap}>
            <DatePickerPopover value={f.date || null} onChange={setDeadlineDate} />
          </div>
        );
      }
    } else {
      const opts = col === 'status' ? statusOptions : priorityOptions;
      valueCtl = (
        <Segment id={`fval-${col}`} openId={openId} setOpenId={setOpenId} mobile={mobile} sheetTitle={COL_NAME[col]} multi
          chips={valueChips(col)}
          options={opts.map((o) => ({ key: String(o.id), label: o.label, dot: o.color, selected: filter[col].values.has(String(o.id)) }))}
          onPick={(id) => toggleFilterVal(col, id)} />
      );
    }
    const lead = i === 0 ? 'Where' : 'And';
    const removeBtn = (
      <button type="button" className={bs.bIconBtn} onClick={() => removeFilterRow(col)} aria-label="Remove filter">
        <BuilderIcon name="x" size={16} />
      </button>
    );
    if (mobile) {
      return (
        <div className={bs.bWhere} style={{ display: 'block' }} key={col}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className={bs.bWhereLead}>{lead}</span>
            {removeBtn}
          </div>
          {field(true, 'Column', colSeg)}
          {field(true, 'Condition', opSeg)}
          {valueCtl ? field(true, 'Value', valueCtl) : null}
        </div>
      );
    }
    return (
      <div className={bs.bWhere} key={col}>
        <span className={bs.bWhereLead}>{lead}</span>
        {colSeg}{opSeg}{valueCtl}{removeBtn}
      </div>
    );
  };
  const renderFilterBody = ({ mobile, openId, setOpenId }) => (
    <>
      {filterRows.map((col, i) => renderFilterRow(col, i, mobile, openId, setOpenId))}
      {filterRows.length === 0 ? <div className={bs.bEmpty}>No filters — showing all decisions</div> : null}
      {filterRows.length < FILTER_COLUMNS.length
        ? <button type="button" className={bs.bAddLink} onClick={addFilterRow}>+ New filter</button>
        : null}
    </>
  );

  const showSearch = searchOpen || search.length > 0;
  const needDiscDates = group.col === 'discussion' && (group.order === 'dateAsc' || group.order === 'dateDesc');

  const backBar = onBackToDiscussions ? (
    <div className={styles.topBar} dir="ltr">
      <Button kind={"secondary"} size={"small"} onClick={onBackToDiscussions}>
        דיונים
      </Button>
    </div>
  ) : null;

  // ---- unmapped decisions BOARD: the whole surface is inert (hook fired no
  // query) — back button + explanation only, no toolbar/tabs/table chrome.
  if (!boardMapped) {
    return (
      <div className={styles.root}>
        {backBar}
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>לוח ההחלטות טרם הוגדר</div>
          <div className={styles.emptyHint}>מפו אותו בהגדרות</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {needDiscDates ? <DiscussionDates onLoaded={setDiscDateMap} /> : null}

      {backBar}

      {/* Sub-tabs: which people column scopes the server-side query. */}
      <div className={styles.subTabs} role="tablist" aria-label="סינון החלטות לפי תפקיד">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={subTab === tab.key}
            className={`${styles.subTab}${subTab === tab.key ? ` ${styles.subTabActive}` : ''}`}
            onClick={() => setSubTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* monday-style toolbar: English pills, left-aligned (LTR) */}
      <div className={styles.toolbar} dir="ltr">
        {showSearch ? (
          <div className={styles.searchPill}>
            <Search className={styles.pillIcon} aria-hidden="true" />
            <input
              className={styles.searchInput}
              type="text"
              autoFocus
              value={search}
              placeholder="Search"
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => { if (!search) setSearchOpen(false); }}
              aria-label="Search"
            />
          </div>
        ) : (
          <button type="button" className={styles.pill} onClick={() => setSearchOpen(true)}>
            <Search className={styles.pillIcon} />
            <span>Search</span>
          </button>
        )}

        <BuilderControl
          icon={Filter} label="Filter" title="Filter by" mobile={isMobile} width={isMobile ? undefined : 620}
          applied={fc > 0} badge={fc}
          onClear={fc > 0 ? clearFilter : null}
          onSave={canSaveView ? saveFilterView : null}
          renderBody={renderFilterBody}
        />
        <BuilderControl
          icon={Sort} label="Sort" title="Sort by" mobile={isMobile} width={isMobile ? undefined : 360}
          applied={sort.active} badge={1}
          onClear={sort.active ? clearSort : null}
          onSave={canSaveView ? saveSortView : null}
          renderBody={renderSortBody}
        />
        <BuilderControl
          icon={Group} label="Group by" title="Group items by" mobile={isMobile} width={isMobile ? undefined : 360}
          applied={group.col !== 'none'} badge={1}
          onClear={group.col !== 'none' ? clearGroup : null}
          onSave={canSaveView ? saveGroupView : null}
          renderBody={renderGroupBody}
        />

        <button type="button" className={styles.pill} onClick={toggleAll}>
          {allCollapsed ? <Expand className={styles.pillIcon} /> : <Collapse className={styles.pillIcon} />}
          <span>{allCollapsed ? 'Expand all' : 'Collapse all'}</span>
        </button>
      </div>

      <div className={styles.board}>
      {loading ? (
        <div className={styles.skeletonStack}>
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} type="rectangle" height={36} fullWidth />)}
        </div>
      ) : !configured ? (
        // Board mapped but the ACTIVE sub-tab's people column isn't — keep the
        // tabs (switching back may work) and explain what's missing.
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>
            {subTab === 'affected' ? 'עמודת "מושפעים" אינה ממופה' : 'עמודת "מחליט" אינה ממופה'}
          </div>
          <div className={styles.emptyHint}>מפו אותה בהגדרות כדי להציג את ההחלטות</div>
        </div>
      ) : error ? (
        <div className={styles.empty}>אירעה שגיאה בטעינת ההחלטות</div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>
            {subTab === 'affected' ? 'אין החלטות שמשפיעות עליך' : 'אין החלטות שאתה מחליט בהן'}
          </div>
          <div className={styles.emptyHint}>החלטות חדשות שייוחסו אליך יופיעו כאן</div>
        </div>
      ) : (
        <div className={styles.groupScrollInner}>
          <div className={styles.groupStack}>
            {grouped.map((grp) => (
              <div key={grp.key}>
                <button
                  type="button"
                  onClick={() => setCollapsed((p) => ({ ...p, [grp.key]: !p[grp.key] }))}
                  className={styles.groupHeader}
                >
                  <DropdownChevronDown
                    className={`${styles.chevron} ${collapsed[grp.key] ? styles.chevronCollapsed : ''}`}
                    style={grp.color ? { color: grp.color } : undefined}
                  />
                  <span
                    className={styles.groupTitle}
                    style={{ color: grp.color || 'var(--secondary-text-color)' }}
                  >
                    {grp.label}
                  </span>
                  <span className={styles.groupCount}>{grp.items.length}</span>
                </button>
                {!collapsed[grp.key] && (
                  <MyDecisionsTable
                    decisions={grp.items}
                    color={grp.color}
                    canManageSettings={canManageSettings}
                    canDecision={canDecision}
                    onStatusChange={updateDecisionStatus}
                    onPriorityChange={updateDecisionPriority}
                    onDateChange={updateDecisionDate}
                  />
                )}
              </div>
            ))}
          </div>
          {hasMore && (
            <div className={styles.loadMore}>
              <button type="button" className={styles.pill} disabled={loadingMore} onClick={loadMore}>
                <span>טעינת החלטות נוספות</span>
              </button>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

export default MyDecisionsView;
