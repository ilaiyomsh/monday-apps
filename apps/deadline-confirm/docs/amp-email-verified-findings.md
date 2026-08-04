# AMP for Email — what actually works, measured

Live-send investigation, 2026-08-03, ~20 real messages from a laptop through the
app's own MIME builder to internal and external Gmail mailboxes.

**Read this before touching anything AMP-related.** Everything below was measured
on delivered mail, not inferred from documentation. Where it contradicts an older
doc in this folder, this file wins and the older doc is annotated. Two claims
that were previously stated as fact in this repo were disproven here (§6).

---

## 1. The one-line summary

A rendered AMP email needs **four** things true at once. Three were already true;
the two that broke us were the send channel and the sender domain's SPF.

| Requirement | How it failed here | Status |
|---|---|---|
| Valid amp4email document | was already valid | ✅ |
| `text/x-amp-html` part survives to the inbox | **Gmail API strips it** | fixed by changing channel |
| `dkim=pass`, aligned to the `From` domain | `google._domainkey` did not exist | fixed in DNS |
| `spf=pass` **on its own** | `spf=softfail` | fixed in DNS |

Confirmed end to end at 22:42: `spf=pass` + `dkim=pass` + `dmarc=pass`, three MIME
parts intact, interactive card rendered and driven by two humans in two mailboxes.

---

## 2. THE GMAIL API CANNOT DELIVER AMP

`users.messages.send` **silently strips the `text/x-amp-html` part on external
delivery.** It rebuilds the message with its own boundary
(`000000000000…`) and the recipient gets plain + html only.

Proven by a one-variable swap: the byte-identical message submitted over raw SMTP
(`smtp.gmail.com:465`) arrived with **our** `dc_…` boundary and all three parts
present — three times, against the same recipient.

Consequence: `src/services/gmail-sender.js` cannot deliver AMP as built, and
`docs/v5-gmail-dynamic-email.md` §5 (which chose `users.messages.send` +
`gmail.send`) describes a path that does not work for the AMP part. Migration is
pending an owner decision; see §5 for which channels remain.

Non-obvious detail: the strip happens on **external** delivery. An internal send
keeps the part — which is exactly the trap in §3.

---

## 3. SELF-SEND IS AN INVALID TEST METHOD — same-domain is fine

A message from a mailbox **to itself** is delivered internally and never traverses
an outbound hop, so it arrives with **no `DKIM-Signature`, no `Received-SPF` and
no `Authentication-Results` at all**. AMP requires all three to pass, so a
self-send can *never* render — it always answers `INTERNAL_ERROR`, no matter how
correct the document is. The AMP part does survive in that path, which makes the
failure look like a document problem. It is not.

**The boundary is the MAILBOX, not the domain.** Verified: `ilai@twyst.co.il` →
`ido@twyst.co.il` (same Workspace domain, different mailbox) went out via
`smtp.gmail.com` and back via `mx.google.com` and arrived with full authentication
headers, and rendered. So a second mailbox in the same domain **is** a valid test
target.

Always test with two distinct mailboxes. Never conclude anything from a self-send.

---

## 4. DNS: what AMP demands beyond ordinary mail

### `dmarc=pass` is NOT sufficient — SPF must pass on its own

Observed directly: with `dkim=pass header.i=@twyst.co.il header.s=google` and
`dmarc=pass` (alignment satisfied via DKIM alone), Gmail still refused with
`SPF_FAILED` because `spf=softfail`. Ordinary mail delivery was unaffected — only
AMP cares. This is not stated in `docs/google-setup-guide.md`.

### Workspace DKIM is not automatic

`google._domainkey.<domain>` must be generated under Admin console → Apps →
Google Workspace → Gmail → *Authenticate email* and published as a TXT record.
Until then Google signs with its default `*.gappssmtp.com` selector, which is
**not aligned** with the `From` domain and does not satisfy AMP. A 2048-bit key
comes back from `dig` as two quoted strings — that is normal for values over 255
bytes, not a corrupted record.

### After a DNS change, wait one full old-TTL period before testing

This cost the most time in the session, so it is worth stating bluntly.

Between the edit and full propagation you get **mostly failures with an occasional
success**, because each resolver instance holds the old record for its own TTL
from its own fetch. Observed: `pass` 14:35 → `softfail` 14:41 / 16:13 / 16:21 →
`pass` 22:42 (the old TTL was 21600s = 6h).

**One `pass` proves the record is correct. A `softfail` inside the window proves
nothing.** Reading in-window failures as signal sent this session down eight
dead-end hypotheses (multiple SPF records, legacy type-99 SPF records, the 10-term
lookup limit, the per-`mx` address-record limit, broken DNSSEC, authoritative-NS
disagreement, stray `_spf.` subdomains, mechanism ordering). All were measured and
all were negative. Lowering the TTL does **not** help retroactively — it only
affects future fetches.

Google's word for a `~all` softfail in the header text is **"transitioning"**
(`domain of transitioning user@…`). Seeing it means the record that was evaluated
lacked the sender's range — i.e. a stale copy.

### Useful checks

```bash
dig +short TXT <domain> @8.8.8.8 | tr -d '"' | grep spf1
dig +short TXT google._domainkey.<domain> @8.8.8.8
for ns in $(dig +short NS <domain>); do dig +short TXT <domain> @"$ns"; done
```

---

## 5. SMTP XOAUTH2 rejects `gmail.send` — measured

`smtp.gmail.com:465` answers `AUTH XOAUTH2` bearing a `gmail.send` token with a
`334` challenge that base64-decodes to:

```json
{"status":"400","schemes":"Bearer","scope":"https://mail.google.com/"}
```

Gmail names the scope it demands. `gmail.send` works for `users.messages.send`
but is **not accepted by SMTP AUTH**.

The probe was verified clean via `https://oauth2.googleapis.com/tokeninfo?access_token=…`,
which listed only `gmail.send`/`openid`/`email`. **Always verify a scope probe with
tokeninfo** — a live broader grant for the same OAuth client can make Google mint a
token carrying previously-authorized scopes even when you request less, which
reads as a false PASS.

Since `https://mail.google.com/` is a *restricted* scope (read + permanently
delete + send over the whole mailbox) and this repo forbids mail read scopes, the
shippable channels are the ones with **no Google OAuth in the send path**:

| Channel | Google OAuth scope | What it needs |
|---|---|---|
| SMTP + app password on a dedicated mailbox | none | the mailbox + 2FA enabled on it |
| Workspace SMTP relay | none | Admin console config; IP auth is fragile on monday-code |
| External ESP | none | a vendor; native `text/x-amp-html` support |

Note on classification: a *restricted* scope forces Google's CASA security
assessment (with annual renewal) once the consent screen is **External**. An
**Internal** consent screen escapes it — which is why local testing with the broad
scope is possible at all, and why it does not generalize to shipping.

---

## 6. Two repo claims that were disproven

Recorded so nobody re-derives them.

**"The 3-part order and base64 encoding are hypotheses about `INTERNAL_ERROR`."**
Both are false as explanations. A 5-variant matrix — no extensions / 2 parts only /
quoted-printable / `⚡4email` spelling / amp-before-plain — failed **identically**,
which is the signature of a sender-side condition, not a MIME one. The real cause
was §2 + §4. Base64 and the plain→amp→html order are still worth keeping for their
own independent reasons (7-bit safety, CRLF integrity, preheader source), just not
as `INTERNAL_ERROR` remedies.

**"`users.messages.send` with `gmail.send` is the production sending path."**
It cannot carry AMP at all (§2).

---

## 7. Still open

- **RESOLVED (commit `a197bf9`, 2026-08-04)** — ~~`src/helpers/digest-amp.js`
  carries 10 strict-CSS violations~~ that amp4email
  rejects: `border-inline-end` ×4, `padding-inline-start`, `inset-inline-end`
  (logical properties — natural in an RTL-first app, but not allowed), plus
  `pointer-events`, `transition: filter`, `cursor: progress`, `filter: none`.
  They only surface with `data-css-strict` on the `<html amp4email>` tag; without
  it the validator PASSes and hides them, while **Gmail enforces strict CSS
  regardless**. Add the attribute and fix them.
  ```bash
  npx amphtml-validator --html_format=AMP4EMAIL <file>
  ```
  → `data-css-strict` added and every violation fixed (physical properties are
  exact stand-ins since `dir=rtl` is fixed in the document); `npm run
  validate:amp` runs the strict validation in CI.
- **RESOLVED (commits `c67b669` + `82c7694`, 2026-08-04)** — ~~Migrating
  `gmail-sender.js` off the Gmail API~~ (§2, §5) — owner decision, taken
  2026-08-04: for the **testing phase** the channel is SMTP XOAUTH2 with the
  broad `https://mail.google.com/` scope (Internal consent screen, so no CASA —
  §5's classification note). `c67b669` broadens the scope + persists the granted
  scope; `82c7694` ships `src/services/smtp-sender.js` (nodemailer, 465,
  scope pre-flight, one-refresh retry). `gmail-sender.js` is kept for
  reference/rollback only. The §5 table's no-OAuth channels remain the candidates
  for the **production** decision, which is still open. Post-merge live
  verification: `docs/manual-verification-checklist.md` (incl. the unproven
  outbound-465 risk from monday-code).
- **AMP sender registration** with `ampforemail.whitelisting@gmail.com`
  (~5 working days, per sender address) for recipients outside the org.

## 8. Component notes

- **`amp-lightbox` is deprecated in AMP4EMAIL** — the validator warns "cannot be
  properly positioned in emails and will soon be invalid". Use `amp-accordion`
  for an in-message panel and a `target="_blank"` link for a real window.
- `disable-session-states` is **not** a valid `amp-accordion` attribute here.
- `target` may not appear on `<form>` in amp4email.
- A `<form>` requires `action-xhr` even when nothing submits — an `<input>` can
  drive `amp-bind` directly and never call the endpoint.
