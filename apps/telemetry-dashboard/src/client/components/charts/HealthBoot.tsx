// Boot health — a p50→p95 dot-range (dumbbell) per app. Built as plain HTML so
// the two dots and the connecting track are precisely placed and directly
// labeled. p50 = sequential hue, p95 = warning status (paired with its label).

import { useTheme } from '../../lib/theme';
import { STATUS } from '../../lib/palette';
import type { HealthBoot as HealthBootRow } from '../../lib/types';
import { EmptyPanel, Legend, fmt } from './shared';

export function HealthBoot({ rows }: { rows: HealthBootRow[] }) {
  const { chrome } = useTheme();
  if (!rows.length) return <EmptyPanel />;
  const max = Math.max(...rows.map((r) => r.p95_ms), 1);

  return (
    <>
      <div className="dumbbell">
        {rows.map((r) => {
          const p50pct = (r.p50_ms / max) * 100;
          const p95pct = (r.p95_ms / max) * 100;
          return (
            <div className="dumbbell__row" key={r.app}>
              <div className="dumbbell__label" style={{ color: chrome.textSecondary }}>
                {r.app}
                <span className="dumbbell__samples" style={{ color: chrome.muted }}>
                  n={fmt(r.samples)}
                </span>
              </div>
              <div className="dumbbell__track">
                <span className="dumbbell__line" style={{ left: `${p50pct}%`, width: `${Math.max(0, p95pct - p50pct)}%`, background: chrome.baseline }} />
                <span className="dumbbell__dot" style={{ left: `${p50pct}%`, background: chrome.sequential }} title={`p50 ${fmt(r.p50_ms)} ms`} />
                <span className="dumbbell__dot" style={{ left: `${p95pct}%`, background: STATUS.warning }} title={`p95 ${fmt(r.p95_ms)} ms`} />
                <span className="dumbbell__val" style={{ left: `${p95pct}%`, color: chrome.muted }}>
                  {fmt(r.p95_ms)}ms
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <Legend
        items={[
          { label: 'p50 (median)', color: chrome.sequential },
          { label: 'p95', color: STATUS.warning },
        ]}
      />
    </>
  );
}
