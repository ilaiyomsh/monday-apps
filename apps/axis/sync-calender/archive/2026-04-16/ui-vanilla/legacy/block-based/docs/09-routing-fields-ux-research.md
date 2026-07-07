# Routing Fields UX — Research & Decision Log

**Date:** 2026-04-15
**Status:** Research complete, decision pending
**Related code:** `src/routes/actions.js`, `src/routes/webhook.js`, `src/services/monday-triggers.js`, `src/middlewares/authentication.js`

## The Problem

The v3 trigger fires per-event with rich `outputFields`, including three **internal routing fields** that the action needs in order to know how to process the data:

| Field | Purpose |
|---|---|
| `channelId` | Identifies which Google Calendar watch channel sent the event — used to look up `accessToken`, `userEmail`, `userId` from `SecureStorage` |
| `eventId` | Google's event ID — used to reconstruct the event URL (`buildEventUrl(eventId, userEmail)`) for board lookup |
| `eventStatus` | `"confirmed"` or `"cancelled"` — drives the create/update vs delete decision in the action |

These fields are **not** something an end user should know about, configure, or even see. They are pure plumbing between the Trigger and Action of the same app.

In the monday workflow builder, however, the user is required to manually click "Refer to previous step → Step 1: Google Calendar Trigger → Channel ID / Event ID / Event Status" for each one. monday does **not** auto-map these fields by name, even when the action input has the exact same `name` and `type` as the trigger output. Confirmed empirically:

- New automation created on 2026-04-15
- Action input `eventStatus` (String) and trigger output `eventStatus` (String) — both exist with matching name/type
- Action input arrived as `eventStatus=undefined`, action fell through to v2 fallback path, syncToken was already consumed by webhook, **0 events processed → silent data loss**
- User reports: "גם eventid לא מופה אוטומטית" (even eventId is not auto-mapped)

The setup pain affects every user who installs the app. From the user's words:

> "השדות eventStatus, eventId, channelId הם פשוט משתנים שמגיעים עם האירוע מגוגל קלנדר ומסבירים לשרת כיצד להשתמש במידע החדש. מיפוי שלהם ידנית בזמן הגדרת האפליקציה הוא פשוט מעצבן."

## Research Method

Deep web research across:
- monday Developer Center docs ([developer.monday.com/apps/docs](https://developer.monday.com/apps/docs)) — workflow blocks, custom actions, custom triggers, custom field recipes, sentences, dynamic mapping
- monday community forum ([community.monday.com/c/developers/8](https://community.monday.com/c/developers/8))
- monday official sample apps ([github.com/mondaycom/welcome-apps](https://github.com/mondaycom/welcome-apps))
- Local skills at `/Users/ilaish/monday_app/apps/.claude/skills/integration-scaffold/`
- Project-internal docs at `/Users/ilaish/monday_app/apps/sync-calender/docs/`

## Findings

### Finding 1 — monday provides NO mechanism to hide or auto-map action input fields

There is no documented property such as `hidden`, `isInternal`, `system`, `auto`, `defaultValue`, or `defaultBinding` on action input field definitions in any of these references:
- [How to create a workflow block](https://developer.monday.com/apps/docs/how-to-create-a-workflow-block)
- [Custom actions](https://developer.monday.com/apps/docs/custom-actions)
- [Custom triggers](https://developer.monday.com/apps/docs/custom-trigger)
- [Custom field recipes](https://developer.monday.com/apps/docs/custom-field-recipes)
- [Sentences](https://developer.monday.com/apps/docs/sentences)
- [Dynamic mapping](https://developer.monday.com/apps/docs/dynamic-mapping)

Matching name + type does **not** trigger auto-binding. The user must click "Refer to previous step" for every input. Sentence templates only support `{LABEL, fieldKey}` tokens, all of which are user-configurable.

**Confidence: High.** Multiple doc pages fetched; absence of the property is consistent across them.

### Finding 2 — The canonical pattern is to derive routing from server-side state

The official sample [`mondaycom/welcome-apps/apps/github-monday-code`](https://github.com/mondaycom/welcome-apps/tree/master/apps/github-monday-code) demonstrates the recommended architecture:

- `trigger-controller.js` — at subscribe time, stores `SubscriptionModel { mondayWebhookUrl, owner, repo, mondayUserId }` keyed by a generated `subscriptionId`
- `action-controller.js` — receives `req.session.userId` (extracted from the JWT monday signs when invoking the action), then calls `connectionModelService.getConnectionByUserId(userId)` to recover OAuth tokens and any other state
- The trigger's `outputFields` contains **only domain data** (`issue`), no routing fields

Routing is reconstructed server-side from the JWT's `userId` (or `subscriptionId` from the action payload), which monday injects automatically and never surfaces in the recipe UI.

**Confidence: High.** Verified by reading the sample app's source.

### Finding 3 — Per-event data has no clean alternative path

Subscription-level data can be derived server-side (Finding 2). But **per-event** data — most importantly `eventStatus` — must travel from the webhook (where Google delivers the event) to the action (where monday provides a fresh `shortLivedToken` for board mutations). The only documented mechanism for per-event data flow is trigger `outputFields`, which means user mapping.

Possible mitigations explored:
- **Encode in the JWT** that `monday-triggers.js` signs when firing the trigger — unverified that monday passes through custom JWT claims to the action's invocation JWT. The agent suggested this; documentation does not confirm it. Likely doesn't work.
- **Two separate triggers** ("Event Created/Updated" and "Event Deleted") — works; eliminates `eventStatus` entirely; cost = user must set up two automations instead of one
- **Sentinel encoding** in another trigger output (e.g., `eventName=""` ⇒ cancelled) — fragile, hidden behavior

**Confidence: High** for the constraint, **Medium** for the JWT-passthrough hypothesis (untested).

### Finding 4 — Custom Field bundling does not solve auto-mapping

A single Custom Field of Object type bundling `{ channelId, eventId, eventStatus }` would reduce three mappings to one. However, Custom Fields are still user-mappable; there is no evidence that a Custom Field with matching key on both Trigger output and Action input auto-binds without user action. Reduces from 3 to 1, doesn't eliminate.

**Confidence: Medium.** Not empirically tested.

### What I could NOT find

- No property in monday's schema for `hidden`, `internal`, `auto-map`, `defaultValue`, or `defaultBinding`
- No pre-wired field bindings inside recipe sentence definitions
- No documented or sample auto-map-by-name rule
- No community forum thread describing a workaround beyond "use `subscriptionId` server-side"
- No verification that custom JWT claims signed by us flow through to the action's JWT

## Conclusions

1. **The UX problem is real and has no UI-level workaround.** The platform does not let us mark fields as hidden or auto-bound. This is a constraint of monday's integration framework, not a bug in our app.

2. **Subscription-level routing CAN be eliminated.** `channelId` and `eventId` can both be removed from trigger outputs and action inputs:
   - `channelId` — derived in the action from `req.session.userId` via the existing `user_channels_<userId>` index
   - `eventId` — not actually needed; identity is the Link column URL on the board (the trigger can output `eventLink` directly instead of reconstructing it from `eventId + userEmail`)

3. **Per-event routing (`eventStatus`) is the unavoidable bottleneck.** It must travel from webhook to action. The only documented mechanism is a trigger output → user mapping. The single way to eliminate it is **two separate triggers** (one for created/updated, one for deleted), which moves the cost from "map one field" to "set up two automations."

4. **Recommended path forward:** Adopt the canonical server-side-routing pattern. Remove `channelId` and `eventId` from the trigger/action contract. Reduces the user's mandatory mapping count from 3 routing fields to 1 (`eventStatus` only). Defer the "two triggers" approach unless the single-mapping pain re-surfaces.

## Open Questions

1. **JWT claim passthrough (untested):** When `monday-triggers.js` signs the trigger-fire POST with `MONDAY_SIGNING_SECRET` and includes custom claims (e.g., `eventStatus`), are those claims preserved in the JWT that monday signs when invoking the action? If yes, this would let us hide `eventStatus` too. **Worth a 30-minute spike.**

2. **Custom Field auto-bind (untested):** Does a Custom Field with the same `key` registered on both Trigger output and Action input auto-bind in the workflow builder? If yes, bundling routing fields into one Custom Field gives us one-click mapping. **Worth a 30-minute spike.**

3. **Two-trigger UX cost:** Is "set up two automations" actually worse than "map one field once"? Some users may prefer two simple recipes over one recipe with an internal field. Worth user-testing if we ever go there.

4. **`syncToken` race on v3 fallback:** The 2026-04-15 incident showed that when v3 misroutes (eventStatus undefined → falls to v2), the v2 path runs against an already-consumed syncToken and silently processes 0 events. Even after fixing the routing-fields UX, the **silent data loss** behavior of v2 fallback when v3 misconfigures should be revisited. Options: refuse to run v2 if any v3 input is present (loud failure), or rewind the syncToken when v3 detects misconfiguration.

5. **Migration impact:** Removing `channelId` / `eventId` from the trigger output is a **breaking change** for any existing automations users have set up. A migration path / version bump for the action block needs planning.

## Recommended Next Steps

1. **Spike (Open Question 1):** Test whether monday passes custom JWT claims from our trigger-fire request through to the action's invocation JWT. Modify `monday-triggers.js` locally, add `eventStatus` to JWT claims, log `req.session` in `actions.js`, fire one event. ~30 min.

2. **If the spike succeeds:** Eliminate **all three** routing fields. Best possible outcome — zero mandatory mapping for routing.

3. **If the spike fails:** Implement the "remove channelId + eventId, keep eventStatus" plan from Conclusion 3. Plan migration for existing subscriptions.

4. **Independently from above:** Fix the silent data-loss behavior described in Open Question 4 (loud failure when v3 misconfigures, instead of silent v2 fallback that loses events).
