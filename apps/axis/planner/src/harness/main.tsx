// DEV-ONLY Gantt geometry harness. Renders the REAL VirtualRowList /
// GroupHeaderRow / ProjectSummaryCard / TrackRow with mock data + the real CSS
// (index.css sets :root font-size:20px), OUTSIDE the monday iframe, so the
// focus-card ↔ track-row alignment can be measured with getBoundingClientRect.
// Not part of the prod build: vite build only crawls index.html; harness.html
// is served by the dev server only. See harness.html.
//
// Usage:  pnpm server   →   http://localhost:8301/harness.html
//         ?tracks=1|2|3  picks the allocation count (default 2).
//         window.__measure()  → { verdict:'PASS'|'FAIL', offsets, missing, rows }.
//
// The measurement is SELF-VERIFYING and FAILS LOUD: if a card row / track / panel
// cannot be found (e.g. a refactor renamed a class), verdict is 'FAIL' with the
// missing selectors listed — it never silently returns "aligned". This is the
// lesson from the #122→#174 saga: the old harness queried `.h-12`, #174 removed
// `.h-12`, so the offset check was silently skipped and every session read a
// FALSE pass. Selectors are now stable data-testids on the real components.
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

// ── scenario: N time-OVERLAPPING allocations → N packed tracks ───────────────
// ?tracks=1|2|3 (default 2). All start on the same day so they never share a
// track — packTasksIntoTracks yields exactly N tracks, exercising 1-, 2- and
// 3-row focused blocks (card content is always 2 rows; a 3-track block adds a
// blank card row over track 2 — this catches drift that only shows past row 2).
const TRACKS = Math.min(3, Math.max(1, Number(new URLSearchParams(location.search).get('tracks')) || 2))
const NAMES = ['עידו פיוטרקובסקי', 'עילי שלם', 'דנה כהן']
const COLORS = ['#00854d', '#0073ea', '#a25ddc']
const tasks: Task[] = Array.from({ length: TRACKS }, (_, i) => ({
  id: `t${i + 1}`, name: NAMES[i], projectId: 'p1', employeeId: `e${i + 1}`, role: 'מפתח',
  startDate: iso(2026, 3, 5), endDate: iso(2026, 7 + i, 20), hoursPerDay: 4,
  totalHours: 300, reportedHours: 200, color: COLORS[i],
}) as unknown as Task)

const group = {
  id: 'p1', name: `אסדן (HARNESS · tracks=${TRACKS})`, tasks, color: '#00854d',
  projectSummary: {
    totalPlannedHours: 350, totalReportedHours: 320, totalCost: 0, costPerHour: 0,
    managerName: 'עידו פיוטרקובסקי', projectType: 'שעות גמיש', projectTypeColor: '#e2a600', currency: '₪',
  },
} as unknown as Group

const employees = NAMES.map((name, i) => ({ id: `e${i + 1}`, name, role: 'מפתח', capabilities: [], allocationPercentage: 100 })) as any

const settings = {
  projectsBoardId: '1', projectTypeColumnId: 'type', projectManagerColumnId: 'pm',
  projectPlannedHoursColumnId: 'ph', reportedHoursColumnId: 'rh',
  workDays: [0, 1, 2, 3, 4], maxHoursPerDay: 8.5,
} as any

const projectMetrics = new Map([['p1', { planned: 350, allocated: 500, reported: 320 }]])

// ── measurement: card rows vs track rows, all via real getBoundingClientRect ──
// Stable data-testid selectors on the real components (summary-card-panel,
// summary-card-row1/2) — never fragile utility classes. Verdict is FAIL the
// moment any required node is missing, so a broken selector can NEVER read as 0.
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
  const cardPanel = box(document.querySelector('[data-testid="summary-card-panel"]'))
  const cardRow1 = box(document.querySelector('[data-testid="summary-card-row1"]')) // PM + type badge
  const cardRow2 = box(document.querySelector('[data-testid="summary-card-row2"]')) // hours metrics

  const missing: string[] = []
  if (!cardPanel) missing.push('summary-card-panel')
  if (!cardRow1) missing.push('summary-card-row1')
  if (!cardRow2) missing.push('summary-card-row2')
  if (!rows.track0) missing.push('track0')
  if (TRACKS >= 2 && !rows.track1) missing.push('track1')

  const offsets: Record<string, number | null> = {
    row1_vs_track0: cardRow1 && rows.track0 ? cardRow1.center - rows.track0.center : null,
    row2_vs_track1: cardRow2 && rows.track1 ? cardRow2.center - rows.track1.center : null,
  }
  // PASS only when nothing is missing AND every measurable offset is 0.
  const measured = Object.values(offsets).filter((v): v is number => v !== null)
  const verdict = missing.length === 0 && measured.every((v) => v === 0) ? 'PASS' : 'FAIL'

  return {
    verdict, tracks: TRACKS, missing,
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    offsets, cardPanel, cardRow1, cardRow2, ...rows,
  }
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
    const t = setTimeout(() => {
      const m = measure()
      const tag = m.verdict === 'PASS' ? '[HARNESS_MEASURE PASS]' : '[HARNESS_MEASURE FAIL]'
      console.log(tag + ' ' + JSON.stringify(m))
    }, 700)
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
