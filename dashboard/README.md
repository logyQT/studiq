# StudiQ QA Dashboard — Phase 1

A tiny zero-dependency Bun server that renders a 2×2 grid of the four QA
environments' opencode agent chats. Each tile is an iframe of the official
opencode web client, deep-linked to that environment's newest session. Basic
auth is injected **server-side** by a host-based reverse proxy, so the browser
never sees an auth prompt.

Phase 2 will add live application/browser tiles next to the chat tiles.

## URLs

| What | URL |
| --- | --- |
| Dashboard | <http://localhost:4000/> |
| qa-env-1 client | <http://qa-env-1.localhost:4000/> |
| qa-env-2 client | <http://qa-env-2.localhost:4000/> |
| qa-env-3 client | <http://qa-env-3.localhost:4000/> |
| qa-env-4 client | <http://qa-env-4.localhost:4000/> |

`*.localhost` resolves to loopback in Chrome, Edge and Firefox, so no hosts
file changes are needed. Opening a bare `qa-env-N.localhost:4000/` redirects
(302) to that env's current session deep link.

App links in the top bar point at the published web apps:
`http://localhost:3010` … `http://localhost:3013`.

## Run / restart

Inside the `studiq-dev` container, from this directory:

```bash
./run.sh            # start (idempotent: exits 0 if already running)
./run.sh restart    # stop the recorded PID, then start
./run.sh stop
./run.sh status
./run.sh logs       # tail dashboard.log
```

The process is detached with `setsid nohup bun run server.ts`, writes
`.pid`, and appends to `dashboard.log`. It binds `0.0.0.0:4000`; port 4000 is
already published by the container to the Windows host. `run.sh` refuses to
start if port 4000 is held by an unknown process.

`GET /healthz` returns `{"ok":true,...}`.

## Session mapping

By default sessions are auto-discovered every ~10 seconds:

1. `GET http://127.0.0.1:4096/api/session` (with Basic auth).
2. Keep sessions whose `location.directory` is exactly
   `/workspaces/studiq/.worktrees/qa-env-N`.
3. Pick the one with the highest `time.updated` (falling back to
   `time.created`).

If an env has no session yet, its tile shows a placeholder: *"No agent session
yet for qa-env-N. Open an opencode session in `.worktrees/qa-env-N`, then
Refresh."* The **Refresh** / **Refresh all** buttons invalidate the cache and
reload the page; the mapping can also be refreshed without a restart by hitting
`POST /api/dashboard/refresh` or `GET /api/dashboard/state`.

### Manual override

Create `dashboard/sessions.json` (git-ignored) to pin a session:

```json
{
  "qa-env-1": "ses_abc123...",
  "qa-env-2": "ses_def456..."
}
```

Values are opencode session IDs; missing envs keep using auto-discovery.
Manual mappings are marked `manual` in the tile header.

## Architecture

```
Browser ── Host: localhost:4000 ──────────────► Bun :4000 ──► dashboard HTML
        │
        └─ Host: qa-env-N.localhost:4000 ────► Bun :4000 ──► 127.0.0.1:4096
                                                (+ Authorization: Basic …)
```

* Dashboard host: `GET /` renders the server-side 2×2 grid; JSON endpoints
  expose the session mapping.
* Tile host (`/^qa-env-[1-4]\./`): every request is reverse-proxied to the
  opencode server with `Authorization: Basic base64("opencode:studiq-local-dev")`.
  Method, path, query, body, status and headers are preserved; SSE
  (`/api/event`) streams through unbuffered.
* Deep link format:
  `http://qa-env-N.localhost:4000/server/<base64(tileOrigin)>/session/<sessionID>`.
  The encoded key is the **tile origin**, not `localhost:4096`, so all of the
  SPA's `/api` calls stay same-origin and therefore proxied. This also matches
  the opencode client's own "local server" key derivation.
* Only files under `dashboard/` are added; application code and the four QA
  stacks are untouched.

## Known limitations

* **WebSocket upgrades are not proxied.** The proxy answers `501` for
  `Upgrade: websocket`. Chat, session list and live events use HTTP + SSE and
  work fine; opencode's integrated terminal (which uses a WebSocket) will not
  work through a tile. Use the direct client for terminal work.
* Long-lived SSE connections keep a Bun request open per tile; this is
  expected. `idleTimeout` is disabled so streams are not cut.
* The SPA keeps per-origin `localStorage` (theme, etc.). Each tile subdomain is
  a separate origin, so theme choices are independent unless set again.
* Auto-discovery matches the exact directory string. If a session is opened in
  a nested worktree of a QA env, create a manual override.
