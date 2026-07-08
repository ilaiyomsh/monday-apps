# Working with Axiom Dashboards — Session Notes

Pragmatic notes from building the `Calendar Sync — Health & Activity` dashboard. These complement `SKILL.md` with the gotchas that actually cost time.

---

## 1. Token scopes are per-action, not per-deployment

Three Axiom tokens lived in this project. Each had different permissions:

| Token | Source | `dashboards:read` | `dashboards:create` | `dashboards:update` |
|---|---|---|---|---|
| `~/.axiom.toml` `prod` token | shared with axiom-sre skill | ❌ | ❌ | ❌ |
| `AXIOM_READ_TOKEN` | `.env` | ❌ | ❌ | ❌ |
| `AXIOM_API_KEY` | `.env` | ❌ | ❌ | ❌ |
| `AXIOM_DASHBOARD_KEY` | `.env` | ✅ | ✅ | ✅ |

**Lesson:** `403 token does not have access to resource: dashboards with action: <verb>` is unambiguous — try the next token before assuming the dashboard or deployment is misconfigured. The skill's `scripts/dashboard-*` use the toml token only; for projects with a separate dashboard token in `.env`, fall back to direct curl.

Direct curl pattern that worked for this project:

```bash
set -a && . /path/to/project/.env && set +a
curl -sS -X POST "https://api.axiom.co/v2/dashboards" \
  -H "Authorization: Bearer $AXIOM_DASHBOARD_KEY" \
  -H "X-Axiom-Org-Id: <org-slug>" \
  -H "Content-Type: application/json" \
  -d @- < payload.json
```

The org slug (`X-Axiom-Org-Id`) is the same as in the dashboard URL: `app.axiom.co/<org>/dashboards/uid/...`.

---

## 2. Payload envelope: POST vs PUT differ

**POST `/v2/dashboards`** (create):

```json
{ "dashboard": { ...full dashboard object without id/uid/version... } }
```

**PUT `/v2/dashboards/uid/<uid>`** (update):

```json
{ "dashboard": { ...without version... }, "version": <int64-as-raw-number> }
```

Two non-obvious points:

- **`version` is a separate top-level field on PUT**, not nested inside `dashboard`. If you put it inside, the API responds with `version is required when overwrite is false`.
- **`version` is an int64**. Don't let `jq` round-trip it as a number — large values lose precision. Build the body via string substitution: `BODY="{\"dashboard\":${DASHBOARD},\"version\":${VERSION}}"`.

The skill's `scripts/dashboard-update` does this correctly; replicate the pattern when calling the API directly.

---

## 3. GET response shape is nested; create response is flat

Don't assume the same jq path everywhere:

| Call | Shape |
|---|---|
| `GET /v2/dashboards/uid/<uid>` | `{ uid, version, dashboard: { name, charts: [...] }, ... }` |
| `POST /v2/dashboards` | `{ uid, ...flat dashboard fields... }` |
| `PUT  /v2/dashboards/uid/<uid>` | flat-ish — `name`/`charts` may be `null` in the response even on success |

**Always verify a write by re-reading via GET** — don't trust the POST/PUT response body to confirm content.

---

## 4. Schema discovery before query design

For `axiom:events:v1` (logs) datasets:

```bash
scripts/metrics/datasets <deployment>                  # list datasets + kind
# kind=axiom:events:v1 → APL path
```

```bash
# In the API: getschema returns ColumnName/DataType — not name/type
['<dataset>'] | where _time > ago(7d) | getschema
```

Schema discovery is **mandatory** — guessing field names wastes deploy cycles on `field 'X' not found` errors. For real apps, also discover the actual values of `tag` / `op` / `level` etc. by running a `summarize count() by <field>` to see what's actually in the data.

---

## 5. Validation cascade — three layers, all worth running

1. **Local JSON structure** — `scripts/dashboard-validate <file>` (catches missing chart IDs, layout/chart ID mismatches).
2. **API-side schema** — `POST` returns 400 with field-level errors like:
   - `dashboard validation failed at [charts 0 text]: Invalid input: expected string, received undefined`
   - `dashboard validation failed at [charts 17 selectedMonitors]: Too small: expected array to have >=1 items`
3. **APL/MPL runtime** — only fires when the chart actually loads in the UI. Errors like `function 'any' not found` only surface here.

---

## 6. Chart-shape gotchas observed

| Chart type | Trap |
|---|---|
| `Note` | `text` is a **top-level chart field**, not under `config`. |
| `MonitorList` | Field is `selectedMonitors` (not `monitorIds`), and it must contain **≥1 monitor**. If you have none, use a `Note` placeholder instead. |
| `SmartFilter` | Each filter needs an `id`, `name`, `type: "select"`, `selectType: "apl"\|"list"`, plus an `options` array containing at least an `{ key: "All", value: "", default: true }` entry. |
| `Statistic` | `warningThreshold`/`errorThreshold` go under `config`. The output query must `project` / `summarize` to a single scalar. |

---

## 7. SmartFilter wiring — both ends must agree

A SmartFilter has two halves:

- **Filter chart** declares filters with `id` (e.g. `cfg_filter`).
- **Every other chart's APL** must `declare query_parameters (cfg_filter:string="", ...)` and add `| where (isempty(cfg_filter) or cfg == cfg_filter)`.

**If the names drift, the filter silently does nothing** — no error, just no effect. Use `Edit replace_all` on the JSON file to keep the prefix identical across all queries when adding/renaming filters.

---

## 8. APL function gotchas seen this session

| Wrote | Should be | Reason |
|---|---|---|
| `any(field)` | `take_any(field)` | APL has no `any()` aggregator. |
| `percentile(x, 95)` in TimeSeries | `percentiles_array(x, 50, 95, 99)` | Multiple `percentile` calls render as separate axes — `percentiles_array` overlays them as one chart. |
| `bin(_time, 1m)` | `bin_auto(_time)` | Auto-bin adapts to the dashboard time picker; fixed bins under-/over-resolve. |

---

## 9. Iteration loop that worked

For each change to a deployed dashboard:

```bash
# 1. Edit the local JSON
# 2. Validate
scripts/dashboard-validate calendar-sync-dashboard.json

# 3. Fetch current version
VERSION=$(curl -sS "https://api.axiom.co/v2/dashboards/uid/$UID" \
  -H "Authorization: Bearer $AXIOM_DASHBOARD_KEY" \
  -H "X-Axiom-Org-Id: $ORG" | jq -r '.version')

# 4. Build body with version as raw int64
DASHBOARD=$(jq -L scripts '
  include "dashboard-normalize";
  del(.id,.uid,.version,.createdAt,.updatedAt,.createdBy,.updatedBy)
  | normalize_dashboard_layout
' calendar-sync-dashboard.json)
BODY="{\"dashboard\":${DASHBOARD},\"version\":${VERSION}}"

# 5. PUT
echo "$BODY" | curl -sS -X PUT \
  "https://api.axiom.co/v2/dashboards/uid/$UID" \
  -H "Authorization: Bearer $AXIOM_DASHBOARD_KEY" \
  -H "X-Axiom-Org-Id: $ORG" \
  -H "Content-Type: application/json" \
  -d @- | jq '{error: .message, code: .code}'

# 6. Verify
curl -sS "https://api.axiom.co/v2/dashboards/uid/$UID" \
  -H "Authorization: Bearer $AXIOM_DASHBOARD_KEY" \
  -H "X-Axiom-Org-Id: $ORG" \
  | jq '{uid, version, chartCount: (.dashboard.charts|length)}'

# 7. Reload the browser tab
```

---

## 10. Live dashboard

- **UID:** `b0b00fcd-de22-4a0c-bc01-4ae4f5cf95bb`
- **URL:** https://app.axiom.co/twyst-jffk/dashboards/uid/b0b00fcd-de22-4a0c-bc01-4ae4f5cf95bb
- **Source JSON:** `calendar-sync-dashboard.json` (in this directory)
- 22 charts: header note, 6-filter SmartFilter (acc/obj/cfg/usr/tag/level), 4 at-a-glance stats, 2× sync timeseries, 2× webhook/latency, OAuth + cron stats row, account/instance/configs-per-instance row, per-config usage table, backfill timeseries, monitors placeholder, error LogStream.
