// Top errors — a ranked table (err_name / err_msg / count / apps affected).
// Clicking a row cross-filters the whole dashboard to that error name (seed
// mode re-aggregates; in live mode it highlights the active row). A table is
// also the required non-chart accessible view of the error data.

import { useTheme } from '../../lib/theme';
import type { TopError } from '../../lib/types';
import { EmptyPanel, fmt } from './shared';

interface Props {
  rows: TopError[];
  focusError: string | null;
  onFocus: (errName: string | null) => void;
}

export function TopErrorsTable({ rows, focusError, onFocus }: Props) {
  const { chrome } = useTheme();
  if (!rows.length) return <EmptyPanel />;
  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <div className="table-scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th>Error</th>
            <th>Message</th>
            <th className="num">Count</th>
            <th className="num">Apps</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const active = focusError === r.err_name;
            return (
              <tr
                key={`${r.err_name}|${r.err_msg}`}
                className={active ? 'tbl__row tbl__row--active' : 'tbl__row'}
                onClick={() => onFocus(active ? null : r.err_name)}
                title={active ? 'Clear cross-filter' : `Cross-filter to ${r.err_name}`}
              >
                <td>
                  <span className="tbl__name">{r.err_name}</span>
                  {r.err_code != null && r.err_code !== '' && <span className="tbl__code">{String(r.err_code)}</span>}
                </td>
                <td className="tbl__msg">{r.err_msg}</td>
                <td className="num">
                  <span className="tbl__bar" style={{ width: `${(r.count / max) * 100}%`, background: chrome.sequential }} />
                  <span className="tbl__val">{fmt(r.count)}</span>
                </td>
                <td className="num">{r.apps_affected}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
