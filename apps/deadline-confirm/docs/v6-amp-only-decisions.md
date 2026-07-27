# V6 — AMP-only + per-message signed manifest

**Status:** partially implemented (V6 phases 1–5 on branch `cursor/v6-amp-only-0251`).
T9–T12 (Gmail send, scheduler) and T15 (D9 redesign) remain open.
**App:** `deadline-confirm` (App ID `11704868`, server app on monday-code, pushed dir = app root)
**Baseline:** `0.7.3` on both `develop` and `main`. Suite: 526 green.
**Suggested target version:** `0.8.0` (breaking product change).

---

## 0. Read this first

This is a **hardening round with a deliberate product cost**. The owner has
chosen to drop universal email compatibility in exchange for a much smaller
attack surface and a credential that expires daily. Do not "restore" the
fallback paths this document deletes — their removal *is* the change.

Two things this round does NOT do, and must not claim to do:

- It does **not** add verified identity. Whoever holds today's message can act
  on the tasks in it, today. That is an accepted risk (§6).
- It does **not** stop the signature from being readable in the message source.
  "View original" in Gmail still shows it. The gain is scope and lifetime, not
  secrecy.

Follow the repo rules in `/CLAUDE.md`: `feature/*` off `develop`, PR into
`develop`, never push to `main`, never deploy from a machine. All monday API
probing goes through `.claude/skills/mapps/scripts/mapps-api.sh` against
`TEST_WORKSPACE_ID=16291824` with `WZ-` prefixed scratch objects.

---

## 1. Decisions

### D1 — AMP-only. The actionable HTML email is removed.

The organization runs Google Workspace and the AMP part renders in the Gmail
mobile app, which the owner has accepted as sufficient. Each recipient enables
dynamic email for themselves once; that one-time friction is accepted.

**Consequence:** the static `text/html` body with one link per task is no longer
sent. There is no actionable fallback by design.

### D2 — The `/confirm` route family is deleted entirely.

With D1 and D4, nothing calls it. `HEAD /confirm`, `GET /confirm` and
`POST /confirm` all go, along with the landing page, the JS auto-submit, the
success page and the generic invalid page.

**This leaves exactly one public write endpoint in the app: `POST /amp/confirm`.**
That sentence is the headline of the security review — do not reintroduce a
second one.

### D3 — The link secret never leaves the server.

The message no longer carries `k`. It carries one signature derived from the
secret, over a manifest of what that message authorizes (§3). The base secret
becomes **write-only from the outside**:
generated server-side, stored in SecureStorage, never returned by any endpoint.

### D4 — The monday-workflow snippet path is retired.

`GET /api/snippet` and `GET /api/email-template` are deleted. They were the only
endpoints that returned the secret unmasked, and static pasted HTML cannot carry
a signature that changes daily. The per-button-per-task UX they produced is also
being replaced by D9.

`POST /api/secret/rotate` keeps rotating the secret but **stops returning it** —
nothing needs to display it any more. Rotation remains the emergency kill switch:
it invalidates every outstanding signature at once, because all of them are
derived from the base secret.

### D5 — Codes are bound to the task and expire at the next send.

Full spec in §3. The validity window runs from one scheduled send time to the
next — exactly 24h, no gap, no overlap.

### D6 — The slot is derived from the **scheduled** send time, never from the
actual send timestamp.

This is what makes D8 (resend) work for free: a resend during the same day
produces byte-identical signatures, so both copies of the message stay valid
until the next scheduled send.

### D7 — Timezone is global: `Asia/Jerusalem`.

Not per-account. The digest's open-task classification already works in this
zone; the slot now uses it too. This closes the open node from the target-state
doc.

### D8 — Operator summary email + resend for the current day.

After a scheduled run finishes, the app sends **one** message to the operator
mailbox: how many recipients were sent, how many failed, which addresses failed,
and the slot. **Counts and addresses only — no task content and no signatures.**

A "resend today" action re-runs the send for **all** recipients using the current
slot. Selective resend is out of scope for this round.

### D9 — Email redesign: multi-button table, one global submit. **DO NOT
IMPLEMENT YET.**

Decided, but the owner will brief this separately with a visual example. Recorded
here so the crypto spec in §3 is designed for it from the start.

Target behaviour:
- A section may offer **more than one button**.
- The recipient sees a **table with one column per button** and marks, per task,
  which status that task moves to — so one task can be sent to "done",
  "in progress" or "start date reached" as appropriate.
- **One global submit for the whole message**, not one per section.

**Do not build the renderer or the admin UI for this until the owner briefs it.**

The signed-manifest design in §3 (decision D10) deliberately **decouples the
signature from the layout**: the manifest enumerates whichever (task, button)
pairs the renderer chooses to offer, so the crypto layer can be built now and the
renderer later with no risk of having to re-issue codes.

### D10 — One signature per message, over a signed manifest.

Superseded design: one signature per (task × button) pair. Rejected in favour of
a single signature covering an explicit manifest of what the message authorizes.

A bare per-recipient token was also considered and **rejected**: it proves which
mailbox the message went to but not *which tasks it listed*, so any itemId on the
board could be submitted — restoring the whole-board blast radius. Re-deriving
the recipient's task set at confirm time was rejected too: it costs two board
reads on the hot path, it is unstable (a task in the 08:00 digest may no longer
qualify at 15:00, so a legitimate click gets rejected), and it moves
authorization out of cryptography and into business logic, where a filter bug
becomes an authorization bypass.

### D11 — Runtime assignee check. NOT clicker identity.

At execution time, compare the signed `recipientPersonId` against the person ids
in the item's people column. If the signed person is not among the item's
assignees, that item is refused.

Costs zero extra API calls: `performAction` already fetches the item with
`peopleColumnId` for attribution.

What it buys: a task reassigned after the message was sent can no longer be acted
on with that message; the R2 invariant is enforced at runtime and not only at
build time; and a leaked manifest is further narrowed to tasks still assigned to
the person it was issued to.

**What it does NOT buy, and must never be presented as buying: verification of who
clicked.** AMP for Email transmits no clicker identity — unlike Outlook Actionable
Messages, which sends a signed token identifying the user. The request carries
`AMP-Email-Sender` (our own sending mailbox, set by the recipient's mail server)
and the hidden fields we baked in at send time. Nothing in it reveals the mailbox
the click came from.

Concretely: if the message is forwarded to Bob and Bob submits the form, the
request is byte-identical to Alice's, because the hidden fields travel with the
message. There is no field to compare. Do not implement a "forwarded mailbox"
check — it is not expressible.

Related fact, worth recording but not a control we own: **Gmail strips the AMP
part on forward**, so a forwarded message shows only the `text/plain` part and has
no form at all. That blocks the naive forwarding case, but it is Gmail's
behaviour, not ours, and it does not cover access to the original mailbox, a copy
of the raw MIME, or a screenshot of the source.

---

## 2. Endpoint inventory after the change

| Endpoint | Auth | Writes | Change |
|---|---|---|---|
| `POST /amp/confirm` | sender gate + signed manifest | yes | **the only public write path** |
| `OPTIONS /amp/confirm` | sender gate | no | unchanged |
| `GET /oauth/start?st=` | monday sessionToken (query) | no | unchanged (see §7) |
| `GET /oauth/callback` | single-use expiring nonce | stores token | unchanged |
| `GET /api/state` | sessionToken (header) | no | secret stays masked |
| `PUT /api/config` | sessionToken | yes | may gain button config (D9, later) |
| `POST /api/secret/rotate` | sessionToken | yes | **stops returning the secret** |
| `GET /api/digest/preview` | sessionToken | no | drops `html`, keeps `amp` |
| `POST /api/digest/send` | sessionToken | yes | manual trigger retained |
| `GET /health` | none | no | unchanged |
| `GET /admin/*`, `GET /` | none (inert static) | no | unchanged |
| ~~`HEAD/GET/POST /confirm`~~ | — | — | **DELETED (D2)** |
| ~~`GET /api/snippet`~~ | — | — | **DELETED (D4)** |
| ~~`GET /api/email-template`~~ | — | — | **DELETED (D4)** |

---

## 3. Signature spec (authoritative)

### Construction

**One signature per message.** It covers a manifest that enumerates exactly what
the message authorizes: which tasks, and for each task which buttons are offered.

```
slot     = date (YYYYMMDD) of the scheduled send, Asia/Jerusalem
manifest = "<itemId>:<btnId>[,<btnId>…][;<itemId>:…]"   canonical: items ascending,
                                                        buttons ascending, no spaces
payload  = accountId | recipientPersonId | slot | manifest  (single-byte "|" separator)
sig      = base64url( HMAC-SHA256(link_secret, payload) )
```

The manifest is **not secret** — it lists item and button ids that the message
already displays. Signing it is what binds authorization to a specific task set,
so nothing outside the manifest can ever be acted on.

`recipientPersonId` is inside the payload. It is not needed to constrain scope
(the manifest already does that); it exists so the server knows
**cryptographically** which person a code was issued to. Two uses: the runtime
assignee check in D11, and provable attribution if the wording in R2 is ever
changed (§6).

A person **id** is signed rather than an email address because the item's people
column already returns person ids — so the D11 check costs **zero** extra API
calls. Signing the address instead would force a users-board read on the hot
path.

### Current slot

```
currentSlot = now >= today's scheduled send time (Asia/Jerusalem)
                ? today's date
                : yesterday's date
```

The slot rolls at the send hour, not at midnight. A recipient opening
yesterday's message at 07:00 when the send time is 08:00 is still inside the
previous slot and can still act — correct, because the new message has not
arrived yet.

**Do not accept the previous slot as a grace window.** It would defeat D5. If a
scheduled run fails, yesterday's codes are already dead and the recipient has no
actionable message that day; that is accepted, and the mitigation is alerting on
scheduler failure, not widening the window.

### Wire format

```html
<input type="hidden" name="a"   value="1234567">
<input type="hidden" name="m"   value="9871234567:done,in-progress;9871234599:done">
<input type="hidden" name="s"   value="20260728">
<input type="hidden" name="sig" value="a7f3c91e4b2d…">

<input type="radio" name="item_9871234567" value="done">   <!-- selection, no crypto -->
```

- No `k` field anywhere. The base secret never appears in the message.
- Selection fields carry **no signature** — authorization lives entirely in the
  signed manifest.
- Radio group name is per task (`item_<itemId>`); accept only field names matching
  `^item_\d{1,20}$` and ignore everything else.
- Unselected tasks submit nothing.
- `recipientPersonId` must be transmitted (it is an input to the recompute) and it
  is **not** secret. It is protected by being inside the HMAC: a submitted value
  that has been altered simply fails verification. Never read it from the request
  for any purpose other than recomputing the signature.

### Verification order (security contract — do not reorder)

1. **AMP CORS sender gate** — first, pure header work, no I/O. Unchanged.
2. **Rate limit, bucket A** — per-IP, generous. See §4. New position: *before*
   any secret work.
3. Parse `a`, `m`, `s`, `sig`. Reject a malformed or non-canonical manifest, a
   manifest listing more than `MAX_ITEMS` (50) tasks, or duplicate item ids.
4. Load the account's base secret via `storage.forAccount(a)`.
5. `s` must equal `currentSlot`.
6. Recompute the HMAC over `accountId|recipientEmail|s|m` and compare with
   `timingSafeEqual`. **Reject before parsing selections** — an invalid signature
   must never lead to reading the selection fields.
7. Parse selections. Every `(itemId, btnId)` pair **must appear in the verified
   manifest**; reject on no selections, an unknown item, or a button not offered
   for that item.
8. **All-or-nothing for integrity failures.** Any failure in 3–7 rejects the whole
   request with the generic invalid message and performs no mutation. This is not
   cosmetic: the response returns counts, so partial execution at this stage would
   turn those counts into a verification oracle.
9. **Rate limit, bucket B** — the existing `accountId:ip` bucket.
10. `performAction` per selection, passing that selection's own `btnId`, plus the
    D11 assignee check.

Steps 3–8 must complete before any monday API call.

### Two classes of failure — do not collapse them

| Class | Examples | Handling |
|---|---|---|
| **Integrity** (before execution) | bad signature, expired slot, item or button absent from the manifest, malformed manifest | **reject the entire request**, generic message, no mutation |
| **State** (during execution) | D11 assignee mismatch, already at target, item not found, API error | **per item**, reported in the response counts |

Collapsing state failures into all-or-nothing would mean one reassigned task
silently kills a batch of nine good ones. It does not reopen the oracle: reaching
the execution stage at all requires a valid signature, and a holder of a valid
signature already knows what their own manifest contains.

Note the inversion from the old `/confirm` contract, where the secret gate ran
before the rate limit. Here bucket A runs first (§4) and the signature is checked
before any selection data is trusted.

### What each property buys — state it this way in the security doc

- **Non-composable.** Holding any number of valid message signatures gives zero
  ability to forge one for a different manifest. Recomputation requires the base
  secret, which never leaves the server.
- **Scope.** A leaked message authorizes exactly the (task, button) pairs in its
  own manifest — not the board, and not other buttons.
- **Lifetime.** One send interval.
- **Non-escalating.** A compromise cannot be widened; there is no path from a
  signature back to the secret.

---

## 4. Rate limiting

Split into two buckets. **Do not simply move the existing bucket earlier** — the
current bucket is keyed `accountId:ip`, and letting unauthenticated failures
consume it lets one attacker exhaust the allowance for legitimate users behind
the same corporate NAT, i.e. a self-inflicted DoS.

| Bucket | Key | When | Purpose |
|---|---|---|---|
| A | `ip` | before signature verification | abuse control; closes the "no rate limiting on auth attempts" checklist item |
| B | `accountId:ip` | after verification | protects the monday API complexity budget |

Bucket A should be generous — it exists to bound abuse, not to be the defence
against guessing. Entropy is the defence against guessing.

**Correct the threat-model claim while you are here.** The security doc currently
says key guessing is blocked by "256-bit entropy plus rate limiting". Rate
limiting does not participate in that today. After this change it does, but the
honest phrasing is: *entropy blocks guessing; rate limiting protects resources.*

---

## 5. MIME structure

AMP for Email requires a fallback part — a message carrying only the AMP part is
invalid. So "AMP-only" means **the second part becomes non-actionable, not absent**.

```
multipart/alternative
├── text/plain          task list, NO links, NO signatures, NO secret
└── text/x-amp-html     the interactive part
```

`text/plain` content: the task list plus one line — to confirm, update in
monday.com. It must carry no credential of any kind; leaving a `/confirm` link
there would undo D2 and D3 entirely.

**Note:** no `text/plain` renderer exists today — the sender currently posts
`html` only. This is new work, not an adaptation.

Ordering note retained from the target-state doc: when both an AMP part and an
HTML part are present the AMP part must come first, because some clients render
the last part they understand. With `text/html` gone this is less load-bearing,
but keep AMP last-but-one / plain first as specified above.

---

## 6. Accepted risks — record these verbatim in the security doc

**R1 — No verified identity.** The signature authorizes possession, not a person.
Whoever holds today's message can act on its tasks today. Accepted: the
recipient is authorized to make these changes in monday anyway, so forwarding
delegates a permitted action rather than escalating privilege. A compromised
mailbox is an organization-level problem with far wider consequences than this
app.

**R2 — Attribution is an assumption, not proof.** The board update names the
person from the task's people column, not the actual clicker. D11 narrows the gap
— the code is cryptographically bound to a person and the task must still be
assigned to them — but it does not close it: AMP carries no clicker identity, so
"assigned to" is not "pressed by". If provable attribution is ever wanted, the
signed `recipientPersonId` already supports wording like "confirmed via the
message issued to X" at no extra cost.

> **Invariant that R1 and R2 depend on:** a recipient's digest must contain
> **only tasks assigned to that recipient**. Today `digest-service` builds
> sections per recipient from the people column, so this holds. If a future
> round adds a team or manager digest, both justifications collapse and the
> attribution wording must change before that ships. Add a test that pins this.

**R3 — Single channel.** If dynamic email is disabled for the domain, or sender
registration lapses, no recipient has an actionable message. There is no
fallback by design. This is an availability risk, accepted knowingly.

**R4 — Rate limiting is container-local.** In-memory, so the effective ceiling
scales with container count. Unchanged by this round, already disclosed.

**R5 — Sender gate is not authentication.** The `AMP-Email-Sender` header is set
by the mail server, not by us. It reduces attack surface; the signature remains
the only authorization.

---

## 7. Explicitly out of scope for this round

- `GET /oauth/start` keeps taking the sessionToken in the query string. It is a
  top-level browser redirect, which cannot carry a header. Documented remediation
  if ever required: POST that mints a one-time code, and navigate with the code.
  Not this round.
- Distributed rate limiting (R4).
- Selective resend (D8 covers all-recipients only).
- The D9 renderer and its admin UI — owner will brief.

---

## 8. Implementation checklist

**Delete**
- [ ] T1 — `src/routes/confirm.js` and its tests; remove from `app.js`.
- [ ] T2 — from `helpers/pages.js`, remove only `successPage`, `invalidPage`,
      `badRequestPage`, `confirmLandingPage`. **Keep the file** — `routes/oauth.js`
      still imports `oauthDonePage` and `oauthErrorPage` from it.
- [ ] T3 — `GET /api/snippet`, `GET /api/email-template`, `helpers/snippet.js`,
      `helpers/email-template.js` and their tests.
- [ ] T4 — the actionable `text/html` digest renderer.

**Build**
- [ ] T5 — signature module: build manifest, sign, verify, `currentSlot`, and a
      strict canonical-manifest parser (§3). Pure and unit-testable; no storage,
      no network.
- [ ] T6 — rewrite `POST /amp/confirm` to the §3 verification order: manifest
      verified before selections are read, every selection checked against the
      manifest, all-or-nothing for integrity failures, per-selection `btnId`.
- [ ] T6b — D11 assignee check inside `performAction`, using the person ids
      already fetched from the people column. Returns a per-item state outcome,
      never a whole-request rejection.
- [ ] T7 — two-bucket rate limiter (§4).
- [ ] T8 — `text/plain` renderer (§5).
- [ ] T9 — multipart/alternative assembly for the Gmail API send path.
- [ ] T10 — monday-code scheduler that runs the send at the configured hour and
      replaces the external monday workflow.
- [ ] T11 — operator summary email (D8).
- [ ] T12 — resend-today action, reusing the current slot (D6, D8).
- [ ] T13 — `POST /api/secret/rotate` stops returning the secret; admin UI stops
      displaying it.
- [ ] T14 — `GET /api/digest/preview` drops `html`, keeps `amp`.

**Do not build yet**
- [ ] T15 — D9 email redesign (multi-button table, one global submit). Awaiting
      owner briefing.

---

## 9. Quality gates (binding — see `/CLAUDE.md`)

- **test-guard:** every new test must be **observed failing before it passes**.
  For each changed module, prove ≥2 killed mutations. Specifically pin:
  - a selection for an item absent from the verified manifest is rejected;
  - a selection naming a button not offered for that item in the manifest is
    rejected;
  - a manifest signature from the previous slot is rejected;
  - a tampered manifest (item added, button added, reordered) is rejected;
  - an invalid signature is rejected **without** the selection fields being read;
  - one bad selection rejects the entire batch (the oracle guard);
  - a reassigned item is refused by D11 **without** failing its batch-mates;
  - a tampered `recipientPersonId` fails signature verification;
  - the R2 invariant: a digest section contains only the recipient's tasks.
- **error-guard:** every catch logs, rethrows, or displays. GraphQL soft errors
  inside 200 responses are thrown at the API funnel.
- **monday-api skill:** validate any changed query against the live schema and
  probe in the sandbox workspace. Build monday-facing test doubles **only** from
  probe-captured fixtures — the 0.7.3 board-picker bug happened because a
  fixture was invented, and 519 green tests could not catch it.
- CI gate: type-check → lint → build must pass. Tests are a visibility job; new
  red is yours.
- Version bump + `CHANGELOG.md` entry are required (release-guard).

---

## 10. Documents to update in the same PR

- `CLAUDE.md` (this app's) — **required, and easy to miss.** Its "Locked
  decisions" block currently reads "static shared secret in every email", "no
  clicker identity in the URL", and "scanner protection = the JS-auto-POST
  landing page". V6 overturns all three: the secret leaves the message, the
  landing page is deleted, and `/confirm` no longer exists. Its module-layout
  tree and the `/confirm` request-order contract also become wrong. Leaving this
  stale will make the next agent revert V6 as a rule violation.
- `docs/spec.md` — V6 amendment.
- `docs/v5-gmail-dynamic-email.md` — mark the HTML fallback section superseded.
- Security doc (external, 5-page): threat-model rate-limit row (§4), disclosure
  item 1 rewritten for scope+lifetime, disclosure item 5 (source maps) reframed
  as **found and fixed in 0.7.2, guarded against regression** — it is currently
  presented as open, which is no longer true. Also correct the test count.
- Flow diagram: remove the graceful-fallback note and the per-task button line.

---

## 11. Still open — do not block on these

| # | Question |
|---|---|
| O1 | Where the dedicated mailbox's Google refresh token lives — SecureStorage or monday-code env — and who owns the OAuth client. |
| O2 | No index of configured accounts exists; the scheduler needs a source of truth for "who to run for". |
| O3 | Resend's fate — fully retired, or kept as a backup channel. Keeping it weakens the "removes an external data processor" argument. |
| O4 | One organizational sender address or one per account. |
| O5 | Which monday user the OAuth token is taken from, and how many boards that user can actually see. Needed as a number, not an adjective. |
| O6 | Lifecycle of that monday token — ownership, rotation, what happens when the user is deactivated. |
