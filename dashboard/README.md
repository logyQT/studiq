# StudiQ QA Dashboard — Phase 2

A zero-dependency Bun app on **port 5000** that renders one row per environment across the eight
QA environments as **live Chromium windows**, plus a collapsible opencode chat
drawer per tile.

Each tile is a real headless Chromium page (1920×1080) streamed over the
Chrome DevTools Protocol (JPEG screencast, ~12 fps) and scaled to fit. Mouse,
wheel and keyboard input on the tile is forwarded to that page. The same
Chromium is exposed to QA agents through an MCP server and a CLI, so the
operator and the agent operate the _same_ browser.

Phase 1 remains intact: tile hosts `qa-env-N.localhost:5000` reverse-proxy the
opencode web client with Basic auth injected server-side, deep-linked to the
newest session for that worktree.

## URLs

| What                   | URL                                                             |
| ---------------------- | --------------------------------------------------------------- |
| Dashboard              | <http://localhost:5000/>                                        |
| Health / browser state | <http://localhost:5000/healthz> (`?deep=1` evaluates each page) |
| JSON browser state     | <http://localhost:5000/api/browsers>                            |
| Session mapping        | <http://localhost:5000/api/dashboard/state>                     |
| qa-env-1 chat client   | <http://qa-env-1.localhost:5000/>                               |
| qa-env-2 chat client   | <http://qa-env-2.localhost:5000/>                               |
| qa-env-3 chat client   | <http://qa-env-3.localhost:5000/>                               |
| qa-env-4 chat client   | <http://qa-env-4.localhost:5000/>                               |

App links in the top bar point at the published web apps:
`http://localhost:3010` … `http://localhost:3013`.

## Host ports

The dashboard listens on `5000` inside the container. A host-side nginx
`stream` container (`studiq-ports`) publishes `5000` and `3010-3013` and
forwards them to `studiq-dev` over the `studiq-ports` Docker network, so the
main container does not need to be recreated. Config lives on the host at
`studiq-dev/ports-proxy.conf`.

    docker network create studiq-ports
    docker network connect studiq-ports studiq-dev
    docker run -d --name studiq-ports --restart unless-stopped \
      --network studiq-ports \
      -p 5000:5000 -p 3010:3010 -p 3011:3011 -p 3012:3012 -p 3013:3013 \
      -v "C:/Users/logy/Documents/Default Project/studiq-dev/ports-proxy.conf:/etc/nginx/nginx.conf:ro" \
      nginx:alpine

Port `4000` is left free for the main admin app (`bun run dev:admin`).

### PWA

`/manifest.webmanifest`, `/sw.js` and the icons in `dashboard/public/` make the
dashboard installable from Chrome/Edge ("Install app"). It opens standalone
with the eight tiles and no browser tabs.

## Run / restart

Inside the `studiq-dev` container, from `dashboard/`:

```bash
./run.sh                  # start browsers + dashboard (idempotent)
./run.sh up               # alias
./run.sh restart          # restart dashboard and all four browsers
./run.sh stop             # stop both
./run.sh status           # dashboard + browser status
./run.sh logs             # tail dashboard.log
./run.sh browsers status --deep
./run.sh browsers restart 3
./run.sh browsers start --force
```

`run.sh` starts the browsers first, then the dashboard. It is safe to run twice.
The dashboard is detached with `setsid nohup bun run server.ts`, writes `.pid`
and appends to `dashboard.log`. It refuses to start if port 5000 is held by an
unknown process.

## Browser supervisor

`browsers.ts` launches one Chromium per env and writes `browsers.json`:

| env      | CDP                     | profile                        | default page            |
| -------- | ----------------------- | ------------------------------ | ----------------------- |
| qa-env-1 | <http://127.0.0.1:9221> | `dashboard/.profiles/qa-env-1` | <http://localhost:3010> |
| qa-env-2 | <http://127.0.0.1:9222> | `dashboard/.profiles/qa-env-2` | <http://localhost:3011> |
| qa-env-3 | <http://127.0.0.1:9223> | `dashboard/.profiles/qa-env-3` | <http://localhost:3012> |
| qa-env-4 | <http://127.0.0.1:9224> | `dashboard/.profiles/qa-env-4` | <http://localhost:3013> |

```json
{
  "qa-env-1": {
    "cdp": "http://127.0.0.1:9221",
    "port": 9221,
    "pid": 608096,
    "profile": "/workspaces/studiq/.worktrees/qa-env/dashboard/.profiles/qa-env-1",
    "chrome": "/home/node/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
    "startedAt": "2026-10-22T12:59:07.047Z"
  }
}
```

- Fixed Chromium flags: `--headless=new --no-sandbox --disable-dev-shm-usage
--disable-gpu --window-size=1920,1080`, a normal Chrome UA, one persistent
  profile per env, CDP on 9221-9228 with `--remote-allow-origins=*`.
- `Emulation.setDeviceMetricsOverride(1920×1080, dsf=1, mobile=false)` is
  applied to every page, so `innerWidth/innerHeight` is exactly 1920×1080.
- The active page per env is recorded in `tabs.json`; the supervisor waits for
  Chrome's first target instead of racing it, and prunes duplicate/blank tabs
  on `start`/`restart`.
- Reuse is idempotent: a live CDP endpoint with a matching pid/profile is
  adopted. Stale pids/listeners are reaped before a restart. Unknown processes
  holding 9221-9228 are never killed.
- Chromium stdout/stderr: `dashboard/logs/chrome-qa-env-N.log`.

## Live streaming and input

`GET /ws/browser/N` upgrades to a Bun WebSocket. On connect the server:

1. connects to the env's page target over CDP;
2. applies the 1920×1080 emulation and enables focus emulation;
3. starts `Page.startScreencast` (JPEG, quality 70, max 1920×1080);
4. forwards frames as binary WS messages, throttled to ~12 fps, and **acks every
   frame** (otherwise Chrome pauses the stream);
5. forwards input:
   - mouse move/down/up/wheel → `Input.dispatchMouseEvent` (normalized from the
     displayed image rect to 1920×1080),
   - keyboard → `Input.dispatchKeyEvent` with key/code/keyCode/modifiers and
     `text` for printable keys, plus `Input.insertText` for paste,
   - navigation/back/forward/reload → `Page.navigate` /
     `Page.getNavigationHistory` / `Page.reload`, waiting for the next main-frame
     load event;
6. streams URL/title state back to the URL bar and records recent network
   responses (status + `x-trace-id`) and console/exceptions under
   `dashboard/logs/`.

If the browser is down the upgrade returns `503`; the tile shows **Browser down
— reconnecting…** and retries with exponential backoff (max 8 s). After
`./run.sh browsers restart N` the tile reconnects on its own.

## Chat drawer

Each tile header has a 💬 button. The drawer slides in at ≈420 px (or 52% on
narrow tiles) and loads the Phase 1 opencode iframe for that env/session. The
browser gets the remaining width. Open/closed is persisted per tile in
`localStorage` (`studiq.qa.chat.N`); drawers start closed.

## Agent browser interface

Both interfaces drive the live tile browser through `browser-core.ts`.

### MCP (preferred)

A stdio MCP server, `mcp-browser.ts`, is registered globally as `qa_browser`
(`~/.config/opencode/opencode.jsonc`, `codemode: false`). OpenCode prefixes tool
names with the server, exposing:

`qa_browser_navigate`, `qa_browser_state`, `qa_browser_click`,
`qa_browser_type`, `qa_browser_press`, `qa_browser_scroll`,
`qa_browser_wait_for`, `qa_browser_evaluate`, `qa_browser_screenshot`,
`qa_browser_tabs`, `qa_browser_new_tab`, `qa_browser_select_tab`,
`qa_browser_close_tab`, `qa_browser_back`, `qa_browser_forward`,
`qa_browser_reload`, `qa_browser_network`, `qa_browser_console`.

The env resolves per call from `qa/env.json` in the session workspace (openCode
sets the MCP cwd to the workspace), or from `QA_ENV_ID`, or the optional `env`
argument. Verify server state with:

```bash
curl -s -u opencode:studiq-local-dev \
  'http://127.0.0.1:4096/api/mcp?location[directory]=/workspaces/studiq/.worktrees/qa-env-1'
# -> {"name":"qa_browser","status":{"status":"connected"}}
```

### CLI (guaranteed fallback)

`browser-cli.ts` is a one-shot JSON CLI. Run it from any QA worktree; it finds
`qa/env.json` in cwd or a parent, or accepts `--env qa-env-N`.

```bash
B=/workspaces/studiq/.worktrees/qa-env/dashboard/browser-cli.ts
bun "$B" navigate http://localhost:3010/login
bun "$B" type "manager@dev.local" --selector "#email" --clear
bun "$B" type "pass" --selector "#password" --clear
bun "$B" click --selector "button[type=submit]"
bun "$B" wait --url "/manage"
bun "$B" eval "document.title"
bun "$B" screenshot --name login              # -> {path, bytes, width, height}
bun "$B" network --limit 20                   # status + x-trace-id
bun "$B" tabs
bun "$B" new-tab http://localhost:3010/admin  # (or adminUrl)
bun "$B" select-tab 0
bun "$B" close-tab 1
bun "$B" back | forward | reload
bun "$B" state | status | browsers
```

- Clicks accept `--selector`, `--text`, or `--x/--y` in page (1920×1080) space.
- `wait` accepts `--selector`, `--text`, `--url`, `--expression`, `--timeout`,
  `--gone`.
- `screenshot` writes `dashboard/shots/qa-env-N-<timestamp>[-name].png` and
  prints the absolute path and byte size.
- `navigate` prints the final URL/title and the last HTTP responses, including
  `traceId` (`x-trace-id`) and `location`.
- Any failure prints `{"ok":false,"error":"..."}` and exits 1.

## Architecture

```
Host browser ── localhost:5000 ───────────► Bun server ── dashboard HTML
             │                                  │
             ├─ qa-env-N.localhost:5000 ──────► 127.0.0.1:4096 (opencode, auth injected)
             │                                  │
             └─ /ws/browser/N (WebSocket) ─────► CDP 127.0.0.1:922N ── Chromium page
                                                    ▲
QA agent ── MCP qa_browser_* / browser-cli.ts ──────┘ (same page target)
```

- Dashboard host: `GET /` renders the grid; JSON endpoints expose sessions,
  browsers and health.
- Tile hosts: every request is proxied to opencode with
  `Authorization: Basic base64("opencode:studiq-local-dev")`; SSE streams
  unbuffered.
- Deep link: `http://qa-env-N.localhost:5000/server/<base64(tileOrigin)>/session/<id>`.
  The encoded key is the tile origin so the SPA's `/api` calls stay same-origin.
- Only `dashboard/` (plus the QA docs) is touched; application code and the four
  QA stacks are not.

## Session mapping

Auto-discovered every ~10 s from `GET /api/session`: sessions whose
`location.directory` is exactly `.worktrees/qa-env-N`; newest `time.updated`
wins. Missing envs show a placeholder. `POST /api/dashboard/refresh` invalidates
the cache; the dashboard reloads when the mapping changes.

Manual override: create `dashboard/sessions.json` (git-ignored):

```json
{ "qa-env-1": "ses_abc123", "qa-env-2": "ses_def456" }
```

## Files

| File                                                          | Purpose                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `server.ts`                                                   | dashboard HTML, proxy, session mapping, `/ws/browser/N`, health    |
| `config.ts`                                                   | env table, ports, paths, shared constants                          |
| `cdp.ts`                                                      | minimal CDP WebSocket client + `/json` helpers + navigation waits  |
| `browsers.ts`                                                 | Chromium supervisor (`start/stop/restart/status`)                  |
| `browser-state.ts`                                            | `browsers.json` / `tabs.json`, pid/port reaping                    |
| `browser-core.ts`                                             | navigate/click/type/press/scroll/wait/eval/screenshot/tabs/history |
| `browser-cli.ts`                                              | JSON CLI over `browser-core`                                       |
| `mcp-browser.ts`                                              | MCP stdio server (`qa_browser_*` tools)                            |
| `run.sh`                                                      | lifecycle wrapper for dashboard + browsers                         |
| `shots/`, `logs/`, `.profiles/`, `browsers.json`, `tabs.json` | runtime, git-ignored                                               |

## Known limitations

- **WebSocket upgrades to the opencode server are still not proxied.** The chat,
  session list and SSE events work; opencode's integrated terminal (WebSocket)
  does not work through a chat iframe. The dashboard's own `/ws/browser/N` is a
  separate WebSocket and is not affected.
- Screencast bandwidth is ~2-6 MB/s for four busy tiles (JPEG q70, 12 fps). The
  server drops frames rather than buffering; static pages send very few frames.
- Chromium runs headless as root with `--no-sandbox` inside the dev container.
  Pages see `HeadlessChrome`-style capabilities but a normal Chrome UA; GPU
  acceleration is disabled, so WebGL/canvas performance is software-rendered.
- Each env has one persistent profile, so cookies/logins survive dashboard and
  browser restarts. Delete `dashboard/.profiles/qa-env-N` to reset a slot's
  browser state (operator action).
- The MCP server is registered globally; outside a QA worktree pass
  `env: "qa-env-N"` explicitly or the env lookup fails.
- `browsers.json`, `tabs.json`, screenshots and logs are runtime state and are
  intentionally git-ignored.
- `/ws/browser/N` and the dashboard have no authentication; they are bound to
  the container's port 5000 and intended for the local operator only.
