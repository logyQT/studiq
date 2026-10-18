# Prometheus + Grafana Metrics Monitoring (Tempo traces)

**Date:** 2026-09-21
**Status:** Implemented

---

## Problem

We have OpenTelemetry **traces**, but no way to answer basic operational
questions:

- How many requests per second is the API handling?
- What's the p95/p99 latency for `POST /api/v1/flashcards/batch/create`?
- What's the current error rate? Is it trending up?
- How many AI chat sessions are active right now?
- Which controller is the slowest?

Individual traces answer "what happened in this one request?". Aggregate
"how are we doing right now?" questions need a time-series metrics layer,
live dashboards, and correlated logs.

## Architecture

```
StudiQ (Next.js)  ──OTLP/HTTP :4318──►  OTel Collector
  traces + metrics + logs                 ├─ traces  → Tempo
                                          ├─ metrics → Prometheus (:8889 scrape)
                                          └─ logs    → Loki
                                                   │
                                                   ▼
                                                 Grafana (:3001)
                                                   ├─ datasources: Prometheus, Loki, Tempo
                                                   ├─ OTel dashboard + trace↔log correlation by trace_id
                                                   └─ mcp-grafana  ◄── OpenCode agent (traces+logs+metrics)
```

**Tempo is the sole trace backend.** It is Grafana-native (TraceQL) and
`grafana/mcp-grafana` gives first-class Tempo trace tools plus trace↔log
correlation. Jaeger was removed entirely — it is not part of the stack.

### OTel Collector as the single intake

The app sends OTLP to one endpoint; the Collector fans out to Tempo (traces),
Prometheus (metrics) and Loki (logs). The app doesn't care where telemetry
goes.

### Why the Collector

- **Single OTLP endpoint** for the app — no separate trace/metric/log exporter config to wrangle
- **Batching and memory limiting** before data hits backends
- **Fan-out** — add or swap backends without touching app code
- **Standard production pattern** — if we ever move to K8s or Grafana Cloud, the Collector config stays the same

## Changes

### 1. npm packages

```bash
bun add --filter @studiq/web \
  @opentelemetry/sdk-metrics @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/sdk-logs @opentelemetry/exporter-logs-otlp-http
bun add --filter @studiq/server @opentelemetry/api-logs
```

All match the existing `^0.220.0` / `^2.9.0` lines already used by
`@opentelemetry/sdk-node`.

### 2. `apps/web/src/instrumentation.ts`

A `PeriodicExportingMetricReader` (15s interval) and a
`BatchLogRecordProcessor` are added to the `NodeSDK` config:

```ts
const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'studiq',
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV ?? 'development',
  }),
  traceExporter: new OTLPTraceExporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
    exportIntervalMillis: 15_000,
  }),
  logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
  instrumentations: [getNodeAutoInstrumentations()],
});
```

All three exporters send to the same OTLP endpoint
(`OTEL_EXPORTER_OTLP_ENDPOINT`, default `localhost:4318`). The
`OTEL_SDK_DISABLED=true` early-return is preserved — unit tests set it.

### 3. Custom metrics in `packages/server/src/lib/observability.ts`

A shared `metrics.getMeter('studiq')` with reusable instruments:

```ts
export const httpRequestDuration = meter.createHistogram('http.server.duration', { unit: 'ms' });
export const httpRequestTotal = meter.createCounter('http.server.request.total');
export const activeRequests = meter.createUpDownCounter('http.server.active_requests');
export const controllerMethodDuration = meter.createHistogram('controller.method.duration', {
  unit: 'ms',
});
```

The Collector's Prometheus exporter adds the `studiq` namespace, so these land
in Prometheus as `studiq_http_server_duration_milliseconds_bucket`,
`studiq_http_server_request_total`, `studiq_http_server_active_requests` and
`studiq_controller_method_duration_milliseconds_bucket`.

### 4. Wire metrics into the request lifecycle

**`packages/server/src/lib/with-auth.ts`** records, per request:

- `activeRequests.add(1)` on entry / `.add(-1)` in `finally` (labels: `http.method`)
- `httpRequestDuration.record(duration, { http.method, http.status_code })`
- `httpRequestTotal.add(1, { http.method, http.status_code })`

**`packages/server/src/lib/observability.ts`** records `controllerMethodDuration`
in `withSupervision`'s `finally` (labels: `service.name`, `code.function`).

### 5. Correlation — the part that makes agent debugging exact

- **`with-auth.ts`** now sets `ctx.traceId = span.spanContext().traceId`
  (was `crypto.randomUUID()`) and sets `x-trace-id` on **every** response
  (success and `catch` paths). Every API response therefore carries the Tempo
  trace id.
- **`supabase-errors.ts`** annotates `trace.getActiveSpan()` with
  `db.system`, `db.error.code`, `db.error.message`, `db.error.details` and
  `db.error.hint` in both `toDbFailure()` and `mapSupabaseError()` before the
  raw Postgres error is collapsed into a generic `AppErrorCode`. This turns
  the QA 400s (#142/#143) into a visible Postgres `23502` constraint message
  on the span.
- `withSupervision` surfaces the application error `code` as a span attribute
  so thrown `AppError`s are not bare 500s.

### 6. Logs → Loki

- Logs flow through the OTel Logs pipeline, so each record automatically
  carries the active `trace_id` / `span_id`.
- `packages/server/src/lib/log.ts` is a minimal `log()` / `warn()` / `error()`
  helper over `logs.getLogger('studiq')`. `console.error` inside `withAuth`
  and `handleApiError` routes through it.
- **This is the single deliberate exception to the "no logger module" rule in
  `AGENTS.md`.** Do not add a second logging abstraction.
- Fallback only if an app-level log shipper is rejected: scrape container
  stdout via Alloy/Promtail → Loki with `trace_id` in the console line.

### 7. Docker Compose stack

`docker-compose.yml` runs the full local stack:

| Service | Image | Ports |
|---------|-------|-------|
| `otel-collector` | `otel/opentelemetry-collector-contrib` | `4317` (gRPC), `4318` (HTTP), `8889` (Prometheus exporter) |
| `tempo` | `grafana/tempo` | `3200` (HTTP API) |
| `loki` | `grafana/loki` | `3100` |
| `prometheus` | `prom/prometheus` | `9090` |
| `grafana` | `grafana/grafana` | `3001` |

Config files: `otel-collector-config.yml`, `tempo.yml`, `loki-config.yml`,
`prometheus.yml`, `grafana/provisioning/{datasources,dashboards}/`.

**Breaking change:** Port 4318 is now owned by the Collector instead of the
trace backend directly. Update `OTEL_EXPORTER_OTLP_ENDPOINT` if pointing at a
non-localhost collector (e.g. `http://otel-collector:4318` in Docker networks).

### 8. OTel Collector config (`otel-collector-config.yml`)

```yaml
receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }

processors:
  memory_limiter: { check_interval: 1s, limit_mib: 512 }
  batch: { timeout: 5s, send_batch_size: 1024 }

exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls: { insecure: true }
  prometheus:
    endpoint: 0.0.0.0:8889
    namespace: studiq
  otlphttp/loki:
    endpoint: http://loki:3100/otlp
    tls: { insecure: true }

service:
  pipelines:
    traces:  { receivers: [otlp], processors: [memory_limiter, batch], exporters: [otlp/tempo] }
    metrics: { receivers: [otlp], processors: [memory_limiter, batch], exporters: [prometheus] }
    logs:    { receivers: [otlp], processors: [memory_limiter, batch], exporters: [otlphttp/loki] }
```

### 9. Prometheus scrape config (`prometheus.yml`)

Prometheus scrapes the Collector's Prometheus exporter (`:8889`) for
application metrics and the Collector's own telemetry (`:8888`).

### 10. Grafana provisioning

- Datasources: Prometheus, Loki, Tempo (uids `prometheus`, `loki`, `tempo`).
- **Tempo → Loki correlation** via `tracesToLogsV2` (filter by `trace_id`), and
  a **Loki derived field** on the `trace_id` structured-metadata label that
  jumps to the Tempo trace.
- Dashboard: `grafana/dashboards/otel-dashboard.json` — request rate, p95/p99
  latency, error rate, active requests, controller breakdown and Node runtime
  metrics.

> **Note on community dashboard #15757.** The original plan referenced Grafana
> community dashboard `15757` as the "OpenTelemetry" dashboard. That id now
> resolves to *Kubernetes / Views / Global*, which queries `kube_*` metrics and
> is not useful for StudiQ's OTLP metrics. We ship a purpose-built StudiQ OTel
> dashboard instead.

### 11. Node.js runtime metrics

`getNodeAutoInstrumentations()` includes `@opentelemetry/instrumentation-runtime-node`,
which emits `nodejs.eventloop.delay.*`, `nodejs.eventloop.utilization`,
`v8js.memory.heap.*`, `v8js.gc.duration` and `v8js.resource.active`. These
appear automatically once the `MetricReader` is configured.

## Dev vs. Prod

| | Dev | Prod |
|--|-----|------|
| **Collector** | Docker Compose (local) | Deploy separately (Docker/K8s) or use Grafana Cloud OTLP endpoint |
| **Prometheus** | Docker Compose (local) | Managed (Grafana Cloud, AWS Managed Prometheus) or self-hosted |
| **Grafana** | Docker Compose at :3001 | Managed or self-hosted |
| **Tempo** | Docker Compose at :3200 | Same pattern, or Tempo on Grafana Cloud |
| **Loki** | Docker Compose at :3100 | Same pattern, or Loki on Grafana Cloud |
| **OTEL_SDK_DISABLED** | Can disable to skip overhead | Always enabled |
| **Alerting** | Not needed | Prometheus Alertmanager or Grafana alerts |

### Production path: Grafana Cloud (simplest)

If we don't want to self-host the stack in prod, **Grafana Cloud** offers an
OTLP ingestion endpoint (app sends directly — no Collector needed) plus
Prometheus, Tempo, Loki and Mimir. The Collector config stays identical — only
the endpoint URL changes.

## What This Unlocks

### Live dev monitoring

`docker compose up` → open Grafana at `:3001` → see real-time request rate,
latency, error rate while developing. Catches regressions before they ship.

### Debugging workflow (also the agent loop)

1. Reproduce the issue in the browser.
2. Read the failing request's `x-trace-id` response header.
3. Query that trace in Tempo (via the Grafana MCP or the Grafana UI).
4. Pull the correlated Loki logs for the same `trace_id`.
5. Read Prometheus metrics for the time window to see the aggregate impact.
6. Fix, then watch the dashboard recover.

See [`docs/observability-debugging.md`](../observability-debugging.md) for the
full agent-driven loop.

## Open Questions

1. **Prometheus remote write vs. scrape?** Scrape is fine for now; remote write if we hit scale limits.
2. **Metric naming convention?** Follow [OTel HTTP semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/) to stay compatible with community dashboards.
3. **Custom metric cardinality?** Labels like `user_id` or `trace_id` must NOT be used as metric labels (high cardinality = TSDB explosion). Use `http.method`, `http.route`, `http.status_code`, `account_type` — bounded label sets only.
