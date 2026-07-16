import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '../../../i18n';
import { CONFIG } from '../../../utils/constants';
import { GanttContext } from '../GanttContext';
import { SettingsContext } from '../../../contexts/SettingsContext';
import { ProjectSummaryCard } from '../ProjectSummaryCard';

// Regression guard for the 2026-07-15 rem/px drift bug (see BUGS.md). The focus
// card's rows MUST carry an explicit CONFIG.rowHeight px height so they line up
// 1:1 with the px-based Gantt track grid. A Tailwind rem height (h-12) renders
// 60px at the app's 20px root and drifts the card off the bars, compounding per
// row. jsdom applies no Tailwind CSS, so if a row reverts to a rem class its
// inline `style.height` becomes '' and this test fails — that's the guard.

const summary = {
  totalPlannedHours: 100, totalReportedHours: 80, totalCost: 0, costPerHour: 0,
  managerName: 'PM', projectType: 'Type', projectTypeColor: '#e2a600', currency: '₪',
} as any;

const ganttMock: any = {
  availableProjectTypes: [{ label: 'Type', color: '#e2a600' }],
  patchProjectData: vi.fn(),
  projectMetrics: new Map([['p1', { planned: 100, allocated: 120, reported: 80 }]]),
  projectMetricsReady: true,
  settings: { projectsBoardId: '1', projectTypeColumnId: 'type', projectManagerColumnId: 'pm', projectPlannedHoursColumnId: 'ph' },
};
const settingsMock: any = {
  settings: ganttMock.settings, updateSettings: vi.fn(), loading: false,
  isConfigured: true, error: null, errorKind: null, refresh: vi.fn(),
};

const renderCard = () => render(
  <SettingsContext.Provider value={settingsMock}>
    <GanttContext.Provider value={ganttMock}>
      <ProjectSummaryCard summary={summary} projectId="p1" employees={[]} onPMUpdate={() => {}} />
    </GanttContext.Provider>
  </SettingsContext.Provider>
);

describe('ProjectSummaryCard row height — px grid alignment', () => {
  it('the PM/type row and the hours row are each exactly CONFIG.rowHeight px (not a rem class)', () => {
    const { container } = renderCard();
    const px = `${CONFIG.rowHeight}px`;
    const pmRow = container.querySelector('.justify-between') as HTMLElement | null;      // row 1
    const metricsRow = container.querySelector('.items-stretch') as HTMLElement | null;   // row 2
    expect(pmRow).toBeTruthy();
    expect(metricsRow).toBeTruthy();
    expect(pmRow!.style.height).toBe(px);
    expect(metricsRow!.style.height).toBe(px);
  });
});
