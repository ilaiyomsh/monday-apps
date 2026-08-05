// The 11 APL queries the dashboard runs against the Axiom "app-errors" dataset.
// Every query shares the prefix
//   ['<dataset>'] | where _time between (_startTime .. _endTime)
// and the Axiom client prepends `let _startTime = ...; let _endTime = ...;`
// bindings (see axiom.js) plus passes the same window in the request body.
//
// Records in app-errors carry: kind ('error'|'usage'|'health'), app, acc
// (account), err_name, err_msg, err_code, message, tag, total_ms.

// The display name for an error row / drill-down key. Many live error records
// carry no err_name (warn-level logs put the text in `message`), so fall back
// err_name → err_msg → message → '(unnamed)'. top_errors groups by it and the
// drill-down filters by it, so the two ALWAYS agree on what a row means.
export const ERR_NAME_EXPR =
  "case(isnotempty(err_name), err_name, isnotempty(err_msg), err_msg, isnotempty(message), message, '(unnamed)')";

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

    top_errors: `${P} | where kind=='error' | extend __name=${ERR_NAME_EXPR} | summarize count=count(), apps_affected=dcount(app) by __name, err_msg | project err_name=__name, err_msg, count, apps_affected | sort by count desc | take 20`,

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

/** How many raw occurrences the error-detail drill-down returns (newest first). */
export const ERROR_DETAIL_LIMIT = 200;

/**
 * Escape a value for safe embedding inside a single-quoted APL string literal.
 * err_name reaches the drill-down from a client query param, so it is
 * UNTRUSTED — escape backslashes first (so we don't double-unescape) then
 * single quotes, which keeps the whole payload trapped inside the literal and
 * defeats any attempt to break out into the APL pipeline.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeApl(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Build the drill-down query: the most recent raw error occurrences for ONE
 * error name, newest first, capped at `limit`. The name is matched via the
 * SAME derivation as top_errors (ERR_NAME_EXPR), so a row and its drill-down
 * always refer to the same records — including err_name-less rows named by
 * their message. Deliberately does NOT project the real fields away — the
 * detail view shows every field the record carries (identity, object, stack,
 * version, …), exactly what an operator would otherwise open Axiom to read;
 * only the synthetic __name helper is dropped.
 * @param {string} dataset
 * @param {string} errName  UNTRUSTED — escaped before embedding
 * @param {number} [limit]
 * @returns {string} APL pipeline (shares the `_startTime`/`_endTime` bindings)
 */
export function buildErrorDetailQuery(dataset, errName, limit = ERROR_DETAIL_LIMIT) {
  const safe = escapeApl(errName);
  return `['${dataset}'] | where _time between (_startTime .. _endTime) and kind=='error' | extend __name=${ERR_NAME_EXPR} | where __name=='${safe}' | project-away __name | sort by _time desc | take ${limit}`;
}
