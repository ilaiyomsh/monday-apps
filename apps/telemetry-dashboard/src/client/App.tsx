// The dashboard shell — filter state, data source (live vs seed), and the
// 12-panel grid. Live data arrives from the authenticated /api/telemetry
// endpoint; a { seed:true } response or any failure falls back to the bundled
// synthetic seed, which is fully re-filterable client-side so the app is a
// working demo before Axiom is wired up.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilterBar } from './components/FilterBar';
import { KpiRow } from './components/KpiRow';
import { ChartCard } from './components/ChartCard';
import { AppBar, AccountBar } from './components/charts/BarPanels';
import { ErrorsOverTime } from './components/charts/ErrorsOverTime';
import { TopErrorsTable } from './components/charts/TopErrorsTable';
import { ErrorDetailDrawer } from './components/charts/ErrorDetailDrawer';
import { TopUsageEvents } from './components/charts/TopUsageEvents';
import { HealthBoot } from './components/charts/HealthBoot';
import { ApiLatency } from './components/charts/ApiLatency';
import { Heatmap } from './components/charts/Heatmap';
import { SettingsView } from './components/SettingsView';
import { fetchTelemetry, fetchErrorDetail } from './lib/api';
import { aggregateAll, applyLivePresentationFilters, errorOccurrences } from './lib/aggregate';
import { SEED_RECORDS, SEED_NOW } from './data/seed';
import { APP_ORDER } from './lib/palette';
import type { ErrorOccurrence, Filters, TelemetryPanels, TelemetryPayload, TopError } from './lib/types';

type Source =
  | { kind: 'seed' }
  | { kind: 'live'; payload: TelemetryPayload };

const DEFAULT_FILTERS: Filters = {
  window: '7d',
  apps: [],
  accounts: [],
  kinds: [],
  focusError: null,
};

type View = 'dashboard' | 'settings';

export function App() {
  const [view, setView] = useState<View>('dashboard');
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [source, setSource] = useState<Source>({ kind: 'seed' });
  const [refreshing, setRefreshing] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  // Error drill-down drawer: the selected error + its raw occurrences.
  const [detailError, setDetailError] = useState<TopError | null>(null);
  const [detailRows, setDetailRows] = useState<ErrorOccurrence[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErrorMsg, setDetailErrorMsg] = useState<string | null>(null);

  const load = useCallback(async (window: Filters['window']) => {
    setRefreshing(true);
    const res = await fetchTelemetry(window);
    if (res.payload) {
      setSource({ kind: 'live', payload: res.payload });
      setNotice(null);
    } else {
      setSource({ kind: 'seed' });
      setNotice(
        res.seed
          ? 'Axiom is not configured on the server — showing the synthetic demo seed.'
          : res.error
            ? 'Live telemetry unavailable (open this from inside monday) — showing the synthetic demo seed.'
            : null
      );
    }
    setRefreshing(false);
  }, []);

  // Load on mount and whenever the time window changes (live data is
  // window-scoped server-side; the seed re-slices client-side).
  useEffect(() => {
    void load(filters.window);
  }, [filters.window, load]);

  const updateFilters = useCallback((patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  // Open the drawer for one error. In seed mode the raw records are already in
  // the browser, so we drill down synchronously; in live mode we fetch the
  // occurrences from the access-controlled endpoint.
  const openDetail = useCallback(
    (err: TopError) => {
      setDetailError(err);
      setDetailErrorMsg(null);
      if (source.kind === 'seed') {
        setDetailRows(errorOccurrences(SEED_RECORDS, err.err_name, filters, SEED_NOW) as ErrorOccurrence[]);
        setDetailLoading(false);
        return;
      }
      setDetailRows([]);
      setDetailLoading(true);
      void (async () => {
        const res = await fetchErrorDetail(filters.window, err.err_name);
        setDetailRows(res.rows);
        setDetailErrorMsg(res.error);
        setDetailLoading(false);
      })();
    },
    [source, filters]
  );

  const closeDetail = useCallback(() => setDetailError(null), []);

  // Derive the panel payload for the current source + filters. The JS
  // aggregation modules infer a looser shape; assert the shared panel type.
  const panels = useMemo<TelemetryPanels>(() => {
    if (source.kind === 'seed') {
      return aggregateAll(SEED_RECORDS, filters, SEED_NOW) as TelemetryPanels;
    }
    return applyLivePresentationFilters(source.payload, filters) as TelemetryPanels;
  }, [source, filters]);

  const generatedAt = source.kind === 'live' ? source.payload.generatedAt : new Date(SEED_NOW).toISOString();
  const seed = source.kind === 'seed';

  // Account options come from whichever source is active.
  const availableAccounts = useMemo(() => {
    const set = new Set<string>();
    if (source.kind === 'seed') {
      for (const r of SEED_RECORDS) set.add(r.acc);
    } else {
      for (const r of source.payload.app_account_crosstab) set.add(r.acc);
    }
    return [...set].sort();
  }, [source]);

  const availableApps = useMemo(() => [...APP_ORDER], []);

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Telemetry Dashboard</h1>
          <p className="page__sub">
            Usage &amp; error telemetry from the Axiom <code>app-errors</code> dataset — by account and by app.
          </p>
        </div>
        <nav className="page__tabs">
          <button
            className={view === 'dashboard' ? 'page__tab page__tab--on' : 'page__tab'}
            onClick={() => setView('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={view === 'settings' ? 'page__tab page__tab--on' : 'page__tab'}
            onClick={() => setView('settings')}
          >
            Settings
          </button>
        </nav>
      </header>

      {view === 'settings' ? (
        <SettingsView />
      ) : (
        <DashboardBody
          filters={filters}
          updateFilters={updateFilters}
          panels={panels}
          availableApps={availableApps}
          availableAccounts={availableAccounts}
          seed={seed}
          generatedAt={generatedAt}
          refreshing={refreshing}
          notice={notice}
          onRefresh={() => load(filters.window)}
          onOpenDetail={openDetail}
        />
      )}

      <ErrorDetailDrawer
        error={detailError}
        rows={detailRows}
        loading={detailLoading}
        errorMsg={detailErrorMsg}
        seed={seed}
        onClose={closeDetail}
      />
    </div>
  );
}

interface DashboardBodyProps {
  filters: Filters;
  updateFilters: (patch: Partial<Filters>) => void;
  panels: TelemetryPanels;
  availableApps: string[];
  availableAccounts: string[];
  seed: boolean;
  generatedAt: string;
  refreshing: boolean;
  notice: string | null;
  onRefresh: () => void;
  onOpenDetail: (err: TopError) => void;
}

function DashboardBody({
  filters,
  updateFilters,
  panels,
  availableApps,
  availableAccounts,
  seed,
  generatedAt,
  refreshing,
  notice,
  onRefresh,
  onOpenDetail,
}: DashboardBodyProps) {
  return (
    <>
      <FilterBar
        filters={filters}
        onChange={updateFilters}
        availableApps={availableApps}
        availableAccounts={availableAccounts}
        seed={seed}
        generatedAt={generatedAt}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />

      {notice && <div className="notice">{notice}</div>}

      <KpiRow kpi={panels.kpi_summary} />

      <div className="grid">
        <ChartCard title="Errors by app" subtitle="Error records per app, sorted">
          <AppBar data={panels.errors_by_app} onSelect={(app) => updateFilters({ apps: [app] })} />
        </ChartCard>

        <ChartCard title="Errors by account" subtitle="Top 15 accounts + Other">
          <AccountBar data={panels.errors_by_account} onSelect={(acc) => updateFilters({ accounts: [acc] })} />
        </ChartCard>

        <ChartCard title="Errors over time" subtitle="Stacked by app" wide>
          <ErrorsOverTime rows={panels.errors_over_time} window={filters.window} />
        </ChartCard>

        <ChartCard title="Top errors" subtitle="Row = cross-filter · 🔍 = full occurrences" wide>
          <TopErrorsTable
            rows={panels.top_errors}
            focusError={filters.focusError}
            onFocus={(errName) => updateFilters({ focusError: errName })}
            onOpenDetail={onOpenDetail}
          />
        </ChartCard>

        <ChartCard title="Usage by app" subtitle="Usage records per app, sorted">
          <AppBar data={panels.usage_by_app} onSelect={(app) => updateFilters({ apps: [app] })} />
        </ChartCard>

        <ChartCard title="Usage by account" subtitle="Top 15 accounts + Other">
          <AccountBar data={panels.usage_by_account} onSelect={(acc) => updateFilters({ accounts: [acc] })} />
        </ChartCard>

        <ChartCard title="Top usage events" subtitle="view_open vs track" wide>
          <TopUsageEvents rows={panels.top_usage_events} />
        </ChartCard>

        <ChartCard title="Boot health" subtitle="p50 → p95 boot time per app">
          <HealthBoot rows={panels.health_boot} />
        </ChartCard>

        <ChartCard title="API latency" subtitle="Share of calls per bucket, per app">
          <ApiLatency rows={panels.health_api_latency} />
        </ChartCard>

        <ChartCard title="App × Account volume" subtitle="Total records per pair" wide>
          <Heatmap rows={panels.app_account_crosstab} />
        </ChartCard>
      </div>

      <footer className="page__foot">
        <span>
          {seed ? 'Synthetic demo data — no real accounts.' : 'Live, access-controlled data for your monday accounts.'}
        </span>
        <span className="page__ver">v{__APP_VERSION__} · {__BUILD_SHA__}</span>
      </footer>
    </>
  );
}
