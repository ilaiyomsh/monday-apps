// DEV-ONLY Gantt geometry harness. Renders the REAL VirtualRowList /
// GroupHeaderRow / ProjectSummaryCard / TrackRow with mock data + the real CSS
// (index.css sets :root font-size:20px), OUTSIDE the monday iframe, so the
// focus-card ↔ track-row alignment can be measured with getBoundingClientRect.
// Not part of the prod build: vite build only crawls index.html; harness.html
// is served by the dev server only. See harness.html.
//
// Usage:  pnpm server   →   http://localhost:8301/harness.html
//         window.__measure()  logs card-row vs track-row offsets.
import { useRef, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DndContext } from '@dnd-kit/core'
import '@vibe/core/tokens'
import '../index.css'
import '../i18n'
import { SettingsContext } from '../contexts/SettingsContext'
import { ActiveProjectsContext } from '../contexts/ActiveProjectsContext'
import { GanttContext } from '../components/Gantt/GanttContext'
import { VirtualRowList } from '../components/Gantt/VirtualRowList'
import { useDataFlattener } from '../hooks/useDataFlattener'
import type { Group, Task } from '../types/gantt.types'

// ── mock timeline ──────────────────────────────────────────────────────────
const START = new Date(2026, 3, 1) // 1 Apr 2026
const DAYS = 300
const PPD = 8
const displayDays = Array.from({ length: DAYS }, (_, i) => {
  const d = new Date(START); d.setDate(d.getDate() + i); return d
})
const iso = (y: number, m: number, d: number) => new Date(y, m, d).toISOString()
const idx = (d: Date | string) => Math.round((new Date(d).getTime() - START.getTime()) / 86400000)
const getXByDate = (d: Date | string) => idx(d) * PPD
const getDateByX = (x: number) => { const d = new Date(START); d.setDate(d.getDate() + Math.round(x / PPD)); return d }
const getWidthByDates = (s: Date | string, e: Date | string) => Math.max(PPD, (idx(e) - idx(s) + 1) * PPD)

// ── mock project: 2 time-overlapping allocations → 2 packed tracks (like "אסדן") ──
const tasks: Task[] = [
  { id: 't1', name: 'עידו פיוטרקובסקי', projectId: 'p1', employeeId: 'e1', role: 'מפתח',
    startDate: iso(2026, 3, 5), endDate: iso(2026, 7, 20), hoursPerDay: 4, totalHours: 300, reportedHours: 200, color: '#00854d' } as unknown as Task,
  { id: 't2', name: 'עילי שלם', projectId: 'p1', employeeId: 'e2', role: 'מנהל',
    startDate: iso(2026, 4, 1), endDate: iso(2026, 8, 15), hoursPerDay: 4, totalHours: 200, reportedHours: 120, color: '#0073ea' } as unknown as Task,
]

const group = {
  id: 'p1', name: 'אסדן (HARNESS)', tasks, color: '#00854d', classification: 'external',
  projectSummary: {
    totalPlannedHours: 350, totalReportedHours: 320, totalCost: 0, costPerHour: 0,
    managerName: 'עידו פיוטרקובסקי', projectType: 'שעות גמיש', projectTypeColor: '#e2a600', currency: '₪',
  },
} as unknown as Group

// Second focusable project — to reproduce the real bug, which only appears when
// you SWITCH focus from one project to another (stale card from the previous one).
const tasks2: Task[] = [
  { id: 't3', name: 'ספיר הורושובסקי', projectId: 'p2', employeeId: 'e3', role: 'מפתח',
    startDate: iso(2026, 3, 10), endDate: iso(2026, 7, 25), hoursPerDay: 4, totalHours: 200, reportedHours: 150, color: '#00854d' } as unknown as Task,
  { id: 't4', name: 'עובד ד', projectId: 'p2', employeeId: 'e4', role: 'מנהל',
    startDate: iso(2026, 4, 5), endDate: iso(2026, 8, 20), hoursPerDay: 4, totalHours: 180, reportedHours: 100, color: '#0073ea' } as unknown as Task,
]
const group2 = {
  id: 'p2', name: 'אימפקט (HARNESS)', tasks: tasks2, color: '#e2a600', classification: 'external',
  projectSummary: {
    totalPlannedHours: 200, totalReportedHours: 150, totalCost: 0, costPerHour: 0,
    managerName: 'ספיר הורושובסקי', projectType: 'חודשי - כסף', projectTypeColor: '#e91e8c', currency: '₪',
  },
} as unknown as Group

const employees = [
  { id: 'e1', name: 'עידו פיוטרקובסקי', role: 'מפתח', capabilities: [], allocationPercentage: 100 },
  { id: 'e2', name: 'עילי שלם', role: 'מנהל', capabilities: [], allocationPercentage: 100 },
] as any

const settings = {
  projectsBoardId: '1', projectTypeColumnId: 'type', projectManagerColumnId: 'pm',
  projectPlannedHoursColumnId: 'ph', reportedHoursColumnId: 'rh',
  workDays: [0, 1, 2, 3, 4], maxHoursPerDay: 8.5,
  // Classification ON (like the real app) — this puts the focused project inside a
  // section, which is the one structural thing the harness was missing.
  enableProjectClassification: true, projectClassificationColumnId: 'class',
  externalProjectStatusValues: ['ext'], internalProjectStatusValues: ['int'],
} as any

const projectMetrics = new Map<string, any>([
  ['p1', { planned: 350, allocated: 500, reported: 320 }],
  ['p2', { planned: 200, allocated: 380, reported: 150 }],
])

// ── measurement: full vertical chain, all via real getBoundingClientRect ──
function measure() {
  const box = (el: Element | null) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), h: Math.round(r.height), center: Math.round(r.top + r.height / 2) }
  }
  const rows: Record<string, any> = {}
  document.querySelectorAll('[data-track-index]').forEach((el: any) => {
    rows['track' + el.dataset.trackIndex] = box(el)
  })
  const card = document.querySelector('.gantt-group-row .absolute.bg-bg-surface') // the focused project's white card (fillers have none)
  const groupRow = card?.closest('.gantt-group-row') || null
  const cardPanel = box(card)
  const cardRow1 = box(card?.querySelector('.justify-between') || null) // PM + type badge row
  const cardRow2 = box(card?.querySelector('.items-stretch') || null)   // hours metrics row
  const badge = box(card?.querySelector('button[title], span') || null) // the type-badge chip itself
  const out: any = {
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    groupRow: box(groupRow), cardPanel, cardRow1, cardRow2, badge, ...rows,
  }
  // A uniform panel offset shows up as cardPanel.top - track0.top (the real bug 2).
  if (cardPanel && rows.track0) out.PANEL_top_minus_track0_top = cardPanel.top - rows.track0.top
  if (cardRow1 && rows.track0) out.OFFSET_row1_vs_track0 = cardRow1.center - rows.track0.center
  if (cardRow2 && rows.track1) out.OFFSET_row2_vs_track1 = cardRow2.center - rows.track1.center
  return out
}

function Harness() {
  const containerRef = useRef<HTMLDivElement>(null)
  // Start UNFOCUSED, then focus after mount — mirrors the real app, where the
  // user clicks to focus. This is the one thing the harness wasn't doing: the
  // virtualizer's size cache is built while unfocused, then focus changes row
  // heights + count, and if the cache isn't invalidated the sizes go stale.
  const [sel, setSel] = useState<string | null>(null)
  // Expose focus control (drive the exact focus-SWITCH sequence from the console)
  // and auto-focus p1 after mount so the harness shows the focused card by default.
  useEffect(() => {
    (window as any).__focus = setSel
    const t = setTimeout(() => setSel('p1'), 400)
    return () => clearTimeout(t)
  }, [])
  // Filler projects ABOVE the focused one so the focused block renders SCROLLED
  // into view (like the real app), not at the very top — to test whether the
  // card's absolute `top` drifts vs the virtualizer-positioned tracks when the
  // group row sits at a large virtualRow.start.
  const filler = (i: number, cls: string) => ({
    id: 'f' + i, name: 'מילוי ' + i, tasks: [], color: '#888', classification: cls,
    projectSummary: { totalPlannedHours: 0, totalReportedHours: 0, totalCost: 0, costPerHour: 0, currency: '₪' },
  }) as unknown as Group
  // Focused project is the FIRST in its ('external') section — a section header
  // sits directly above it, exactly like "אימפקט". The 'internal' fillers before
  // it collapse in focus mode, leaving: [external section header][p1][siblings].
  const internalFillers = Array.from({ length: 6 }, (_, i) => filler(i, 'internal'))
  const externalFillers = Array.from({ length: 6 }, (_, i) => filler(i + 6, 'external'))
  // p2 (group2) sits right after p1 in the external section — adjacent, like
  // אימפקט + אסדן — so switching focus between them shifts the rows by one.
  const allGroups = [...internalFillers, group, group2, ...externalFillers]

  const { flattenedData: flattenedRows, totalHeight } = useDataFlattener(
    allGroups, new Set(sel ? [sel] : []), 'projects',
    undefined, '', [], [], undefined, [], [],
    undefined, settings, false, false, new Set(),
    undefined, employees, undefined, undefined, undefined,
    null, false, new Set(), undefined, sel,
  )
  const totalWidth = DAYS * PPD

  const ctx: any = {
    groups: [group], setGroups() {}, flattenedRows, totalHeight, employees, roles: [], settings,
    rawAllocations: [], loading: false, allocationsError: null, allocationsErrorKind: null, refreshAllocations: async () => {},
    zoomLevel: 'month', setZoomLevel() {}, viewMode: 'projects', setViewMode() {}, effectiveEffortMode: 'hours',
    displayUnit: 'hours', setDisplayUnit() {}, searchQuery: '', setSearchQuery() {},
    timeframeFilter: [], setTimeframeFilter() {}, utilizationFilter: [], setUtilizationFilter() {},
    hidePastAllocations: false, setHidePastAllocations() {}, hideProjectsWithoutActiveAllocations: false, setHideProjectsWithoutActiveAllocations() {},
    showOnlyActiveProjectsWithoutAllocations: false, setShowOnlyActiveProjectsWithoutAllocations() {},
    pmFilter: [], setPmFilter() {}, projectTypeFilter: [], setProjectTypeFilter() {},
    availablePMs: [], availableProjectTypes: [{ label: 'שעות גמיש', color: '#e2a600' }],
    expandedGroups: new Set(sel ? [sel] : []), toggleGroup() {},
    selectedEmployeeId: null, setSelectedEmployeeId() {}, selectedProjectId: sel, setSelectedProjectId() {},
    collapsedSections: new Set(), toggleSection() {},
    timelineStart: START, timelineEnd: displayDays[DAYS - 1], displayDays, totalWidth,
    handleTimelineScroll() {}, getXByDate, getDateByX, getWidthByDates, pixelsPerDay: PPD, requestDrillDown() {},
    scrollLeft: 0, setScrollLeft() {}, scrollTop: 0, setScrollTop() {}, containerWidth: 1400,
    visibleDayRange: { startIndex: 0, endIndex: DAYS, offsetLeft: 0 },
    sidebarWidth: 360, setSidebarWidth() {}, saveSidebarWidth() {},
    updateTask() {}, addAllocation: async () => {}, deleteAllocation() {}, pendingDelete: null, undoDelete() {},
    showToast() {}, openModal() {}, openBulkModal() {}, bulkUpdateAllocationPM: async () => {}, patchProjectData() {},
    containerRef, forceShownProjects: new Map(), addForceShownProject() {}, absencesLoading: false,
    availability: {}, holidaysByDate: new Map(), projectMetrics, projectMetricsReady: true,
  }
  const settingsCtx: any = { settings, updateSettings: async () => true, loading: false, isConfigured: true, error: null, errorKind: null, refresh: async () => {} }
  const activeCtx: any = { activeProjects: [], activeProjectIds: new Set(), projectDataMap: new Map(), allProjects: [], loading: false, fetchAllProjectsLazy: async () => {}, refresh: async () => {} }

  useEffect(() => {
    ;(window as any).__measure = measure
    const t = setTimeout(() => console.log('[HARNESS_MEASURE] ' + JSON.stringify(measure())), 700)
    return () => clearTimeout(t)
  }, [])

  return (
    <SettingsContext.Provider value={settingsCtx}>
      <ActiveProjectsContext.Provider value={activeCtx}>
        <GanttContext.Provider value={ctx}>
          <DndContext>
            <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <VirtualRowList />
            </div>
          </DndContext>
        </GanttContext.Provider>
      </ActiveProjectsContext.Provider>
    </SettingsContext.Provider>
  )
}

document.documentElement.setAttribute('dir', 'rtl')
// No StrictMode — prod (main.tsx) uses it, but StrictMode's double-render can
// leave transforms/transitions in a dev-only intermediate state that doesn't
// reflect real geometry; the harness measures geometry, so it must match prod.
createRoot(document.getElementById('root')!).render(<Harness />)
