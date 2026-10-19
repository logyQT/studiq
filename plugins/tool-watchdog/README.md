# tool-watchdog

An OpenCode plugin that aborts tool calls which stop making progress, so a stuck
call can't stall an unattended agent run.

## Problem

The Code Mode sandbox has no timers. When a model wants to "wait a moment" it
often writes `await new Promise(() => {})` — valid-looking, never resolves — and
the tool call hangs until a human aborts it manually.

## How it works

OpenCode fires `execute.before` when a tool starts and `execute.after` when it
finishes (success **or** error). A hung call never fires `after`, so a real
`setTimeout` started in `before` detects it. On timeout the plugin interrupts the
session and (by default) lets it continue.

```
execute.before ──► setTimeout(budget)
                      │
        execute.after ─┴─► clearTimeout        (normal: no action)
                      │
                      └─ (no after) ──► session.interrupt({ continue: true })
```

A second layer caps every shell command's own timeout via
`ctx.shell.hook("create.before")`.

## Budgets

Budgets are keyed on the **outer** tool name, because Code Mode inner calls
(`tools.grafana.*`, browser, …) run inside a single `execute` part and are not
visible individually. Use the `shell` tool for long-running work.

| Tool | Default | Rationale |
|---|---|---|
| `execute` | 15s | catches the stuck-promise case fast |
| `read`/`write`/`edit`/`glob`/`grep`/… | 15s | local filesystem |
| `browser*` | 45s | cold Next compile, navigation |
| `grafana*` / `mcp*` / namespaced tools | 45s | slow TraceQL/LogQL queries |
| `shell` | not timed here | uses its own timeout, capped at 300s |
| `task` | never | don't abort delegated work |
| anything else | 60s | |

## Configuration

Loaded from `opencode.jsonc`:

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/tool-watchdog",
      "options": {
        "executeMs": 15000,
        "shellCapMs": 300000,
        "resume": true
      }
    }
  ]
}
```

All options (defaults in brackets):

| Option | Default | Meaning |
|---|---|---|
| `enabled` | `true` | master switch |
| `executeMs` | `15000` | Code Mode `execute` budget |
| `defaultMs` | `60000` | fallback budget |
| `fsMs` | `15000` | file tools |
| `mcpMs` | `45000` | MCP/namespaced tools |
| `browserMs` | `45000` | browser tools |
| `taskMs` | `0` | delegated tasks; `0` = never abort |
| `shellCapMs` | `300000` | cap applied to shell timeouts; `0` disables |
| `resume` | `false` | `false` interrupts then sends a continue prompt (observed to resume the run); `true` uses `continue: true`, which was observed to end the run as `interrupted` |
| `cooldownMs` | `30000` | minimum gap between interrupts per session |
| `maxPerHour` | `6` | interrupt ceiling per session |
| `skipSessions` | `[]` | session ids to ignore |

## Behaviour notes

- **Verified live**: an `execute` running `await new Promise(() => {})` was aborted at
  15,015 ms (the configured budget), the tool part went `error`, and the session
  reached `idle` with `outcome: interrupted` — no manual abort. `resume: false`
  then sends the continue prompt so the run picks back up.
- **Permission waits are skipped** — a tool that is `running` while the UI asks
  for approval is not a hang (`ctx.permission.list`).
- **Rate limited** — at most one interrupt per `cooldownMs`, and
  `maxPerHour` per session, so a genuinely broken task can't loop forever.
- **CPU-spin hangs** (a synchronous infinite loop) block the event loop and
  timer callbacks; this plugin only handles async hangs, which is the observed
  failure mode.
- **Scope** — a project plugin sees this project's sessions. Load it from the
  global config if you want it in every worktree.
- Logs as `[tool-watchdog] …` on stderr.
