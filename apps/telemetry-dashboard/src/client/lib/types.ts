// Shared shapes for the telemetry payload (server JSON) and the client-side
// aggregation output — they are intentionally identical so the panel
// components render either source through one path.

export type Kind = 'error' | 'usage' | 'health';
export type TimeWindow = '24h' | '7d' | '30d' | '90d';

export interface KpiSummary {
  total: number;
  errors: number;
  usage: number;
  health: number;
  distinct_accounts: number;
  distinct_apps: number;
  error_rate: number;
}

export interface CountByApp {
  app: string;
  count: number;
}
export interface CountByAccount {
  acc: string;
  count: number;
}
export interface ErrorsOverTimePoint {
  _time: string;
  app: string;
  count: number;
}
export interface TopError {
  err_name: string;
  err_msg: string;
  count: number;
  apps_affected: number;
  err_code: string | number | null;
}
/**
 * One raw error occurrence, as returned by the drill-down (live endpoint or the
 * seed extractor). The named fields are the documented app-errors columns; the
 * index signature carries whatever enrichment the record also holds (usr, obj,
 * board, app version, environment, …) so the detail drawer can render every
 * field Axiom stores without the shape being pinned here.
 */
export interface ErrorOccurrence {
  _time?: string;
  app?: string;
  acc?: string;
  err_name?: string;
  err_msg?: string;
  err_code?: string | number | null;
  message?: string;
  tag?: string;
  [key: string]: unknown;
}

export interface UsageEvent {
  message: string;
  event_kind: 'view_open' | 'track';
  count: number;
}
export interface HealthBoot {
  app: string;
  p50_ms: number;
  p95_ms: number;
  samples: number;
}
export interface ApiLatencyRow {
  app: string;
  bucket: string;
  count: number;
}
export interface CrosstabRow {
  app: string;
  acc: string;
  count: number;
  errors: number;
  usage: number;
}

export interface TelemetryPanels {
  kpi_summary: KpiSummary;
  errors_by_app: CountByApp[];
  errors_by_account: CountByAccount[];
  errors_over_time: ErrorsOverTimePoint[];
  top_errors: TopError[];
  usage_by_app: CountByApp[];
  usage_by_account: CountByAccount[];
  top_usage_events: UsageEvent[];
  health_boot: HealthBoot[];
  health_api_latency: ApiLatencyRow[];
  app_account_crosstab: CrosstabRow[];
}

export interface TelemetryPayload extends TelemetryPanels {
  seed: boolean;
  generatedAt: string;
  window: TimeWindow;
}

/** A raw telemetry record (seed dataset + client aggregation input). */
export interface TelemetryRecord {
  _time: string;
  kind: Kind;
  app: string;
  acc: string;
  err_name?: string;
  err_msg?: string;
  err_code?: string | number | null;
  message?: string;
  tag?: string;
  total_ms?: number;
}

export interface Filters {
  window: TimeWindow;
  apps: string[];
  accounts: string[];
  kinds: Kind[];
  focusError: string | null;
}
