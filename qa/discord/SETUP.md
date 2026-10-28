# Discord control surface — server & app setup

**Status: Phase 0.** This document is the preparation checklist only. No bot
process is started yet — the service will not be built until the server, the
five applications and the `.env` values below exist.

What you are preparing:

| Bot                     | Posts in                 | Purpose                                                         |
| ----------------------- | ------------------------ | --------------------------------------------------------------- |
| `QA Manager`            | `#manager`, `#dashboard` | orchestrator: commands + manager agent chat + live status board |
| `QA Env 1` … `QA Env 4` | `#env-1` … `#env-4`      | chat bridge to that slot's opencode agent + screenshot relay    |

Files live in the `feat/discord-qa` worktree:
`/workspaces/studiq/.worktrees/qa-discord/qa/discord/`.

---

## 1. Create the server

Discord bots cannot create servers, so this is manual:

1. In the Discord client: **+** → **Create My Own** → **For me and my friends**
   (or **Create a Community**, either works).
2. Name it something recognisable, e.g. `StudiQ QA`.
3. Keep it **private**. Do not publish it, do not add a public invite link.
   The bot allowlists your user ID and ignores everyone else.

---

## 2. Create the channels

Create these six **text** channels with exactly these names:

```
#dashboard
#manager
#env-1
#env-2
#env-3
#env-4
```

Optionally group them under a category named `QA` (right-click the server →
**Create Category**, then drag the channels in). A category makes the
permission lockdown in §7 much faster.

Two things to know before you start:

- **`#dashboard` is status-only.** The manager bot keeps exactly one message
  there and edits it in place. Do not pin anything anywhere — pinned messages
  are deliberately not part of this design.
- **Channel names stay fixed.** Exactly `dashboard`, `manager`, `env-1` …
  `env-4`; nothing renames them at runtime. Status is shown by each bot's
  presence and by the single live message in `#dashboard` — the two surfaces
  that update every ~15 s. This also means the IDs you copy in §5 never change.

---

## 3. Create the five applications

Go to <https://discord.com/developers/applications> → **New Application**, once
per bot:

| #   | Application name | Becomes     |
| --- | ---------------- | ----------- |
| 1   | `QA Manager`     | manager bot |
| 2   | `QA Env 1`       | env-1 bot   |
| 3   | `QA Env 2`       | env-2 bot   |
| 4   | `QA Env 3`       | env-3 bot   |
| 5   | `QA Env 4`       | env-4 bot   |

For **each** application:

1. Open **Bot** in the left sidebar.
2. Click **Reset Token** → **Yes, do it** → **Copy**. The token is shown
   **once**. Paste it straight into `.env` (`DISCORD_MANAGER_TOKEN`,
   `DISCORD_ENV1_TOKEN`, …). If you lose one, reset it again — no harm done,
   but the old token dies immediately.
3. Scroll to **Privileged Gateway Intents** and enable **Message Content
   Intent**. This is required: without it the bot receives empty message text.
4. Leave **Presence Intent** and **Server Members Intent** **off** — they are
   not needed and only widen the permission surface.
5. Copy the **Application ID** from the _General Information_ page; you need it
   for the invite URL in §4.

> Tokens are passwords. Never paste them into this chat, a commit, a ticket or
> a screenshot. Only into `qa/discord/.env` on the machine.

---

## 4. Invite the bots

Build one invite URL per application by replacing `<APP_ID>` with that app's
Application ID:

```
https://discord.com/api/oauth2/authorize?client_id=<APP_ID>&permissions=<PERMS>&scope=bot%20applications.commands
```

Open it, pick your QA server, **Authorize**. Repeat for all five apps.

### Permission integers

| Bot                     | `permissions` | What that grants                                                              |
| ----------------------- | ------------- | ----------------------------------------------------------------------------- |
| `QA Manager`            | `117760`      | View Channels, Send Messages, Embed Links, Attach Files, Read Message History |
| `QA Env 1` … `QA Env 4` | `117760`      | exactly the same set                                                          |

All five bots use the **same** permission integer — `117760`.

Bit breakdown, if you prefer to tick boxes by hand:

| Permission           | Bit   |
| -------------------- | ----- |
| View Channels        | 1024  |
| Send Messages        | 2048  |
| Embed Links          | 16384 |
| Attach Files         | 32768 |
| Read Message History | 65536 |

`Manage Channels` is **not** needed: channels are never renamed. `Manage
Messages` is **not** needed either: the `#dashboard` message belongs to the
manager bot and is edited by it, never pinned. `Administrator` is not needed
and should not be granted.

Invite the bots **before** filling channel IDs: a bot that is not in the server
cannot see the channels.

---

## 5. Copy the IDs

1. Discord → **User Settings** → **Advanced** → enable **Developer Mode**.
2. **Server ID** — right-click the server icon → **Copy Server ID**
   → `DISCORD_GUILD_ID`.
3. **Channel IDs** — right-click each channel → **Copy Channel ID**:

   | Channel      | Variable                       |
   | ------------ | ------------------------------ |
   | `#dashboard` | `DISCORD_DASHBOARD_CHANNEL_ID` |
   | `#manager`   | `DISCORD_MANAGER_CHANNEL_ID`   |
   | `#env-1`     | `DISCORD_ENV1_CHANNEL_ID`      |
   | `#env-2`     | `DISCORD_ENV2_CHANNEL_ID`      |
   | `#env-3`     | `DISCORD_ENV3_CHANNEL_ID`      |
   | `#env-4`     | `DISCORD_ENV4_CHANNEL_ID`      |

4. **Your user ID** — right-click your own avatar → **Copy User ID**
   → `DISCORD_OWNER_ID`. This is the allowlist: only this account may run
   mutating commands and talk to the agents. Add more testers later only if you
   decide to widen it.

---

## 6. Fill `.env`

Inside the container:

```bash
cd /workspaces/studiq/.worktrees/qa-discord/qa/discord
cp .env.example .env
```

Then edit `.env`. Only the blank values need you; the rest already point at
the live QA stack:

| Variable                                                                                            | Where it comes from                                                          |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `DISCORD_GUILD_ID`                                                                                  | §5, server ID                                                                |
| `DISCORD_OWNER_ID`                                                                                  | §5, your user ID                                                             |
| `DISCORD_MANAGER_TOKEN`                                                                             | `QA Manager` app → Bot → Reset Token                                         |
| `DISCORD_MANAGER_CHANNEL_ID`                                                                        | `#manager` channel ID                                                        |
| `DISCORD_DASHBOARD_CHANNEL_ID`                                                                      | `#dashboard` channel ID                                                      |
| `DISCORD_ENV1_TOKEN` … `DISCORD_ENV4_TOKEN`                                                         | `QA Env 1` … `QA Env 4` app tokens                                           |
| `DISCORD_ENV1_CHANNEL_ID` … `DISCORD_ENV4_CHANNEL_ID`                                               | `#env-1` … `#env-4` channel IDs                                              |
| `OPENCODE_URL`, `OPENCODE_PASSWORD`                                                                 | already correct — leave as-is                                                |
| `DASHBOARD_URL`, `QA_LIVE_ROOT`, `QA_MANAGER_TOOL`, `QA_MANAGER_PROMPT`, `BROWSER_CLI`, `SHOTS_DIR` | already correct — leave as-is                                                |
| `DISCORD_DRY_RUN`                                                                                   | leave at `1` for now; it becomes `0` only after the first successful dry run |
| `DISCORD_STATUS_MS`                                                                                 | `15000` — status poll interval                                               |
| `DISCORD_LOG_LEVEL`                                                                                 | `info` (`debug` for troubleshooting)                                         |

`.env` is git-ignored and must stay on this machine.

---

## 7. Lock down channel permissions

The server is private, but the bots are only as narrow as their channel access.
Recommended (right-click each channel → **Edit Channel** → **Permissions**):

1. Under a `QA` category: set `@everyone` → **View Channel: deny**. Then grant
   your own account access (or keep the default owner access).
2. **`QA Manager`** — allow on **all six** channels: View Channel, Send
   Messages, Embed Links, Attach Files, Read Message History.
3. **`QA Env N`** — allow the same on `#env-N` only; deny View Channel on the
   other env channels and on `#manager`.
4. Your account — access to all six.

All five bots carry the same permissions — no bot has Manage Channels. The
split is about reach, not capability: env bot N can only see its own channel,
so a bug in one bridge cannot read or write another slot's conversation, while
the manager needs all six for commands and the status board.

---

## 8. Check before handing back

- [ ] Server exists, private, six text channels with the exact names above.
- [ ] Five applications exist; **Message Content Intent** enabled on each.
- [ ] Each bot shows as **online/offline** in the member list (i.e. was
      invited) — offline is expected, it has not been started yet.
- [ ] `#dashboard` has no pinned messages.
- [ ] `qa/discord/.env` is filled; `git status` does **not** list `.env`.
- [ ] No token has been pasted into chat.

Optional local sanity check — run it yourself, it prints only the bot's name:

```bash
set -a; . ./qa/discord/.env; set +a
curl -s -H "Authorization: Bot $DISCORD_MANAGER_TOKEN" \
  https://discord.com/api/v10/users/@me | jq -r '.username'
```

A username means the token is valid. `401 Unauthorized` means a bad copy or a
reset token. Repeat with `$DISCORD_ENV1_TOKEN` … `$DISCORD_ENV4_TOKEN` if you
want all five checked. The real validation runs from the service before it
connects anything.

---

## 9. What to hand back

Reply with confirmation that §8 is done, and that `.env` contains:

```
DISCORD_GUILD_ID, DISCORD_OWNER_ID
DISCORD_MANAGER_TOKEN, DISCORD_MANAGER_CHANNEL_ID, DISCORD_DASHBOARD_CHANNEL_ID
DISCORD_ENV1_TOKEN, DISCORD_ENV1_CHANNEL_ID
DISCORD_ENV2_TOKEN, DISCORD_ENV2_CHANNEL_ID
DISCORD_ENV3_TOKEN, DISCORD_ENV3_CHANNEL_ID
DISCORD_ENV4_TOKEN, DISCORD_ENV4_CHANNEL_ID
```

Do not paste the values here — just say they are filled. The tokens get
validated with `GET /users/@me` before anything connects, and the build starts
only after that. Nothing in the current QA stack is restarted or modified by
this phase.
