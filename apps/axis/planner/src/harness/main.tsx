// DEV-ONLY Gantt geometry harness. Renders the REAL VirtualRowList /
// GroupHeaderRow / ProjectSummaryCard / TrackRow with mock data + the real CSS
// (index.css sets :root font-size:20px), OUTSIDE the monday iframe, so the
// focus-card ↔ track-row alignment can be measured with getBoundingClientRect.
// Not part of the prod build: vite build only crawls index.html; harness.html
// is served by the dev server only. See harness.html.
//
// Usage:  pnpm server   →   http://localhost:8301/harness.html
//         window.__measure()  logs card-row vs track-row offsets.
import { StrictMode, useRef, useEffect } from 'react'
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
  id: 'p1', name: 'אסדן (HARNESS)', tasks, color: '#00854d',
  projectSummary: {
    totalPlannedHours: 350, totalReportedHours: 320, totalCost: 0, costPerHour: 0,
    managerName: 'עידו פיוטרקובסקי', projectType: 'שעות גמיש', projectTypeColor: '#e2a600', currency: '₪',
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
} as any

const projectMetrics = new Map([['p1', { planned: 350, allocated: 500, reported: 320 }]])

// ── measurement: card rows vs track rows, all via real getBoundingClientRect ──
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
  const cardRow1 = box(document.querySelector('.gantt-group-row .justify-between.h-12')) // PM + type badge
  const cardRow2 = box(document.querySelector('.gantt-group-row .items-stretch.h-12'))   // hours metrics
  const cardPanel = box(document.querySelector('.gantt-group-row .absolute.bg-bg-surface')) // white card container
  const out: any = {
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    cardPanel, cardRow1, cardRow2, ...rows,
  }
  if (cardRow1 && rows.track0) out.OFFSET_row1_vs_track0 = cardRow1.center - rows.track0.center
  if (cardRow2 && rows.track1) out.OFFSET_row2_vs_track1 = cardRow2.center - rows.track1.center
  return out
}

function Harness() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { flattenedData: flattenedRows, totalHeight } = useDataFlattener(
    [group], new Set(['p1']), 'projects',
    undefined, '', [], [], undefined, [], [],
    undefined, settings, false, false, new Set(),
    undefined, employees, undefined, undefined, undefined,
    null, false, new Set(), undefined, 'p1',
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
    expandedGroups: new Set(['p1']), toggleGroup() {},
    selectedEmployeeId: null, setSelectedEmployeeId() {}, selectedProjectId: 'p1', setSelectedProjectId() {},
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
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
