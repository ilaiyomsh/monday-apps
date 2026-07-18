// Global filter bar: app multi-select, account multi-select, kind multi-select,
// time-window presets, theme toggle, refresh, and the data-source + freshness
// stamp. Multi-selects are <details> dropdowns of checkboxes (no dependency).

import type { Filters, Kind, TimeWindow } from '../lib/types';
import { useTheme } from '../lib/theme';
import type { ThemeMode } from '../lib/theme';

const WINDOWS: TimeWindow[] = ['24h', '7d', '30d', '90d'];
const KINDS: Kind[] = ['error', 'usage', 'health'];
const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const active = selected.length;
  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
  };
  return (
    <details className="ms">
      <summary className="ms__summary">
        {label}
        <span className="ms__count">{active ? active : 'all'}</span>
      </summary>
      <div className="ms__menu">
        {active > 0 && (
          <button className="ms__clear" onClick={() => onChange([])} type="button">
            Clear
          </button>
        )}
        {options.map((opt) => (
          <label className="ms__opt" key={opt}>
            <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
            <span>{opt}</span>
          </label>
        ))}
        {!options.length && <div className="ms__empty">none</div>}
      </div>
    </details>
  );
}

interface Props {
  filters: Filters;
  onChange: (next: Partial<Filters>) => void;
  availableApps: string[];
  availableAccounts: string[];
  seed: boolean;
  generatedAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}

export function FilterBar({
  filters,
  onChange,
  availableApps,
  availableAccounts,
  seed,
  generatedAt,
  refreshing,
  onRefresh,
}: Props) {
  const { mode, setMode } = useTheme();
  const stamp = generatedAt ? new Date(generatedAt).toLocaleString() : '—';

  return (
    <div className="filterbar">
      <div className="filterbar__group">
        <span className="filterbar__seg" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              className={`seg__btn${filters.window === w ? ' seg__btn--on' : ''}`}
              onClick={() => onChange({ window: w })}
            >
              {w}
            </button>
          ))}
        </span>

        <MultiSelect label="Apps" options={availableApps} selected={filters.apps} onChange={(apps) => onChange({ apps })} />
        <MultiSelect
          label="Accounts"
          options={availableAccounts}
          selected={filters.accounts}
          onChange={(accounts) => onChange({ accounts })}
        />
        <MultiSelect
          label="Kinds"
          options={KINDS}
          selected={filters.kinds}
          onChange={(kinds) => onChange({ kinds: kinds as Kind[] })}
        />

        {filters.focusError && (
          <button className="chip chip--filter" type="button" onClick={() => onChange({ focusError: null })}>
            error: {filters.focusError} ✕
          </button>
        )}
      </div>

      <div className="filterbar__group filterbar__group--right">
        <span className={`badge ${seed ? 'badge--seed' : 'badge--live'}`}>{seed ? 'DEMO SEED' : 'LIVE'}</span>
        <span className="filterbar__stamp" title="Data generated at">
          {refreshing ? 'refreshing…' : stamp}
        </span>
        <button className="iconbtn" type="button" onClick={onRefresh} disabled={refreshing} title="Refresh">
          ↻
        </button>
        <span className="filterbar__seg" role="group" aria-label="Theme">
          {THEME_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={`seg__btn${mode === m ? ' seg__btn--on' : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'light' ? '☀' : m === 'dark' ? '☾' : 'auto'}
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
