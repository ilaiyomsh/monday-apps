import React from 'react';

// Deterministic bar geometry per row (left%, width%) so the skeleton looks like
// a populated Gantt without random reflow between renders.
const SKELETON_BARS: Array<{ left: number; width: number }> = [
  { left: 8, width: 34 },
  { left: 20, width: 28 },
  { left: 4, width: 46 },
  { left: 30, width: 22 },
  { left: 14, width: 38 },
  { left: 24, width: 30 },
  { left: 10, width: 26 },
  { left: 36, width: 24 },
  { left: 6, width: 42 },
  { left: 18, width: 32 },
];

/**
 * GanttSkeleton — a lightweight, data-free placeholder that mimics the Gantt
 * layout (sticky sidebar column + timeline rows with bars). Shown after the
 * initial branded loader so the chart "appears" while the data is still in
 * flight, instead of staring at a spinner for the whole platform boot + fetch.
 * Pure divs + Tailwind pulse — no data, no heavy deps.
 */
export const GanttSkeleton: React.FC = () => {
  return (
    // dir="ltr": the Gantt is structurally left-to-right (sidebar column on the
    // left, timeline on the right) regardless of UI locale. Without this the
    // skeleton inherits the page RTL and the flex rows flip (sidebar on right).
    <div dir="ltr" className="w-full h-full bg-bg-surface rounded-xl shadow-2xl border border-border-subtle overflow-hidden flex flex-col animate-pulse">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-faint flex-shrink-0">
        <div className="h-7 w-40 rounded-md bg-bg-emphasis" />
        <div className="flex gap-2">
          <div className="h-7 w-24 rounded-md bg-bg-emphasis" />
          <div className="h-7 w-28 rounded-md bg-bg-emphasis" />
        </div>
      </div>

      {/* Timeline header */}
      <div className="flex border-b border-border-subtle flex-shrink-0">
        <div className="w-[320px] min-w-[320px] border-r border-border-subtle h-12 bg-bg-app flex items-center px-4">
          <div className="h-4 w-32 rounded bg-bg-emphasis" />
        </div>
        <div className="flex-1 h-12 flex">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex-1 border-r border-border-faint flex items-center justify-center">
              <div className="h-3 w-12 rounded bg-bg-emphasis" />
            </div>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-hidden">
        {SKELETON_BARS.map((bar, i) => (
          <div key={i} className="flex h-12 border-b border-border-faint">
            {/* Sidebar cell */}
            <div className="w-[320px] min-w-[320px] border-r border-border-subtle bg-bg-app flex items-center px-4">
              <div className="h-4 rounded bg-bg-emphasis" style={{ width: `${40 + ((i * 7) % 45)}%` }} />
            </div>
            {/* Timeline cell with a bar */}
            <div className="flex-1 relative">
              <div
                className="absolute top-1/2 -translate-y-1/2 h-7 rounded-full bg-bg-emphasis"
                style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
