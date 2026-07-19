// App × Account volume heatmap — a single-hue sequential encoding of total
// record volume per (app, account) cell. Rows are apps (fixed order), columns
// are accounts sorted by total volume. Near-zero recedes toward the surface;
// magnitude darkens along one hue (data-viz sequential rule).

import { useMemo } from 'react';
import { useTheme } from '../../lib/theme';
import { APP_ORDER } from '../../lib/palette';
import type { CrosstabRow } from '../../lib/types';
import { EmptyPanel, fmt } from './shared';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function Heatmap({ rows }: { rows: CrosstabRow[] }) {
  const { chrome, isDark } = useTheme();

  const { apps, accounts, cells, max } = useMemo(() => {
    const appSet = new Set<string>();
    const accTotals = new Map<string, number>();
    const cellMap = new Map<string, CrosstabRow>();
    let m = 0;
    for (const r of rows) {
      appSet.add(r.app);
      accTotals.set(r.acc, (accTotals.get(r.acc) || 0) + r.count);
      cellMap.set(`${r.app}|${r.acc}`, r);
      if (r.count > m) m = r.count;
    }
    const knownSet = new Set<string>(APP_ORDER);
    const appsOrdered: string[] = [
      ...APP_ORDER.filter((a) => appSet.has(a)),
      ...[...appSet].filter((a) => !knownSet.has(a)),
    ];
    const accountsOrdered = [...accTotals.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
    return { apps: appsOrdered, accounts: accountsOrdered, cells: cellMap, max: m || 1 };
  }, [rows]);

  if (!rows.length) return <EmptyPanel />;

  const [sr, sg, sb] = hexToRgb(chrome.sequential);

  return (
    <div className="heatmap-scroll">
      <table className="heatmap">
        <thead>
          <tr>
            <th className="heatmap__corner" />
            {accounts.map((acc) => (
              <th key={acc} className="heatmap__colhead" style={{ color: chrome.textSecondary }}>
                {acc}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {apps.map((app) => (
            <tr key={app}>
              <th className="heatmap__rowhead" style={{ color: chrome.textSecondary }}>
                {app}
              </th>
              {accounts.map((acc) => {
                const cell = cells.get(`${app}|${acc}`);
                const count = cell?.count ?? 0;
                const intensity = count ? 0.12 + 0.88 * (count / max) : 0;
                const bg = count ? `rgba(${sr},${sg},${sb},${intensity.toFixed(3)})` : chrome.surface;
                // Ink flips to white once the cell is dark enough.
                const ink = intensity > 0.55 ? (isDark ? '#ffffff' : '#ffffff') : chrome.textSecondary;
                return (
                  <td
                    key={acc}
                    className="heatmap__cell"
                    style={{ background: bg, color: ink, borderColor: chrome.grid }}
                    title={`${app} × ${acc}: ${fmt(count)} records (${fmt(cell?.errors ?? 0)} err, ${fmt(cell?.usage ?? 0)} usage)`}
                  >
                    {count ? fmt(count) : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
