# The telemetry egress boundary — what actually ships to Axiom

Learned during the 2026-08-04 security scan of `apps/discussions`
(commit `b35e233`, see `docs/SECURITY-SCAN-REPORT.md` Finding 2).

## The one-line rule

**Attaching `query`, `variables`, or any raw payload to a log record does NOT leak it
to Axiom.** `mapRecordToEvent()` in `packages/error-kit/dist/browser/axiomSink.js` is a
strict **allowlist** mapper, and it is the only thing standing between the logger's
`record.context` and the network. Treat it as a security boundary.

## What the allowlist actually ships

Shipped event fields, and nothing else:

```
level, tag, message, kind, corr,
err_name, err_code, stack1, stack, err_msg,
ms, total_ms, step, component_stack
```

From `record.context` it reads **only** `duration`, `totalMs`, `step`, and
`componentStack`. It never reads `context.query`, `context.variables`,
`context.rawResponse`, or `record.data`. `err_msg`, `stack`, and `component_stack` pass
through `redact()` (email → `[email]`, token-shaped → `[redacted]`, digit runs → `[num]`).

The transport (`axiomTransport.js`) adds only identity enrichment —
`app, env, ver, sess` and `acc/usr/obj/board`. Its internal variable is also called
`context`; that is the identity map, **not** the logger's `record.context`. Do not
confuse the two when reading `{ ...context, ...ev, … }` at the flush step.

## Two consequences that are easy to get backwards

1. **A reviewer reading only the call site will over-report.** `client.js:279/321/330`
   attach the full GraphQL document and its variables — user-authored business content
   — with no redaction at that layer. That looks like a data-egress finding and is not
   one. The unredacted values live only in the client ring buffer, the in-memory error
   object, and `ErrorDetailsModal` — all visible solely to the user who already owns the
   data. Trace to `mapRecordToEvent` before assigning severity.
2. **Adding a field to the allowlist is a security change, not a telemetry change.**
   Anything that widens the mapper — or any future `{ ...record.context }` spread —
   silently starts shipping business content. Worth a regression test asserting
   `context.query` / `context.variables` never appear in a mapped event.

## Level policy, and the incident override

`shouldShip()`: duplicates never ship; records flagged `alwaysShip` (usage/health at
INFO) bypass the level gate; otherwise **WARN/ERROR only**.

So `logger.api()` (level `DEBUG`, carries `{ query, variables }` in context) does not
ship under the default policy. Note that `emit()` calls `dispatchToSinks()` for **every**
non-duplicate record regardless of level — the `consoleEnabled` flag gates console
rendering only. Level filtering happens **inside the sink**, not in the logger. A
sink written without its own level check will receive everything.

`remoteLevel` (read once at module load from `localStorage`) is an incident override
that can lower the threshold to DEBUG. It increases record *volume*; because of the
allowlist it still does not ship variables.

## Do not trust the documented activation state — check the secret

`docs/ERROR-AXIOM-STANDARD.md` §"Activation status" listed `AXIOM_INGEST_TOKEN` as
still required, with "the gate stays inert" as the consequence. The secret had in fact
existed since **2026-07-22** — six days before that section's own "last verified" date —
and live builds had been shipping an active sink ever since.

That drift caused a prior manual review to classify a live telemetry path as dormant.
Before concluding a sink is inert:

```bash
gh secret list --repo ilaiyomsh/monday-apps        # names only, no values
gh run list --workflow=deploy-live-<slug>.yml --limit 5
```

The client gate is `import.meta.env.PROD === true && dataset && token && app`
(`src/index.jsx`), and the workflows inject all three in the **Build** step. Token
present + a deploy since = the sink is live, whatever the docs say.
