// api_latency — a 100% stacked horizontal bar per app across the fast / ok /
// slow / very_slow buckets, using the reserved status palette. Each segment is
// separated by a 2px surface gap; legend pairs each status color with its label.

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTheme } from '../../lib/theme';
import { LATENCY_COLORS, LATENCY_LABELS, LATENCY_ORDER } from '../../lib/palette';
import type { ApiLatencyRow } from '../../lib/types';
import { EmptyPanel, Legend, TooltipShell, fmt } from './shared';

interface AppRow {
  app: string;
  total: number;
  fast: number;
  ok: number;
  slow: number;
  very_slow: number;
}

function pivot(rows: ApiLatencyRow[]): AppRow[] {
  const byApp = new Map<string, AppRow>();
  for (const r of rows) {
    let a = byApp.get(r.app);
    if (!a) {
      a = { app: r.app, total: 0, fast: 0, ok: 0, slow: 0, very_slow: 0 };
      byApp.set(r.app, a);
    }
    if ((LATENCY_ORDER as readonly string[]).includes(r.bucket)) {
      (a as unknown as Record<string, number>)[r.bucket] += r.count;
      a.total += r.count;
    }
  }
  return [...byApp.values()].sort((x, y) => y.total - x.total);
}

export function ApiLatency({ rows }: { rows: ApiLatencyRow[] }) {
  const { chrome } = useTheme();
  if (!rows.length) return <EmptyPanel />;
  const data = pivot(rows);
  const height = Math.max(160, data.length * 34 + 24);

  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" stackOffset="expand" margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
          <XAxis type="number" hide domain={[0, 1]} />
          <YAxis
            type="category"
            dataKey="app"
            width={128}
            tick={{ fill: chrome.textSecondary, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: chrome.baseline }}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const row = payload[0].payload as AppRow;
              return (
                <TooltipShell
                  title={row.app}
                  rows={LATENCY_ORDER.map((b) => ({
                    label: LATENCY_LABELS[b],
                    value: `${fmt(row[b])} (${row.total ? Math.round((100 * row[b]) / row.total) : 0}%)`,
                    swatch: LATENCY_COLORS[b],
                  }))}
                />
              );
            }}
          />
          {LATENCY_ORDER.map((b) => (
            <Bar key={b} dataKey={b} stackId="s" fill={LATENCY_COLORS[b]} stroke={chrome.surface} strokeWidth={1} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <Legend items={LATENCY_ORDER.map((b) => ({ label: LATENCY_LABELS[b], color: LATENCY_COLORS[b] }))} />
    </>
  );
}
