# Time Reporting Dashboard — Feature Specification

**Version:** 1.0
**Status:** Draft
**Date:** February 2025
**Author:** [Your Name]
**Reviewers:** [Technical Lead, Product Owner, UX Lead]

---

## Document Information

| Field | Value |
|-------|-------|
| Document Title | Time Reporting Dashboard – Feature Specification |
| Version | 1.0 |
| Status | Draft |
| Target Release | [Sprint / Quarter] |

### Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Feb 2025 | [Author] | Initial draft |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Data Model](#2-data-model)
3. [Feature Specification](#3-feature-specification)
4. [UI / UX Specifications](#4-ui--ux-specifications)
5. [Technical Architecture](#5-technical-architecture)
6. [Data Integration](#6-data-integration)
7. [Edge Cases & Validation](#7-edge-cases--validation)
8. [Accessibility Requirements](#8-accessibility-requirements)
9. [Performance Requirements](#9-performance-requirements)
10. [Testing Plan](#10-testing-plan)
11. [Future Enhancements](#11-future-enhancements-v2-roadmap)
12. [Sign-Off](#12-sign-off)

---

## 1. Executive Summary

This document specifies the implementation of a Time Reporting Dashboard feature within the existing application. The dashboard provides real-time visibility into time entries through interactive filtering, aggregated statistics, and visual analytics (bar and pie charts).

The feature addresses the operational need for quick, actionable insights into how time is distributed across reporters, projects, billable vs. non-billable categories, and time periods — without requiring users to export data or build manual reports.

### 1.1 Goals

- Provide a single-view dashboard for time entry analysis with instant filtering
- Enable comparison across reporters, projects, and time periods
- Distinguish between billable (project-linked) and non-billable time with proper hierarchy
- Deliver a mobile-first, responsive interface consistent with the existing app design
- Support Hebrew (RTL) and English layouts natively

### 1.2 Non-Goals (Out of Scope)

- CRUD operations on time entries (view-only dashboard)
- Export to PDF / Excel (planned for v2)
- Budget or cost calculations
- User permissions / role-based access (inherits from host app)
- Notifications or alerts based on thresholds

---

## 2. Data Model

### 2.1 Time Entry Schema

Each time entry record contains the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID / String | Yes | Unique identifier for the time entry |
| `reporter` | String | Yes | Name or ID of the person reporting |
| `date` | Date (ISO 8601) | Yes | Date and time of the entry |
| `hours` | Number (decimal) | Yes | Duration in hours (e.g., 1.5) |
| `billable` | Boolean | Yes | Whether the entry is billable |
| `project` | String \| null | Conditional | Project name. Required if `billable=true`; `null` if `billable=false` |
| `category` | String | Yes | Sub-classification (see Section 2.2) |

### 2.2 Classification Hierarchy

The classification system follows a strict hierarchy where the `billable` flag determines both the available categories and whether a project is required:

| Billable Status | Project | Available Categories |
|-----------------|---------|----------------------|
| **Billable** (`true`) | Required – must reference a valid project | Self-work (עבודה עצמית), Internal meetings (פגישות פנימיות), External meetings (פגישות חיצוניות) |
| **Non-billable** (`false`) | `null` – no project association | Training (לימודים), Company meetings (פגישות חברה), Sales (מכירות), Development (פיתוח) |

> **Key constraint:** When filtering by a specific project, only billable entries are shown, since non-billable entries have no project association. The UI must clearly communicate this to the user.

---

## 3. Feature Specification

### 3.1 Dashboard Layout Overview

The dashboard is a single-page view composed of the following sections, rendered top to bottom:

| # | Section | Description |
|---|---------|-------------|
| 1 | Header | Dashboard title and branding |
| 2 | Filter Panel | All filter controls grouped in a collapsible card |
| 3 | Summary Statistics | KPI cards showing aggregated totals |
| 4 | Bar Chart | Time distribution over the selected period |
| 5 | Pie Chart(s) | Category breakdown for billable and/or non-billable hours |
| 6 | Footer | Record count indicator |

### 3.2 Filter Panel

The filter panel contains five independent controls. All filters are applied simultaneously (AND logic). Changing any filter triggers an immediate re-render of all downstream components (stats, bar chart, pie charts).

#### 3.2.1 Reporter Filter (Multi-Select Dropdown)

| Property | Specification |
|----------|---------------|
| Control Type | Dropdown with checkboxes (multi-select) |
| Default State | All reporters selected |
| Behavior | Click to open dropdown; each option has a checkbox. "All" checkbox at top toggles all on/off |
| Display When Closed | Shows "All reporters" when all selected, comma-separated names when ≤ 2 selected, or "N selected" when > 2 |
| Data Source | Distinct reporter values from the time entries dataset |
| Dismiss | Click outside dropdown or select an option |

#### 3.2.2 Project Filter (Multi-Select Dropdown)

| Property | Specification |
|----------|---------------|
| Control Type | Dropdown with checkboxes (multi-select) |
| Default State | All projects selected |
| Label | Labeled as "Projects (billable)" to indicate it only filters billable entries |
| Behavior | Same interaction pattern as Reporter filter |
| Impact on Non-Billable | When a subset of projects is selected, non-billable entries (which have no project) are excluded. When all projects are selected, non-billable entries are included. |
| Data Source | Distinct non-null project values from time entries |

#### 3.2.3 Billable Type Toggle

| Property | Specification |
|----------|---------------|
| Control Type | Segmented toggle (3 options) |
| Options | All \| Billable \| Non-billable |
| Default | All |
| Behavior | Single selection. Filters the dataset by billable status. Affects which pie charts are displayed (see Section 3.5). |

#### 3.2.4 Time Granularity Toggle

| Property | Specification |
|----------|---------------|
| Control Type | Segmented toggle (4 options) |
| Options | Day \| Week \| Month \| Year |
| Default | Week |
| Behavior | Controls the X-axis grouping of the bar chart. Does not affect filtering, only aggregation. |
| Week Calculation | ISO 8601 week numbering |

#### 3.2.5 Date Range Filter

| Property | Specification |
|----------|---------------|
| Control Type | Two date input fields (From / To) with native date picker |
| Default | Earliest to latest date in the dataset |
| Validation | "From" must be ≤ "To". Invalid ranges show no data with a message. |
| Behavior | Inclusive filtering: entries where `date ≥ from AND date ≤ to` |

### 3.3 Summary Statistics Cards

A horizontal row of KPI cards that update in real-time based on the active filters:

| Card | Calculation | Display | Conditional Visibility |
|------|-------------|---------|------------------------|
| Total Hours | Sum of all hours in filtered set | Decimal with 1 place (e.g., 24.5) | Always visible |
| Billable Hours | Sum of hours where `billable=true` | Decimal, accented in primary color | Hidden when toggle = Non-billable |
| Non-Billable Hours | Sum of hours where `billable=false` | Decimal, accented in gray | Hidden when toggle = Billable |
| Billable % | `billableHours / totalHours × 100` | ≥ 70%: green accent; < 70%: amber accent | Always visible |

### 3.4 Bar Chart

The bar chart provides a temporal view of total hours, grouped by the selected time granularity.

| Property | Specification |
|----------|---------------|
| Chart Type | Vertical bar chart (single series) |
| X-Axis | Time buckets based on granularity setting (day/week/month/year) |
| Y-Axis | Hours (numeric, auto-scaled) |
| Bar Content | Total hours per time bucket for the filtered dataset |
| Color | Single color (primary brand color) |
| Tooltip | On hover/tap: shows time period label and total hours |
| Empty State | Center-aligned message: "No data in selected range" |
| Title | Dynamic: "Hours by [granularity]" (e.g., "Hours by Week") |
| Responsive | Full width of container, fixed height 200px |

**Date formatting by granularity:**

| Granularity | X-Axis Label Format | Example |
|-------------|---------------------|---------|
| Day | DD/MM | 05/02 |
| Week | W##'YY | W06'25 |
| Month | MM/YY | 02/25 |
| Year | YYYY | 2025 |

### 3.5 Pie Charts

The dashboard displays up to two donut-style pie charts, depending on the billable type filter:

| Billable Filter | Charts Displayed |
|-----------------|------------------|
| All | Both: Billable Categories + Non-Billable Categories |
| Billable | Billable Categories only |
| Non-billable | Non-Billable Categories only |

#### 3.5.1 Billable Categories Pie

| Property | Specification |
|----------|---------------|
| Title | "Billable hours by category" |
| Segments | Self-work, Internal meetings, External meetings |
| Colors | Primary palette (shades of indigo) |
| Inner Radius | Donut style (inner radius ~55% of outer) |
| Labels | Percentage shown inside segments ≥ 8% |
| Legend | Below chart with color dot, name, and total hours |
| Tooltip | Category name, hours, and percentage of total |
| Empty State | "No billable hours" |

#### 3.5.2 Non-Billable Categories Pie

| Property | Specification |
|----------|---------------|
| Title | "Non-billable hours by category" |
| Segments | Training, Company meetings, Sales, Development |
| Colors | Secondary palette (amber, orange, green, gray) |
| Special Empty State | When projects are filtered: "Filtered by project – only billable hours shown" |

---

## 4. UI / UX Specifications

### 4.1 Layout & Responsiveness

| Property | Specification |
|----------|---------------|
| Primary Layout | Single-column, vertical scroll |
| Max Width | 480px (mobile-optimized), centered on larger screens |
| Direction | RTL (right-to-left) as default; LTR toggle if needed |
| Padding | 16px horizontal, 20px top |
| Font Stack | `Noto Sans Hebrew, SF Pro Display, system-ui, sans-serif` |

### 4.2 Theme & Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#0F172A` | Page background |
| `--bg-card` | `#1E293B` (44% opacity) | Card backgrounds |
| `--bg-input` | `#1E293B` | Input fields, dropdowns, toggles |
| `--text-primary` | `#E2E8F0` | Primary text |
| `--text-secondary` | `#94A3B8` | Labels, secondary text |
| `--text-muted` | `#64748B` | Stat labels, axis ticks |
| `--accent` | `#6366F1` | Primary accent (active states, billable bars) |
| `--border` | `#334155` | Card borders, dropdown borders |
| `--success` | `#10B981` | Billable % ≥ 70% |
| `--warning` | `#F59E0B` | Billable % < 70% |

### 4.3 Interaction Patterns

**Dropdown multi-select:**
- Tap to open; displays options with checkboxes
- Tap outside to dismiss (dropdown remains open during selection)
- "All" checkbox at top toggles between select-all and deselect-all
- Summary text updates immediately as selections change
- Z-index management: dropdown overlays content below

**Segmented toggles:**
- Single selection only; active segment highlighted with accent color
- All segments equal width within container
- Transition animation on segment change (0.2s)

**Charts:**
- Tap/hover on bars or pie segments shows tooltip
- All chart re-renders triggered by filter state changes (no manual refresh)
- Empty states show centered text message in muted color

---

## 5. Technical Architecture

### 5.1 Component Tree

The dashboard is implemented as a single React component with the following internal structure:

| Component / Hook | Responsibility |
|------------------|----------------|
| `Dashboard` (root) | State management, filter logic, layout |
| `DropdownMulti` | Reusable multi-select dropdown with checkboxes |
| `Toggle` | Segmented toggle control (billable type, granularity) |
| `Stat` | Individual KPI stat card |
| `MiniPie` | Reusable pie chart wrapper with legend and empty state |
| `BarTip` / `PieTip` | Custom tooltip components for charts |
| `useMemo(filtered)` | Memoized filtered dataset based on all active filters |
| `useMemo(barData)` | Memoized bar chart data grouped by granularity |
| `useMemo(pieBill / pieNon)` | Memoized pie chart data for each billable type |

### 5.2 State Management

| State Variable | Type | Default | Description |
|----------------|------|---------|-------------|
| `selReporters` | `string[]` | All reporters | Selected reporters |
| `selProjects` | `string[]` | All projects | Selected projects |
| `dateFrom` | `string` (date) | Min date in data | Start of date range |
| `dateTo` | `string` (date) | Max date in data | End of date range |
| `billFilter` | `enum` | `both` | Billable type: `both` \| `billable` \| `nonBillable` |
| `granularity` | `enum` | `week` | Time grouping: `day` \| `week` \| `month` \| `year` |

### 5.3 Filter Logic (Pseudocode)

All filters are combined with AND logic. The filtering pipeline executes on every state change:

1. **Reporter filter:** If `selReporters` is a subset, exclude entries where `reporter` is not in `selReporters`
2. **Project filter:** For billable entries, if `selProjects` is a subset, include only matching projects. If `selProjects` is empty, exclude all billable entries. Non-billable entries: included when all projects are selected, excluded otherwise.
3. **Billable type filter:** If "billable", exclude non-billable entries. If "nonBillable", exclude billable entries.
4. **Date range filter:** Include entries where `date ≥ dateFrom AND date ≤ dateTo`

### 5.4 Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ≥ 18.x | UI framework |
| `recharts` | ≥ 2.x | Charting library (BarChart, PieChart) |
| Host app router | N/A | Dashboard mounted as a route within the existing app |

---

## 6. Data Integration

### 6.1 API Requirements

The dashboard requires a single API endpoint to retrieve time entries:

| Property | Specification |
|----------|---------------|
| Endpoint | `GET /api/time-entries` |
| Auth | Inherits from host application session/token |
| Query Params (optional) | `from` (date), `to` (date), `reporter` (string), `project` (string) |
| Response | JSON array of TimeEntry objects (see Section 2.1) |
| Pagination | If > 10,000 records, implement cursor-based pagination |
| Caching | Client-side cache with 5-minute TTL recommended |

### 6.2 Data Flow

1. On mount: fetch all time entries for the visible date range
2. Store raw data in component state
3. All filtering, grouping, and aggregation happens client-side
4. Filter changes do not trigger new API calls (data is pre-loaded)
5. Date range changes beyond cached data trigger a new fetch

---

## 7. Edge Cases & Validation

| Scenario | Expected Behavior |
|----------|-------------------|
| No reporters selected | Show empty state for all charts; stats show 0 |
| No projects selected | Exclude all billable entries; show only non-billable (if filter allows) |
| Date range with no data | All sections show "No data" empty states |
| From date > To date | Treat as empty range; show no data message |
| Single day selected | Bar chart shows one bar; granularity auto-adjusts or shows "day" |
| Very large dataset (>5000) | Ensure `useMemo` prevents unnecessary recalculations; consider virtualization if needed |
| Billable entry with null project | Data validation error – reject at API level |
| Non-billable entry with project | Data validation error – reject at API level |
| Category not in allowed list | Display as-is but flag for data cleanup |
| RTL overflow in dropdowns | Ensure dropdown respects container boundaries with proper z-index |

---

## 8. Accessibility Requirements

| Requirement | Implementation |
|-------------|----------------|
| Keyboard navigation | All controls reachable via Tab; toggles respond to Enter/Space |
| Screen reader labels | `aria-label` on dropdowns, toggles, and chart containers |
| Color contrast | All text meets WCAG AA ratio (≥ 4.5:1) against backgrounds |
| Chart alternatives | `aria-label` on chart containers with summary text; stat cards provide textual totals |
| Focus indicators | Visible focus ring on all interactive elements |
| RTL support | Full `dir=rtl` propagation; no hardcoded left/right positioning |

---

## 9. Performance Requirements

| Metric | Target |
|--------|--------|
| Initial render (with data) | < 500ms |
| Filter change re-render | < 100ms |
| Chart animation | < 300ms transition |
| Bundle size (dashboard only) | < 50KB gzipped (excluding recharts) |
| Memory (10K entries) | < 20MB heap |

---

## 10. Testing Plan

### 10.1 Unit Tests

- Filter logic: verify AND combination of all filters produces correct subset
- Grouping functions: verify `groupKey` and `groupLabel` for all granularities
- ISO week calculation: boundary cases (year transitions, leap years)
- Statistics calculations: totals, billable %, edge cases (0 hours, all billable, all non-billable)
- Pie data generation: correct category aggregation and sorting

### 10.2 Integration Tests

- API data fetch and state hydration
- Filter changes propagate to charts and stats correctly
- Dropdown open/close behavior and multi-select state
- Date range validation and boundary handling

### 10.3 Visual / E2E Tests

- Mobile viewport (375px, 480px): full flow with all filter combinations
- RTL layout: no overflow, correct alignment
- Chart rendering: bars and pie segments match filtered data
- Empty states: all components show correct messages
- Tooltip display on hover/tap for both chart types

---

## 11. Future Enhancements (v2 Roadmap)

| Feature | Priority | Description |
|---------|----------|-------------|
| Export to PDF/Excel | High | Download filtered data and charts as a formatted report |
| Comparison Mode | High | Side-by-side grouped bar chart comparing selected projects or reporters |
| Saved Filters | Medium | Save and recall frequently used filter configurations |
| Drill-Down Tables | Medium | Click chart segments to see underlying time entries in a table view |
| Budget Overlay | Medium | Overlay budgeted hours on bar chart for variance analysis |
| Custom Date Presets | Low | Quick buttons: This Week, This Month, Last 30 Days, This Quarter |
| Dark/Light Theme Toggle | Low | User preference for theme; currently dark only |

---

## 12. Sign-Off

By signing below, stakeholders confirm they have reviewed this specification and approve it for implementation.

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Product Owner | | | |
| Technical Lead | | | |
| UX / Design Lead | | | |
| QA Lead | | | |
