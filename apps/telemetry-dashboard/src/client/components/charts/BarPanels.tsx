// Sorted horizontal-bar panels. Two flavors:
//  - AppBar: one bar per app, colored by the app's fixed categorical slot
//    (identity), used for errors-by-app and usage-by-app.
//  - AccountBar: one bar per account, a single sequential hue (magnitude),
//    top-15 with the remainder folded into "Other".
// Both: sorted desc, 4px rounded data-ends on the baseline, direct value labels.

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTheme } from '../../lib/theme';
import { appColor } from '../../lib/palette';
import type { CountByApp, CountByAccount } from '../../lib/types';
import { EmptyPanel, TooltipShell, fmt } from './shared';

const ROW_H = 30;

export function AppBar({ data, onSelect }: { data: CountByApp[]; onSelect?: (app: string) => void }) {
  const { chrome, isDark } = useTheme();
  const handleClick = (state: unknown) => {
    const p = state as { app?: string; payload?: { app?: string } };
    const app = p?.payload?.app ?? p?.app;
    if (app) onSelect?.(app);
  };
  if (!data.length) return <EmptyPanel />;
  const height = Math.max(140, data.length * ROW_H + 24);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 8 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="app"
          width={128}
          tick={{ fill: chrome.textSecondary, fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: chrome.baseline }}
        />
        <Tooltip
          cursor={{ fill: chrome.grid, opacity: 0.4 }}
          content={({ active, payload }) =>
            active && payload && payload.length ? (
              <TooltipShell
                title={String(payload[0].payload.app)}
                rows={[{ label: 'Count', value: fmt(Number(payload[0].value)), swatch: appColor(String(payload[0].payload.app), isDark) }]}
              />
            ) : null
          }
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} onClick={onSelect ? handleClick : undefined} cursor={onSelect ? 'pointer' : undefined}>
          {data.map((d) => (
            <Cell key={d.app} fill={appColor(d.app, isDark)} />
          ))}
          <LabelList dataKey="count" position="right" fill={chrome.textSecondary} fontSize={11} formatter={(v) => fmt(Number(v))} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AccountBar({ data, onSelect }: { data: CountByAccount[]; onSelect?: (acc: string) => void }) {
  const { chrome } = useTheme();
  const handleClick = (state: unknown) => {
    const p = state as { acc?: string; payload?: { acc?: string } };
    const acc = p?.payload?.acc ?? p?.acc;
    if (acc && acc !== 'Other') onSelect?.(acc);
  };
  if (!data.length) return <EmptyPanel />;

  // top-15 + Other
  const sorted = [...data].sort((a, b) => b.count - a.count);
  let rows = sorted;
  if (sorted.length > 15) {
    const head = sorted.slice(0, 15);
    const otherCount = sorted.slice(15).reduce((s, r) => s + r.count, 0);
    rows = [...head, { acc: 'Other', count: otherCount }];
  }
  const height = Math.max(140, rows.length * ROW_H + 24);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 8 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="acc"
          width={92}
          tick={{ fill: chrome.textSecondary, fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: chrome.baseline }}
        />
        <Tooltip
          cursor={{ fill: chrome.grid, opacity: 0.4 }}
          content={({ active, payload }) =>
            active && payload && payload.length ? (
              <TooltipShell
                title={String(payload[0].payload.acc)}
                rows={[{ label: 'Count', value: fmt(Number(payload[0].value)), swatch: chrome.sequential }]}
              />
            ) : null
          }
        />
        <Bar
          dataKey="count"
          radius={[0, 4, 4, 0]}
          onClick={onSelect ? handleClick : undefined}
          cursor={onSelect ? 'pointer' : undefined}
        >
          {rows.map((d) => (
            <Cell key={d.acc} fill={d.acc === 'Other' ? chrome.muted : chrome.sequential} />
          ))}
          <LabelList dataKey="count" position="right" fill={chrome.textSecondary} fontSize={11} formatter={(v) => fmt(Number(v))} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
