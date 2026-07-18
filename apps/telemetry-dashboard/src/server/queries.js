// The 11 APL queries the dashboard runs against the Axiom "app-errors" dataset.
// Every query shares the prefix
//   ['<dataset>'] | where _time between (_startTime .. _endTime)
// and the Axiom client prepends `let _startTime = ...; let _endTime = ...;`
// bindings (see axiom.js) plus passes the same window in the request body.
//
// Records in app-errors carry: kind ('error'|'usage'|'health'), app, acc
// (account), err_name, err_msg, err_code, message, tag, total_ms.

/**
 * Build the { name: apl } map for a given dataset.
 * @param {string} dataset
 * @returns {Record<string, string>}
 */
export function buildQueries(dataset) {
  const P = `['${dataset}'] | where _time between (_startTime .. _endTime)`;
  return {
    kpi_summary: `${P} | summarize total=count(), errors=countif(kind=='error'), usage=countif(kind=='usage'), health=countif(kind=='health'), distinct_accounts=dcount(acc), distinct_apps=dcount(app) | extend error_rate=round(100.0*errors/total,2)`,

    errors_by_app: `${P} | where kind=='error' | summarize count=count() by app | sort by count desc`,

    errors_by_account: `${P} | where kind=='error' | summarize count=count() by acc | sort by count desc | take 15`,

    errors_over_time: `${P} | where kind=='error' | summarize count=count() by bin_auto(_time), app | sort by _time asc`,

    top_errors: `${P} | where kind=='error' | summarize count=count(), apps_affected=dcount(app), err_code=any(err_code) by err_name, err_msg | sort by count desc | take 20`,

    usage_by_app: `${P} | where kind=='usage' | summarize count=count() by app | sort by count desc`,

    usage_by_account: `${P} | where kind=='usage' | summarize count=count() by acc | sort by count desc | take 15`,

    top_usage_events: `${P} | where kind=='usage' | extend event_kind=iff(message startswith 'view_open','view_open','track') | summarize count=count() by message, event_kind | sort by count desc | take 20`,

    health_boot: `${P} | where kind=='health' and tag=='boot' | summarize p50_ms=percentile(total_ms,50), p95_ms=percentile(total_ms,95), samples=count() by app | sort by p95_ms desc`,

    health_api_latency: `${P} | where kind=='health' and message startswith 'api_latency' | extend bucket=extract('bucket=([a-z_]+)',1,message) | summarize count=count() by app, bucket`,

    app_account_crosstab: `${P} | summarize count=count(), errors=countif(kind=='error'), usage=countif(kind=='usage') by app, acc | sort by count desc`,
  };
}

/** The window presets the endpoint accepts, mapped to a millisecond span. */
export const WINDOWS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};
