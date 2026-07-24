// Error drill-down drawer — slides in from the right when the operator clicks
// the magnifier on a Top-errors row. It lists the raw individual occurrences
// of that one error (live: from /api/telemetry/error-detail; seed: extracted
// from the bundled records) so the full per-event context lives in the
// dashboard, not in Axiom.
//
// Columns are DYNAMIC: whatever fields the records actually carry are shown
// (known ones ordered + labelled first, any extra enrichment appended), so the
// drawer surfaces everything Axiom stores without pinning the schema here.
// Closes on the × button, a backdrop click, or Escape; body scroll is locked
// while open.

import { useEffect } from 'react';
import type { ErrorOccurrence, TopError } from '../../lib/types';
import { fmt } from './shared';

interface Props {
  error: TopError | null;
  rows: ErrorOccurrence[];
  loading: boolean;
  errorMsg: string | null;
  seed: boolean;
  onClose: () => void;
}

// Fields we know how to label + the order we prefer them in. Any key present in
// the data but not listed here is appended after these (alphabetically).
const KNOWN: Array<[string, string]> = [
  ['_time', 'Time'],
  ['app', 'App'],
  ['acc', 'Account'],
  ['usr', 'User'],
  ['obj', 'Object'],
  ['board', 'Board'],
  ['level', 'Level'],
  ['err_code', 'Code'],
  ['tag', 'Tag'],
  ['message', 'Message'],
  ['err_msg', 'Detail'],
  ['total_ms', 'ms'],
  ['appVersion', 'Version'],
  ['environment', 'Env'],
];
const LABELS = new Map(KNOWN);
const PREFERRED = KNOWN.map(([k]) => k);
// Redundant in this view: kind is always 'error', err_name is the drawer title.
const HIDDEN = new Set(['kind', 'err_name']);

/** Order the columns actually present across the rows: known keys first, rest after. */
function columnsFor(rows: ErrorOccurrence[]): string[] {
  const present = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (HIDDEN.has(k)) continue;
      // Drop Axiom's internal system fields, but keep _time.
      if (k.startsWith('_') && k !== '_time') continue;
      present.add(k);
    }
  }
  const ordered = PREFERRED.filter((k) => present.has(k));
  const extra = [...present].filter((k) => !PREFERRED.includes(k)).sort();
  return [...ordered, ...extra];
}

function cell(key: string, value: unknown): string {
  if (value == null || value === '') return '—';
  if (key === '_time') {
    const t = Date.parse(String(value));
    if (!Number.isNaN(t)) return new Date(t).toLocaleString('en-GB');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ErrorDetailDrawer({ error, rows, loading, errorMsg, seed, onClose }: Props) {
  const open = error !== null;

  // Escape-to-close + body scroll lock, only while open.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!error) return null;

  const cols = columnsFor(rows);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Occurrences of ${error.err_name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer__head">
          <div className="drawer__titles">
            <h2 className="drawer__title">{error.err_name}</h2>
            <p className="drawer__meta">
              {fmt(error.count)} occurrence{error.count === 1 ? '' : 's'} · {error.apps_affected} app
              {error.apps_affected === 1 ? '' : 's'}
              {seed ? ' · demo seed' : ''}
            </p>
            {error.err_msg && <p className="drawer__msg">{error.err_msg}</p>}
          </div>
          <button className="drawer__close" onClick={onClose} aria-label="Close details" title="Close (Esc)">
            ✕
          </button>
        </header>

        <div className="drawer__body">
          {loading ? (
            <div className="drawer__state">Loading occurrences…</div>
          ) : errorMsg ? (
            <div className="drawer__state drawer__state--err">Couldn’t load occurrences: {errorMsg}</div>
          ) : rows.length === 0 ? (
            <div className="drawer__state">No individual occurrences in this window.</div>
          ) : (
            <div className="table-scroll">
              <table className="tbl tbl--dense">
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th key={c} className={c === 'err_code' || c === 'total_ms' ? 'num' : undefined}>
                        {LABELS.get(c) ?? c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {cols.map((c) => (
                        <td
                          key={c}
                          className={c === 'err_code' || c === 'total_ms' ? 'num' : undefined}
                          title={cell(c, r[c])}
                        >
                          {cell(c, r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
