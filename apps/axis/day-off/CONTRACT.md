# Day-off Absence Data Contract

> **Status: NORMATIVE — frozen 2026-06-10 (Day-off integration task W1.6).**
> This is the consumer contract for the Axis absence system. **Planner (W3) and tracker (W4)
> code against this document.** It is the written form of `DAY-OFF-INTEGRATION-PLAN.md` §4
> (the canonical spec) combined with the implementation facts that W1.1–W1.5 locked into this
> repo. If this file and the plan's §4 ever disagree, that is a deviation — record it in
> `DAY-OFF-INTEGRATION-EXECUTION.md` §5 and resolve with the user; do not silently pick one.
>
> Decisions D1–D10 (plan §3) are frozen and referenced below by number.
> Audience: AI agents and developers building or consuming the absence system. English only.

---

## 1. Scope and roles

One monday.com **vacations board** is the single source of truth for absences.
**Every item on the board is exactly one absence entry**, of one of two kinds:

| Kind | Meaning | Written by |
|---|---|---|
| **Personal** | One employee's absence request (vacation / sick / reserves / any account-defined type) with an approval lifecycle | Day-off (submit / edit / approve / reject / cancel) |
| **General** | A company-wide day (holiday / office closure / optional event) | Day-off (Settings → Company days) |

- **Day-off is the only writer.** Planner and tracker are read-only consumers.
- There is **no code-level integration**: no shared package is required to consume the board,
  no backend, no webhooks. The only shared surface is the board itself (Axis invariant:
  components never import each other).
- monday storage is **app-scoped** — consumers can NEVER read Day-off's settings blob.
  The board ID + column IDs + label IDs must be configured in **each consumer's own settings**,
  **manually via its settings dialog** (D9 — provisioning-blueprint distribution is deferred).

### Hard rules (org-wide, non-negotiable)

1. Match columns by **column ID**, never by title (titles are freely Hebraized/renamed).
2. Match status labels by **stable monday label ID**, never by text or display position.
   Read label metadata via the column's `settings` field (NOT the deprecated `settings_str`).
   Label text is display-only and a *fallback* for settings saved before label IDs were stored.
3. A label that matches nothing configured must **fail loudly** (log + surfaced error) — never
   a silent default, never a silently-empty result.
4. Whole-day granularity only (D6). Dates are local-calendar day-keys `YYYY-MM-DD` (no time,
   no timezone math; day-keys compare lexicographically). The schema deliberately leaves room
   for a future `portion` field; consumers must not invent half-day semantics in v1.

---

## 2. Common fields (every entry)

| Field | Column type | Semantics |
|---|---|---|
| `kind` | status | The discriminator: one label means **general** (default text `כללי`), one means **personal** (default text `אישי`). Matched by label ID first (`generalLabelId` / `personalLabelId` in the consumer's settings), case-insensitive text second (legacy). **Fallback rule (normative):** when the kind is unmapped, empty, or matches neither configured label ⇒ the entry is **personal iff the person column is non-empty**, otherwise general. A non-empty kind label that matches nothing configured signals settings drift and must be warn-logged (the fallback keeps the item visible; the drift must be loud in logs). Reference: `src/services/vacationService.ts` `isPersonal`. |
| `startDate`, `endDate` | **two date columns — NOT a timeline column** | The entry's inclusive day range: `[startDate .. endDate]`, **inclusive on BOTH ends**. Single-day entries have `startDate == endDate`. Read the day-key from the column `text`; write `{ "date": "YYYY-MM-DD" }`. An entry missing either date is malformed — Day-off drops it on read; consumers must do the same (skip, optionally log), never guess. |
| `workdays` | numbers | App-computed count of non-Fri/Sat days in the range (Israel weekend). **Informational only.** It does NOT subtract company holidays, it is not window-clipped, and it must **never** be used for capacity math or day counting (rule §6.4). Reference: `src/domain/dates.ts` `workdaysBetween`. |

## 3. Personal entry (absence request)

| Field | Column type | Semantics |
|---|---|---|
| `person` | people | `persons_and_teams[0].id` = the employee's **monday user ID** — the system-wide identity join (Planner `Employee.id`, tracker current user). **Required** on personal entries; Day-off always writes exactly one person. |
| `personalType` | status | The absence type. **The label set is OPEN and DYNAMIC (D1):** defaults are חופשה / מחלה / מילואים, but accounts may define more or different types — consumers must NEVER hardcode or assume the three defaults. Day-off writes it **by label ID** (`{ "index": <labelId> }`). Consumers treat the **label ID as the type key** and the label text as opaque display-only (color/text from the column's `settings` labels). Never branch logic on label text. |
| `approvalStatus` | status | The approval lifecycle: `pending` / `approved` / `rejected` (three labels, matched by label ID first — `statusValues.labelIds` shape — text fallback for legacy settings). **Capacity deduction counts ONLY approved items** (under an approval-required policy, §5). **Rejected items remain on the board** and must be excluded by every consumer. **Cancelled requests are HARD-DELETED** — no tombstone, no cancelled status; re-read is the only deletion signal (§7). An item with **no approval value at all** reads as `pending` (semantic default for an undecided request — this is NOT the forbidden silent default). A **non-empty** approval label matching nothing configured must fail loudly (Day-off throws `ApprovalStatusMismatchError`; consumers must surface an equivalent error, per D8 — a silent `pending` makes approved absences vanish with no error). |
| `empNote`, `mgrNote` | long_text | Display only. |
| `decidedBy` | people | Audit: the approving/rejecting manager. Not consumed by Planner/tracker. |
| `decidedAt` | date | Audit: decision day. Not consumed by Planner/tracker. |
| `file` | file | Attachment (e.g. sick note), uploaded via monday `add_file_to_column`. Not consumed by Planner/tracker. |
| Item **name** | — | `"<employee name> - <type label>"` — **display only, NOT a parseable contract field.** Never extract identity or type from the name. |

Lifecycle facts consumers must know:

- A new request is created with kind=personal and approval=pending.
- **Editing a request resets its approval status to `pending`** (re-approval required).
- Approve/reject writes the approval label + `decidedBy`/`decidedAt` (+ optional `mgrNote`).
- Cancel **hard-deletes the item** (§7).

## 4. General entry (company day / holiday)

| Field | Semantics |
|---|---|
| Item **name** | The holiday/company-day display name — for general entries the name **IS the contract field**. There is no general-type column: the formerly declared `generalTypeColumnId` was removed (W1.4) and must not be reintroduced by consumers. |
| `startDate`, `endDate` | Same inclusive range as §2 (multi-day company closures are one item). |
| `mandatory` | checkbox | `true` = office closed → reduces capacity for **ALL** employees. In Planner this routes to the **`holidaysByDate` channel** (blocking holiday, zeroes everyone, excluded from role-capacity denominators) — NOT the personal-absence channel; routing a general day through the personal channel corrupts role-level free% math (plan §2). `false` (רשות / optional) = **display-only, no capacity effect**. Checkbox read: `{ "checked": "true" }` (or boolean) = true, anything else/empty = false. **An unmapped mandatory column reads as `false`** (Day-off behavior — consumers must match). |
| `person` | Empty / ignored on general entries. |
| `kind`, `workdays` | As in §2. |

## 5. Consumer read rules

1. **Query by date-range overlap** with the visible window — see §6 for the normative algorithm.
2. **Approval filtering is per-component policy (D2).** Each consumer has its own
   "approval required for personal absences?" setting:
   - **ON** → keep only personal items whose approval **label ID** ∈ the consumer's configured
     approved set; the approval column + approved-label mapping become required settings
     (validated). Planner: only approved items reduce capacity. tracker: pending items render
     unfilled (hollow), approved render filled.
   - **OFF** → count all personal items **except rejected ones** (pending + approved + empty
     approval all count; approval state is otherwise informational).
   - **Rejected items are excluded by every consumer REGARDLESS of the policy toggle**
     (D2 amendment, user decision 2026-06-10 — supersedes the original "OFF counts all
     items literally" rule). Rejection only marks the item (`approvalStatus = rejected`);
     the item stays on the board and stays visible inside Day-off itself (the request's
     owner and managers see its history) — it must simply never reduce capacity in Planner
     nor render in tracker. Consumers therefore need the **rejected-label mapping even when
     the policy is OFF**; with no rejected mapping configured a consumer cannot exclude
     them (documented degradation — map it).
3. **Identity join:** the person column's user ID ↔ Planner `Employee.id` ↔ tracker's current
   user ID. ⚠️ If Planner's Employees-board user column is unmapped, `Employee.id` falls back
   to the board item ID and the join silently misses — consumers must validate their identity
   configuration when an absence source is configured.
4. **Kind routing is mandatory, not stylistic:** personal → per-employee absence channel
   (employee's day zeroed, employee **stays** in role/period capacity denominators);
   general+mandatory → company-holiday channel (everyone zeroed, **excluded** from
   denominators); general+optional → display only.
5. **Granularity:** whole days only (v1, D6).
6. **Validation must fail loudly.** A half-configured mapping must produce an explicit,
   user-visible error — never a silent empty result (no silent `pending` defaults, no silent
   EMPTY_MAP). Day-off itself enforces this for its own settings (W1.3,
   `src/domain/settingsValidation.ts`): board ID + the five contract-critical columns
   (kind / person / startDate / endDate / approvalStatus) + non-empty kind/status label maps
   are required, and the board is never read while invalid. Consumers must enforce the
   equivalent for their own mapping (board/column existence, label resolvability,
   approval mapping required when their approval policy is ON).
7. **Type set is open (D1):** treat the personal type as an opaque
   (label-ID key, display text/color) pair. Never assume the default three types exist.

## 6. Range-expansion spec (normative algorithm)

A vacations-board item carries an **inclusive** `[startDate .. endDate]` range; Planner's
internal absence map is keyed per calendar day. The expansion every consumer must implement:

1. **Fetch** items whose range overlaps the visible window:
   `startDate ≤ windowEnd AND endDate ≥ windowStart`.
   ⚠️ monday `items_page` has no native two-column overlap operator. Day-off itself queries
   with the **AND-of-two-rules form** — proven against the live API
   (`src/services/vacationService.ts` `buildEntriesQuery`):
   ```
   rules: [
     { column_id: <endDateCol>,   compare_value: ["<windowFrom>"], operator: greater_than_or_equals },
     { column_id: <startDateCol>, compare_value: ["<windowTo>"],   operator: lower_than_or_equal }
   ],
   operator: and
   ```
   and additionally **clips client-side** (`rangeOverlapsWindow`) so server over-fetches never
   leak out of the window. Consumers should do the same; a consumer with a different rule
   builder must verify the form against the API first (or use a widened fetch window + a
   client-side overlap filter). Do **not** use OR-of-betweens on the two date columns — it
   misses items spanning the whole window.
2. **Expand** each qualifying item into one entry per **calendar day**, from
   `max(startDate, windowStart)` to `min(endDate, windowEnd)`, inclusive on both ends.
3. **Do NOT skip weekends or holidays during expansion.** Day-classification stays in the
   consumer's math (e.g. Planner's `buildDayInfo` priority chain weekend → holiday → absence
   already resolves a weekend day to `weekend` even if an absence entry exists for it).
   Expanding all calendar days keeps the producer dumb and the consumer's math authoritative.
4. **Never derive day counts from the `workdays` column** — it is informational, ignores
   company holidays, and is not window-clipped (§2).
5. **tracker does not expand at all:** one vacations item = one multi-day all-day calendar
   event — `start = startDate`, **exclusive** `end = endDate + 1 day` (react-big-calendar
   renders multi-day all-day events natively).
6. **Re-expansion happens on every window change**; expanded entries are keyed
   `(employeeId, 'YYYY-MM-DD')` so overlapping sources and refetches stay idempotent.

**Canonical window shape:** `DayWindow { from: DayKey; to: DayKey }` — inclusive on BOTH ends
(`src/domain/types.ts`). Day-keys compare lexicographically, so `from <= day && day <= to` is
the membership test and `start <= window.to && end >= window.from` is the overlap test — no
Date math needed. Day-off's read API takes `ReadScope = DayWindow | number` (a calendar-year
number is a legacy convenience normalized via `yearWindow`); windows may freely span year
boundaries (W1.1).

## 7. Consistency model

There is **no push channel anywhere** in the Axis suite — Day-off, Planner, and tracker are
all pure client-side apps; no backend, **no webhooks**, no event stream.

- **Freshness = client-side re-read.** Consumers re-read the board on visible-window change
  (and on their own refresh actions). Between reads, a consumer's view may be stale: new
  requests, approvals, rejections, edits, and deletions are invisible until the next fetch.
  This staleness is accepted (v1).
- **Hard-deleted cancellations leave NO tombstone.** Cancelling a personal request (and
  deleting a company day) deletes the monday item outright. There is no "cancelled" status,
  no deletion marker, no signal of any kind — **re-reading the board is the only way to
  observe a deletion.** Consumers must therefore **replace** the window's absence data on
  each refetch of that window (an entry absent from a fresh read is gone). This does NOT
  conflict with the multi-stage-loaders-merge rule: merge applies across *different* windows
  /stages; within one re-read window, stale entries must not survive.
- **Edits reset approval:** an edited request returns to `pending` (§3) — under an
  approval-required policy a consumer will (correctly) stop counting it until re-approved.
- **Label drift:** Day-off Settings can rewrite the personal-type status labels on the board
  (`update_status_column` — add/rename/recolor/deactivate, with an in-use guard). Label IDs
  are stable across renames/recolors (which is why IDs are the contract key), but
  deactivating/adding labels changes the live set while consumers' cached label-ID mappings
  in their own app-scoped settings do NOT update automatically. Day-off warns the admin about
  exactly this before saving label edits (W1.5); consumers must fail loudly on unmatched
  labels (§1 rule 3) rather than silently dropping items, so drift is detected, not hidden.

## 8. Board permissions (privacy & access)

**Who may read/write the vacations board is decided by monday board permissions — the
contract adds no ACL layer of its own, and the apps cannot enforce one** (they are
client-side: every GraphQL call runs as the signed-in user; the monday API silently omits
boards/items the user cannot see, returning empty data rather than an error).

Documented expectations:

- **Read:** every user of Day-off, Planner, or tracker whose view must include absences needs
  **read access to the vacations board**. Day-off's own Team Gantt / Approvals / Dashboard
  views already imply employees can see each other's personal absences (name, type, dates).
  Planner managers need everyone's absences for capacity math.
- **If a user lacks board access, consumers will silently miss absences** (empty reads, no
  API error) — capacity/calendars will simply be wrong for that user. Deployments that
  restrict board visibility accept this. Consumers should validate the board is *reachable*
  (board-existence check fails loudly per §5.6), but cannot detect partially-hidden items.
- **Item-level restrictions** (e.g. "view only items assigned to you") are incompatible with
  consumer views that must show other people's absences — do not use them on this board for
  Planner/tracker users.
- **Write:** only Day-off writes. Board edit permissions must allow requesters to create/edit
  their own items and approvers (managers) to update approval/decision columns. Keeping write
  permissions tight is the deployment's defense against out-of-band edits that bypass
  Day-off's lifecycle (the contract assumes board data was written by Day-off).
- Privacy posture is a **per-deployment decision** made in monday board permissions at setup
  time (W5.1 manual mapping is the natural moment to set it).

## 9. Producer write encodings (informative)

How Day-off writes columns today (consumers never write, but agents extending the system
need the formats — all writes go through Day-off's single API funnel `mondayApi`):

| Column | Write value |
|---|---|
| people | `{ "personsAndTeams": [{ "id": <numericUserId>, "kind": "person" }] }` |
| date | `{ "date": "YYYY-MM-DD" }` |
| `personalType` (status) | **by label ID**: `{ "index": <labelId> }` (monday names the field `index` but expects the label id) |
| `kind`, `approvalStatus` (status) | currently **by label text**: `{ "label": "<text>" }` (no `create_labels_if_missing` — labels must already exist). Known follow-up: switching these writes to label-ID encoding would survive renames; readers are already ID-first so renames are survivable today. |
| long_text | `{ "text": "<text>" }` |
| checkbox | `{ "checked": "true" }` to check; `{}` (empty object) to clear — `{ "checked": "false" }` is still-checked, never write it |
| numbers | the number as a **string** |
| file | monday `add_file_to_column` (platform translates a GraphQL `File` variable to multipart) |

## 10. Reference implementation map

The normative behavior above is implemented (and unit-tested, incl. a timezone matrix) in
this repo — consumers re-implement the *semantics* in their own stack, not the code:

| Concern | Where |
|---|---|
| Overlap query + window clipping + kind split | `src/services/vacationService.ts` (`buildEntriesQuery`, `listEntries`) |
| Kind resolution (ID → text → person-presence fallback) | `vacationService.ts` `isPersonal` |
| Approval resolution (ID → text → empty=pending → loud mismatch) | `vacationService.ts` `resolveApprovalStatus`, `ApprovalStatusMismatchError` |
| Item → domain mapping | `vacationService.ts` `mapRequest` / `mapCompanyDay` |
| Day-key/window math | `src/domain/dates.ts` (`rangeOverlapsWindow`, `yearWindow`, `eachDay`, `workdaysBetween`); types in `src/domain/types.ts` (`DayKey`, `DayWindow`) |
| Column (de)serialization | `src/services/columnMap.ts` |
| Fail-loud settings validation | `src/domain/settingsValidation.ts` |
| Settings shape (column map + label-ID maps) | `src/types/index.ts` (`VacationColumnMap`, `KindValueMap`, `StatusValueMap`) |

> Note: `buildEntriesQuery` retains a fallback that fetches the whole board when the date
> columns are unmapped. Since W1.3 this path is unreachable in-app (invalid settings block all
> reads) — it is defense-in-depth only and NOT a consumer-facing behavior.

> Deep link (informative — not a read/write semantic): a consumer holding an entry's monday
> **item id** can link a user straight into the Day-off UI for that entry via
> `{customObjectUrl}?app[itemId]=<item id>` (the `app[...]` namespace is required by monday).
> This adds no board behavior; see `DEEPLINK.md` for the link-builder spec.

---

*Version: 1.0 (W1.6, 2026-06-10). Changes to this contract are contract changes: update
`DAY-OFF-INTEGRATION-PLAN.md` §4 in the same change, log it loudly, and bump this version.*
