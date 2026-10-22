# Discord QA control surface

Five Discord bots over the existing four-slot StudiQ QA stack. One Bun process
runs all five `discord.js` clients; a failure in one is logged and reconnected
without taking the others down.

This directory is an **add-on**. It never touches `apps/`, `packages/`,
`supabase/`, the live QA prompts, or the dashboard/browser processes. It reads
live state from `QA_LIVE_ROOT` and writes only `qa/discord/`.

```
Discord (5 bots)  ⇄  qa/discord (one Bun process)
                       ├─ manager bot   → commands + manager agent session
                       ├─ env bot N     → qa-env-N's current opencode session
                       ├─ status        → /api/dashboard/state → presence + #dashboard message
                       ├─ screenshots   → tool output / browser-cli → attachments
                       └─ qa-manager.py → subprocess, argv only
```

## Channels and bots

| Bot | Reads / writes | Purpose |
|---|---|---|
| `QA Manager` | `#manager`, `#dashboard` | `!` commands, free-text manager agent, live status board |
| `QA Env 1` … `QA Env 4` | `#env-1` … `#env-4` | chat with that slot's opencode agent, screenshot relay |

`#dashboard` is status-only: the manager keeps **one** message there and edits
it in place. It is never pinned. Channel names are **fixed** — nothing is
renamed at runtime.

## Status: where to look

1. **`#dashboard`** — the source of truth. One message, all four slots,
   rewritten every `DISCORD_STATUS_MS` (15 s) when something changed:

   ```
   free    | env-1 · MGR-INV-03 · 0 pending · 2m ago
   busy    | env-2 · MGR-GRP-02 · 0 pending · now
   waiting | env-3 · MGR-GRP-01 · 4 pending · 1h ago
   free    | env-4 · MGR-ROL-01 · 0 pending · 12m ago

   dashboard: http://localhost:5000/
   ```

   The message ID lives in `state.json`; if it is deleted, it is reposted.

2. **Bot presence** — each env bot shows `free` (online), `busy` (do not
   disturb) or `waiting` (idle) with a custom status like `busy | env-1`.
   The manager shows `2 busy · 1 waiting · 1 free`.

Channel names deliberately do **not** encode status. Discord allows roughly
two renames per channel per ten minutes, which makes them a lagging, noisy
signal; presence and the dashboard message are the real-time ones. Edits and
sends are throttled and queued well inside Discord's limits.

## Commands (owner only)

| Command | Action |
|---|---|
| `!status` | slot, state, scenario, pending, session |
| `!free` | free slot numbers |
| `!run <ID> [--env N]` | dispatch a scenario |
| `!queue <ID…>` | fill free slots from a list |
| `!report [env]` | last assistant report |
| `!decisions` | pending decisions |
| `!show <dec>` | decision detail |
| `!file <dec>` | file it (`decisions file --yes`) |
| `!skip <dec>` | answer skip |
| `!spawn <dec>` | spawn an investigator |
| `!screenshot [env]` | capture the slot browser and attach the PNG |
| `!help` | command list |

Anything that does not start with `!` goes to the agent: in `#manager` to a
dedicated `Discord Manager` session running `qa/MANAGER-PROMPT.md`, in `#env-N`
to that slot's current session. If the agent is busy the message is sent with
`delivery: "queue"` — it is never interrupted just to chat. Messages from any
bot (including these five) are ignored, so there are no reply loops.

`#dashboard` ignores human messages. Owner-only means `DISCORD_OWNER_ID`;
everyone else is ignored silently on this private server.

## Files

```
src/index.ts      config validation, check mode, wiring, shutdown
src/config.ts     env parsing, slot → channel/token/directory map
src/opencode.ts   sessions, messages, prompt (+ queue), active map
src/qa.ts         qa-manager.py wrapper (execFile, argv only)
src/bridge.ts     agent → Discord relay, Discord → agent prompting
src/status.ts     dashboard poll → presence + live #dashboard message
src/commands.ts   ! commands + screenshots
src/discord.ts    client factory, intents, login
src/state.ts      state.json (session ID, dashboard message ID, seen IDs)
run.sh            start | stop | restart | status | logs | check | dry-run
```

Runtime artefacts, all git-ignored: `.env`, `state.json`, `discord.log`,
`node_modules/`, `dist/`.

## Running

```bash
cd /workspaces/studiq/.worktrees/qa-discord/qa/discord
bun install

bun run check        # env, 5 tokens, guild, 6 channels, opencode, dashboard
bun run dry-run      # polls and logs, posts nothing
./run.sh start       # background; .pid + discord.log
./run.sh logs
./run.sh status
./run.sh stop
```

`check` validates every bot token with `GET /users/@me` before anything
connects, and lists missing config instead of failing halfway.

If `discord.js` ever misbehaves under Bun, the same code runs on Node 22:
`node --experimental-strip-types src/index.ts` (or build with `tsc`). Bun 1.4
is the tested runtime here.

## Behaviour notes

- **Session choice:** `GET /api/session?directory=…&order=desc`; an active
  session wins, otherwise the newest. On dispatch the bridge notices the new
  session and seeds its backlog as already-seen, so history is never dumped
  into the channel.
- **Relay:** polls assistant messages every 3 s, posts only completed `text`
  parts. Reasoning and tool JSON are not posted. Long reports (> 6 000 chars)
  go as a `.md` attachment; everything else is chunked under 2 000 chars.
- **Screenshots:** `!screenshot` runs
  `bun <BROWSER_CLI> screenshot --name discord-<ts>` in the slot directory.
  Auto-relay attaches new `dashboard/shots/*.png` referenced by tool results,
  deduplicated by path. Nothing outside `SHOTS_DIR` is ever uploaded.
- **Rate limits:** presence is debounced, sends are sequential, dashboard
  edits are debounced 10 s. `discord.js` handles 429s internally; the status
  loop backs off on dashboard errors and keeps the last good snapshot.
- **Manager session:** created once as `Discord Manager` (model
  `opencode-go/deepseek-v4.1-flash#high`), seeded with the markdown block from
  `qa/MANAGER-PROMPT.md`, ID persisted in `state.json`. If it disappears it is
  recreated.

## Troubleshooting

| Symptom | Check |
|---|---|
| `1/5 bots online` | token for the failed app; `check` names it |
| commands do nothing in `#manager` | Message Content Intent on the manager app |
| `Missing Permissions` | invite used `117760` and channel overwrites allow the bot |
| dashboard message never appears | bot can View Channel/Send Messages in `#dashboard` |
| `No QA session in this slot yet` | dispatch a scenario with `!run` first |
| screenshot fails | `BROWSER_CLI` path and the slot's Chromium on CDP 9221–9224 |
| agent replies missing | `curl -u opencode:… http://127.0.0.1:4096/api/session/active` |

Logs redact nothing that is not already public: tokens are never logged, and
errors include only HTTP status plus a short response body.

## Acceptance smoke test

1. `./run.sh check` → PASS, `bun run start` → `5/5 bots online`.
2. `!status` in `#manager` → table matching the dashboard.
3. `!queue MGR-INV-03` → env channel starts relaying; `#dashboard` follows.
4. Message in `#env-1` → agent receives it; reply appears once.
5. `!screenshot 1` → PNG attachment.
6. `!decisions` → list; `!skip <dec>` works.
7. Kill and restart → same sessions, no history replay, bots reconnect.
