// Error drill-down drawer — slides in from the right when the operator clicks
// the magnifier on a Top-errors row. It lists the raw individual occurrences
// of that one error (live: from /api/telemetry/error-detail; seed: extracted
// from the bundled records) so the full per-event context lives in the
// dashboard, not in Axiom.
//
// Columns are DYNAMIC: whatever fields the records carry are shown. Known
// app-errors fields (verified live 2026-07-25 via getschema — usr/obj/board,
// env, ver, corr, sess, path, level, …) get friendly labels + a sensible
// order; any unrecognised field is appended so the drawer never hides data.
// The stack trace (`stack1`) is NOT a column — it would be unreadable squeezed
// into a cell — so a row that has one gets an expander that reveals the full
// stack in a monospace block. Closes on ×, a backdrop click, or Escape; body
// scroll is locked while open.

import { Fragment, useEffect, useState } from 'react';
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

// Known columns → label, in display order (identity/context first, the longer
// message/detail last). Any field present in the data but absent here is shown
// after these with its raw key. Keys match the real app-errors schema.
const KNOWN: Array<[string, string]> = [
  ['_time', 'Time'],
  ['level', 'Level'],
  ['app', 'App'],
  ['acc', 'Account'],
  ['usr', 'User'],
  ['obj', 'Object'],
  ['board', 'Board'],
  ['env', 'Env'],
  ['ver', 'Version'],
  ['tag', 'Tag'],
  ['path', 'Path'],
  ['corr', 'Corr'],
  ['sess', 'Session'],
  ['step', 'Step'],
  ['ms', 'ms'],
  ['total_ms', 'total ms'],
  ['err_code', 'Code'], // seed dataset carries this; live app-errors does not
  ['message', 'Message'],
  ['err_msg', 'Detail'],
];
const LABELS = new Map(KNOWN);
const PREFERRED = KNOWN.map(([k]) => k);
const NUMERIC = new Set(['err_code', 'total_ms', 'ms', 'step']);
// Rendered via a per-row expander, never as a table column.
const STACK_KEY = 'stack1';
// Redundant in this view: kind is always 'error', err_name is the drawer title.
const HIDDEN = new Set(['kind', 'err_name', STACK_KEY]);

/** Order the columns present across the rows: known keys first, the rest after. */
export function columnsFor(rows: ErrorOccurrence[]): string[] {
  const present = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (HIDDEN.has(k)) continue;
      if (k.startsWith('_') && k !== '_time') continue; // drop Axiom system fields
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
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

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

  // Collapse every expanded stack when the selected error changes.
  useEffect(() => {
    setExpanded(new Set());
  }, [error?.err_name]);

  if (!error) return null;

  const cols = columnsFor(rows);
  const totalCols = cols.length + 1; // + the leading stack-toggle column
  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

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
                    <th className="act" aria-label="Stack trace" />
                    {cols.map((c) => (
                      <th key={c} className={NUMERIC.has(c) ? 'num' : undefined}>
                        {LABELS.get(c) ?? c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const stack = r[STACK_KEY];
                    const hasStack = stack != null && stack !== '';
                    const isOpen = expanded.has(i);
                    return (
                      <Fragment key={i}>
                        <tr className={hasStack ? 'occ-row occ-row--stack' : 'occ-row'}>
                          <td className="act">
                            {hasStack && (
                              <button
                                type="button"
                                className="drawer__stack-toggle"
                                aria-expanded={isOpen}
                                aria-label={isOpen ? 'Hide stack trace' : 'Show stack trace'}
                                title={isOpen ? 'Hide stack trace' : 'Show stack trace'}
                                onClick={() => toggle(i)}
                              >
                                {isOpen ? '▾' : '▸'}
                              </button>
                            )}
                          </td>
                          {cols.map((c) => (
                            <td key={c} className={NUMERIC.has(c) ? 'num' : undefined} title={cell(c, r[c])}>
                              {cell(c, r[c])}
                            </td>
                          ))}
                        </tr>
                        {hasStack && isOpen && (
                          <tr className="drawer__stack-row">
                            <td colSpan={totalCols} className="drawer__stack-cell">
                              <pre className="drawer__stack">{String(stack)}</pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
