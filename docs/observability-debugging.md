# Agent-Driven Live Debugging (Tempo + Loki + Prometheus)

This is the operational loop for going from "something failed in the browser"
to "here is the exact Postgres error and the log lines around it" without
guessing. It is driven end-to-end by the OpenCode agent through the
[`grafana/mcp-grafana`](https://github.com/grafana/mcp-grafana) MCP server.

**Tempo is the only trace backend.** Jaeger is gone; all trace queries use
Tempo / TraceQL.

## Start the stack (once per machine)

The observability stack is **machine-wide**, owned by the **primary checkout** —
not per checkout or worktree. On this VM the primary is `/workspaces/studiq`;
find it with `git worktree list` (first entry). Start it from there, never from a
worktree:

```bash
cd /workspaces/studiq
docker compose up -d
```

The Compose project name is fixed (`studiq-observability`) and the host ports are
fixed, so starting it from a worktree conflicts with or mutates the same stack.
Check health and get the exact start command with `bun run env:doctor`.

If `env:doctor` reports a partial stack (Grafana answers, Tempo/Loki/Prometheus
do not), an older observability Compose project is probably holding the 7000-range
host ports.
Identify it with `docker compose ls`; if the name is ambiguous, inspect the
container publishing the port (`docker ps --filter publish=7001`) and read its
`com.docker.compose.project` / `...project.working_dir` labels. Stop that
project **from its own directory**, before starting the canonical stack from the
primary checkout. `compose down` keeps named volumes unless you pass `-v`; do
not pass `-v` unless you mean to delete its data.

If the owning directory no longer exists, stop only the container holding the
port (`docker ps --filter publish=7001` → `docker stop <container>`), then start
the canonical stack. Never use an unscoped `docker rm` or `pkill`.

The primary checkout must contain `name: studiq-observability` in its
`docker-compose.yml`; if `env:doctor` says it predates the fixed project name,
update that checkout first.

| UI         | URL                                       |
| ---------- | ----------------------------------------- |
| Grafana    | http://localhost:7001 (`admin` / `admin`) |
| Prometheus | http://localhost:7090                     |
| Tempo API  | http://localhost:7200                     |
| Loki       | http://localhost:7100                     |
| OTLP       | http://localhost:7318                     |

The Next.js app sends OTLP (traces + metrics + logs) to the collector on
`http://localhost:7318`. `env:ensure` sets that endpoint and a per-checkout
`OTEL_SERVICE_NAME` (`studiq-<branch>`) so one collector can tell worktrees apart;
an explicit value in `.env.local` wins. Make sure `OTEL_SDK_DISABLED` is **not**
`true` when you want telemetry. See the
[plan doc](./plans/prometheus-metrics-monitoring.md).

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
          "GRAFANA_URL": "http://localhost:7001",
          "GRAFANA_SERVICE_ACCOUNT_TOKEN": "{env:GRAFANA_SERVICE_ACCOUNT_TOKEN}",
        },
      },
    },
  },
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
  "-e", "GRAFANA_URL=http://localhost:7001",
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
`trace_id`). Through the MCP, query Loki for
`{service_name="studiq-<branch>"} | trace_id="<id>"` (or use the derived field
`TraceID`; `service_name=~"studiq-.*"` searches every checkout). You get the
`log()` / `warn()` / `error()` records emitted while the span was active —
including a WARN/ERROR line for **every 4xx/5xx response** (`API error 400 BAD_REQUEST`,
with `http.method`, `http.url`, `error.code`), so a failed request is visible in
Loki even when the failure is a handled `ServiceResult` rather than a thrown error.

### 5. Read Prometheus metrics for the window

Check the aggregate impact via the MCP (or the Grafana dashboard; its
**Service** variable filters every panel by `service_name`, so pick your
`studiq-<branch>`):

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
