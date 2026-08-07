# Local dev server + mapps tunnel from a CLOUD session

Feasibility study run 2026-08-07 on `twyst-your-status` (app 11775054, draft v5
16639900) from a Claude Code cloud session. **Verdict: it works, but `mapps
tunnel:create` itself does NOT** — it needs the wrapper in
`.claude/skills/mapps/scripts/cloud-tunnel.mjs`.

Everything below is live-verified in that session unless marked otherwise. This is
the *how to actually do it* document; the one-line version lives in `cli.md`.

---

## 0. TL;DR — the working recipe

```bash
# 1. deps (the cloud clone starts with no node_modules)
pnpm install --frozen-lockfile

# 2. dev server on the app's own port — see §4 before choosing the script
/opt/node20/bin/… vite --port <APP_DEV_PORT>

# 3. tunnel (NOT `mapps tunnel:create` — see §1)
TUNNEL_APP_ID=<APP_ID> TUNNEL_PORT=<APP_DEV_PORT> \
  node .claude/skills/mapps/scripts/cloud-tunnel.mjs

# 4. bind the DRAFT feature — record the old build first (§5)
mapps app-features:build -a <APP_ID> -i <DRAFT_VERSION_ID> -d <FEATURE_ID> \
  -t custom_url --customUrl="https://<domain>/<route>"

# 5. ALWAYS restore when done (§5) — a redeploy does NOT clear a custom_url bind
```

The tunnel domain is **deterministic per app** (`<APP_ID>-<hash>.apps-tunnel.monday.app`),
so it survives reconnects and the binding stays valid across tunnel restarts.

---

## 1. Why `mapps tunnel:create` fails in a cloud session

Two *separate* obstacles. Fixing only the first gets you a different error and is
the trap — it looks like progress and is still dead.

**Obstacle A — TLS.** The sandbox egress gateway transparently re-terminates TLS on
port 443. `connect.ngrok-agent.com` presents `CN=*.ngrok-agent.com` issued by
`Anthropic Egress Gateway SDS Issuing CA`, not ngrok's real cert. The ngrok component
inside `@mondaycom/apps-cli` is the Rust `ngrok-rs` library, which **pins its own root
CA and ignores `NODE_EXTRA_CA_CERTS`**. Result:

```
failed to connect session: tls handshake error
```

`SessionBuilder` exposes `.caCert()`, so trusting the gateway bundle is possible — and
gets you past the handshake, straight into:

**Obstacle B — protocol.** The gateway is an **L7 HTTP proxy**. ngrok's session
protocol is not HTTP, so the gateway's reply is unparseable:

```
failed to connect session: failed to deserialize rpc response
```

**The fix is neither.** The *explicit* CONNECT proxy at `$HTTPS_PROXY` passes raw TCP
straight through to the real ngrok edge (verified: it returns ngrok's own
`no_application_protocol` TLS alert, which only the real endpoint sends). So:

1. Run a local forwarder that opens `CONNECT connect.ngrok-agent.com:443` through
   `$HTTPS_PROXY` and pipes bytes.
2. Add `127.0.0.1 connect.ngrok-agent.com` to `/etc/hosts`.
3. Point ngrok at it with `serverAddr('connect.ngrok-agent.com:<forwarder-port>')`.

The hosts entry is what keeps **SNI and certificate validation on the real hostname**,
so ngrok's pinned CA applies unchanged and **no `caCert()` override is needed**. Using
an IP in `serverAddr` instead would send SNI `127.0.0.1` and fail cert validation.

`SessionBuilder` has **no proxy option** — only `caCert` and `serverAddr` — which is
why the forwarder exists at all.

### Network allowlist

| Host | Needed | Status in the tested environment |
|---|---|---|
| `connect.ngrok-agent.com` | yes — agent control plane | allowed (`CONNECT` → `200`) |
| `*.apps-tunnel.monday.app` | yes — the public tunnel URL | allowed |
| `tunnel.us.ngrok.com` | ngrok regional data plane | **403** — not allowlisted |

The session worked without `tunnel.us.ngrok.com`, but if ngrok ever redirects to a
regional edge it will fail. Add it if tunnels start dying unpredictably.

> `curl https://connect.ngrok-agent.com/` returning a TLS error is **not** a failure —
> that endpoint is not an HTTP server. Read the **CONNECT** line: `200 Connection
> Established` means allowed, `403` means blocked.

---

## 2. The cloud sandbox moves under you — plan for it

Observed mid-session, roughly an hour in, **both at once**:

- The agent proxy **restarted on a different port** (45035 → 33375). A long-running
  process cannot see the updated `$HTTPS_PROXY`, so every forwarded connection died
  with `ECONNREFUSED`.
- **`/etc/hosts` was regenerated** and the ngrok entry was wiped.

The second failure mode is the nasty one: ngrok then resolved the *real* address,
dialled the forwarder's port there, and **hung forever with no error message**. A
silent hang is indistinguishable from a slow connect.

`cloud-tunnel.mjs` handles both — it rediscovers the proxy port by scanning listening
sockets for the `/__agentproxy/status` endpoint, re-asserts the hosts entry at startup,
and **aborts loudly** if the hostname does not resolve to `127.0.0.1` rather than
hanging. If a tunnel dies for no apparent reason, check those two things first.

---

## 3. The backend problem — a tunnel serves the SPA, not the app

**This is the part that silently invalidates testing**, and it applies to any app whose
SPA and server share an origin (in this repo: `twyst-your-status` since the round324
same-origin unification, and `deadline-confirm` / `telemetry-dashboard` by the same shape).

The SPA calls its backend at **relative** paths (`/api/…`). Binding the feature to a
tunnel makes the tunnel the origin — and a vite dev server has no backend. Verified:
`/api/guard/status` through the tunnel returned **404 HTML**. Nothing announces this;
the UI just misbehaves.

Fix: proxy the API prefixes from vite to the **deployed draft service**
(`mapps code:status -i <DRAFT_VERSION_ID>` gives the URL):

```js
server: {
  proxy: {
    '/api':   { target: DRAFT_SERVICE_URL, changeOrigin: true, secure: true },
    '/oauth': { target: DRAFT_SERVICE_URL, changeOrigin: true, secure: true },
  },
}
```

Verified working: `/api/guard/status` then returned **401 from the real server** (auth
required — the correct answer without a session token). Outbound HTTPS from vite to
`*.us.monday.app` works directly; `NODE_EXTRA_CA_CERTS` is already set in the environment.

Add a `configure` hook logging status + latency — that is usually the number you wanted:

```
[guard-api] GET /api/guard/status -> 401 in 4304ms
```

**Consequences to state out loud before anyone measures anything:**

- You are running **session UI against a DEPLOYED backend**. Server-side changes made
  in the session are NOT what responds.
- The first call to a cold monday-code service measured **~4.3s**. Warm it once before
  timing anything.
- **Webhook-driven behaviour never touches the tunnel.** monday calls the *deployed*
  service directly, so e.g. `twyst-your-status`'s revert-a-forbidden-status flow is
  invisible to the dev server. Read it with `mapps code:logs -i <VERSION_ID>` instead
  (subject to every `code:logs` trap in `cli.md`).

To keep the repo clean, put the proxy in a **session-local config outside the repo** and
run `vite --config <path>`. That file cannot use bare `import ... from 'vite'` (it is
outside the app's `node_modules`) — import the app's own config by absolute path and
export a plain object; `defineConfig` is only an identity helper.

Also required, once, in the app's real config: `server.allowedHosts:
['.apps-tunnel.monday.app']`, or vite 6 rejects the tunnel host with a 403.

---

## 4. `dev:mock` is the wrong server for a bound tunnel

`pnpm dev:mock` sets `VITE_MONDAY_MOCK=1`, which aliases `monday-sdk-js` to the
dev-harness stub. Inside a real board that means **mock context, not your board** —
and in this repo it also makes `resolveGuardBase()` return `null`, disabling the guard
entirely. Use it to verify the server is up; switch to plain `vite` before binding.

Two pnpm traps that cost time here:

- `pnpm server` collides with pnpm's **builtin** `server` command — use `pnpm run server`.
- The Bash tool resets cwd between calls, so `pnpm run <script>` at the repo root
  resolves the wrong package. Use a small `cd && exec` script.

---

## 5. Binding and restoring — the mandatory part

Record the current build **before** changing anything:

```bash
mapps app-features:list -a <APP_ID> -i <DRAFT_VERSION_ID>   # ids + current build
mapps manifest:export  -a <APP_ID> -i <DRAFT_VERSION_ID>    # exact build blocks
```

Bind (note `--customUrl=` — the short `-u` form fails with "Unexpected argument"):

```bash
mapps app-features:build -a <APP_ID> -i <VERSION_ID> -d <FEATURE_ID> \
  -t custom_url --customUrl="https://<domain>/<route>"
```

Restore — pass the **original relative path**, and the CLI re-resolves it against the
deployed service:

```bash
mapps app-features:build -a <APP_ID> -i <VERSION_ID> -d <FEATURE_ID> \
  -t monday_code --customUrl="/picker"
```

Then **prove** it by re-exporting the manifest and diffing against the baseline. In this
study the restored manifest came back byte-identical.

> **A pipeline redeploy does NOT clear a `custom_url` binding** (incident-verified).
> Cloud sandboxes are ephemeral and reclaimed without warning — if the session dies with
> a binding in place, the draft is left pointing at a dead tunnel until a human clears it.
> Restore before you stop working, not "at the end".

Full teardown: restore every bound feature → kill the tunnel → kill the dev server →
remove the `/etc/hosts` line.

---

## 6. What this does NOT change

Golden rule 2 still holds: **deploys happen only on GitHub Actions runners.** A working
tunnel authenticates and exposes a local dev server; it is not a deploy path.
`code:push`, `ship.sh` and `app:promote` remain forbidden from a cloud session, and
`app-features:build` is still a gated mutation — one confirming question, every time.
