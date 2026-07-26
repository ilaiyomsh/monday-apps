import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Deterministic dataset so the KPIs are known. a & b both enter 07-06 (2 unique
// that day); a also 07-07 (1). Active days: 07-06=2, 07-07=1 => avg = 1.5.
// Total actions = 3 + 2 + 10 = 15.
const DOCS = {
  a: { '2026-07-06': { entered: 1, actions: 3 }, '2026-07-07': { entered: 1, actions: 2 } },
  b: { '2026-07-06': { entered: 1, actions: 10 } },
};

vi.mock('@generated/utils/usageMetrics.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadUsageData: vi.fn(() => Promise.resolve(DOCS)) };
});

import { UsageMetricsTab } from '../UsageMetricsTab.jsx';

describe('UsageMetricsTab (round265 smoke)', () => {
  it('shows the loader until data resolves, then the KPIs + metric/granularity toggles', async () => {
    const { container } = render(<UsageMetricsTab active />);
    // BrandLoader first (no KPIs yet).
    expect(container.querySelector('.kpiValue')).toBeNull();

    await waitFor(() => expect(container.querySelector('.kpiValue')).toBeTruthy());

    // avg daily users = 1.5 ; total actions = 15
    const kpis = [...container.querySelectorAll('.kpiValue')].map((el) => el.textContent);
    expect(kpis).toContain('1.5');
    expect(kpis).toContain('15');

    // both segmented groups render, entries + day selected by default
    expect(screen.getByText('כניסות (משתמשים ייחודיים)')).toBeTruthy();
    expect(screen.getByText('פעולות באפליקציה')).toBeTruthy();
    expect(screen.getByText('יום')).toBeTruthy();
    expect(screen.getByText('שבוע')).toBeTruthy();
    expect(screen.getByText('חודש')).toBeTruthy();
  });

  it('does not load (stays in loading state) until the tab is active', () => {
    const { container } = render(<UsageMetricsTab active={false} />);
    // inactive => never fetched => still loading, no KPIs.
    expect(container.querySelector('.kpiValue')).toBeNull();
  });

  it('lets the owner switch the metric toggle (actions becomes selected)', async () => {
    const { container } = render(<UsageMetricsTab active />);
    await waitFor(() => expect(container.querySelector('.kpiValue')).toBeTruthy());
    const actionsBtn = screen.getByText('פעולות באפליקציה');
    expect(actionsBtn.className).not.toContain('segOn');
    fireEvent.click(actionsBtn);
    expect(actionsBtn.className).toContain('segOn');
  });
});
