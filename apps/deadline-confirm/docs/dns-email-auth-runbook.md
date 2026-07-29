# Runbook — guiding a Workspace admin through the two DNS records

**Audience: a code agent.** You cannot do this task. It requires Google Workspace
super-admin access and DNS write access, and you have neither. Your job is to
walk a human through it, catch the mistakes people actually make, and refuse to
declare success without the one verification signal that proves it worked.

**Read the whole runbook before your first message to the user.** The failure
modes section is the reason this document exists; discovering it after the admin
has already saved a wrong record costs a DNS propagation cycle.

---

## 1. Why this blocks the product

Gmail renders the `text/x-amp-html` part of an email — the interactive digest —
only when the message passes sender authentication. Google's requirements are
absolute, not advisory:

> "The email must pass Domain Keys Identified Mail (DKIM) authentication."
> "The DKIM-authenticated signing domain must be aligned with the domain of the
> email in the `From` field."
> "The email must pass Sender Policy Framework (SPF) authentication."

Without them Gmail does not merely hide the interactive part — **it strips the
AMP MIME part out of the message during delivery.** Verified on 2026-07-29: the
sent copy carried `multipart/alternative` with both parts; the delivered copy at
the recipient was `Content-Type: text/plain` alone, same `Message-ID`.

So the visible symptom is "the email arrives as a plain list and the buttons are
gone", and nothing in the application logs will explain it. This is the first
thing to suspect when a newly-connected organization reports that.

## 2. The signature of the problem

If DKIM has never been configured for the domain, Google still signs outgoing
mail — with a **fallback domain it owns**, which does not align with the `From`
header. In Gmail, open a message the app sent, expand the details panel, and read
the **"Signed by" / "חתום בידי"** line:

| What it shows | Meaning |
|---|---|
| `<domain-with-dashes>.<date>.gappssmtp.com` | ✗ Google's fallback. DKIM passes but does NOT align. This is the broken state. |
| the organization's own domain | ✓ Configured correctly. |

Real example of the broken state, from the Twyst rollout:

```
DKIM-Signature: d=twyst-co-il.20251104.gappssmtp.com
dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=twyst.co.il
spf=softfail (... does not designate 209.85.220.41 as permitted sender)
```

DKIM "passed" and the mail still failed, because alignment and SPF are separate
requirements. Do not let a `dkim=pass` alone convince you the domain is fine.

## 3. Before you give any instructions — establish four facts

Ask for these in one message. Do not start the walkthrough until you have them,
because the answers change who has to do what.

1. **The sending domain.** Take it from the `From` address of a message the app
   sent — not from the company's website, which is often a different domain.
2. **Who has Workspace super-admin.** Only a super-admin sees
   *Authenticate email*. A regular admin will report the menu as missing and you
   will waste a round guessing why.
3. **Who controls DNS for that domain.** Very often a different person, or an
   external IT provider, or a registrar the company no longer has the login for.
   This is the most common source of multi-day delay — surface it on day one.
4. **Whether an SPF record already exists.** Decides whether step 5 is "add" or
   "merge", and merging wrongly breaks all of the organization's outbound mail,
   not just this app.

If the DNS holder is a third party, ask for the exact records to be sent to them
as a written change request rather than relayed verbally. Long TXT values get
corrupted when read out.

## 4. Record 1 — DKIM

**Console steps** (super-admin, at `admin.google.com`):

1. **Apps** → **Google Workspace** → **Gmail** → **Authenticate email**.
2. Pick the domain from the selector if the account hosts several.
3. **Generate new record.** Accept the defaults: **2048-bit** key and the
   **`google`** prefix (selector), unless the registrar rejects 2048-bit — see
   failure modes.
4. Google now shows two values. Have the admin copy both **verbatim**:
   - a **host / name**, which will be `google._domainkey`
   - a long **TXT value** beginning `v=DKIM1; k=rsa; p=…`
5. **Leave this console page open.** Step 7 lives here.

**DNS step:** add a **TXT** record at the registrar with that host and value.

**Then, and only then:** back in the console, click **Start authentication**.
Google verifies the record is live before switching signing over. Clicking it
before DNS has propagated fails and the admin has to come back.

Propagation is usually minutes, sometimes up to 48 hours. If **Start
authentication** errors, wait and retry rather than regenerating the key — a
second key replaces the first and invalidates the record already published.

## 5. Record 2 — SPF

A single **TXT** record at the **domain root** (`@`, or the bare domain, or blank
— registrars differ):

```
v=spf1 include:_spf.google.com ~all
```

**The rule that matters more than the value: a domain may have exactly ONE SPF
record.** Two SPF TXT records make SPF evaluation return `permerror`, which
fails SPF for *everything* the domain sends. This is a strictly worse outcome
than having no record at all.

So:

- **No SPF record exists** → add the line above as-is.
- **An SPF record already exists** → do **not** add a second one. **Edit** the
  existing record and insert `include:_spf.google.com` before its final `all`
  mechanism, keeping every other mechanism intact. For example
  `v=spf1 include:sendgrid.net ~all` becomes
  `v=spf1 include:sendgrid.net include:_spf.google.com ~all`.

Before proposing a merged value, ask the admin to paste the current record and
compose the new one **for** them. Do not describe the edit in prose and hope —
this record governs all of the organization's outbound mail.

## 6. Optional but recommended — DMARC

Not one of the two required records. Google recommends a policy of `quarantine`
or `reject` and notes it **may be enforced in the future**, so it is worth
raising once rather than discovering later.

TXT at `_dmarc.<domain>`:

```
v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@<domain>
```

Advise starting at `p=none` with `rua` reporting for a couple of weeks on a
domain that sends from several services, so legitimate senders surface before a
policy starts quarantining them.

## 7. Verification — do not skip, and do not accept a substitute

**What you can check yourself,** if the environment has outbound DNS:

```bash
dig +short TXT google._domainkey.<domain>    # expect v=DKIM1; k=rsa; p=...
dig +short TXT <domain> | grep spf1          # expect exactly ONE line
```

Two `v=spf1` lines is the failure in §5. Say so immediately.

DNS resolving correctly is **necessary but not sufficient** — it proves the
records exist, not that Google switched signing over. Only a real message proves
that.

**What the admin must confirm.** Ask them to send one digest to a mailbox on a
**different domain** (a personal `gmail.com` address is fine) and read the
**"Signed by"** line:

- shows the organization's domain → **done**
- still shows `…gappssmtp.com` → *Start authentication* was never completed, or
  it failed. Send them back to §4 step 7.

For a stricter check, have them open **Show original** and confirm all three:

```
dkim=pass header.i=@<domain>
spf=pass
dmarc=pass
```

## 8. Two traps that will otherwise waste an hour

**Do not test by sending to an address on the same domain.** Mail between two
mailboxes in the same Workspace is delivered internally and never traverses SMTP,
so it carries **no `DKIM-Signature` and no `Authentication-Results` at all** — not
a failing signature, none. Verified 2026-07-29: `ilai@twyst.co.il` →
`ido@twyst.co.il` arrived with neither header. AMP can never render on such a
message, so a test like that tells you nothing about DKIM. **Always test
cross-domain.**

**Correct DNS is not sufficient to see the interactive part.** Until the sender
address is registered with Google for dynamic email, each recipient must also
add it to their own **Gmail → Settings → General → Dynamic email → Developer
settings** allowlist. That setting is per mailbox and invisible to everyone else.
A recipient who has not done it sees the plain list **with no error banner at
all** — indistinguishable, to them, from the DNS problem.

These two conditions are independent, and the whole class of confusion here comes
from testing both at once. When a test fails, change one variable.

## 9. Boundaries

- **Never ask for, accept, or store** Workspace credentials, registrar logins, or
  a DKIM private key. Nothing in this runbook requires a secret to reach you. If
  the user offers one, decline and tell them it is not needed.
- **Never claim the records are correct because the admin says they saved them.**
  The verification in §7 is the only evidence. Registrars silently rewrite host
  names and truncate long values.
- **Never suggest working around a failing check** — no relaxing the SPF
  qualifier to `+all`, no removing DMARC to make a report go green. These are
  the controls the customer's security review will examine.
- If DKIM cannot be configured (the domain's DNS is genuinely inaccessible), say
  plainly that the interactive email cannot work on that domain, and that the
  plain-text fallback is what recipients will get. Do not present a partial
  configuration as working.

## 10. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| *Authenticate email* not in the menu | Not a super-admin | Escalate to a super-admin |
| **Start authentication** errors | TXT not propagated yet | Wait, retry. Do NOT regenerate the key |
| "Signed by" still `…gappssmtp.com` after adding DNS | *Start authentication* never clicked | §4 step 7 |
| `dig` shows the TXT at `google._domainkey.<domain>.<domain>` | Registrar auto-appends the domain; admin pasted the FQDN | Re-enter the host as `google._domainkey` only |
| DKIM record present but invalid / truncated | Registrar's 255-char limit per string | Re-enter split into quoted chunks, or use the registrar's DKIM-specific field |
| `spf=permerror`, all mail failing SPF | Two SPF records | Merge into one — §5 |
| `dkim=pass` but `dmarc=fail` | Signing domain does not align with `From` | This is the fallback-domain state. DKIM is not actually configured — §4 |
| Everything passes, still no interactive part | Recipient has not allowlisted the sender | §8, second trap |
| Registrar rejects the 2048-bit key | Provider limitation | Regenerate at 1024-bit; note it as weaker and revisit |

## 11. Closing report

When §7 passes, tell the user in plain terms:

- which records were added, at which hosts
- that "Signed by" now shows their domain, quoting it
- that DKIM, SPF and DMARC all pass, quoting the `Authentication-Results` line
- and — if it is still true — that each test recipient must allowlist the sender
  until production sender registration with Google completes

If it does not pass, report exactly which of the three failed and which failure
mode in §10 you matched. Do not report partial success as success.
