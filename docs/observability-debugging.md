# Agent-Driven Live Debugging (Tempo + Loki + Prometheus)

This is the operational loop for going from "something failed in the browser"
to "here is the exact Postgres error and the log lines around it" without
guessing. It is driven end-to-end by the OpenCode agent through the
[`grafana/mcp-grafana`](https://github.com/grafana/mcp-grafana) MCP server.

**Tempo is the only trace backend.** Jaeger is gone; all trace queries use
Tempo / TraceQL.

## Start the stack

```bash
docker compose up -d
```

| UI | URL |
|----|-----|
| Grafana | http://localhost:3001 (`admin` / `admin`) |
| Prometheus | http://localhost:9090 |
| Tempo API | http://localhost:3200 |
| Loki | http://localhost:3100 |

The Next.js app sends OTLP (traces + metrics + logs) to the OTel Collector on
`http://localhost:4318` (SDK default). Make sure `OTEL_SDK_DISABLED` is **not**
`true` when you want telemetry. See the [plan doc](./plans/prometheus-metrics-monitoring.md).

## Configure the Grafana MCP

The MCP server is declared in [`opencode.jsonc`](../opencode.jsonc):

```jsonc
{
  "mcp": {
    "servers": {
      "grafana": {
        "type": "local",
        "command": ["mcp-grafana", "-t", "stdio"],
        "environment": {
          "GRAFANA_URL": "http://localhost:3001",
          "GRAFANA_SERVICE_ACCOUNT_TOKEN": "{env:GRAFANA_SERVICE_ACCOUNT_TOKEN}"
        }
      }
    }
  }
}
```

Create a Grafana service account token (Grafana → **Administration → Users and
access → Service accounts**), then export it as `GRAFANA_SERVICE_ACCOUNT_TOKEN`
**in the environment of the OpenCode server** (the process that spawns MCP
servers) and restart it with `opencode service restart`. The `mcp-grafana` binary
must be on that same process's `PATH`. Verify with `opencode mcp list` →
`✓ grafana connected`, then call `list_datasources`.

> `GRAFANA_API_KEY` still works but is deprecated in favour of
> `GRAFANA_SERVICE_ACCOUNT_TOKEN`.

If you prefer Docker (no binary install; `--network host` is required so the
container reaches the host's Grafana):

```jsonc
"command": [
  "docker", "run", "-i", "--rm", "--network", "host",
  "-e", "GRAFANA_URL=http://localhost:3001",
  "-e", "GRAFANA_SERVICE_ACCOUNT_TOKEN",
  "grafana/mcp-grafana", "-t", "stdio"
]
```

## The loop

### 1. Reproduce in the browser

Drive the failing flow with the browser tools. The failing API call is in the
network log.

### 2. Read `x-trace-id` from the failed response

Every API response carries the header:

```
x-trace-id: 4f1c9c2a9f7d4a0e8b3c1d2e3f4a5b6c
```

Read it with `browser.network.get` on the failed request's response headers.
This value **is** the Tempo trace id — no lookups, no clock skew.

### 3. Query the trace in Tempo (via Grafana MCP)

Use the Grafana MCP Tempo tool (e.g. `grafana_query_tempo` / search by trace
id). You get the full span tree for that request:

- `METHOD /api/**` (root, from `withAuth`) — `http.status_code`, `duration.ms`
- `controller.*` / `service.*` spans (from `wrapService`) — `duration.ms`, `error.code`
- `db.error.*` attributes on the failing span — the raw Postgres
  `db.error.code` / `db.error.message` **before** it was collapsed into a
  generic `ERROR_BAD_REQUEST`

> This is the payoff for the span annotations in `supabase-errors.ts`: a QA 400
> from #142/#143 shows the underlying `23502` constraint message on the span
> instead of a bare `BAD_REQUEST`.

### 4. Pull the correlated Loki logs

From the trace, jump to its logs (Grafana's Tempo→Loki `tracesToLogsV2` uses
`trace_id`). Through the MCP, query Loki for `{service_name="studiq"} |
trace_id="<id>"` (or use the derived field `TraceID`). You get the
`log()` / `warn()` / `error()` records emitted while the span was active —
including a WARN/ERROR line for **every 4xx/5xx response** (`API error 400 BAD_REQUEST`,
with `http.method`, `http.url`, `error.code`), so a failed request is visible in
Loki even when the failure is a handled `ServiceResult` rather than a thrown error.

### 5. Read Prometheus metrics for the window

Check the aggregate impact via the MCP (or the Grafana dashboard):

- `studiq_http_server_request_total{http_status_code=~"5.."}` — error rate
- `histogram_quantile(0.95, sum by (le) (rate(studiq_http_server_duration_milliseconds_bucket[5m])))` — p95 latency
- `sum(studiq_http_server_active_requests)` — in-flight requests
- `studiq_controller_method_duration_milliseconds_bucket` — slowest controller
- `studiq_v8js_memory_heap_used_bytes` / `studiq_nodejs_eventloop_delay_p99_milliseconds` — runtime

### 6. Fix and verify

Make the change, replay the flow, and confirm the dashboard recovers and the
span no longer carries a `db.error.*` annotation.

## Cardinality guardrails

Metric labels must stay bounded. **Never** use `user_id` or `trace_id` as a
metric label. Allowed: `http.method`, `http.route`, `http.status_code`,
`service.name`, `code.function`, `account_type`. `trace_id` belongs on spans
and logs only.

## Parallel QA environments

Several agents can run different scenarios at once. The **Grafana stack stays
shared**; everything that mutates state is per agent.

```bash
scripts/qa-env MGR-MEM-03 1     # start slot 1
scripts/qa-env --list           # running environments
scripts/qa-env --clean MGR-MEM-03
```

A slot gives you:

| | slot 1 | slot 2 | slot 3 |
|---|---|---|---|
| App | `:3010` | `:3011` | `:3012` |
| Supabase API / DB | `:54421` / `:54422` | `:54521` / `:54522` | `:54621` / `:54622` |
| Studio / Mail | `:54423` / `:54424` | `:54523` / `:54524` | `:54623` / `:54624` |
| OTel service | `studiq-MGR-MEM-03` | `studiq-MGR-ACC-01` | … |

### How Supabase is isolated

`supabase/config.toml` has a `project_id` and a fixed port block. The launcher
creates a **detached git worktree** per scenario and rewrites that worktree's
config:

- `project_id = "qa-<scenario>"` — Docker names containers **and volumes** after
  it (`supabase_db_qa-mgr-mem-03`, `supabase_db_qa-mgr-mem-03` volume, …), so
  two stacks coexist without touching each other's data.
- every port is offset by the slot (`54321 + 100*slot`), so `supabase start`
  binds a distinct set.
- the worktree gets its own `apps/web/.env` with that stack's URL + anon key,
  `OTEL_SERVICE_NAME=studiq-<scenario>`, and its app `PORT`.
- `supabase start -x imgproxy,logflare,vector,realtime` keeps the stack small;
  `supabase db reset` seeds it independently, so resets never race.
- `scripts/qa-env --clean` runs `supabase stop --no-backup`, frees the ports and
  removes the worktree.

Because each stack is seeded from the same migrations/seeds, expected results
(e.g. member counts) stay identical across agents.

### Telemetry filtering

The collector keeps one `studiq_` metric namespace but now converts resource
attributes to labels, so:

- Tempo: `{ resource.service.name = "studiq-MGR-MEM-03" }`
- Loki: `{service_name="studiq-MGR-MEM-03"}`
- Prometheus: `studiq_http_server_request_total{service_name="studiq-MGR-MEM-03"}`

Agents read their identity from `qa/env.json` in their worktree (`appUrl`,
`serviceName`, `supabaseUrl`); the QA prompt treats that file as authoritative.

**Sizing:** a trimmed stack is ~1.5–2 GB and a Next dev ~0.5–1 GB. On the 15 GB
dev host, 3 parallel slots plus the shared stack is comfortable; 4 is tight.

