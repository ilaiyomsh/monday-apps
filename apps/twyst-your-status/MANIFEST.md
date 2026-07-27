# Twyst Your Status — validation manifest

## Existing Status Column contract

- App ID: `11775054`
- Draft app version inspected: `16381642`
- Column feature type: `AppFeatureStatusColumn`
- On-click dialog feature type: `AppFeatureDialog`
- GraphQL schema validated against the current monday schema on 2026-07-27.
- Captured scratch response: `src/test-utils/probes/status-column-context.json`.
- Scratch isolation: workspace `16291824`, `WZ-` board/item only; the board was deleted after read/write/readback validation.

## Product rules

Configured labels are omitted from the user picker. If monday automation or the API
sets a configured label, the selected value remains visible as the current value but
is not rendered as a selectable option.

The Workflow engine adds:

- Board View configurator at `/?view=board`.
- Item View workflow panel at `/?view=item`.
- monday-code API and authenticated `change_column_value` webhook.
- Allowed-edge, user/team permission, and required-field validation.
- Rollback with a short-lived expected-change marker to prevent webhook loops.
- Per-item audit history (newest 200 entries).

Configuration and audit data are stored by the monday-code `SecureStorage` adapter with
explicit account, board, and item namespaces. Instance storage is intentionally not the
shared source of truth because separate Board View, Item View, and Status Column feature
instances do not share one instance-storage namespace.

## External version configuration still pending approval

- Board View feature URL: `/?view=board`
- Item View feature URL: `/?view=item`
- OAuth redirect URL: `/oauth/callback`
- Required scopes: `boards:read`, `boards:write`, `users:read`, `teams:read`,
  `webhooks:read`, `webhooks:write`, `notifications:write`
- monday-code environment: `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`,
  `MONDAY_SIGNING_SECRET`, `BASE_URL`

Scope and feature changes have not been applied to draft version `16381642`, and no code
has been deployed. Existing installations may require reauthorization after scopes change.
