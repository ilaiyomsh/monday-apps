// Errors over time — stacked area, one band per app. The flat {_time,app,count}
// rows are pivoted into per-timestamp buckets. Time always reads LEFT→RIGHT
// (earliest → latest): buckets are sorted ascending and the axis is never
// reversed, so the direction holds even when the host document is RTL.

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMemo } from 'react';
import { useTheme } from '../../lib/theme';
import { APP_ORDER, appColor } from '../../lib/palette';
import type { ErrorsOverTimePoint } from '../../lib/types';
import { EmptyPanel, Legend, TooltipShell, compact, fmt } from './shared';

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

// Choose which bucket timestamps carry a LABEL, so each label shows once and
// they don't collide: 24h → one per hour, otherwise → one per calendar day.
// The candidates are then thinned to ~8 evenly-spaced labels — this removes the
// "Jul 18 Jul 18" duplicate-day crowding of the raw per-bucket axis.
function chooseTicks(data: Array<Record<string, number | string>>, window: string): string[] {
  const keyOf = (iso: string) => (window === '24h' ? iso.slice(0, 13) : iso.slice(0, 10));
  const seen = new Set<string>();
  const firstPerGroup: string[] = [];
  for (const d of data) {
    const iso = String(d._time);
    const k = keyOf(iso);
    if (!seen.has(k)) {
      seen.add(k);
      firstPerGroup.push(iso);
    }
  }
  // Fewer labels → each date/month gets real breathing room and none is
  // "swallowed" by its neighbour (owner: X-axis month names were unreadable).
  const MAX = 6;
  if (firstPerGroup.length <= MAX) return firstPerGroup;
  const step = Math.ceil(firstPerGroup.length / MAX);
  return firstPerGroup.filter((_, i) => i % step === 0);
}

export function ErrorsOverTime({ rows, window }: { rows: ErrorsOverTimePoint[]; window: string }) {
  const { chrome, isDark } = useTheme();
  const { data, apps } = useMemo(() => pivot(rows), [rows]);
  const ticks = useMemo(() => chooseTicks(data, window), [data, window]);
  if (!rows.length) return <EmptyPanel />;

  return (
    <>
      <ResponsiveContainer width="100%" height={288}>
        {/* Roomier gutters so neither axis' labels get clipped by the SVG edge:
            the last X date-label centers on the right-most point (right margin
            catches its overflow) and the Y column has room for its ticks + the
            rotated caption. */}
        <AreaChart data={data} margin={{ top: 8, right: 24, bottom: 16, left: 8 }}>
          <defs>
            {apps.map((a) => {
              const c = appColor(a, isDark);
              return (
                <linearGradient key={a} id={`eot-${a}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c} stopOpacity={0.96} />
                  <stop offset="100%" stopColor={c} stopOpacity={0.62} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid stroke={chrome.grid} vertical={false} />
          <XAxis
            dataKey="_time"
            type="category"
            reversed={false}
            ticks={ticks}
            tickFormatter={(t) => tickLabel(String(t), window)}
            tick={{ fill: chrome.textSecondary, fontSize: 13, fontWeight: 600 }}
            tickLine={{ stroke: chrome.baseline }}
            tickMargin={10}
            height={40}
            axisLine={{ stroke: chrome.baseline }}
            interval="preserveStartEnd"
            // Inset the plot from both ends so the first/last date labels have
            // room to center under their points instead of being sliced off.
            padding={{ left: 16, right: 16 }}
          />
          <YAxis
            tick={{ fill: chrome.textSecondary, fontSize: 14, fontWeight: 600 }}
            tickLine={false}
            axisLine={false}
            width={54}
            tickMargin={4}
            allowDecimals={false}
            // Compact ticks (1.2K) keep the number column narrow so large counts
            // don't spill past the gutter and get cut. The rotated "errors"
            // caption was dropped: it sat ON TOP of the middle tick number
            // ("swallowed" it), and the card title already says "Errors over time".
            tickFormatter={(v) => compact(Number(v))}
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
              fill={`url(#eot-${a})`}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <Legend items={apps.map((a) => ({ label: a, color: appColor(a, isDark) }))} />
    </>
  );
}
