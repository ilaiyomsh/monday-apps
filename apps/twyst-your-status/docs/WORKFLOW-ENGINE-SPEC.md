# Twyst Your Status — Workflow Engine

## Product outcome

Turn a monday Status column into a governed workflow. Administrators configure valid
state transitions and their conditions; users perform transitions from an Item View;
and a monday-code backend detects direct board edits, rolls back invalid changes, and
records an audit trail.

The existing protected-label picker remains a separate policy layer:

- `hiddenManualLabelIds` controls which labels are absent from the custom cell picker.
- `transitions` controls which state changes are valid, regardless of where they began.

This separation preserves the original use case in which an automation can set a label
that users cannot select manually, while still allowing the workflow engine to validate
the resulting transition.

## Confirmed platform constraints

1. `monday.storage.instance` is isolated to one view instance. A Board View and an Item
   View cannot use it as their shared source of truth.
2. Shared configuration and audit data will use app-global/shared Storage, namespaced by
   account, board, and item. Backend writes use optimistic versioning.
3. A board webhook observes a change after monday has applied it. Enforcement is therefore
   eventual rollback, not a synchronous veto; an invalid value may appear briefly.
4. Rollback itself emits another webhook. Every rollback requires an expiring suppression
   record and live-value recheck to prevent loops and stale-event overwrites.
5. Authenticated, app-owned board webhooks require an app OAuth token. Registration happens
   when an administrator enables/saves workflow enforcement for a board, because an account
   installation event does not identify a board.
6. Webhook payloads provide `userId`, `previousValue`, `value`, and trigger identifiers, but
   monday does not document a reliable generic flag that distinguishes every automation
   from every manual/API change. Generic “all automations bypass permissions” is therefore
   not a safe authorization rule.

## Configuration schema (v1)

```json
{
  "schemaVersion": 1,
  "accountId": "123",
  "boardId": "456",
  "targetColumnId": "status",
  "hiddenManualLabelIds": ["7"],
  "transitions": [
    {
      "id": "review-to-approved",
      "fromLabelId": "2",
      "toLabelId": "3",
      "permissions": {
        "mode": "allowlist",
        "userIds": ["1001"],
        "teamIds": ["2001"]
      },
      "requiredColumnIds": ["email"],
      "formFields": [
        {
          "columnId": "rejection_reason",
          "required": true,
          "label": "סיבת הדחייה"
        }
      ]
    }
  ],
  "enforcement": {
    "enabled": true
  },
  "updatedAt": "2026-07-27T10:00:00.000Z",
  "updatedBy": "1001"
}
```

Identifiers are stored as canonical strings. A transition is unique by
`fromLabelId + toLabelId`; duplicate edges are rejected. `permissions.mode = "any"`
ignores the allowlists. `allowlist` permits the actor when either the actor ID or one of
the actor's team IDs matches.

## Audit schema (v1)

```json
{
  "id": "trigger-uuid-or-app-intent-id",
  "accountId": "123",
  "boardId": "456",
  "itemId": "789",
  "columnId": "status",
  "actorUserId": "1001",
  "fromLabelId": "2",
  "toLabelId": "3",
  "occurredAt": "2026-07-27T10:01:00.000Z",
  "source": "item_view",
  "transitionId": "review-to-approved",
  "formValues": {
    "rejection_reason": "מחיר"
  }
}
```

Audit entries are stored as a bounded per-item log with optimistic retries and newest
entry first. The first release caps the retained log at 200 entries per item.

## Enforcement decision contract

The pure validation engine receives configuration, actor identity/team IDs, the current
item values, and an attempted `from -> to` transition. It returns exactly one of:

- `allow` with the matched transition.
- `deny: transition_not_defined`.
- `deny: actor_not_permitted`.
- `deny: required_fields_missing` with the exact missing column IDs.
- `ignore: target_column_not_managed`.
- `ignore: internal_rollback`.
- `ignore: no_state_change`.

Missing-field semantics in v1:

- `null`, `undefined`, empty string, whitespace-only text, empty array, and empty object
  are empty.
- `0` and `false` are filled values.
- A monday column value is filled when either its structured `value` contains data or its
  rendered `text` is non-blank.

## Delivery backlog

### Epic 0 — Architecture and contracts

- **WF-001 — Technical contract.** Document storage, auth, webhook, rollback, and audit
  decisions. Acceptance: this document and versioned schemas exist in source control.
- **WF-002 — Live API validation.** Validate every GraphQL field, enum, and mutation against
  API version `2026-04`; capture scratch fixtures before landing monday-facing mocks.
- **WF-003 — Scope plan.** Configure only approved scopes and document reauthorization.

### Epic 1 — Domain and persistence core

- **WF-101 — Normalize workflow configuration.** Reject unsupported versions and invalid or
  duplicate transitions; canonicalize IDs without changing transition order.
- **WF-102 — Evaluate transition permission.** Support `any`, user allowlist, and team
  allowlist with OR semantics.
- **WF-103 — Evaluate required fields.** Return exact missing column IDs and treat `0`/`false`
  as filled.
- **WF-104 — Produce enforcement decisions.** Return stable result codes for allow, deny,
  and ignore paths.
- **WF-105 — Storage repository.** Shared config keys, audit keys, optimistic concurrency,
  bounded logs, pending intents, idempotency, and rollback suppression records.

### Epic 2 — monday-code backend

- **WF-201 — Server shell.** Express app, health route, one terminal error middleware,
  process guards, and monday-code environment loading.
- **WF-202 — Session authentication.** Verify view `sessionToken` with Client Secret and
  bind account/user identity to every frontend API request.
- **WF-203 — Board webhook authentication.** Echo challenge, verify JWT with Signing Secret,
  validate audience/expiry, and never log token contents.
- **WF-204 — Configuration endpoints.** Authenticated GET/PUT for board configuration;
  require monday account admin on writes.
- **WF-205 — OAuth 2.1 account connection.** Admin authorization, secure token storage,
  refresh/revocation, and reauthorization state.
- **WF-206 — Webhook registration manager.** List app-owned webhooks, create/update the one
  managed status webhook, persist its ID, and remove stale column subscriptions.
- **WF-207 — Webhook processor.** Dedupe by trigger ID, serialize per item/column, fetch live
  item state and configuration, and evaluate the pure engine.
- **WF-208 — Safe rollback.** Re-read live status, roll back only when it still equals the
  denied target, write suppression before mutation, and ignore the matching rollback event.
- **WF-209 — Notification.** Send a specific Hebrew reason to the actor for denied changes.
- **WF-210 — Audit append.** Record allowed changes exactly once, including pending Item View
  form data when present.

### Epic 3 — Board View configurator

- **WF-301 — Admin gate and board context.** Only account admins can edit; other users see a
  read-only summary.
- **WF-302 — Target column picker.** Load active Status columns and select one managed target.
- **WF-303 — Transition matrix editor.** Add/remove multiple directed edges per source state;
  prevent duplicates and self-transitions.
- **WF-304 — Permission editor.** Pick users and teams per transition and choose `any` or
  `allowlist`.
- **WF-305 — Required-column mapping.** Pick existing board columns required before a
  transition.
- **WF-306 — Transition-form mapping.** Pick supported writable columns, required flag, and
  optional prompt label.
- **WF-307 — Protected labels.** Manage `hiddenManualLabelIds` in the same board workflow.
- **WF-308 — Save and enable.** Validate draft, persist config, provision/update webhook,
  and show distinct success/error states.

### Epic 4 — Item View workflow panel

- **WF-401 — Current state.** Display the live status label and monday color.
- **WF-402 — Available transition model.** Show only outgoing transitions; hide or disable
  unauthorized transitions consistently.
- **WF-403 — Smart transition modal.** Collect configured form values and expose missing
  pre-existing required columns.
- **WF-404 — Transition intent.** Store authenticated intent/form metadata before the monday
  column mutation so the resulting webhook can audit it.
- **WF-405 — Apply transition.** Update form columns and target status using a validated,
  captured GraphQL payload; report soft-200 GraphQL errors as failures.
- **WF-406 — Audit table.** Show actor, from/to, timestamp, source, and collected fields with
  empty/loading/error states.

### Epic 5 — Existing column picker integration

- **WF-501 — Shared policy key.** Migrate the current protected-label config into the workflow
  config while continuing to read the v1 legacy key during migration.
- **WF-502 — Transition-aware options.** For configured workflows, the picker exposes only
  valid outgoing manual transitions in addition to hiding protected labels.
- **WF-503 — Read-only protected current value.** Preserve the already implemented behavior.

### Epic 6 — Verification and release readiness

- **WF-601 — Domain mutation gates.** Every new logic module reaches test-guard DONE with at
  least two killed semantic mutations.
- **WF-602 — Backend contract tests.** JWT failures, challenge, duplicate delivery, stale
  rollback, internal rollback, permission denial, missing fields, storage conflicts, and
  GraphQL soft errors.
- **WF-603 — Scratch integration probes.** Create a `WZ-` board only in workspace `16291824`,
  register webhook, run allowed/denied/rollback scenarios, capture fixtures, then delete the
  webhook and board.
- **WF-604 — UI smoke.** RTL/LTR, admin/member/view-only, missing config, empty audit, modal,
  denied and successful transitions.
- **WF-605 — Pipeline conversion.** Change app type from client-only CDN to monday-code,
  add Board View and Item View features, and verify draft pipeline wiring.

## Required scopes (pending explicit approval)

- `boards:read` — load boards, columns, items, and values.
- `boards:write` — apply transitions and rollbacks.
- `users:read` — user picker and actor display.
- `teams:read` — team picker and membership checks.
- `webhooks:read` — reconcile existing app-owned board webhooks.
- `webhooks:write` — create/delete the managed board webhook.
- `notifications:write` — notify the actor when a change is rolled back.

Changing scopes can require existing installations/users to reauthorize the app.

## Product decisions still requiring owner confirmation

1. **Automation policy.** Recommended v1: hidden labels may still be set externally, but
   every resulting transition must be defined and satisfy required fields. Do not grant a
   generic automation permission bypass because monday does not expose a reliable universal
   automation-source flag. A later first-party workflow action can carry a verifiable intent.
2. **Unauthorized button UX.** Recommended v1: show disabled with a concise reason for known
   transitions, rather than hiding it; this teaches users what approval path exists.
3. **Audit retention.** Recommended v1: keep the newest 200 entries per item. Increase only
   after measuring real usage and storage contention.
