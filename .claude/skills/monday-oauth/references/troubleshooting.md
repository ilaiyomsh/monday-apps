# monday OAuth — troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid request — code_challenge is required` on the authorize screen | The app VERSION has the New OAuth Flow enabled (default for newly created apps) but the code sends a legacy authorize request | Migrate the code to OAuth 2.1 (SKILL §3–4). There is NO disable toggle inside the new flow — do not hunt for one. |
| `invalid_grant` on token exchange (authorization_code) | Code reused, expired, or the `code_verifier` does not match the `code_challenge` | One exchange per code; verify the verifier is the SAME one stored with that state nonce. |
| `invalid_grant` on refresh | Rotation burned (a concurrent refresh spent the single-use token), grant revoked, or the 6-month lifetime hit | Re-authorize (the only fix). Prevent recurrence: single-flight mutex + persist the rotated token BEFORE using the new access token. |
| Refresh works locally, dies in prod after a deploy | Two instances refreshed concurrently (cross-instance race) | Rare with a 5-min cushion; self-surfaces as `reauth_required`. If frequent, move the refresh to a single cron owner. |
| "invalid signature" verifying a sessionToken | Verified with the SIGNING secret | Use the CLIENT secret (SKILL §1). |
| Webhook JWT 401s on every delivery | Verified with the CLIENT secret | Board/integration webhooks use the SIGNING secret; only app-lifecycle webhooks use the client secret. |
| Authorize succeeds but the token lands on the wrong app version's scopes | Draft testing without `app_version_id` | Set `MONDAY_APP_VERSION_ID` so `/start` appends `app_version_id`; clear it after promote. |
| Callback 400 "invalid or expired" | State nonce replayed (double-click / re-visit) or >10 min on the consent screen | Expected behavior — start again. Forged `state` values look identical by design. |
| Dashboard/board writes silently stop ~6 months after authorize | Refresh token hit the 6-month max lifetime | Watch for `oauth_refresh_invalid_grant` in Axiom; the Settings UI shows the re-authorize CTA (`reauth_required`). |

## Axiom probes (axiom-sre skill, dataset `app-errors`)

```apl
// All OAuth lifecycle events for an app, most recent first
['app-errors'] | where app == '<slug>' and message startswith 'oauth_'
| project _time, message, tag, level | sort by _time desc | take 50

// The alertable signal: refresh death → re-auth needed
['app-errors'] | where message == 'oauth_refresh_invalid_grant' | summarize count() by app, bin(_time, 1d)

// Exchange failures after a deploy (regression canary)
['app-errors'] | where message startswith 'oauth_token_exchange' | summarize count() by app, message
```

Privacy check (should ALWAYS return 0 rows — tokens must never be logged):
run a broad `contains` sweep for a token prefix you just minted in a test
account; any hit is a sanitizer regression.
