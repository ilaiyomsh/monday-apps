// Errors over time — stacked area, one band per app. The flat {_time,app,count}
// rows are pivoted into per-timestamp buckets. Stacked areas carry a 2px
// surface gap (stroke in the surface color) between bands.

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTheme } from '../../lib/theme';
import { APP_ORDER, appColor } from '../../lib/palette';
import type { ErrorsOverTimePoint } from '../../lib/types';
import { EmptyPanel, Legend, TooltipShell, fmt } from './shared';

function pivot(rows: ErrorsOverTimePoint[]): { data: Array<Record<string, number | string>>; apps: string[] } {
  const times = new Map<string, Record<string, number | string>>();
  const appsSeen = new Set<string>();
  for (const r of rows) {
    appsSeen.add(r.app);
    let bucket = times.get(r._time);
    if (!bucket) {
      bucket = { _time: r._time };
      times.set(r._time, bucket);
    }
    bucket[r.app] = (Number(bucket[r.app]) || 0) + r.count;
  }
  const known: string[] = APP_ORDER.filter((a) => appsSeen.has(a));
  const known_set = new Set<string>(APP_ORDER);
  const extra = [...appsSeen].filter((a) => !known_set.has(a));
  const apps = [...known, ...extra];
  const data = [...times.values()].sort((a, b) => Date.parse(String(a._time)) - Date.parse(String(b._time)));
  // Fill gaps with 0 so the stack is continuous.
  for (const d of data) for (const a of apps) if (d[a] == null) d[a] = 0;
  return { data, apps };
}

function tickLabel(iso: string, window: string): string {
  const d = new Date(iso);
  if (window === '24h') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ErrorsOverTime({ rows, window }: { rows: ErrorsOverTimePoint[]; window: string }) {
  const { chrome, isDark } = useTheme();
  if (!rows.length) return <EmptyPanel />;
  const { data, apps } = pivot(rows);

  return (
    <>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={chrome.grid} vertical={false} />
          <XAxis
            dataKey="_time"
            tickFormatter={(t) => tickLabel(String(t), window)}
            tick={{ fill: chrome.muted, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: chrome.baseline }}
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: chrome.muted, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={36}
            allowDecimals={false}
          />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload && payload.length ? (
                <TooltipShell
                  title={tickLabel(String(label), window)}
                  rows={payload
                    .filter((p) => Number(p.value) > 0)
                    .map((p) => ({ label: String(p.name), value: fmt(Number(p.value)), swatch: String(p.color) }))}
                />
              ) : null
            }
          />
          {apps.map((a) => (
            <Area
              key={a}
              type="monotone"
              dataKey={a}
              stackId="1"
              stroke={chrome.surface}
              strokeWidth={1}
              fill={appColor(a, isDark)}
              fillOpacity={0.9}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <Legend items={apps.map((a) => ({ label: a, color: appColor(a, isDark) }))} />
    </>
  );
}
