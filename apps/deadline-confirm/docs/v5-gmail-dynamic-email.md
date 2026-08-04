# V5 design log — Gmail dynamic email (AMP for Email)

> **Superseded by V6 (2026-07-27).** V6 removes the HTML fallback and `/confirm`
> entirely — see `docs/v6-amp-only-decisions.md` and the V6 Amendment in
> `docs/spec.md`. Sections below on "additive, never a replacement" and per-task
> `/confirm` links describe the **pre-V6** model and are kept for history only.

Owner session 2026-07-26. Records WHY, not just what; the spec (`docs/spec.md`,
V5 Amendment) is the normative statement.

## 1. The pivot

Earlier exploration targeted **Outlook Actionable Messages / Adaptive Cards**
for true in-email interactivity. Then the client's platform turned out to be
**Google Workspace (Gmail)** — and Actionable Messages renders in Outlook only.
In Gmail an Adaptive Card is invisible: the reader sees the HTML fallback.

Gmail's equivalent is **AMP for Email**, branded **dynamic email** in Gmail's
UI. It is closer to what we actually want: an HTML-shaped format with real form
controls (`<input type="checkbox">`, `<select>`) that POSTs to our own endpoint
from inside the message. The owner's original request — "a user gets an email
and performs all the updates without leaving the email" — is satisfiable
literally, with checkboxes and one submit button.

Bonus: the client and our own organization both run Workspace, so the whole
flow is testable end-to-end today, against a real mailbox.

## 2. Decisions

1. **Additive, never a replacement.** The digest email carries BOTH parts:
   `text/x-amp-html` (checkboxes) and the existing `text/html` (per-task
   links). Anyone whose client does not render AMP — Outlook, Apple Mail, a
   user who never allow-listed the sender — gets exactly today's email. No
   recipient is ever blocked or shown a broken message. This graceful
   degradation is what makes shipping AMP low-risk, and it lets both models run
   in the same send.
2. **The AMP part goes BEFORE the html part** in `multipart/alternative` — some
   clients render only the last part.
3. **Sender-scoped CORS, default deny.** `/amp/confirm` answers only senders on
   `AMP_ALLOWED_SENDERS`; empty list = nobody. Both documented CORS variants
   are implemented (v2 `AMP-Email-Sender` preferred, v1 `Origin` +
   `__amp_source_origin` supported), and the wildcard `*` the spec permits is
   deliberately NOT supported — echoing it would let any sender's email drive
   our endpoint.
4. **The CORS gate runs before any I/O.** It is pure header work, so putting it
   first means an unauthorized caller never reaches storage and cannot use the
   endpoint to probe whether a link secret is valid. A rejection carries no
   CORS headers at all, which makes the email client discard the response
   rather than render it as a soft failure.
5. **Bulk, but bounded.** One submission may carry up to `MAX_ITEMS = 50` tasks
   (one section's worth). Each is run through the SAME `performAction` engine
   as `/confirm`, so already-at-target remains a silent success, duplicate ids
   collapse, and nothing is ever written twice.
6. **No new identity claim.** Unlike Outlook Actionable Messages — which sends
   a signed Bearer token identifying the clicker — an AMP form POST carries no
   verified user identity. The per-account link secret embedded in the email
   remains the only credential, exactly as in v3. This is a real difference
   from the Microsoft design and must be stated as such in any security
   review: the trust model did not improve, it stayed the same.
7. **Sending stays manual for now.** Resend's support for a
   `text/x-amp-html` part is undocumented, so phase 1 exposes the AMP document
   through `GET /api/digest/preview` (`amp` field) and the admin panel copies it
   into the AMP playground. Phase 2 sends it properly (§5).
8. **Checkbox first, status dropdown later.** The format also supports a
   `<select>` per row (a status dropdown per task). The owner has seen a mock;
   no decision yet. The checkbox model ships first because it maps 1:1 onto the
   existing per-button target-label semantics with no new server concepts.

## 3. What Gmail requires (verified against the AMP + Gmail specs)

Document validity — an invalid document is silently dropped to the HTML
fallback, so these are hard requirements:

- `<!doctype html>` + `<html amp4email>` (or `⚡4email`)
- `<meta charset="utf-8">` as the FIRST child of `<head>`
- `<style amp4email-boilerplate>body{visibility:hidden}</style>`
- scripts ONLY from `cdn.ampproject.org` (`v0.js` + `amp-form` + `amp-mustache`)
- POST forms use `action-xhr`; `action`/`target` are website-only attributes
- responses must be `Content-Type: application/json`, rendered through
  `<template type="amp-mustache">`; redirects are disallowed at runtime
- whole AMP part < 200,000 bytes, `<style amp-custom>` < 50,000 bytes

Client support: Gmail web, Android and iOS. Not Outlook, not Apple Mail.

## 4. Enabling it — the two paths

**Admin (one-time, org-wide, and it is ON by default):**
Admin console → Apps → Google Workspace → Gmail → **User settings** → (per OU)
→ **Dynamic email** → *Enable dynamic email*. Requires the *Gmail Settings
administrator* privilege; changes can take up to 24 hours. This toggle is the
ONLY dynamic-email control an admin has — there is **no** organization-wide
sender allowlist for dynamic email. Worth asking the admin separately whether
content compliance / advanced content filtering might strip MIME parts.

**Then sender approval, one of two ways:**

| | Per-user allowlist | Registration with Google |
|---|---|---|
| Who acts | each recipient, self-service | us, once |
| Where | Gmail → Settings → General → Dynamic email → **Developer settings** → add the sender address | send a real production email including the AMP part **directly** (never forwarded — Gmail strips the AMP part) to `ampforemail.whitelisting@gmail.com`, plus the registration form |
| Time | ~30 seconds per person, immediate | ~5 working days |
| Requirements | none | SPF + DKIM pass with DKIM `d=` aligned to the From domain; TLS; a real worldwide-accessible website at the sender's eTLD+1; low spam-complaint rate; consistent volume |
| Good for | a pilot (5–15 people), internal | rollout, and anyone outside the org |

For testing through the AMP playground, allow-list `amp@gmail.dev` — that is
the playground's sending address.

Note for Workspace senders: DKIM is **not** automatic — it must be generated
under Admin console → Apps → Google Workspace → Gmail → *Authenticate email*
and published as a DNS TXT record before registration can pass.

## 5. Phase 2 — the production sending path

> **DISPROVEN 2026-08-03 — `users.messages.send` cannot deliver AMP.** It strips
> the `text/x-amp-html` part on external delivery, rebuilding the message with its
> own boundary; the byte-identical message over raw SMTP kept all three parts.
> SMTP is also not a drop-in: `AUTH XOAUTH2` rejects `gmail.send` and demands the
> restricted `https://mail.google.com/` scope. The surviving channels have no
> Google OAuth in the send path at all. See
> **`docs/amp-email-verified-findings.md`** §2 and §5. The paragraph below is kept
> for history; do not implement it.
>
> **The channel that WAS implemented (2026-08-04, testing phase):** SMTP XOAUTH2
> with the broad `https://mail.google.com/` scope — `src/services/smtp-sender.js`
> (owner decision suspending D12's no-mail-read rule; production channel still open).

Gmail's compose UI cannot attach an AMP MIME part; sending must be
programmatic. Chosen direction: a **dedicated Google Workspace mailbox** (e.g.
`deadline@…`) sent through the **Gmail API `users.messages.send`** with raw
RFC822, authorized with the **`gmail.send` scope only** — send, never read, and
no access to any other mailbox, calendar, file or admin surface. That is the
same least-privilege story prepared for the security review, in Google form
instead of Microsoft form, and it gives DKIM alignment for free.

## 6. Sources

- AMP for Email format / components / structure / HTML / CSS:
  `ampproject/amphtml` → `docs/spec/email/*.md`
- CORS in AMP for Email (both versions):
  <https://amp.dev/documentation/guides-and-tutorials/learn/cors-in-email>
- `amp-form` (`enctype`, JSON responses, `action-xhr`):
  <https://amp.dev/documentation/components/amp-form>
- Gmail dynamic email: registration, testing, supported platforms, security
  requirements: <https://developers.google.com/workspace/gmail/ampemail>
- Turn dynamic email on or off for users (admin):
  <https://support.google.com/a/answer/9707629>
