// Top usage events — one bar per event message, colored by event_kind
// (view_open vs track). Two-hue categorical; legend pairs color with label.

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTheme } from '../../lib/theme';
import type { UsageEvent } from '../../lib/types';
import { EmptyPanel, Legend, TooltipShell, fmt } from './shared';

const KIND_COLOR = {
  light: { view_open: '#2a78d6', track: '#1baf7a' },
  dark: { view_open: '#3987e5', track: '#199e70' },
};

export function TopUsageEvents({ rows }: { rows: UsageEvent[] }) {
  const { chrome, isDark } = useTheme();
  if (!rows.length) return <EmptyPanel />;
  const colors = isDark ? KIND_COLOR.dark : KIND_COLOR.light;
  const data = [...rows].sort((a, b) => b.count - a.count);
  const height = Math.max(160, data.length * 28 + 24);

  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 46, bottom: 4, left: 8 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="message"
            width={150}
            tick={{ fill: chrome.textSecondary, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: chrome.baseline }}
          />
          <Tooltip
            cursor={{ fill: chrome.grid, opacity: 0.4 }}
            content={({ active, payload }) =>
              active && payload && payload.length ? (
                <TooltipShell
                  title={String(payload[0].payload.message)}
                  rows={[
                    { label: 'Kind', value: String(payload[0].payload.event_kind) },
                    { label: 'Count', value: fmt(Number(payload[0].value)), swatch: colors[payload[0].payload.event_kind as 'view_open' | 'track'] },
                  ]}
                />
              ) : null
            }
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {data.map((d) => (
              <Cell key={d.message} fill={colors[d.event_kind]} />
            ))}
            <LabelList dataKey="count" position="right" fill={chrome.textSecondary} fontSize={11} formatter={(v) => fmt(Number(v))} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <Legend
        items={[
          { label: 'view_open', color: colors.view_open },
          { label: 'track', color: colors.track },
        ]}
      />
    </>
  );
}
