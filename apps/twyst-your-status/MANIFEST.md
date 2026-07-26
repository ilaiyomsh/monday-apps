# Twyst Your Status — validation manifest

## Status column contract

- App ID: `11775054`
- Draft app version inspected: `16381642`
- Column feature type: `AppFeatureStatusColumn`
- On-click dialog feature type: `AppFeatureDialog`
- GraphQL schema validated against the current monday schema on 2026-07-27.
- Captured scratch response: `src/test-utils/probes/status-column-context.json`.
- Scratch isolation: workspace `16291824`, `WZ-` board/item only; the board was deleted after read/write/readback validation.

## Product rule

Configured labels are omitted from the user picker. If monday automation or the API
sets a configured label, the selected value remains visible as the current value but
is not rendered as a selectable option.

This is a picker-level guard, not an account-wide authorization boundary. Other monday
surfaces, automations, integrations, and direct API writes can still set the label.
